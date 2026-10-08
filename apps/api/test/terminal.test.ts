import { afterEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
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

test("terminal: process exit closes the socket", async () => {
    await setup({ command: () => ["sh", "-c", "echo bye"] });
    const t = ctx.connect("host=h1&login=root");
    const { code, reason, output } = await t.closed;
    expect(output).toContain("bye");
    expect([code, reason]).toEqual([1000, "exited"]);
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
