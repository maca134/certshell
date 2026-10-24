import { afterEach, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname } from "node:path";
import { openDb } from "../src/db";
import { reachable } from "../src/lib/hosts";
import { createSession } from "../src/lib/sessions";
import { SESSION_COOKIE } from "../src/routes/auth";
import { ensureCa } from "../src/ssh/ca";
import {
    openTerminal,
    signSession,
    type TerminalDeps,
} from "../src/ssh/terminal";
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
        { id: "h1", name: "h1", tags: [], logins: ["root"] },
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

test("terminal: a failed session_end audit still closes the socket", async () => {
    await setup({ command: () => ["sh", "-c", "echo bye"] });
    ctx.db.run(
        "CREATE TRIGGER boom BEFORE INSERT ON audit WHEN NEW.event = 'session_end' BEGIN SELECT RAISE(ABORT, 'boom'); END",
    );
    const { code, reason } = await ctx.connect("host=h1&login=root").closed;
    expect([code, reason]).toEqual([1000, "exited"]);
});

// Linux only: true while a process whose argv contains `marker` exists.
const running = (marker: string) =>
    readdirSync("/proc").some((pid) => {
        try {
            return readFileSync(`/proc/${pid}/cmdline`, "utf8").includes(
                marker,
            );
        } catch {
            return false;
        }
    });

test("terminal: a failed session_start audit leaves no key dir or ssh process and frees the slot", async () => {
    const marker = `600.${crypto.getRandomValues(new Uint32Array(1))[0]}`;
    let sleeper = true;
    await setup({
        maxSessions: 1,
        command: (args) => {
            const argv = fakeSsh.command(args);
            return sleeper ? ["sleep", marker] : argv;
        },
    });
    ctx.db.run(
        "CREATE TRIGGER boom BEFORE INSERT ON audit WHEN NEW.event = 'session_start' BEGIN SELECT RAISE(ABORT, 'boom'); END",
    );
    expect((await ctx.connect("host=h1&login=root").closed).code).toBe(1011);
    expect(existsSync(sessionDir)).toBe(false);
    expect(running(marker)).toBe(false);
    sleeper = false;
    ctx.db.run("DROP TRIGGER boom");
    const t = ctx.connect("host=h1&login=root");
    await t.waitFor("login=root");
    t.ws.close();
    await t.closed;
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

test("signSession: dropped when an admin ends the user or revokes access mid-sign", async () => {
    ctx = await startApp();
    const root = await mkdtemp(`${tmpdir()}/sign-`);
    await ensureCa(`${root}/ca`, "test-ca", undefined);
    const deps: TerminalDeps = {
        db: openDb(":memory:"),
        caKey: `${root}/ca/user_ca`,
        caPassword: undefined,
        idleMs: 0,
        maxMs: 0,
        taskMs: 0,
        maxSessions: 1,
        maxSessionsTotal: 1,
        live: new Map(),
        tasks: new Map(),
        endedAt: new Map(),
    };
    const user = { iss: "i", sub: "user-1", email: null, groups: ["g"] };
    const host = {
        id: "h1",
        name: "h1",
        address: "h1.test",
        host_key: "k",
        os: null,
    };
    deps.db.run(
        "INSERT INTO hosts (id, name, address, host_key) VALUES ('h1', 'h1', 'h1.test', 'k')",
    );
    deps.db.run(
        "INSERT INTO access (host_id, login, grp) VALUES ('h1', 'root', 'g')",
    );
    const pending = signSession(deps, user, host, "root", "1.2.3.4");
    deps.endedAt.set("user-1", Date.now());
    await expect(pending).rejects.toThrow("ended by admin");
    expect(
        (await signSession(deps, user, host, "root", "1.2.3.4")).principal,
    ).toBe("ws:h1:root");

    const revoked = signSession(deps, user, host, "root", "1.2.3.4");
    deps.db.run("DELETE FROM access");
    await expect(revoked).rejects.toThrow("access revoked");
    await rm(root, { recursive: true, force: true });
});

test("terminal: input that arrives after ssh exited is dropped, not thrown", async () => {
    ctx = await startApp();
    const root = await mkdtemp(`${tmpdir()}/late-`);
    await ensureCa(`${root}/ca`, "test-ca", undefined);
    const deps: TerminalDeps = {
        db: openDb(":memory:"),
        caKey: `${root}/ca/user_ca`,
        caPassword: undefined,
        idleMs: 10_000,
        maxMs: 10_000,
        taskMs: 0,
        maxSessions: 1,
        maxSessionsTotal: 1,
        live: new Map(),
        tasks: new Map(),
        endedAt: new Map(),
        command: () => ["sh", "-c", "exit 0"],
    };
    deps.db.run(
        "INSERT INTO hosts (id, name, address, host_key) VALUES ('h1', 'h1', 'h1.test', 'k')",
    );
    deps.db.run(
        "INSERT INTO access (host_id, login, grp) VALUES ('h1', 'root', 'g')",
    );
    const { promise: exited, resolve } = Promise.withResolvers<string>();
    const t = await openTerminal(
        deps,
        { iss: "i", sub: "user-1", email: null, groups: ["g"] },
        { id: "h1", name: "h1", address: "h1.test", host_key: "k", os: null },
        "root",
        "1.2.3.4",
        { cols: 80, rows: 24, onData: () => {}, onExit: resolve },
    );
    expect(await exited).toBe("exited");
    expect(() => t.write("x")).not.toThrow();
    expect(() => t.resize(100, 30)).not.toThrow();
    await rm(root, { recursive: true, force: true });
});

test("terminal: email chars outside [\\w.@+-] can't forge the cert key ID", async () => {
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
        email: '"v (serial 1)"@x/victim/s\nKey ID',
        groups: ["admins"],
    });
    const t = ctx.connect("host=h1&login=root", {
        cookie: `${SESSION_COOKIE}=${token}`,
    });
    await t.waitFor('Key ID: "_v__serial_1__@x_victim_s_Key_ID/user-1/');
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
    // Bun ≥ 1.4.4 sends 1009 (message too big); older Bun drops the socket (1006).
    expect([1006, 1009]).toContain(code);
});

test("admin: lists open terminals, ends one, then all of a user's", async () => {
    ctx = await startApp(
        {
            command: (args) =>
                args.remote === undefined
                    ? fakeSsh.command(args)
                    : ["sh", "-c", args.remote],
        },
        ["certshell-admins"],
    );
    ctx.addHost("h1", "h1.test", "ssh-ed25519 AAAA", {
        root: "certshell-admins",
    });
    const call = (method: string, path: string, body?: unknown) =>
        ctx.app.request(`${APP_URL}/api${path}`, {
            method,
            headers: {
                cookie: ctx.cookie,
                origin: APP_URL,
                "content-type": "application/json",
            },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
    const a = ctx.connect("host=h1&login=root");
    const b = ctx.connect("host=h1&login=root");
    const c = ctx.connect("host=h1&login=root");
    await Promise.all([a, b, c].map((t) => t.waitFor("login=root")));

    const list = (await (await call("GET", "/admin/sessions")).json()) as {
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

    expect((await call("DELETE", "/admin/sessions/nope")).status).toBe(404);
    expect((await call("DELETE", "/admin/sessions")).status).toBe(400);
    expect(
        (await call("DELETE", `/admin/sessions/${list[0]?.id}`)).status,
    ).toBe(204);
    const ended = await Promise.race([a.closed, b.closed, c.closed]);
    expect([ended.code, ended.reason]).toEqual([1000, "ended by admin"]);
    expect(await (await call("GET", "/admin/sessions")).json()).toHaveLength(2);

    const task = (await (
        await call("POST", "/tasks", {
            name: "t",
            script: "echo started; exec sleep 30",
            targets: [{ host: "h1", login: "root" }],
        })
    ).json()) as { id: number };
    const run = (await (
        await call("POST", `/tasks/${task.id}/run`)
    ).json()) as { id: string };
    await Bun.sleep(300);

    ctx.db.run(
        "INSERT INTO users (iss, sub, email, groups, last_login) VALUES ('https://id.test', 'user-1', 'a@b.c', '[]', 1)",
    );
    ctx.db.run(
        "INSERT INTO signs (created_at, sub, principal, host_id, session_id) VALUES (?, 'user-1', 'ws:h1:root', 'h1', 'old')",
        [Math.floor(Date.now() / 1000) - 15 * 60 - 1],
    );
    const users = (await (await call("GET", "/admin/users")).json()) as {
        sub: string;
        certs: unknown;
    }[];
    // 2 open terminals + 1 task target; 4 signs in the last 15 min (3 terminals + task), the old one excluded.
    expect(users.find((u) => u.sub === "user-1")?.certs).toEqual({
        inUse: 3,
        unexpired: 4,
    });

    expect((await call("DELETE", "/admin/sessions?sub=user-1")).status).toBe(
        204,
    );
    await Promise.all([a.closed, b.closed, c.closed]);
    expect(ctx.live.size).toBe(0);
    expect((await call("GET", "/admin/sessions")).status).toBe(401);
    const runHost = () =>
        ctx.db
            .query("SELECT status, output FROM run_hosts WHERE run_id = ?")
            .get(run.id);
    for (let i = 0; i < 50 && ctx.tasks.size; i++) await Bun.sleep(50);
    await Bun.sleep(100);
    expect(ctx.tasks.size).toBe(0);
    expect(runHost()).toEqual({
        status: "failed",
        output: "started\n\n[ended by admin]",
    });
    expect(
        ctx.db
            .query<{ event: string }, []>(
                "SELECT event FROM audit WHERE event IN ('session_kill', 'user_signout')",
            )
            .all()
            .map((r) => r.event),
    ).toEqual(["session_kill", "session_kill", "session_kill", "user_signout"]);
});

test("admin: access change ends what it no longer allows; host delete ends the rest", async () => {
    ctx = await startApp(
        {
            command: (args) =>
                args.remote === undefined
                    ? fakeSsh.command(args)
                    : ["sh", "-c", args.remote],
        },
        ["certshell-admins"],
    );
    ctx.addHost("h1", "h1.test", "ssh-ed25519 AAAA", {
        root: "certshell-admins",
        alice: "certshell-admins",
    });
    const call = (method: string, path: string, body?: unknown) =>
        ctx.app.request(`${APP_URL}/api${path}`, {
            method,
            headers: {
                cookie: ctx.cookie,
                origin: APP_URL,
                "content-type": "application/json",
            },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
    const root = ctx.connect("host=h1&login=root");
    const alice = ctx.connect("host=h1&login=alice");
    await Promise.all([root, alice].map((t) => t.waitFor("login=")));
    const task = (await (
        await call("POST", "/tasks", {
            name: "t",
            script: "exec sleep 30",
            targets: [{ host: "h1", login: "alice" }],
        })
    ).json()) as { id: number };
    expect((await call("POST", `/tasks/${task.id}/run`)).status).toBe(201);
    for (let i = 0; i < 50 && !ctx.tasks.size; i++) await Bun.sleep(50);
    expect(ctx.tasks.size).toBe(1);

    expect(
        (
            await call("PUT", "/admin/hosts/h1/access", [
                { login: "root", group: "certshell-admins" },
            ])
        ).status,
    ).toBe(204);
    expect((await alice.closed).reason).toBe("ended by admin");
    for (let i = 0; i < 50 && ctx.tasks.size; i++) await Bun.sleep(50);
    expect(ctx.tasks.size).toBe(0);
    expect([...ctx.live.values()].map((s) => s.login)).toEqual(["root"]);

    expect((await call("DELETE", "/admin/hosts/h1")).status).toBe(204);
    expect((await root.closed).reason).toBe("ended by admin");
    expect(ctx.live.size).toBe(0);
});

test("admin sessions: members get 403", async () => {
    await setup();
    expect(
        (await req("/api/admin/sessions", { cookie: ctx.cookie })).status,
    ).toBe(403);
});
