import { afterEach, expect, test } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { HostFactsRow } from "@repo/shared";
import { parseFacts } from "../src/ssh/facts";
import type { TerminalDeps } from "../src/ssh/terminal";
import { APP_URL, startApp } from "./helpers/app";

// Fake `ssh`: runs the remote command locally, so `sh -s` runs the real facts script on this machine.
const localSsh: TerminalDeps["command"] = ({ remote }) => [
    "sh",
    "-c",
    remote ?? "exit 99",
];

let ctx: Awaited<ReturnType<typeof startApp>>;
afterEach(() => ctx?.stop());

async function setup(
    terminal: Parameters<typeof startApp>[0] = {},
    groups = ["certshell-admins"],
) {
    ctx = await startApp({ command: localSsh, ...terminal }, groups);
    ctx.addHost("h1", "h1.test", "ssh-ed25519 AAAA", { root: "ops" });
    ctx.addHost("h2", "h2.test", "ssh-ed25519 BBBB", { root: "ops" });
    return ctx;
}

const call = (method: string, path: string, body?: unknown) =>
    ctx.app.request(`${APP_URL}/api/admin${path}`, {
        method,
        headers: {
            cookie: ctx.cookie,
            origin: APP_URL,
            "content-type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });

const list = async () =>
    (await (await call("GET", "/facts")).json()) as HostFactsRow[];

const setLogin = async (host: string, factsLogin: string | null) =>
    expect((await call("PATCH", `/hosts/${host}`, { factsLogin })).status).toBe(
        204,
    );

test("parseFacts: known keys only, numbers and flags checked", () => {
    expect(
        parseFacts(
            [
                "os=Debian GNU/Linux 13 (trixie)",
                "kernel=6.12.0",
                "uptime=3600",
                "reboot=1",
                "updates=12",
                "security=abc",
                "disk=",
                "evil=1",
                "noise",
                "openssh=OpenSSH_10.0p2 Debian-7",
            ].join("\n"),
        ),
    ).toEqual({
        os: "Debian GNU/Linux 13 (trixie)",
        kernel: "6.12.0",
        uptime: 3600,
        reboot: true,
        updates: 12,
        openssh: "OpenSSH_10.0p2 Debian-7",
    });
    expect(parseFacts("os=a\u0007b\nreboot=yes")).toEqual({});
});

test("facts login off by default; refresh → 404", async () => {
    await setup();
    expect((await list()).map((r) => [r.hostId, r.login, r.facts])).toEqual([
        ["h1", null, null],
        ["h2", null, null],
    ]);
    expect((await call("POST", "/facts/h1/refresh")).status).toBe(404);
    expect(
        (await call("PATCH", "/hosts/h1", { factsLogin: "Root!" })).status,
    ).toBe(400);
});

test("refresh runs the real script via sh -s as the system user, with a no-PTY cert", async () => {
    await setup();
    // A login outside the access map: the admin picked it, no group grants it.
    await setLogin("h1", "facts");
    expect((await call("POST", "/facts/h1/refresh")).status).toBe(204);
    const [row] = await list();
    expect(row).toMatchObject({
        hostId: "h1",
        login: "facts",
        error: null,
        collecting: false,
    });
    expect(row?.collectedAt).toBeGreaterThan(Date.now() - 60_000);
    expect(row?.facts?.kernel).toBe((await Bun.$`uname -r`.text()).trim());
    expect(row?.facts?.os).toBeString();
    expect(row?.facts?.uptime).toBeGreaterThan(0);
    expect(row?.facts?.disk).toBeNumber();

    const audits = ctx.db
        .query<{ event: string; sub: string; data: string }, []>(
            "SELECT event, sub, data FROM audit WHERE event IN ('sign', 'facts') ORDER BY id",
        )
        .all();
    expect(audits.map((a) => [a.event, a.sub])).toEqual([
        ["sign", "system"],
        ["facts", "system"],
    ]);
    expect(JSON.parse(audits[0]?.data ?? "{}").principal).toBe("ws:h1:facts");
}, 30_000);

test("BSD uptime: from kern.boottime's sec, not its usec", async () => {
    const dir = await mkdtemp(`${tmpdir()}/sysctl-`);
    const boot = Math.floor(Date.now() / 1000) - 3600;
    // FreeBSD / OPNsense format.
    await Bun.write(
        `${dir}/sysctl`,
        `#!/bin/sh\necho '{ sec = ${boot}, usec = 123456 } Mon Oct 12 10:00:00 2026'\n`,
    );
    await chmod(`${dir}/sysctl`, 0o755);
    try {
        await setup({
            command: () => [
                "env",
                `PATH=${dir}:${process.env.PATH}`,
                "sh",
                "-s",
            ],
        });
        await setLogin("h1", "root");
        await call("POST", "/facts/h1/refresh");
        const uptime = (await list())[0]?.facts?.uptime ?? 0;
        expect(uptime).toBeGreaterThanOrEqual(3600);
        expect(uptime).toBeLessThan(3660);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test("cert: no permit-pty", async () => {
    await setup({
        command: ({ key }) => [
            "sh",
            "-c",
            'ssh-keygen -L -f "$0-cert.pub" | grep -q permit-pty && echo os=pty || echo os=nopty',
            key,
        ],
    });
    await setLogin("h1", "root");
    await call("POST", "/facts/h1/refresh");
    expect((await list())[0]?.facts?.os).toBe("nopty");
});

test("failed collection: error stored, last good facts kept", async () => {
    let fail = false;
    await setup({
        command: () =>
            fail
                ? [
                      "sh",
                      "-c",
                      "echo 'ssh: connect to host h1.test port 22: Connection refused' >&2; exit 255",
                  ]
                : ["sh", "-c", "echo os=first"],
    });
    await setLogin("h1", "root");
    await call("POST", "/facts/h1/refresh");
    fail = true;
    await call("POST", "/facts/h1/refresh");
    expect((await list())[0]).toMatchObject({
        facts: { os: "first" },
        error: "ssh: connect to host h1.test port 22: Connection refused",
    });
});

test("collectDue: only hosts with a facts login whose facts are missing, stale or for another login", async () => {
    const seen: string[] = [];
    await setup({
        command: ({ host, login }) => {
            seen.push(`${host.id}:${login}`);
            return ["sh", "-c", "echo os=x"];
        },
    });
    await setLogin("h1", "root");
    await ctx.facts.collectDue();
    expect(seen).toEqual(["h1:root"]);
    await ctx.facts.collectDue();
    expect(seen).toEqual(["h1:root"]);
    ctx.db.run("UPDATE host_facts SET collected_at = 0");
    await setLogin("h2", "root");
    await ctx.facts.collectDue();
    expect(seen.sort()).toEqual(["h1:root", "h1:root", "h2:root"]);
    await setLogin("h2", "admin");
    // The list hides facts collected as another login.
    expect((await list())[1]?.facts).toBeNull();
    await ctx.facts.collectDue();
    expect(seen.at(-1)).toBe("h2:admin");
});

test("refresh all: 202, then collected in the background", async () => {
    await setup();
    await setLogin("h1", "root");
    await setLogin("h2", "root");
    expect((await call("POST", "/facts/refresh")).status).toBe(202);
    for (let i = 0; i < 800 && (await list()).some((r) => !r.collectedAt); i++)
        await Bun.sleep(30);
    expect((await list()).every((r) => r.facts?.os)).toBe(true);
}, 30_000);

test("refresh all while one is running adds to its queue: no host dropped", async () => {
    const seen: string[] = [];
    await setup({
        command: ({ host, login }) => {
            seen.push(`${host.id}:${login}`);
            return ["sh", "-c", "echo os=x"];
        },
    });
    await setLogin("h1", "root");
    await setLogin("h2", "root");
    await Promise.all([
        ctx.facts.collectAll(["h1"]),
        ctx.facts.collectAll(["h1", "h2"]),
    ]);
    // h1 was already running when the second call queued it, so it may run again.
    expect([...new Set(seen)].sort()).toEqual(["h1:root", "h2:root"]);
});

test("a failed facts write doesn't stop the queue", async () => {
    await setup({ command: () => ["sh", "-c", "echo os=x"] });
    await setLogin("h1", "root");
    await setLogin("h2", "root");
    ctx.db.run(
        "CREATE TRIGGER boom BEFORE INSERT ON host_facts WHEN NEW.host_id = 'h1' BEGIN SELECT RAISE(ABORT, 'boom'); END",
    );
    await ctx.facts.collectAll(["h1", "h2"]);
    expect((await list()).map((r) => [r.hostId, r.facts?.os])).toEqual([
        ["h1", undefined],
        ["h2", "x"],
    ]);
});

test("deleting a host drops its facts", async () => {
    await setup();
    await setLogin("h1", "root");
    await call("POST", "/facts/h1/refresh");
    expect((await call("DELETE", "/hosts/h1")).status).toBe(204);
    expect(ctx.db.query("SELECT * FROM host_facts").all()).toEqual([]);
});

test("non-admins can't read or refresh facts", async () => {
    await setup({}, ["ops"]);
    expect((await call("GET", "/facts")).status).toBe(403);
    expect((await call("POST", "/facts/refresh")).status).toBe(403);
});
