import type { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { LiveSession, User } from "@repo/shared";
import { audit } from "../lib/audit";
import type { Host } from "../lib/hosts";
import { now } from "../lib/sessions";
import { mintUserCert } from "./certs";

export type LiveTerminal = LiveSession & { kill: (reason: string) => void };

export type TerminalDeps = {
    db: Database;
    caKey: string;
    caPassword: string | undefined;
    idleMs: number;
    maxMs: number;
    taskMs: number;
    /** Per user: terminals + running task targets. */
    maxSessions: number;
    /** All users together. */
    maxSessionsTotal: number;
    /** Open terminals by session ID, for admins to list and end. */
    live: Map<string, LiveTerminal>;
    /** `remote`: a task's command; absent for a terminal. */
    command?: (args: {
        key: string;
        knownHosts: string;
        login: string;
        host: Host;
        remote?: string;
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
    remote,
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
    ...(remote === undefined ? [] : [remote]),
];

export const sshArgv = (
    deps: TerminalDeps,
    args: Parameters<typeof sshCommand>[0],
) => (deps.command ?? sshCommand)(args);

/** Mints a cert for `ws:<host>:<login>` into a new temp dir. The caller removes `dir`. */
export async function signSession(
    deps: TerminalDeps,
    user: User,
    host: Host,
    login: string,
    ip: string,
    opts: { pty?: boolean; run?: string } = {},
) {
    const sessionId = crypto.randomUUID();
    const principal = `ws:${host.id}:${login}`;
    const dir = await mkdtemp(`${tmpdir()}/s-`);
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
            pty: opts.pty,
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
            run: opts.run,
        });
        return {
            sessionId,
            principal,
            dir,
            key,
            knownHosts: `${dir}/known_hosts`,
        };
    } catch (err) {
        await rm(dir, { recursive: true, force: true });
        throw err;
    }
}

export async function openTerminal(
    deps: TerminalDeps,
    user: User,
    host: Host,
    login: string,
    ip: string,
    handlers: TerminalHandlers,
) {
    const { sessionId, principal, dir, key, knownHosts } = await signSession(
        deps,
        user,
        host,
        login,
        ip,
    );
    let proc: Bun.Subprocess;
    try {
        proc = Bun.spawn(sshArgv(deps, { key, knownHosts, login, host }), {
            // ssh forwards TERM to the remote pty; the container has none, so curses apps like top exit.
            env: { ...process.env, TERM: "xterm-256color" },
            terminal: {
                cols: handlers.cols,
                rows: handlers.rows,
                data: (_t, data) => handlers.onData(data),
            },
        });
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
    deps.live.set(sessionId, {
        id: sessionId,
        sub: user.sub,
        email: user.email,
        hostId: host.id,
        hostName: host.name,
        login,
        startedAt: Date.now(),
        kill,
    });
    let idle = setTimeout(() => kill("idle timeout"), deps.idleMs);
    const max = setTimeout(() => kill("max session length"), deps.maxMs);

    proc.exited.then(async (code) => {
        deps.live.delete(sessionId);
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
