import type { Database } from "bun:sqlite";
import { rm } from "node:fs/promises";
import type {
    RunDetail,
    RunHost,
    RunStatus,
    RunSummary,
    RunTarget,
    Task,
    User,
} from "@repo/shared";
import { type Context, Hono } from "hono";
import { jsonBody, writeGuards } from "./admin";
import { audit } from "./audit";
import type { Config } from "./config";
import { allowedHost, type Host } from "./hosts";
import type { AppEnv } from "./sessions";
import { signSession, sshArgv, type TerminalDeps } from "./terminal";
import { validName, validScript } from "./validate";

const MAX_TARGETS = 50;
const MAX_OUTPUT = 256 * 1024;
const MAX_TASKS = 100;
const TRUNCATED = "[earlier output dropped]\n";

type Deps = {
    config: Config;
    db: Database;
    terminal: TerminalDeps;
    signLimit: (key: string) => boolean;
};

export function taskRoutes({ config, db, terminal, signLimit }: Deps) {
    const app = new Hono<AppEnv>();
    app.use(...writeGuards(config));

    // Output of targets still running, by `runId/hostId/login`; the DB gets it when each one ends.
    const live = new Map<string, string>();

    db.run(
        "UPDATE run_hosts SET status = 'failed', output = output || ?, finished_at = ? WHERE status = 'running'",
        ["\n[interrupted: app restarted]", Date.now()],
    );

    async function runTarget(
        user: User,
        ip: string,
        runId: string,
        host: Host,
        login: string,
        script: string,
    ) {
        const key = `${runId}/${host.id}/${login}`;
        let output = "";
        let dropped = false;
        const append = (text: string) => {
            output += text;
            if (output.length > MAX_OUTPUT) {
                output = output.slice(-MAX_OUTPUT);
                dropped = true;
            }
            live.set(key, output);
        };
        let code: number | null = null;
        try {
            const s = await signSession(terminal, user, host, login, ip, {
                pty: false,
                run: runId,
            });
            try {
                const proc = Bun.spawn(
                    sshArgv(terminal, {
                        key: s.key,
                        knownHosts: s.knownHosts,
                        login,
                        host,
                        remote: script,
                    }),
                    { stdin: "ignore", stdout: "pipe", stderr: "pipe" },
                );
                let timedOut = false;
                const timer = setTimeout(() => {
                    timedOut = true;
                    proc.kill();
                }, terminal.taskMs);
                const pump = async (stream: ReadableStream<Uint8Array>) => {
                    const decoder = new TextDecoder();
                    for await (const chunk of stream)
                        append(decoder.decode(chunk, { stream: true }));
                };
                await Promise.all([pump(proc.stdout), pump(proc.stderr)]);
                const exit = await proc.exited;
                clearTimeout(timer);
                if (timedOut) append("\n[timed out]");
                else code = exit;
            } finally {
                await rm(s.dir, { recursive: true, force: true });
            }
        } catch (err) {
            console.warn(`task failed: ${err}`);
            append("\n[failed to start]");
        }
        const status: RunStatus = code === 0 ? "ok" : "failed";
        db.run(
            "UPDATE run_hosts SET status = ?, exit_code = ?, output = ?, finished_at = ? WHERE run_id = ? AND host_id = ? AND login = ?",
            [
                status,
                code,
                (dropped ? TRUNCATED : "") + output,
                Date.now(),
                runId,
                host.id,
                login,
            ],
        );
        live.delete(key);
        audit(db, {
            event: "task_end",
            sub: user.sub,
            email: user.email,
            run: runId,
            host: host.id,
            login,
            status,
            code,
        });
    }

    // Each target must be a host + login the user's groups allow, now.
    function resolveTargets(raw: unknown, groups: string[]) {
        if (!Array.isArray(raw) || !raw.length || raw.length > MAX_TARGETS)
            return `expected 1 to ${MAX_TARGETS} targets`;
        const targets = new Map<string, { host: Host; login: string }>();
        for (const t of raw as Partial<RunTarget>[]) {
            const host =
                typeof t?.host === "string" && typeof t?.login === "string"
                    ? allowedHost(db, t.host, t.login, groups)
                    : undefined;
            if (!host || !t.login)
                return `no access to ${JSON.stringify(t?.login)} on ${JSON.stringify(t?.host)}`;
            targets.set(`${host.id}:${t.login}`, { host, login: t.login });
        }
        return [...targets.values()];
    }

    async function parseTask(c: Context<AppEnv>) {
        const input = await jsonBody(c);
        if (!validName(input?.name)) return "invalid name";
        if (!validScript(input?.script)) return "invalid script";
        const targets = resolveTargets(input?.targets, c.var.user.groups);
        if (typeof targets === "string") return targets;
        return {
            name: input.name,
            script: input.script,
            targets: JSON.stringify(
                targets.map(({ host, login }) => ({ host: host.id, login })),
            ),
        };
    }

    const getTask = (id: string, sub: string) =>
        db
            .query<
                { id: number; name: string; script: string; targets: string },
                [number, string]
            >(
                "SELECT id, name, script, targets FROM tasks WHERE id = ? AND sub = ?",
            )
            .get(Number(id), sub);

    const summaries = (where: string, ...params: (string | number)[]) =>
        db
            .query<
                {
                    id: string;
                    task_id: number;
                    name: string;
                    created_at: number;
                    running: number;
                    ok: number;
                    failed: number;
                },
                (string | number)[]
            >(
                `SELECT r.id, r.task_id, r.name, r.created_at,
                   sum(h.status = 'running') AS running, sum(h.status = 'ok') AS ok, sum(h.status = 'failed') AS failed
                 FROM runs r JOIN run_hosts h ON h.run_id = r.id
                 WHERE ${where}
                 GROUP BY r.id ORDER BY r.created_at DESC LIMIT 50`,
            )
            .all(...params)
            .map(
                (r): RunSummary => ({
                    id: r.id,
                    taskId: r.task_id,
                    name: r.name,
                    createdAt: r.created_at,
                    counts: { running: r.running, ok: r.ok, failed: r.failed },
                }),
            );

    app.get("/", (c) => {
        const sub = c.var.user.sub;
        const last = new Map<number, RunSummary>();
        for (const r of summaries("r.sub = ?", sub))
            if (!last.has(r.taskId)) last.set(r.taskId, r);
        return c.json<Task[]>(
            db
                .query<
                    {
                        id: number;
                        name: string;
                        script: string;
                        targets: string;
                    },
                    [string]
                >(
                    "SELECT id, name, script, targets FROM tasks WHERE sub = ? ORDER BY name, id",
                )
                .all(sub)
                .map((t) => ({
                    ...t,
                    targets: JSON.parse(t.targets),
                    lastRun: last.get(t.id),
                })),
        );
    });

    app.post("/", async (c) => {
        const task = await parseTask(c);
        if (typeof task === "string") return c.json({ error: task }, 400);
        const { n } = db
            .query<{ n: number }, [string]>(
                "SELECT count(*) AS n FROM tasks WHERE sub = ?",
            )
            .get(c.var.user.sub) ?? { n: 0 };
        if (n >= MAX_TASKS)
            return c.json({ error: `at most ${MAX_TASKS} tasks` }, 400);
        const id = Number(
            db.run(
                "INSERT INTO tasks (sub, name, script, targets) VALUES (?, ?, ?, ?)",
                [c.var.user.sub, task.name, task.script, task.targets],
            ).lastInsertRowid,
        );
        return c.json({ id }, 201);
    });

    app.put("/:id", async (c) => {
        if (!getTask(c.req.param("id"), c.var.user.sub))
            return c.json({ error: "not found" }, 404);
        const task = await parseTask(c);
        if (typeof task === "string") return c.json({ error: task }, 400);
        db.run(
            "UPDATE tasks SET name = ?, script = ?, targets = ? WHERE id = ?",
            [task.name, task.script, task.targets, Number(c.req.param("id"))],
        );
        return c.body(null, 204);
    });

    app.delete("/:id", (c) => {
        const { changes } = db.run(
            "DELETE FROM tasks WHERE id = ? AND sub = ?",
            [Number(c.req.param("id")), c.var.user.sub],
        );
        return changes
            ? c.body(null, 204)
            : c.json({ error: "not found" }, 404);
    });

    app.post("/:id/run", (c) => {
        const { user, ip } = c.var;
        const task = getTask(c.req.param("id"), user.sub);
        if (!task) return c.json({ error: "not found" }, 404);
        // Access is checked again: groups or the access map may have changed since the task was saved.
        const targets = resolveTargets(JSON.parse(task.targets), user.groups);
        if (typeof targets === "string") return c.json({ error: targets }, 403);
        if (!signLimit(user.sub))
            return c.json({ error: "too many sessions, slow down" }, 429);

        const runId = crypto.randomUUID();
        db.transaction(() => {
            db.run(
                "INSERT INTO runs (id, task_id, sub, email, name, script, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                [
                    runId,
                    task.id,
                    user.sub,
                    user.email,
                    task.name,
                    task.script,
                    Date.now(),
                ],
            );
            for (const { host, login } of targets)
                db.run(
                    "INSERT INTO run_hosts (run_id, host_id, host_name, login, status) VALUES (?, ?, ?, ?, 'running')",
                    [runId, host.id, host.name, login],
                );
        })();
        audit(db, {
            event: "task_run",
            sub: user.sub,
            email: user.email,
            ip,
            run: runId,
            task: task.id,
            script: task.script,
            targets: targets.map(({ host, login }) => `${host.id}:${login}`),
        });
        for (const { host, login } of targets)
            void runTarget(user, ip, runId, host, login, task.script);
        return c.json({ id: runId }, 201);
    });

    app.get("/runs", (c) => c.json(summaries("r.sub = ?", c.var.user.sub)));

    app.get("/runs/:id", (c) => {
        const id = c.req.param("id");
        const run = db
            .query<
                {
                    task_id: number;
                    name: string;
                    script: string;
                    created_at: number;
                },
                [string, string]
            >(
                "SELECT task_id, name, script, created_at FROM runs WHERE id = ? AND sub = ?",
            )
            .get(id, c.var.user.sub);
        if (!run) return c.json({ error: "not found" }, 404);
        const hosts = db
            .query<
                {
                    host_id: string;
                    host_name: string;
                    login: string;
                    status: RunStatus;
                    exit_code: number | null;
                    output: string;
                },
                [string]
            >(
                "SELECT host_id, host_name, login, status, exit_code, output FROM run_hosts WHERE run_id = ? ORDER BY host_name, login",
            )
            .all(id)
            .map(
                (h): RunHost => ({
                    hostId: h.host_id,
                    hostName: h.host_name,
                    login: h.login,
                    status: h.status,
                    exitCode: h.exit_code,
                    output:
                        live.get(`${id}/${h.host_id}/${h.login}`) ?? h.output,
                }),
            );
        return c.json<RunDetail>({
            id,
            taskId: run.task_id,
            name: run.name,
            script: run.script,
            createdAt: run.created_at,
            hosts,
        });
    });

    return app;
}
