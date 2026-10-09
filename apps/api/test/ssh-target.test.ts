// Integration test against the dev `ssh-target` compose service, after enrolling it via the UI. Run:
// docker compose run --rm --no-deps -T -v ./apps/api/test:/app/apps/api/test:ro -e SSH_TARGET=ssh-target -w /app/apps/api --entrypoint bun certshell test
import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { readCaPassword } from "../src/ssh/ca";
import { mintUserCert } from "../src/ssh/certs";
import { run } from "../src/ssh/exec";
import { startApp } from "./helpers/app";

const target = process.env.SSH_TARGET;

describe.skipIf(!target)("ssh-target", () => {
    let root = "";
    let caPassword: string | undefined;
    let knownHosts = "";
    let hostId = "";
    let hostKey = "";
    beforeAll(async () => {
        const db = new Database("/data/app.sqlite", { readonly: true });
        const row = db
            .query<{ id: string; host_key: string }, [string]>(
                "SELECT id, host_key FROM hosts WHERE address = ? AND host_key IS NOT NULL",
            )
            .get(target ?? "");
        db.close();
        if (!row) throw new Error(`enroll ${target} via the web UI first`);
        ({ id: hostId, host_key: hostKey } = row);
        root = await mkdtemp(`${tmpdir()}/s-`);
        caPassword = await readCaPassword();
        knownHosts = `${root}/known_hosts`;
        await Bun.write(knownHosts, `${target} ${hostKey}\n`);
    });
    afterAll(() => rm(root, { recursive: true, force: true }));

    let n = 0;
    async function sshAs(
        login: string,
        principal: string,
        {
            validity = "+15m",
            args = [] as string[],
            command = ["whoami"],
            pty = true,
        } = {},
    ) {
        const dir = `${root}/${++n}`;
        await run(["mkdir", "-m", "700", dir]);
        const key = await mintUserCert({
            caKey: "/data/ca/user_ca",
            caPassword,
            dir,
            principal,
            keyId: `test/${n}`,
            serial: n,
            validity,
            pty,
        });
        const proc = Bun.spawn(
            [
                "ssh",
                "-i",
                key,
                "-o",
                `UserKnownHostsFile=${knownHosts}`,
                "-o",
                "StrictHostKeyChecking=yes",
                "-o",
                "BatchMode=yes",
                "-o",
                "IdentitiesOnly=yes",
                ...args,
                "--",
                `${login}@${target}`,
                ...command,
            ],
            { stdin: "ignore", stdout: "pipe", stderr: "pipe" },
        );
        return {
            code: await proc.exited,
            out: (await new Response(proc.stdout).text()).trim(),
            err: await new Response(proc.stderr).text(),
        };
    }

    test("cert for ws:<hostId>:root logs in as root", async () => {
        expect(await sshAs("root", `ws:${hostId}:root`)).toMatchObject({
            code: 0,
            out: "root",
        });
    });

    test("cert for ws:<hostId>:alice logs in as alice", async () => {
        expect(await sshAs("alice", `ws:${hostId}:alice`)).toMatchObject({
            code: 0,
            out: "alice",
        });
    });

    test("wrong login → rejected", async () => {
        expect((await sshAs("alice", `ws:${hostId}:root`)).code).toBe(255);
    });

    test("wrong hostId → rejected", async () => {
        expect((await sshAs("root", "ws:other001:root")).code).toBe(255);
    });

    test("expired cert → rejected", async () => {
        expect(
            (await sshAs("root", `ws:${hostId}:root`, { validity: "-10m:-5m" }))
                .code,
        ).toBe(255);
    });

    test("-O clear: port forwarding refused", async () => {
        const { code, err } = await sshAs("root", `ws:${hostId}:root`, {
            args: ["-o", "ExitOnForwardFailure=yes", "-W", "127.0.0.1:22"],
            command: [],
        });
        expect(code).toBe(255);
        expect(err).toMatch(/administratively prohibited|refused/i);
    });

    test("task cert (no permit-pty): runs a command, refuses a PTY", async () => {
        const opts = { pty: false, command: ["whoami; exit 7"] };
        expect(await sshAs("alice", `ws:${hostId}:alice`, opts)).toMatchObject({
            code: 7,
            out: "alice",
        });
        const { code, err } = await sshAs("alice", `ws:${hostId}:alice`, {
            ...opts,
            args: ["-tt"],
        });
        expect(code).toBe(255);
        expect(err).toContain("PTY allocation request failed");
    });

    test("web terminal: WS → signed cert → ssh → shell", async () => {
        const ctx = await startApp({
            caKey: "/data/ca/user_ca",
            caPassword,
        });
        try {
            ctx.addHost(hostId, target ?? "", hostKey, {
                alice: "admins",
            });
            const t = ctx.connect(`host=${hostId}&login=alice`);
            await t.opened;
            t.send({ t: "in", d: "echo me=$(whoami)\r" });
            await t.waitFor("me=alice");
            t.send({ t: "in", d: "exit\r" });
            expect((await t.closed).reason).toBe("exited");
        } finally {
            await ctx.stop();
        }
    });
});
