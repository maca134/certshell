import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { AlertChannel, AlertInput } from "@repo/shared";
import { alerter } from "../src/lib/alerts";
import { audit } from "../src/lib/audit";
import { hostKeyRejected } from "../src/ssh/terminal";
import { APP_URL, startApp } from "./helpers/app";

type Sent = { url: string; args: string[]; body: string; env: string[] };

let ctx: Awaited<ReturnType<typeof startApp>>;
let dir = "";
afterEach(async () => {
    await ctx.stop();
    await rm(dir, { recursive: true, force: true });
});

async function setup(
    terminal: Parameters<typeof startApp>[0] = {},
    probe?: (address: string) => Promise<boolean>,
) {
    dir = await mkdtemp(`${tmpdir()}/alerts-`);
    ctx = await startApp(terminal, ["certshell-admins"], {}, undefined, {
        shoutrrr: [
            process.execPath,
            `${import.meta.dir}/fixtures/shoutrrr.ts`,
            `${dir}/sent`,
        ],
        probe,
    });
    ctx.addHost("h1", "h1.test", "ssh-ed25519 AAAA", {
        root: "certshell-admins",
        deploy: "certshell-admins",
    });
    ctx.db.run("UPDATE hosts SET tags = ? WHERE id = 'h1'", ['["prod"]']);
    return ctx;
}

const call = (method: string, path: string, body?: unknown) =>
    ctx.app.request(`${APP_URL}/api/admin/alerts${path}`, {
        method,
        headers: {
            cookie: ctx.cookie,
            origin: APP_URL,
            "content-type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });

const input = (over: Partial<AlertInput> = {}): AlertInput => ({
    name: "ops",
    url: "ntfy://ntfy.sh/secret-topic",
    events: ["security"],
    tags: [],
    logins: [],
    ...over,
});

async function create(over: Partial<AlertInput> = {}) {
    const res = await call("POST", "", input(over));
    expect(res.status).toBe(201);
    return ((await res.json()) as { id: number }).id;
}

const list = async () =>
    (await (await call("GET", "")).json()) as AlertChannel[];

async function readSent(): Promise<Sent[]> {
    const f = Bun.file(`${dir}/sent`);
    if (!(await f.exists())) return [];
    return (await f.text())
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l));
}

/** Waits until `n` sends are logged, then returns them. */
async function sent(n: number) {
    for (let i = 0; i < 100; i++) {
        const s = await readSent();
        if (s.length >= n) return s;
        await Bun.sleep(30);
    }
    throw new Error(
        `expected ${n} sends, got ${JSON.stringify(await readSent())}`,
    );
}

const titles = (s: Sent[]) => s.map((x) => x.args[x.args.indexOf("-t") + 1]);

test("create: URL stored encrypted, never returned or audited", async () => {
    await setup();
    const id = await create();
    // The channel picked security, so it hears about its own creation.
    expect(titles(await sent(1))).toEqual([
        "CertShell: Alert channel added: ops",
    ]);
    const [row] = await list();
    expect(row).toEqual({
        id,
        name: "ops",
        service: "ntfy",
        events: ["security"],
        tags: [],
        logins: [],
        lastSentAt: expect.any(Number),
        lastError: null,
    });
    expect(JSON.stringify(row)).not.toContain("secret-topic");
    const stored = ctx.db
        .query<{ url: string }, []>("SELECT url FROM alert_channels")
        .get()?.url;
    expect(stored).toStartWith("v1:");
    expect(stored).not.toContain("secret-topic");
    const audits = ctx.db
        .query<{ data: string }, []>("SELECT data FROM audit")
        .all()
        .map((r) => r.data)
        .join("\n");
    expect(audits).toContain("alert_create");
    expect(audits).not.toContain("secret-topic");
});

test("create/update: bad input → 400", async () => {
    await setup();
    for (const bad of [
        { url: "not a url" },
        { url: "ntfy://x\ny" },
        { url: undefined },
        { events: [] },
        { events: ["nope"] },
        { name: "" },
        { tags: ["Bad Tag"] },
        { logins: ["Root!"] },
    ] as Partial<AlertInput>[])
        expect((await call("POST", "", { ...input(), ...bad })).status).toBe(
            400,
        );
    const id = await create({ events: ["host_down"] });
    expect(
        (await call("PUT", `/${id}`, { ...input(), url: "nope" })).status,
    ).toBe(400);
    expect((await call("PUT", "/999", input())).status).toBe(404);
});

test("update without url keeps it; with url replaces it; delete", async () => {
    await setup();
    const id = await create({ events: ["terminal"] });
    const { url: _, ...rest } = input();
    expect(
        (
            await call("PUT", `/${id}`, {
                ...rest,
                name: "renamed",
                events: ["terminal"],
            })
        ).status,
    ).toBe(204);
    expect((await call("POST", `/${id}/test`)).status).toBe(204);
    expect((await sent(1))[0]?.url).toBe("ntfy://ntfy.sh/secret-topic");

    expect(
        (
            await call("PUT", `/${id}`, {
                ...rest,
                name: "renamed",
                events: ["terminal"],
                url: "discord://token@channel",
            })
        ).status,
    ).toBe(204);
    expect((await list())[0]).toMatchObject({
        name: "renamed",
        service: "discord",
    });
    expect((await call("POST", `/${id}/test`)).status).toBe(204);
    expect((await sent(2))[1]?.url).toBe("discord://token@channel");
    expect(
        ctx.db
            .query<{ data: string }, []>(
                "SELECT data FROM audit WHERE event = 'alert_update'",
            )
            .all()
            .map((r) => r.data)
            .join("\n"),
    ).not.toContain("token@channel");

    expect((await call("DELETE", `/${id}`)).status).toBe(204);
    expect(await list()).toEqual([]);
    expect((await call("POST", `/${id}/test`)).status).toBe(404);
});

test("test send: URL only in env, message on stdin, nothing else of ours in env", async () => {
    process.env.ALERT_TEST_SECRET = "s3cret";
    try {
        await setup();
        const id = await create({ events: ["host_down"] });
        expect((await call("POST", `/${id}/test`)).status).toBe(204);
        const [s] = await sent(1);
        expect(s?.args).toEqual([
            "send",
            "-t",
            "CertShell: test alert",
            "-m",
            "-",
        ]);
        expect(s?.body).toContain('Channel "ops" works.');
        expect(s?.env).toContain("SHOUTRRR_URL");
        expect(s?.env).not.toContain("ALERT_TEST_SECRET");
        expect(s?.env).not.toContain("PATH");
    } finally {
        delete process.env.ALERT_TEST_SECRET;
    }
});

test("failed send → 502 with shoutrrr's error, kept as lastError", async () => {
    await setup();
    const id = await create({ url: "ntfy://fail", events: ["host_down"] });
    const res = await call("POST", `/${id}/test`);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
        error: "ntfy: failed to send ntfy notification",
    });
    expect((await list())[0]?.lastError).toBe(
        "ntfy: failed to send ntfy notification",
    );
});

test("failed send: webhook URLs in shoutrrr's error are redacted", async () => {
    await setup();
    const id = await create({
        url: "discord://SECRETTOK@1?leak",
        events: ["host_down"],
    });
    const res = await call("POST", `/${id}/test`);
    expect(res.status).toBe(502);
    const error = 'Post "<url>": dial tcp: lookup failed';
    expect(await res.json()).toEqual({ error });
    expect((await list())[0]?.lastError).toBe(error);
});

test("security events go to channels that picked them", async () => {
    await setup();
    await create({ name: "sec" });
    await create({
        name: "terms",
        url: "ntfy://x/terms",
        events: ["terminal"],
    });
    const res = await ctx.app.request(`${APP_URL}/api/admin/hosts`, {
        method: "POST",
        headers: {
            cookie: ctx.cookie,
            origin: APP_URL,
            "content-type": "application/json",
        },
        body: JSON.stringify({ name: "web9", address: "web9.lan" }),
    });
    expect(res.status).toBe(201);
    const s = await sent(3);
    // "sec" also hears about "terms" being added.
    expect(titles(s)).toEqual([
        "CertShell: Alert channel added: sec",
        "CertShell: Alert channel added: terms",
        "CertShell: Host added: web9",
    ]);
    expect(s.every((x) => x.url === "ntfy://ntfy.sh/secret-topic")).toBe(true);
    expect(s[2]?.body).toBe("By a@b.c.\nhttps://ssh.test/admin/audit");
});

test("terminal event: filtered by host tag or login; empty filter = every terminal", async () => {
    await setup();
    await create({ name: "all", url: "ntfy://x/all", events: ["terminal"] });
    await create({
        name: "prod",
        url: "ntfy://x/prod",
        events: ["terminal"],
        tags: ["prod"],
    });
    await create({
        name: "staging",
        url: "ntfy://x/staging",
        events: ["terminal"],
        tags: ["staging"],
    });
    await create({
        name: "root",
        url: "ntfy://x/root",
        events: ["terminal"],
        logins: ["root"],
    });
    audit(ctx.db, {
        event: "session_start",
        sub: "u",
        email: "a@b.c",
        principal: "ws:h1:deploy",
        session: "s1",
    });
    audit(ctx.db, {
        event: "session_start",
        sub: "u",
        email: "a@b.c",
        principal: "ws:h1:root",
        session: "s2",
    });
    const s = await sent(5);
    await Bun.sleep(100);
    expect((await readSent()).length).toBe(5);
    expect(s.map((x) => `${x.url} ${x.args[2]}`).sort()).toEqual([
        "ntfy://x/all CertShell: a@b.c opened deploy@h1",
        "ntfy://x/all CertShell: a@b.c opened root@h1",
        "ntfy://x/prod CertShell: a@b.c opened deploy@h1",
        "ntfy://x/prod CertShell: a@b.c opened root@h1",
        "ntfy://x/root CertShell: a@b.c opened root@h1",
    ]);
});

test("task_failed: one alert when the last host finishes, only if one failed", async () => {
    await setup({
        command: ({ host, remote }) => ["sh", "-c", remote ?? "", host.id],
    });
    ctx.addHost("h2", "h2.test", "ssh-ed25519 BBBB", {
        root: "certshell-admins",
    });
    await create({ events: ["task_failed"] });
    const task = async (script: string) => {
        const r = await ctx.app.request(`${APP_URL}/api/tasks`, {
            method: "POST",
            headers: {
                cookie: ctx.cookie,
                origin: APP_URL,
                "content-type": "application/json",
            },
            body: JSON.stringify({
                name: "Upgrade",
                script,
                targets: [
                    { host: "h1", login: "root" },
                    { host: "h2", login: "root" },
                ],
            }),
        });
        return ((await r.json()) as { id: number }).id;
    };
    const run = async (id: number) => {
        const r = await ctx.app.request(`${APP_URL}/api/tasks/${id}/run`, {
            method: "POST",
            headers: { cookie: ctx.cookie, origin: APP_URL },
        });
        return ((await r.json()) as { id: string }).id;
    };

    const done = async (runId: string) => {
        for (let i = 0; i < 100; i++) {
            const n = ctx.db
                .query<{ n: number }, [string]>(
                    "SELECT count(*) AS n FROM run_hosts WHERE run_id = ? AND status = 'running'",
                )
                .get(runId)?.n;
            if (n === 0) return;
            await Bun.sleep(30);
        }
    };
    await done(await run(await task("true")));
    const runId = await run(await task('[ "$0" = h2 ] && exit 3; true'));
    await done(runId);
    const s = await sent(1);
    await Bun.sleep(100);
    expect((await readSent()).length).toBe(1);
    expect(s[0]?.args[2]).toBe(
        'CertShell: task "Upgrade" failed on 1 of 2 hosts',
    );
    expect(s[0]?.body).toBe(
        `Run by a@b.c.\nroot@h2: exit 3\nhttps://ssh.test/tasks/runs/${runId}`,
    );
});

test("reboot: alerted when host facts first show the flag, not again until it clears", async () => {
    let reboot = "1";
    await setup({ command: () => ["sh", "-c", `echo reboot=${reboot}`] });
    await create({ events: ["reboot"] });
    ctx.db.run("UPDATE hosts SET facts_login = 'root' WHERE id = 'h1'");
    await ctx.facts.collect("h1");
    await ctx.facts.collect("h1");
    reboot = "0";
    await ctx.facts.collect("h1");
    reboot = "1";
    await ctx.facts.collect("h1");
    const s = await sent(2);
    await Bun.sleep(100);
    expect((await readSent()).length).toBe(2);
    expect(titles(s)).toEqual([
        "CertShell: h1 needs a reboot",
        "CertShell: h1 needs a reboot",
    ]);
    expect(s[0]?.body).toBe(
        "Host facts found the reboot flag set.\nhttps://ssh.test/admin/fleet",
    );
});

test("host monitor: first check silent, offline after 2 failed checks, back online after 1", async () => {
    let up = true;
    await setup({}, async () => up);
    await create({ events: ["host_down"] });
    await ctx.alerts.checkHosts();
    up = false;
    await ctx.alerts.checkHosts();
    expect(await readSent()).toEqual([]);
    await ctx.alerts.checkHosts();
    await ctx.alerts.checkHosts();
    up = true;
    await ctx.alerts.checkHosts();
    const s = await sent(2);
    expect(titles(s)).toEqual([
        "CertShell: h1 is offline",
        "CertShell: h1 is back online",
    ]);
    const events = ctx.db
        .query<{ event: string }, []>(
            "SELECT event FROM audit WHERE event LIKE 'host_%' ORDER BY id",
        )
        .all()
        .map((r) => r.event);
    expect(events).toEqual(["host_down", "host_up"]);
});

test("host key mismatch on a terminal: audited and alerted", async () => {
    await setup({
        command: ({ log }) => [
            "sh",
            "-c",
            `echo 'Host key verification failed.' > "$0"; exit 255`,
            log ?? "",
        ],
    });
    await create();
    const t = ctx.connect("host=h1&login=root");
    expect((await t.closed).output).toContain("Host key verification failed.");
    const s = await sent(2);
    expect(titles(s)[1]).toBe("CertShell: Host key mismatch on h1");
});

test("host key message in the user's own output: not a mismatch", async () => {
    await setup({
        command: () => [
            "sh",
            "-c",
            "echo 'Host key verification failed.'; exit 255",
        ],
    });
    const t = ctx.connect("host=h1&login=root");
    await t.closed;
    const events = ctx.db
        .query<{ event: string }, []>("SELECT event FROM audit")
        .all()
        .map((r) => r.event);
    expect(events).toContain("session_end");
    expect(events).not.toContain("host_key_mismatch");
});

test("hostKeyRejected: exit 255 plus ssh's message", () => {
    expect(
        hostKeyRejected(255, "...\r\nHost key verification failed.\r\n"),
    ).toBe(true);
    expect(hostKeyRejected(1, "Host key verification failed.")).toBe(false);
    expect(hostKeyRejected(255, "Permission denied")).toBe(false);
});

test("URL sealed with another ca_password: send fails with a clear error", async () => {
    await setup();
    const id = await create({ events: ["host_down"] });
    const other = alerter({
        db: ctx.db,
        appUrl: new URL(APP_URL),
        caPassword: "different",
    });
    expect(await other.test(id)).toBe(
        "can't decrypt the URL (ca_password changed?); enter it again",
    );
    const plain = alerter({
        db: ctx.db,
        appUrl: new URL(APP_URL),
        caPassword: undefined,
    });
    expect(await plain.seal("ntfy://x")).toBe("plain:ntfy://x");
});
