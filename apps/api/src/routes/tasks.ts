import type { Database } from "bun:sqlite";
import {
    detached,
    type RunDetail,
    type RunHost,
    type RunStatus,
    type RunSummary,
    type RunTarget,
    type Task,
} from "@repo/shared";
import { type Context, Hono } from "hono";
import type { Config } from "../config";
import { audit } from "../lib/audit";
import { allowedHost, type Host } from "../lib/hosts";
import { jsonBody, writeGuards } from "../lib/http";
import type { AppEnv } from "../lib/sessions";
import { validName, validScript } from "../lib/validate";
import { taskRunner } from "../ssh/runner";
import type { TerminalDeps } from "../ssh/terminal";

const MAX_TARGETS = 50;
const MAX_TASKS = 100;

type Deps = {
    config: Config;
    db: Database;
    terminal: TerminalDeps;
    signLimit: (key: string) => boolean;
};

export function taskRoutes({ config, db, terminal, signLimit }: Deps) {
    const app = new Hono<AppEnv>();
    app.use(...writeGuards(config));

    const runner = taskRunner(db, terminal);

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
        if (input.detach !== undefined && typeof input.detach !== "boolean")
            return "invalid detach";
        return {
            name: input.name,
            script: input.script,
            detach: input.detach ? 1 : 0,
            targets: JSON.stringify(
                targets.map(({ host, login }) => ({ host: host.id, login })),
            ),
        };
    }

    const getTask = (id: string, sub: string) =>
        db
            .query<
                {
                    id: number;
                    name: string;
                    script: string;
                    targets: string;
                    detach: number;
                },
                [number, string]
            >(
                "SELECT id, name, script, targets, detach FROM tasks WHERE id = ? AND sub = ?",
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
                        detach: number;
                    },
                    [string]
                >(
                    "SELECT id, name, script, targets, detach FROM tasks WHERE sub = ? ORDER BY name, id",
                )
                .all(sub)
                .map((t) => ({
                    ...t,
                    targets: JSON.parse(t.targets),
                    detach: !!t.detach,
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
                "INSERT INTO tasks (sub, name, script, targets, detach) VALUES (?, ?, ?, ?, ?)",
                [
                    c.var.user.sub,
                    task.name,
                    task.script,
                    task.targets,
                    task.detach,
                ],
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
            "UPDATE tasks SET name = ?, script = ?, targets = ?, detach = ? WHERE id = ?",
            [
                task.name,
                task.script,
                task.targets,
                task.detach,
                Number(c.req.param("id")),
            ],
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
                "INSERT INTO runs (id, task_id, sub, email, name, script, detach, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                [
                    runId,
                    task.id,
                    user.sub,
                    user.email,
                    task.name,
                    task.script,
                    task.detach,
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
            detach: !!task.detach,
            targets: targets.map(({ host, login }) => `${host.id}:${login}`),
        });
        const remote = task.detach ? detached(task.script) : task.script;
        for (const { host, login } of targets)
            void runner.run(user, ip, runId, host, login, remote);
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
                    detach: number;
                    created_at: number;
                },
                [string, string]
            >(
                "SELECT task_id, name, script, detach, created_at FROM runs WHERE id = ? AND sub = ?",
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
                        runner.liveOutput(id, h.host_id, h.login) ?? h.output,
                }),
            );
        return c.json<RunDetail>({
            id,
            taskId: run.task_id,
            name: run.name,
            script: run.script,
            detach: !!run.detach,
            createdAt: run.created_at,
            hosts,
        });
    });

    return app;
}
