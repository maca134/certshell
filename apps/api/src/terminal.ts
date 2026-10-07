import type { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { mintUserCert } from "./certs";
import type { Host } from "./hosts";
import type { User } from "./sessions";

export type TerminalDeps = {
    db: Database;
    caKey: string;
    caPassword: string | undefined;
    idleMs: number;
    maxMs: number;
    command?: (args: {
        key: string;
        knownHosts: string;
        login: string;
        host: Host;
    }) => string[];
};

export type TerminalHandlers = {
    cols: number;
    rows: number;
    onData: (data: Uint8Array) => void;
    onExit: (reason: string) => void;
};

const sshCommand: NonNullable<TerminalDeps["command"]> = ({
    key,
    knownHosts,
    login,
    host,
}) => [
    "ssh",
    "-i",
    key,
    "-o",
    "IdentitiesOnly=yes",
    "-o",
    `UserKnownHostsFile=${knownHosts}`,
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    "BatchMode=yes",
    "-o",
    "ServerAliveInterval=30",
    "--",
    `${login}@${host.address}`,
];

export const log = (event: Record<string, unknown>) =>
    console.log(JSON.stringify(event));

export async function openTerminal(
    deps: TerminalDeps,
    user: User,
    host: Host,
    login: string,
    handlers: TerminalHandlers,
) {
    const sessionId = crypto.randomUUID();
    const principal = `ws:${host.id}:${login}`;
    const dir = await mkdtemp(`${tmpdir()}/s-`);
    let key: string;
    let serial: number;
    try {
        serial = Number(
            deps.db.run(
                "INSERT INTO signs (created_at, sub, email, principal, host_id, session_id) VALUES (?, ?, ?, ?, ?, ?)",
                [
                    Math.floor(Date.now() / 1000),
                    user.sub,
                    user.email,
                    principal,
                    host.id,
                    sessionId,
                ],
            ).lastInsertRowid,
        );
        key = await mintUserCert({
            caKey: deps.caKey,
            caPassword: deps.caPassword,
            dir,
            principal,
            keyId: `${user.email ?? ""}/${user.sub}/${sessionId}`,
            serial,
        });
        await Bun.write(
            `${dir}/known_hosts`,
            `${host.address} ${host.host_key}\n`,
        );
    } catch (err) {
        await rm(dir, { recursive: true, force: true });
        throw err;
    }
    log({
        event: "sign",
        sub: user.sub,
        email: user.email,
        principal,
        host: host.id,
        ttl: "15m",
        serial,
        session: sessionId,
    });

    const proc = Bun.spawn(
        (deps.command ?? sshCommand)({
            key,
            knownHosts: `${dir}/known_hosts`,
            login,
            host,
        }),
        {
            terminal: {
                cols: handlers.cols,
                rows: handlers.rows,
                data: (_t, data) => handlers.onData(data),
            },
        },
    );
    log({
        event: "session_start",
        sub: user.sub,
        principal,
        session: sessionId,
    });

    let reason: string | undefined;
    const kill = (why: string) => {
        reason = why;
        proc.kill();
    };
    let idle = setTimeout(() => kill("idle timeout"), deps.idleMs);
    const max = setTimeout(() => kill("max session length"), deps.maxMs);

    proc.exited.then(async (code) => {
        clearTimeout(idle);
        clearTimeout(max);
        proc.terminal?.close();
        await rm(dir, { recursive: true, force: true });
        reason ??= code === 0 ? "exited" : `ssh exited with code ${code}`;
        log({
            event: "session_end",
            sub: user.sub,
            principal,
            session: sessionId,
            reason,
            code,
        });
        handlers.onExit(reason);
    });

    return {
        write(data: string | Uint8Array) {
            clearTimeout(idle);
            idle = setTimeout(() => kill("idle timeout"), deps.idleMs);
            proc.terminal?.write(data);
        },
        resize(cols: number, rows: number) {
            proc.terminal?.resize(cols, rows);
        },
        close() {
            kill("closed");
        },
    };
}
