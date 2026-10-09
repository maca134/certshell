import { afterEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import type { RunDetail, RunSummary, Task } from "@repo/shared";
import { SESSION_COOKIE } from "../src/app";
import { loadConfig } from "../src/config";
import { createSession } from "../src/sessions";
import { taskRoutes } from "../src/tasks";
import type { TerminalDeps } from "../src/terminal";
import { APP_URL, startApp } from "./helpers/app";

// Fake `ssh`: runs the task's script locally, with the host id as $0.
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

const h1root = [{ host: "h1", login: "root" }];

async function createTask(script: string, targets: object[], name = "t") {
    const res = await call("POST", "", { name, script, targets });
    expect(res.status).toBe(201);
    return ((await res.json()) as { id: number }).id;
}

async function runTask(taskId: number) {
    const res = await call("POST", `/${taskId}/run`);
    expect(res.status).toBe(201);
    return ((await res.json()) as { id: string }).id;
}

const startRun = async (script: string, targets: object[]) =>
    runTask(await createTask(script, targets));

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

const count = (table: string) =>
    ctx.db.query(`SELECT count(*) AS n FROM ${table}`).get();

test("tasks: create, list, edit, delete; per user", async () => {
    await setup();
    const id = await createTask("apt-get upgrade -y", h1root, "Upgrade");
    await createTask("df -h", [{ host: "h2", login: "root" }], "Disk");
    const list = async (cookie = ctx.cookie) =>
        (await (await call("GET", "", undefined, { cookie })).json()) as Task[];
    expect((await list()).map((t) => [t.name, t.script, t.targets])).toEqual([
        ["Disk", "df -h", [{ host: "h2", login: "root" }]],
        ["Upgrade", "apt-get upgrade -y", h1root],
    ]);

    const edit = {
        name: "Upgrade all",
        script: "apt-get update\napt-get upgrade -y",
        targets: [...h1root, { host: "h2", login: "root" }],
    };
    expect((await call("PUT", `/${id}`, edit)).status).toBe(204);
    expect((await list()).find((t) => t.id === id)).toMatchObject(edit);

    const cookie = otherUser();
    expect(await list(cookie)).toEqual([]);
    expect((await call("PUT", `/${id}`, edit, { cookie })).status).toBe(404);
    expect(
        (await call("POST", `/${id}/run`, undefined, { cookie })).status,
    ).toBe(404);
    expect((await call("DELETE", `/${id}`, undefined, { cookie })).status).toBe(
        404,
    );
    expect((await call("DELETE", `/${id}`)).status).toBe(204);
    expect((await list()).map((t) => t.name)).toEqual(["Disk"]);
});

test("tasks: invalid input and targets the user can't reach are refused", async () => {
    await setup();
    const bad = async (body: object) =>
        expect((await call("POST", "", body)).status).toBe(400);
    const ok = { name: "x", script: "id", targets: h1root };
    await bad({ ...ok, name: "" });
    await bad({ ...ok, script: " " });
    await bad({ ...ok, script: "x".repeat(16 * 1024 + 1) });
    await bad({ ...ok, targets: [] });
    await bad({
        ...ok,
        targets: Array.from({ length: 51 }, () => h1root[0]),
    });
    await bad({ ...ok, targets: [{ host: "h1", login: 1 }] });
    await bad({ ...ok, targets: [{ host: "h1", login: "alice" }] });
    await bad({ ...ok, targets: [{ host: "h9", login: "root" }] });
    expect(
        (await call("POST", "", ok, { origin: "https://evil.test" })).status,
    ).toBe(403);
    expect(count("tasks")).toEqual({ n: 0 });
});

test("tasks: duplicate targets are saved once", async () => {
    await setup();
    await createTask("true", [...h1root, ...h1root]);
    const [task] = (await (await call("GET", "")).json()) as Task[];
    expect(task?.targets).toEqual(h1root);
});

test("run: the script on each target, exit code + merged output per host", async () => {
    await setup();
    const taskId = await createTask(
        'echo "out $0"; echo "err $0" >&2; [ "$0" = h1 ]',
        [...h1root, { host: "h2", login: "root" }],
        "Check",
    );
    const id = await runTask(taskId);
    const run = await finished(id);
    expect(run).toMatchObject({ taskId, name: "Check" });
    expect(
        run.hosts.map((h) => [h.hostId, h.login, h.status, h.exitCode]),
    ).toEqual([
        ["h1", "root", "ok", 0],
        ["h2", "root", "failed", 1],
    ]);
    expect(run.hosts[0]?.output).toContain("out h1");
    expect(run.hosts[0]?.output).toContain("err h1");

    const summary = { id, taskId, name: "Check" };
    const runs = (await (await call("GET", "/runs")).json()) as RunSummary[];
    expect(runs).toEqual([
        {
            ...summary,
            createdAt: expect.any(Number),
            counts: { running: 0, ok: 1, failed: 1 },
        },
    ]);
    const [task] = (await (await call("GET", "")).json()) as Task[];
    expect(task?.lastRun).toMatchObject(summary);

    await Bun.sleep(50);
    expect(keys.map((k) => existsSync(dirname(k)))).toEqual([false, false]);
    const log = events();
    expect(log[0]).toMatchObject({
        event: "task_run",
        sub: "user-1",
        run: id,
        task: taskId,
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

test("run: a later edit doesn't change a past run's script", async () => {
    await setup();
    const taskId = await createTask("echo one", h1root);
    const id = await runTask(taskId);
    await finished(id);
    await call("PUT", `/${taskId}`, {
        name: "t",
        script: "echo two",
        targets: h1root,
    });
    expect((await finished(id)).script).toBe("echo one");
});

test("run: cert is for ws:<host>:<login> and cannot open a terminal", async () => {
    await setup({
        command: ({ key }) => ["ssh-keygen", "-L", "-f", `${key}-cert.pub`],
    });
    const run = await finished(await startRun("true", h1root));
    const out = run.hosts[0]?.output;
    expect(out).toContain("ws:h1:root");
    expect(out).not.toContain("permit-pty");
    expect(out).toMatch(/Critical Options: \(none\)/);
});

test("run: access is checked again; nothing signed once it's gone", async () => {
    await setup();
    const taskId = await createTask("true", h1root);
    ctx.db.run("DELETE FROM access WHERE host_id = 'h1'");
    const res = await call("POST", `/${taskId}/run`);
    expect(res.status).toBe(403);
    expect(count("signs")).toEqual({ n: 0 });
    expect(count("runs")).toEqual({ n: 0 });
});

test("runs are private to the user who started them", async () => {
    await setup();
    const id = await startRun("true", h1root);
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
    const id = await startRun("echo first; sleep 1; echo second", h1root);
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
    const run = await finished(await startRun("exec sleep 10", h1root));
    expect(run.hosts[0]).toMatchObject({ status: "failed", exitCode: null });
    expect(run.hosts[0]?.output).toContain("[timed out]");
});

test("run: keeps the last 256 KB of output", async () => {
    await setup();
    const run = await finished(
        await startRun(
            "head -c 300000 /dev/zero | tr '\\0' x; echo END",
            h1root,
        ),
    );
    const out = run.hosts[0]?.output;
    expect(out).toStartWith("[earlier output dropped]\n");
    expect(out).toEndWith("xEND\n");
    expect(out?.length).toBe(256 * 1024 + "[earlier output dropped]\n".length);
});

test("run: CA failure → failed, not stuck running", async () => {
    await setup({ caKey: "/nonexistent/user_ca" });
    const run = await finished(await startRun("true", h1root));
    expect(run.hosts[0]).toMatchObject({ status: "failed", exitCode: null });
    expect(run.hosts[0]?.output).toContain("[failed to start]");
});

test("targets still running at startup are marked failed", async () => {
    await setup();
    ctx.db.run(
        "INSERT INTO runs (id, task_id, sub, email, name, script, created_at) VALUES ('r1', 1, 'user-1', null, 't', 'x', 0)",
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
