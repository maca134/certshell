import { afterEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import type { RunDetail, RunSummary, SavedCommand } from "@repo/shared";
import { SESSION_COOKIE } from "../src/app";
import { loadConfig } from "../src/config";
import { createSession } from "../src/sessions";
import { taskRoutes } from "../src/tasks";
import type { TerminalDeps } from "../src/terminal";
import { APP_URL, startApp } from "./helpers/app";

// Fake `ssh`: runs the task's command locally, with the host id as $0.
let keys: string[] = [];
const fakeSsh: TerminalDeps["command"] = ({ key, host, remote }) => {
    keys.push(key);
    return ["sh", "-c", remote ?? "exit 99", host.id];
};

let ctx: Awaited<ReturnType<typeof startApp>>;
afterEach(() => ctx.stop());

async function setup(terminal: Parameters<typeof startApp>[0] = {}) {
    keys = [];
    ctx = await startApp({ command: fakeSsh, ...terminal });
    ctx.addHost("h1", "h1.test", "ssh-ed25519 AAAA", {
        root: "admins",
        alice: "others",
    });
    ctx.addHost("h2", "h2.test", "ssh-ed25519 BBBB", { root: "admins" });
    return ctx;
}

const call = (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
) =>
    ctx.app.request(`${APP_URL}/api/tasks${path}`, {
        method,
        headers: {
            cookie: ctx.cookie,
            origin: APP_URL,
            "content-type": "application/json",
            ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });

const otherUser = () =>
    `${SESSION_COOKIE}=${createSession(ctx.db, {
        iss: "https://id.test",
        sub: "user-2",
        email: "x@y.z",
        groups: ["admins"],
    })}`;

async function startRun(command: string, targets: object[]) {
    const res = await call("POST", "/runs", { command, targets });
    expect(res.status).toBe(201);
    return ((await res.json()) as { id: string }).id;
}

async function finished(id: string) {
    for (let i = 0; i < 100; i++) {
        const run = (await (
            await call("GET", `/runs/${id}`)
        ).json()) as RunDetail;
        if (run.hosts.every((h) => h.status !== "running")) return run;
        await Bun.sleep(50);
    }
    throw new Error("run did not finish");
}

const events = () =>
    ctx.db
        .query<{ data: string }, []>("SELECT data FROM audit ORDER BY id")
        .all()
        .map((r) => JSON.parse(r.data));

test("run: one command on each target, exit code + merged output per host", async () => {
    await setup();
    const id = await startRun(
        'echo "out $0"; echo "err $0" >&2; [ "$0" = h1 ]',
        [
            { host: "h1", login: "root" },
            { host: "h2", login: "root" },
        ],
    );
    const run = await finished(id);
    expect(run.command).toStartWith("echo");
    expect(
        run.hosts.map((h) => [h.hostId, h.login, h.status, h.exitCode]),
    ).toEqual([
        ["h1", "root", "ok", 0],
        ["h2", "root", "failed", 1],
    ]);
    expect(run.hosts[0]?.output).toContain("out h1");
    expect(run.hosts[0]?.output).toContain("err h1");

    const list = (await (await call("GET", "/runs")).json()) as RunSummary[];
    expect(list.map((r) => [r.id, r.counts])).toEqual([
        [id, { running: 0, ok: 1, failed: 1 }],
    ]);

    await Bun.sleep(50);
    expect(keys.map((k) => existsSync(dirname(k)))).toEqual([false, false]);
    const log = events();
    expect(log[0]).toMatchObject({
        event: "task_run",
        sub: "user-1",
        run: id,
        targets: ["h1:root", "h2:root"],
    });
    expect(log.filter((e) => e.event === "sign")).toHaveLength(2);
    expect(log.filter((e) => e.event === "sign")[0]).toMatchObject({
        run: id,
        principal: expect.stringMatching(/^ws:h[12]:root$/),
    });
    expect(
        log.filter((e) => e.event === "task_end").map((e) => e.status),
    ).toContain("failed");
});

test("run: cert is for ws:<host>:<login> and cannot open a terminal", async () => {
    await setup({
        command: ({ key }) => ["ssh-keygen", "-L", "-f", `${key}-cert.pub`],
    });
    const run = await finished(
        await startRun("true", [{ host: "h1", login: "root" }]),
    );
    const out = run.hosts[0]?.output;
    expect(out).toContain("ws:h1:root");
    expect(out).not.toContain("permit-pty");
    expect(out).toMatch(/Critical Options: \(none\)/);
});

test("run: only targets the user's groups allow; nothing signed otherwise", async () => {
    await setup();
    const bad = async (body: object, status: number) =>
        expect((await call("POST", "/runs", body)).status).toBe(status);
    await bad(
        { command: "id", targets: [{ host: "h1", login: "alice" }] },
        403,
    );
    await bad(
        {
            command: "id",
            targets: [
                { host: "h1", login: "root" },
                { host: "h9", login: "root" },
            ],
        },
        403,
    );
    await bad({ command: "", targets: [{ host: "h1", login: "root" }] }, 400);
    await bad(
        { command: "x".repeat(4097), targets: [{ host: "h1", login: "root" }] },
        400,
    );
    await bad({ command: "id", targets: [] }, 400);
    await bad(
        {
            command: "id",
            targets: Array.from({ length: 51 }, () => ({
                host: "h1",
                login: "root",
            })),
        },
        400,
    );
    await bad({ command: "id", targets: [{ host: "h1", login: 1 }] }, 400);
    expect(
        (
            await call(
                "POST",
                "/runs",
                { command: "id", targets: [{ host: "h1", login: "root" }] },
                { origin: "https://evil.test" },
            )
        ).status,
    ).toBe(403);
    expect(ctx.db.query("SELECT count(*) AS n FROM signs").get()).toEqual({
        n: 0,
    });
    expect(ctx.db.query("SELECT count(*) AS n FROM runs").get()).toEqual({
        n: 0,
    });
});

test("run: duplicate targets run once", async () => {
    await setup();
    const run = await finished(
        await startRun("true", [
            { host: "h1", login: "root" },
            { host: "h1", login: "root" },
        ]),
    );
    expect(run.hosts).toHaveLength(1);
});

test("runs are private to the user who started them", async () => {
    await setup();
    const id = await startRun("true", [{ host: "h1", login: "root" }]);
    await finished(id);
    const cookie = otherUser();
    expect(
        (await call("GET", `/runs/${id}`, undefined, { cookie })).status,
    ).toBe(404);
    expect(
        await (await call("GET", "/runs", undefined, { cookie })).json(),
    ).toEqual([]);
});

test("run: output streams while running", async () => {
    await setup();
    const id = await startRun("echo first; sleep 1; echo second", [
        { host: "h1", login: "root" },
    ]);
    let run: RunDetail | undefined;
    for (let i = 0; i < 40; i++) {
        run = (await (await call("GET", `/runs/${id}`)).json()) as RunDetail;
        if (run.hosts[0]?.output.includes("first")) break;
        await Bun.sleep(25);
    }
    expect(run?.hosts[0]).toMatchObject({
        status: "running",
        exitCode: null,
        output: "first\n",
    });
    expect((await finished(id)).hosts[0]?.output).toBe("first\nsecond\n");
});

test("run: killed after taskMs", async () => {
    await setup({ taskMs: 300 });
    const run = await finished(
        await startRun("exec sleep 10", [{ host: "h1", login: "root" }]),
    );
    expect(run.hosts[0]).toMatchObject({ status: "failed", exitCode: null });
    expect(run.hosts[0]?.output).toContain("[timed out]");
});

test("run: keeps the last 256 KB of output", async () => {
    await setup();
    const run = await finished(
        await startRun("head -c 300000 /dev/zero | tr '\\0' x; echo END", [
            { host: "h1", login: "root" },
        ]),
    );
    const out = run.hosts[0]?.output;
    expect(out).toStartWith("[earlier output dropped]\n");
    expect(out).toEndWith("xEND\n");
    expect(out?.length).toBe(256 * 1024 + "[earlier output dropped]\n".length);
});

test("run: CA failure → failed, not stuck running", async () => {
    await setup({ caKey: "/nonexistent/user_ca" });
    const run = await finished(
        await startRun("true", [{ host: "h1", login: "root" }]),
    );
    expect(run.hosts[0]).toMatchObject({ status: "failed", exitCode: null });
    expect(run.hosts[0]?.output).toContain("[failed to start]");
});

test("targets still running at startup are marked failed", async () => {
    await setup();
    ctx.db.run(
        "INSERT INTO runs (id, sub, email, command, created_at) VALUES ('r1', 'user-1', null, 'x', 0)",
    );
    ctx.db.run(
        "INSERT INTO run_hosts (run_id, host_id, host_name, login, status, output) VALUES ('r1', 'h1', 'h1', 'root', 'running', 'partial')",
    );
    taskRoutes({
        config: loadConfig({
            APP_URL,
            OIDC_ISSUER: "https://id.test",
            OIDC_CLIENT_ID: "x",
            OIDC_CLIENT_SECRET: "y",
        }),
        db: ctx.db,
        terminal: {} as TerminalDeps,
        signLimit: () => true,
    });
    const run = (await (await call("GET", "/runs/r1")).json()) as RunDetail;
    expect(run.hosts[0]).toMatchObject({
        status: "failed",
        output: "partial\n[interrupted: app restarted]",
    });
});

test("saved commands: per user, create / list / delete", async () => {
    await setup();
    const save = (body: object) => call("POST", "/commands", body);
    expect(
        (await save({ name: "Upgrade", command: "apt-get upgrade -y" })).status,
    ).toBe(201);
    expect((await save({ name: "Disk", command: "df -h" })).status).toBe(201);
    expect((await save({ name: "", command: "x" })).status).toBe(400);
    expect((await save({ name: "x", command: " " })).status).toBe(400);

    const list = (await (
        await call("GET", "/commands")
    ).json()) as SavedCommand[];
    expect(list.map((c) => [c.name, c.command])).toEqual([
        ["Disk", "df -h"],
        ["Upgrade", "apt-get upgrade -y"],
    ]);

    const diskId = list[0]?.id;
    const cookie = otherUser();
    expect(
        await (await call("GET", "/commands", undefined, { cookie })).json(),
    ).toEqual([]);
    expect(
        (await call("DELETE", `/commands/${diskId}`, undefined, { cookie }))
            .status,
    ).toBe(404);
    expect((await call("DELETE", `/commands/${diskId}`)).status).toBe(204);
    expect(
        ((await (await call("GET", "/commands")).json()) as SavedCommand[]).map(
            (c) => c.name,
        ),
    ).toEqual(["Upgrade"]);
});
