import type { Database } from "bun:sqlite";
import { rm } from "node:fs/promises";
import type {
    RunDetail,
    RunHost,
    RunStatus,
    RunSummary,
    SavedCommand,
    User,
} from "@repo/shared";
import { Hono } from "hono";
import { jsonBody, writeGuards } from "./admin";
import { audit } from "./audit";
import type { Config } from "./config";
import { allowedHost, type Host } from "./hosts";
import type { AppEnv } from "./sessions";
import { signSession, sshArgv, type TerminalDeps } from "./terminal";
import { validCommand, validName } from "./validate";

const MAX_TARGETS = 50;
const MAX_OUTPUT = 256 * 1024;
const MAX_SAVED = 100;
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
        command: string,
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
                        remote: command,
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

    app.get("/commands", (c) =>
        c.json<SavedCommand[]>(
            db
                .query<SavedCommand, [string]>(
                    "SELECT id, name, command FROM commands WHERE sub = ? ORDER BY name, id",
                )
                .all(c.var.user.sub),
        ),
    );

    app.post("/commands", async (c) => {
        const input = await jsonBody(c);
        if (!validName(input?.name))
            return c.json({ error: "invalid name" }, 400);
        if (!validCommand(input?.command))
            return c.json({ error: "invalid command" }, 400);
        const { n } = db
            .query<{ n: number }, [string]>(
                "SELECT count(*) AS n FROM commands WHERE sub = ?",
            )
            .get(c.var.user.sub) ?? { n: 0 };
        if (n >= MAX_SAVED)
            return c.json(
                { error: `at most ${MAX_SAVED} saved commands` },
                400,
            );
        const id = Number(
            db.run(
                "INSERT INTO commands (sub, name, command) VALUES (?, ?, ?)",
                [c.var.user.sub, input.name, input.command],
            ).lastInsertRowid,
        );
        return c.json({ id }, 201);
    });

    app.delete("/commands/:id", (c) => {
        const { changes } = db.run(
            "DELETE FROM commands WHERE id = ? AND sub = ?",
            [Number(c.req.param("id")), c.var.user.sub],
        );
        return changes
            ? c.body(null, 204)
            : c.json({ error: "not found" }, 404);
    });

    app.post("/runs", async (c) => {
        const { user, ip } = c.var;
        const input = await jsonBody(c);
        const command = input?.command;
        if (!validCommand(command))
            return c.json({ error: "invalid command" }, 400);
        const raw = input?.targets;
        if (!Array.isArray(raw) || !raw.length || raw.length > MAX_TARGETS)
            return c.json(
                { error: `expected 1 to ${MAX_TARGETS} targets` },
                400,
            );
        const targets = new Map<string, { host: Host; login: string }>();
        for (const t of raw as { host?: unknown; login?: unknown }[]) {
            if (typeof t?.host !== "string" || typeof t?.login !== "string")
                return c.json({ error: "invalid target" }, 400);
            const host = allowedHost(db, t.host, t.login, user.groups);
            if (!host) return c.json({ error: "forbidden" }, 403);
            targets.set(`${host.id}:${t.login}`, { host, login: t.login });
        }
        if (!signLimit(user.sub))
            return c.json({ error: "too many sessions, slow down" }, 429);

        const runId = crypto.randomUUID();
        db.transaction(() => {
            db.run(
                "INSERT INTO runs (id, sub, email, command, created_at) VALUES (?, ?, ?, ?, ?)",
                [runId, user.sub, user.email, command, Date.now()],
            );
            for (const { host, login } of targets.values())
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
            command,
            targets: [...targets.keys()],
        });
        for (const { host, login } of targets.values())
            void runTarget(user, ip, runId, host, login, command);
        return c.json({ id: runId }, 201);
    });

    app.get("/runs", (c) =>
        c.json<RunSummary[]>(
            db
                .query<
                    {
                        id: string;
                        command: string;
                        created_at: number;
                        running: number;
                        ok: number;
                        failed: number;
                    },
                    [string]
                >(
                    `SELECT r.id, r.command, r.created_at,
                       sum(h.status = 'running') AS running, sum(h.status = 'ok') AS ok, sum(h.status = 'failed') AS failed
                     FROM runs r JOIN run_hosts h ON h.run_id = r.id
                     WHERE r.sub = ?
                     GROUP BY r.id ORDER BY r.created_at DESC LIMIT 50`,
                )
                .all(c.var.user.sub)
                .map((r) => ({
                    id: r.id,
                    command: r.command,
                    createdAt: r.created_at,
                    counts: { running: r.running, ok: r.ok, failed: r.failed },
                })),
        ),
    );

    app.get("/runs/:id", (c) => {
        const id = c.req.param("id");
        const run = db
            .query<{ command: string; created_at: number }, [string, string]>(
                "SELECT command, created_at FROM runs WHERE id = ? AND sub = ?",
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
            command: run.command,
            createdAt: run.created_at,
            hosts,
        });
    });

    return app;
}
