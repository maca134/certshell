import type { Database } from "bun:sqlite";
import { rm } from "node:fs/promises";
import type { RunStatus, User } from "@repo/shared";
import { audit } from "../lib/audit";
import type { Host } from "../lib/hosts";
import { signSession, sshArgv, type TerminalDeps } from "./terminal";

const MAX_OUTPUT = 256 * 1024;
const TRUNCATED = "[earlier output dropped]\n";

export function taskRunner(db: Database, terminal: TerminalDeps) {
    // Output of targets still running, by `runId/hostId/login`; the DB gets it when each one ends.
    const live = new Map<string, string>();

    db.run(
        "UPDATE run_hosts SET status = 'failed', output = output || ?, finished_at = ? WHERE status = 'running'",
        ["\n[interrupted: app restarted]", Date.now()],
    );

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
                let ended = false;
                const timer = setTimeout(() => {
                    timedOut = true;
                    proc.kill();
                }, terminal.taskMs);
                terminal.tasks.set(key, {
                    sub: user.sub,
                    kill: () => {
                        ended = true;
                        proc.kill();
                    },
                });
                const pump = async (stream: ReadableStream<Uint8Array>) => {
                    const decoder = new TextDecoder();
                    for await (const chunk of stream)
                        append(decoder.decode(chunk, { stream: true }));
                };
                await Promise.all([pump(proc.stdout), pump(proc.stderr)]);
                const exit = await proc.exited;
                clearTimeout(timer);
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

    return {
        run,
        liveOutput: (runId: string, hostId: string, login: string) =>
            live.get(`${runId}/${hostId}/${login}`),
    };
}
