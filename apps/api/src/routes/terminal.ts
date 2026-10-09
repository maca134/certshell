import type { Database } from "bun:sqlite";
import type { ClientMessage } from "@repo/shared";
import { Hono } from "hono";
import { websocket as honoWebsocket, upgradeWebSocket } from "hono/bun";
import type { Config } from "../config";
import { allowedHost, type Host } from "../lib/hosts";
import type { ConcurrencyLimit } from "../lib/ratelimit";
import type { AppEnv } from "../lib/sessions";
import { openTerminal, type TerminalDeps } from "../ssh/terminal";

type Env = AppEnv & { Variables: { host: Host; login: string } };

// Bun's 16MB default × the pre-sign queue could exceed the container's memory limit.
export const websocket = { ...honoWebsocket, maxPayloadLength: 64 * 1024 };

const termSize = (v: unknown, fallback: number) =>
    Math.min(Math.max(Math.trunc(Number(v)) || fallback, 1), 500);

function parseMessage(raw: unknown): ClientMessage | undefined {
    if (typeof raw !== "string") return undefined;
    let msg: unknown;
    try {
        msg = JSON.parse(raw);
    } catch {
        return undefined;
    }
    if (!msg || typeof msg !== "object") return undefined;
    const m = msg as Record<string, unknown>;
    if (m.t === "in" && typeof m.d === "string") return { t: "in", d: m.d };
    if (m.t === "resize")
        return {
            t: "resize",
            cols: termSize(m.cols, 80),
            rows: termSize(m.rows, 24),
        };
    return undefined;
}

export function terminalRoute({
    config,
    db,
    terminal,
    signLimit,
    sshLimit,
}: {
    config: Config;
    db: Database;
    terminal: TerminalDeps;
    signLimit: (key: string) => boolean;
    sshLimit: ConcurrencyLimit;
}) {
    const app = new Hono<Env>();

    app.get(
        "/api/terminal",
        async (c, next) => {
            if (c.req.header("origin") !== config.appUrl.origin)
                return c.json({ error: "bad origin" }, 403);
            const login = c.req.query("login") ?? "";
            const host = allowedHost(
                db,
                c.req.query("host") ?? "",
                login,
                c.var.user.groups,
            );
            if (!host) return c.json({ error: "forbidden" }, 403);
            if (!signLimit(c.var.user.sub))
                return c.json({ error: "too many sessions, slow down" }, 429);
            c.set("host", host);
            c.set("login", login);
            return next();
        },
        upgradeWebSocket((c) => {
            const { user, host, login } = c.var;
            let term: Awaited<ReturnType<typeof openTerminal>> | undefined;
            let closed = false;
            // Input that arrives while the cert is being signed.
            const pending: ClientMessage[] = [];
            const handle = (msg: ClientMessage) => {
                if (!term) {
                    if (pending.length < 256) pending.push(msg);
                } else if (msg.t === "in") term.write(msg.d);
                else term.resize(msg.cols, msg.rows);
            };
            return {
                onOpen(_evt, ws) {
                    if (!sshLimit.acquire(user.sub)) {
                        ws.close(1013, "too many sessions open");
                        return;
                    }
                    openTerminal(terminal, user, host, login, c.var.ip, {
                        cols: termSize(c.req.query("cols"), 80),
                        rows: termSize(c.req.query("rows"), 24),
                        onData: (data) =>
                            ws.send(data as Uint8Array<ArrayBuffer>),
                        onExit: (reason) => {
                            sshLimit.release(user.sub);
                            ws.close(1000, reason);
                        },
                    }).then(
                        (t) => {
                            term = t;
                            if (closed) t.close();
                            for (const msg of pending.splice(0)) handle(msg);
                        },
                        (err) => {
                            sshLimit.release(user.sub);
                            console.warn(`terminal failed: ${err}`);
                            ws.close(1011, "failed to start session");
                        },
                    );
                },
                onMessage(evt) {
                    const msg = parseMessage(evt.data);
                    if (msg) handle(msg);
                },
                onClose() {
                    closed = true;
                    term?.close();
                },
            };
        }),
    );

    return app;
}
