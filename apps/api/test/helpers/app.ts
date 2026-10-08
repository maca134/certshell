import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createApp, SESSION_COOKIE, websocket } from "../../src/app";
import { ensureCa } from "../../src/ca";
import { loadConfig } from "../../src/config";
import { openDb } from "../../src/db";
import { createSession } from "../../src/sessions";
import type { TerminalDeps } from "../../src/terminal";

export const APP_URL = "https://ssh.test";

// Real Bun server + WS, a logged-in session, and a throwaway CA (unless caKey given).
export async function startApp(
    terminal: Partial<Omit<TerminalDeps, "db">> = {},
    groups = ["admins"],
    env: Record<string, string> = {},
) {
    const root = await mkdtemp(`${tmpdir()}/app-`);
    if (!terminal.caKey) await ensureCa(`${root}/ca`, "test-ca", "pw");
    const db = openDb(":memory:");
    const app = createApp({
        config: loadConfig({
            APP_URL,
            OIDC_ISSUER: "https://id.test",
            OIDC_CLIENT_ID: "x",
            OIDC_CLIENT_SECRET: "y",
            ...env,
        }),
        db,
        getOidc: () => Promise.reject(new Error("unused")),
        terminal: {
            db,
            caKey: `${root}/ca/user_ca`,
            caPassword: "pw",
            idleMs: 60_000,
            maxMs: 60_000,
            ...terminal,
        },
    });
    const server = Bun.serve({ port: 0, fetch: app.fetch, websocket });
    const cookie = `${SESSION_COOKIE}=${createSession(db, {
        iss: "https://id.test",
        sub: "user-1",
        email: "a@b.c",
        groups,
    })}`;

    const addHost = (
        id: string,
        address: string,
        hostKey: string,
        logins: Record<string, string>,
    ) => {
        db.run(
            "INSERT INTO hosts (id, name, address, host_key) VALUES (?, ?, ?, ?)",
            [id, id, address, hostKey],
        );
        for (const [login, grp] of Object.entries(logins))
            db.run(
                "INSERT INTO access (host_id, login, grp) VALUES (?, ?, ?)",
                [id, login, grp],
            );
    };

    // Resolves with everything received once the socket closes.
    const connect = (query: string, headers: Record<string, string> = {}) => {
        const ws = new WebSocket(
            `${server.url.href.replace("http", "ws")}api/terminal?${query}`,
            {
                headers: { origin: APP_URL, cookie, ...headers },
            } as unknown as string[],
        );
        ws.binaryType = "arraybuffer";
        let output = "";
        const decoder = new TextDecoder();
        const waiters: { text: string; resolve: () => void }[] = [];
        ws.onmessage = (e) => {
            output += decoder.decode(new Uint8Array(e.data), { stream: true });
            for (const w of waiters.filter((w) => output.includes(w.text))) {
                waiters.splice(waiters.indexOf(w), 1);
                w.resolve();
            }
        };
        const closed = new Promise<{
            code: number;
            reason: string;
            output: string;
        }>((resolve) => {
            ws.onclose = (e) =>
                resolve({ code: e.code, reason: e.reason, output });
        });
        const opened = new Promise<void>((resolve, reject) => {
            ws.onopen = () => resolve();
            ws.onerror = () => reject(new Error("ws error"));
        });
        return {
            ws,
            opened,
            closed,
            send: (msg: object) => ws.send(JSON.stringify(msg)),
            waitFor: (text: string) =>
                new Promise<void>((resolve, reject) => {
                    if (output.includes(text)) return resolve();
                    waiters.push({ text, resolve });
                    setTimeout(
                        () =>
                            reject(
                                new Error(
                                    `timed out waiting for ${JSON.stringify(text)}; got ${JSON.stringify(output)}`,
                                ),
                            ),
                        5000,
                    );
                }),
        };
    };

    return {
        app,
        db,
        server,
        cookie,
        addHost,
        connect,
        stop: async () => {
            server.stop(true);
            await rm(root, { recursive: true, force: true });
        },
    };
}
