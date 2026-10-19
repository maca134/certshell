import type { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { LiveSession, User } from "@repo/shared";
import { audit } from "../lib/audit";
import { allowedHost, type Host } from "../lib/hosts";
import { now } from "../lib/sessions";
import { mintUserCert } from "./certs";

export type LiveTerminal = LiveSession & {
    groups: string[];
    kill: (reason: string) => void;
};

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
    /** Running task targets by `runId/hostId/login`. */
    tasks: Map<
        string,
        {
            sub: string;
            groups: string[];
            hostId: string;
            login: string;
            kill: () => void;
        }
    >;
    /** When an admin last ended each user's sessions, by sub. A sign started before that is dropped. */
    endedAt: Map<string, number>;
    /** `remote`: a task's command; absent for a terminal. */
    command?: (args: {
        key: string;
        knownHosts: string;
        /** `-E`: ssh's own messages go here, apart from the remote output a user controls. */
        log?: string;
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
    log,
    login,
    host,
    remote,
}) => [
    "ssh",
    ...(log === undefined ? [] : ["-E", log]),
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

/** True when ssh refused the host because its key isn't the one pinned at enrollment. `log`: ssh's `-E` file. */
export const hostKeyRejected = (code: number | null, log: string) =>
    code === 255 && log.includes("Host key verification failed.");

export const readLog = (path: string) =>
    Bun.file(path)
        .text()
        .catch(() => "");

export const sshArgv = (
    deps: TerminalDeps,
    args: Parameters<typeof sshCommand>[0],
) => (deps.command ?? sshCommand)(args);

/**
 * Mints a cert for `ws:<host>:<login>` into a new temp dir. The caller removes `dir`.
 * `system`: the app itself (host facts), on a login an admin picked; skips the user access checks.
 */
export async function signSession(
    deps: TerminalDeps,
    user: User,
    host: Host,
    login: string,
    ip: string,
    opts: { pty?: boolean; run?: string; system?: boolean } = {},
) {
    const started = Date.now();
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
        if (!opts.system) {
            if ((deps.endedAt.get(user.sub) ?? -1) >= started)
                throw new Error("ended by admin");
            if (!allowedHost(deps.db, host.id, login, user.groups))
                throw new Error("access revoked");
        }
        return {
            sessionId,
            principal,
            dir,
            key,
            knownHosts: `${dir}/known_hosts`,
            log: `${dir}/ssh.log`,
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
    const { sessionId, principal, dir, key, knownHosts, log } =
        await signSession(deps, user, host, login, ip);
    let proc: Bun.Subprocess;
    try {
        proc = Bun.spawn(sshArgv(deps, { key, knownHosts, log, login, host }), {
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
    try {
        audit(deps.db, {
            event: "session_start",
            sub: user.sub,
            email: user.email,
            principal,
            session: sessionId,
        });
    } catch (err) {
        proc.kill();
        await rm(dir, { recursive: true, force: true });
        throw err;
    }

    let reason: string | undefined;
    // Input can still arrive after a kill or exit; the closed pty would throw on it.
    let ended = false;
    const kill = (why: string) => {
        reason = why;
        ended = true;
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
        groups: user.groups,
        kill,
    });
    let idle = setTimeout(() => kill("idle timeout"), deps.idleMs);
    const max = setTimeout(() => kill("max session length"), deps.maxMs);

    proc.exited.then(async (code) => {
        ended = true;
        deps.live.delete(sessionId);
        clearTimeout(idle);
        clearTimeout(max);
        proc.terminal?.close();
        const sshErrors = await readLog(log);
        if (sshErrors)
            handlers.onData(
                new TextEncoder().encode(
                    sshErrors.replaceAll(/\r?\n/g, "\r\n"),
                ),
            );
        await rm(dir, { recursive: true, force: true });
        reason ??= code === 0 ? "exited" : `ssh exited with code ${code}`;
        try {
            audit(deps.db, {
                event: "session_end",
                sub: user.sub,
                email: user.email,
                principal,
                session: sessionId,
                reason,
                code,
            });
            if (hostKeyRejected(code, sshErrors))
                audit(deps.db, {
                    event: "host_key_mismatch",
                    sub: user.sub,
                    email: user.email,
                    host: host.id,
                    name: host.name,
                    login,
                });
        } catch (err) {
            console.warn(`session end not audited: ${err}`);
        }
        handlers.onExit(reason);
    });

    return {
        write(data: string | Uint8Array) {
            if (ended) return;
            clearTimeout(idle);
            idle = setTimeout(() => kill("idle timeout"), deps.idleMs);
            proc.terminal?.write(data);
        },
        resize(cols: number, rows: number) {
            if (!ended) proc.terminal?.resize(cols, rows);
        },
        close() {
            kill("closed");
        },
    };
}
