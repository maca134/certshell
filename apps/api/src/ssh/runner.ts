import type { Database } from "bun:sqlite";
import { rm } from "node:fs/promises";
import type { RunStatus, User } from "@repo/shared";
import { audit } from "../lib/audit";
import type { Host } from "../lib/hosts";
import {
    hostKeyRejected,
    readLog,
    signSession,
    sshArgv,
    type TerminalDeps,
} from "./terminal";

const MAX_OUTPUT = 256 * 1024;
/** What a run page poll gets of a target still running; it polls every 1.5s. */
const LIVE_TAIL = 8 * 1024;
const TRUNCATED = "[earlier output dropped]\n";

export function taskRunner(db: Database, terminal: TerminalDeps) {
    // Output of targets still running, by `runId/hostId/login`; the DB gets it when each one ends.
    const live = new Map<string, string>();

    const interrupted = db
        .query<
            {
                run_id: string;
                host_id: string;
                login: string;
                sub: string;
                email: string | null;
            },
            []
        >(
            "SELECT h.run_id, h.host_id, h.login, r.sub, r.email FROM run_hosts h JOIN runs r ON r.id = h.run_id WHERE h.status = 'running'",
        )
        .all();
    // One row at a time: the alerter sends task_failed once no target of the run is still running.
    for (const t of interrupted) {
        db.run(
            "UPDATE run_hosts SET status = 'failed', output = output || ?, finished_at = ? WHERE run_id = ? AND host_id = ? AND login = ?",
            [
                "\n[interrupted: app restarted]",
                Date.now(),
                t.run_id,
                t.host_id,
                t.login,
            ],
        );
        audit(db, {
            event: "task_end",
            sub: t.sub,
            email: t.email,
            run: t.run_id,
            host: t.host_id,
            login: t.login,
            status: "failed",
            code: null,
        });
    }

    async function run(
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
        let sshErrors = "";
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
                        log: s.log,
                        login,
                        host,
                        remote: script,
                    }),
                    { stdin: "ignore", stdout: "pipe", stderr: "pipe" },
                );
                let timedOut = false;
                let ended = false;
                const timer = setTimeout(() => {
                    timedOut = true;
                    proc.kill();
                }, terminal.taskMs);
                terminal.tasks.set(key, {
                    sub: user.sub,
                    groups: user.groups,
                    hostId: host.id,
                    login,
                    kill: () => {
                        ended = true;
                        proc.kill();
                    },
                });
                const pump = async (stream: ReadableStream<Uint8Array>) => {
                    const decoder = new TextDecoder();
                    for await (const chunk of stream)
                        append(decoder.decode(chunk, { stream: true }));
                    append(decoder.decode());
                };
                await Promise.all([pump(proc.stdout), pump(proc.stderr)]);
                const exit = await proc.exited;
                clearTimeout(timer);
                sshErrors = await readLog(s.log);
                append(sshErrors);
                terminal.tasks.delete(key);
                if (timedOut) append("\n[timed out]");
                else if (ended) append("\n[ended by admin]");
                else code = exit;
            } finally {
                await rm(s.dir, { recursive: true, force: true });
            }
        } catch (err) {
            console.warn(`task failed: ${err}`);
            append("\n[failed to start]");
        }
        const status: RunStatus = code === 0 ? "ok" : "failed";
        try {
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
        } catch (err) {
            console.warn(`task result for ${key} not saved: ${err}`);
        }
        live.delete(key);
        if (hostKeyRejected(code, sshErrors))
            audit(db, {
                event: "host_key_mismatch",
                sub: user.sub,
                email: user.email,
                host: host.id,
                name: host.name,
                login,
                run: runId,
            });
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

    return {
        run,
        liveOutput: (runId: string, hostId: string, login: string) => {
            const output = live.get(`${runId}/${hostId}/${login}`);
            return output && output.length > LIVE_TAIL
                ? TRUNCATED + output.slice(-LIVE_TAIL)
                : output;
        },
    };
}
