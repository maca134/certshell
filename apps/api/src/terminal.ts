import type { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { audit } from "./audit";
import { mintUserCert } from "./certs";
import type { Host } from "./hosts";
import { now, type User } from "./sessions";

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

type TerminalHandlers = {
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

export async function openTerminal(
    deps: TerminalDeps,
    user: User,
    host: Host,
    login: string,
    ip: string,
    handlers: TerminalHandlers,
) {
    const sessionId = crypto.randomUUID();
    const principal = `ws:${host.id}:${login}`;
    const dir = await mkdtemp(`${tmpdir()}/s-`);
    let proc: Bun.Subprocess;
    try {
        const serial = Number(
            deps.db.run(
                "INSERT INTO signs (created_at, sub, email, principal, host_id, session_id) VALUES (?, ?, ?, ?, ?, ?)",
                [now(), user.sub, user.email, principal, host.id, sessionId],
            ).lastInsertRowid,
        );
        const key = await mintUserCert({
            caKey: deps.caKey,
            caPassword: deps.caPassword,
            dir,
            principal,
            // Some IdPs let users edit their email; a `/` or newline would forge the key ID in target sshd logs.
            keyId: `${(user.email ?? "").replace(/[/\p{Cc}]/gu, "_")}/${user.sub}/${sessionId}`,
            serial,
        });
        await Bun.write(
            `${dir}/known_hosts`,
            `${host.address} ${host.host_key}\n`,
        );
        audit(deps.db, {
            event: "sign",
            sub: user.sub,
            email: user.email,
            ip,
            principal,
            host: host.id,
            ttl: "15m",
            serial,
            session: sessionId,
        });
        proc = Bun.spawn(
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
    } catch (err) {
        await rm(dir, { recursive: true, force: true });
        throw err;
    }
    audit(deps.db, {
        event: "session_start",
        sub: user.sub,
        email: user.email,
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
        audit(deps.db, {
            event: "session_end",
            sub: user.sub,
            email: user.email,
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
