import { afterEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { reachable } from "../src/lib/hosts";
import { createSession } from "../src/lib/sessions";
import { SESSION_COOKIE } from "../src/routes/auth";
import { APP_URL, startApp } from "./helpers/app";

// Fake `ssh`: prints the login and cert principal, then echoes input via the PTY.
let sessionDir = "";
const fakeSsh = {
    command: ({ key, login }: { key: string; login: string }) => {
        sessionDir = dirname(key);
        return [
            "sh",
            "-c",
            'echo "login=$0"; ssh-keygen -L -f "$1-cert.pub" | grep -A1 Principals | tail -1; exec cat',
            login,
            key,
        ];
    },
};

let ctx: Awaited<ReturnType<typeof startApp>>;
afterEach(() => ctx.stop());

async function setup(terminal: Parameters<typeof startApp>[0] = {}) {
    ctx = await startApp({ ...fakeSsh, ...terminal });
    ctx.addHost("h1", "h1.test", "ssh-ed25519 AAAA", {
        root: "admins",
        alice: "others",
    });
    return ctx;
}

const req = (path: string, headers: Record<string, string>) =>
    ctx.app.request(`${APP_URL}${path}`, { headers });

test("/api/hosts lists only hosts+logins for the user's groups", async () => {
    await setup();
    ctx.addHost("h2", "h2.test", "ssh-ed25519 BBBB", { root: "others" });
    const res = await req("/api/hosts", { cookie: ctx.cookie });
    expect(await res.json()).toEqual([
        { id: "h1", name: "h1", logins: ["root"] },
    ]);
});

test("/api/hosts/status: only the user's hosts, up = TCP connect works", async () => {
    await setup();
    ctx.addHost("h2", "h2.test", "ssh-ed25519 BBBB", { root: "others" });
    const res = await req("/api/hosts/status", { cookie: ctx.cookie });
    expect(await res.json()).toEqual({ h1: false });
});

test("reachable: true on a listening port, false when refused", async () => {
    const listener = Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        socket: { data() {} },
    });
    expect(await reachable("127.0.0.1", listener.port)).toBeTrue();
    listener.stop(true);
    expect(await reachable("127.0.0.1", listener.port)).toBeFalse();
});

test("WS upgrade: no session → 401, bad origin / no access → 403", async () => {
    await setup();
    const ok = { cookie: ctx.cookie, origin: APP_URL };
    expect(
        (await req("/api/terminal?host=h1&login=root", { origin: APP_URL }))
            .status,
    ).toBe(401);
    expect(
        (
            await req("/api/terminal?host=h1&login=root", {
                ...ok,
                origin: "https://evil.test",
            })
        ).status,
    ).toBe(403);
    expect(
        (await req("/api/terminal?host=h1&login=root", { cookie: ctx.cookie }))
            .status,
    ).toBe(403);
    expect((await req("/api/terminal?host=h1&login=alice", ok)).status).toBe(
        403,
    );
    expect((await req("/api/terminal?host=h2&login=root", ok)).status).toBe(
        403,
    );
    expect(ctx.db.query("SELECT count(*) AS n FROM signs").get()).toEqual({
        n: 0,
    });
});

test("terminal: signs ws:<host>:<login>, relays I/O, cleans up on close", async () => {
    await setup();
    const t = ctx.connect("host=h1&login=root");
    await t.opened;
    await t.waitFor("login=root");
    await t.waitFor("ws:h1:root");
    t.send({ t: "in", d: "ping\r" });
    await t.waitFor("ping");
    expect(existsSync(sessionDir)).toBeTrue();

    expect(
        ctx.db.query("SELECT serial, sub, principal, host_id FROM signs").all(),
    ).toEqual([
        { serial: 1, sub: "user-1", principal: "ws:h1:root", host_id: "h1" },
    ]);

    t.ws.close();
    await t.closed;
    await Bun.sleep(200);
    expect(existsSync(sessionDir)).toBeFalse();
    const events = ctx.db
        .query<{ data: string }, []>("SELECT data FROM audit ORDER BY id")
        .all()
        .map((r) => JSON.parse(r.data));
    expect(events.map((e) => [e.event, e.sub, e.email])).toEqual([
        ["sign", "user-1", "a@b.c"],
        ["session_start", "user-1", "a@b.c"],
        ["session_end", "user-1", "a@b.c"],
    ]);
});

test("terminal: resize reaches the PTY", async () => {
    await setup({
        command: () => ["sh", "-c", "read x; stty size; exec cat"],
    });
    const t = ctx.connect("host=h1&login=root&cols=80&rows=24");
    await t.opened;
    await Bun.sleep(100);
    t.send({ t: "resize", cols: 132, rows: 40 });
    t.send({ t: "in", d: "\r" });
    await t.waitFor("40 132");
});

test("terminal: spawns with TERM=xterm-256color", async () => {
    await setup({ command: () => ["sh", "-c", 'echo "term=$TERM"'] });
    const t = ctx.connect("host=h1&login=root");
    await t.opened;
    await t.waitFor("term=xterm-256color");
});

test("terminal: process exit closes the socket", async () => {
    await setup({ command: () => ["sh", "-c", "echo bye"] });
    const t = ctx.connect("host=h1&login=root");
    const { code, reason, output } = await t.closed;
    expect(output).toContain("bye");
    expect([code, reason]).toEqual([1000, "exited"]);
});

test("terminal: past maxSessions → 1013 until a session ends", async () => {
    await setup({ maxSessions: 1 });
    const first = ctx.connect("host=h1&login=root");
    await first.waitFor("login=root");
    const refused = await ctx.connect("host=h1&login=root").closed;
    expect([refused.code, refused.reason]).toEqual([
        1013,
        "too many sessions open",
    ]);
    first.ws.close();
    while (
        !ctx.db.query("SELECT 1 FROM audit WHERE event = 'session_end'").get()
    )
        await Bun.sleep(20);
    const next = ctx.connect("host=h1&login=root");
    await next.waitFor("login=root");
    next.ws.close();
});

test("terminal: idle timeout, reset by input", async () => {
    await setup({ idleMs: 400 });
    const t = ctx.connect("host=h1&login=root");
    await t.opened;
    for (let i = 0; i < 3; i++) {
        await Bun.sleep(250);
        t.send({ t: "in", d: "x" });
    }
    const start = Date.now();
    const { reason } = await t.closed;
    expect(reason).toBe("idle timeout");
    expect(Date.now() - start).toBeGreaterThanOrEqual(300);
});

test("terminal: max session length despite activity", async () => {
    await setup({ idleMs: 10_000, maxMs: 600 });
    const t = ctx.connect("host=h1&login=root");
    await t.opened;
    const typing = setInterval(() => t.send({ t: "in", d: "x" }), 100);
    const { reason } = await t.closed;
    clearInterval(typing);
    expect(reason).toBe("max session length");
});

test("terminal: CA failure → 1011, no process, temp dir removed", async () => {
    await setup({ caKey: "/nonexistent/user_ca" });
    const t = ctx.connect("host=h1&login=root");
    const { code, reason } = await t.closed;
    expect([code, reason]).toEqual([1011, "failed to start session"]);
});

test("terminal: junk messages during signing are ignored", async () => {
    await setup();
    const t = ctx.connect("host=h1&login=root");
    await t.opened;
    for (const junk of ["null", "1", '"x"', "[]", "{", '{"t":"in","d":5}'])
        t.ws.send(junk);
    t.send({ t: "in", d: "still-alive\r" });
    await t.waitFor("still-alive");
    expect((await req("/healthz", {})).status).toBe(200);
});

test("terminal: '/' and control chars in email can't forge the cert key ID", async () => {
    await setup({
        command: ({ key }) => [
            "sh",
            "-c",
            'ssh-keygen -L -f "$0-cert.pub" | grep "Key ID"; exec cat',
            key,
        ],
    });
    const token = createSession(ctx.db, {
        iss: "https://id.test",
        sub: "user-1",
        email: "v@x/victim/s\nKey ID",
        groups: ["admins"],
    });
    const t = ctx.connect("host=h1&login=root", {
        cookie: `${SESSION_COOKIE}=${token}`,
    });
    await t.waitFor('Key ID: "v@x_victim_s_Key ID/user-1/');
    t.ws.close();
});

test("terminal: spawn failure → 1011, temp dir removed", async () => {
    await setup({
        command: ({ key }) => {
            sessionDir = dirname(key);
            return ["/nonexistent/ssh"];
        },
    });
    const t = ctx.connect("host=h1&login=root");
    const { code } = await t.closed;
    expect(code).toBe(1011);
    expect(existsSync(sessionDir)).toBeFalse();
});

test("terminal: oversized frame closes the socket", async () => {
    await setup();
    const t = ctx.connect("host=h1&login=root");
    await t.opened;
    t.send({ t: "in", d: "x".repeat(65 * 1024) });
    const { code } = await t.closed;
    expect(code).toBe(1006);
});

test("admin: lists open terminals, ends one, then all for a user", async () => {
    ctx = await startApp(fakeSsh, ["certshell-admins"]);
    ctx.addHost("h1", "h1.test", "ssh-ed25519 AAAA", {
        root: "certshell-admins",
    });
    const call = (method: string, path: string) =>
        ctx.app.request(`${APP_URL}/api/admin${path}`, {
            method,
            headers: { cookie: ctx.cookie, origin: APP_URL },
        });
    const a = ctx.connect("host=h1&login=root");
    const b = ctx.connect("host=h1&login=root");
    const c = ctx.connect("host=h1&login=root");
    await Promise.all([a, b, c].map((t) => t.waitFor("login=root")));

    const list = (await (await call("GET", "/sessions")).json()) as {
        id: string;
    }[];
    expect(list).toHaveLength(3);
    expect(list[0]).toMatchObject({
        sub: "user-1",
        email: "a@b.c",
        hostId: "h1",
        hostName: "h1",
        login: "root",
    });

    expect((await call("DELETE", "/sessions/nope")).status).toBe(404);
    expect((await call("DELETE", "/sessions")).status).toBe(400);
    expect((await call("DELETE", `/sessions/${list[0]?.id}`)).status).toBe(204);
    const ended = await Promise.race([a.closed, b.closed, c.closed]);
    expect([ended.code, ended.reason]).toEqual([1000, "ended by admin"]);
    expect(await (await call("GET", "/sessions")).json()).toHaveLength(2);

    expect((await call("DELETE", "/sessions?sub=user-1")).status).toBe(204);
    await Promise.all([a.closed, b.closed, c.closed]);
    expect(await (await call("GET", "/sessions")).json()).toEqual([]);
    expect(
        ctx.db
            .query(
                "SELECT count(*) AS n FROM audit WHERE event = 'session_kill'",
            )
            .get(),
    ).toEqual({ n: 3 });
});

test("admin sessions: members get 403", async () => {
    await setup();
    expect(
        (await req("/api/admin/sessions", { cookie: ctx.cookie })).status,
    ).toBe(403);
});
