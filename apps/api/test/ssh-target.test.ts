// Integration test against the dev `ssh-target` compose service (hostId dev00001). Run:
// docker compose run --rm --no-deps -T -v ./apps/api/test:/app/apps/api/test:ro -e SSH_TARGET=ssh-target -w /app/apps/api --entrypoint bun web-ssh test
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { readCaPassword } from "../src/ca";
import { mintUserCert } from "../src/certs";
import { run } from "../src/exec";
import { startApp } from "./helpers/app";

const target = process.env.SSH_TARGET;

describe.skipIf(!target)("ssh-target", () => {
    let root = "";
    let caPassword: string | undefined;
    let knownHosts = "";
    beforeAll(async () => {
        root = await mkdtemp(`${tmpdir()}/s-`);
        caPassword = await readCaPassword();
        knownHosts = `${root}/known_hosts`;
        await Bun.write(
            knownHosts,
            await run(["ssh-keyscan", "-t", "ed25519", target ?? ""]),
        );
    });
    afterAll(() => rm(root, { recursive: true, force: true }));

    let n = 0;
    async function sshAs(
        login: string,
        principal: string,
        { validity = "+15m", args = [] as string[], command = ["whoami"] } = {},
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

    test("cert for ws:dev00001:root logs in as root", async () => {
        expect(await sshAs("root", "ws:dev00001:root")).toMatchObject({
            code: 0,
            out: "root",
        });
    });

    test("cert for ws:dev00001:alice logs in as alice", async () => {
        expect(await sshAs("alice", "ws:dev00001:alice")).toMatchObject({
            code: 0,
            out: "alice",
        });
    });

    test("wrong login → rejected", async () => {
        expect((await sshAs("alice", "ws:dev00001:root")).code).toBe(255);
    });

    test("wrong hostId → rejected", async () => {
        expect((await sshAs("root", "ws:other001:root")).code).toBe(255);
    });

    test("expired cert → rejected", async () => {
        expect(
            (await sshAs("root", "ws:dev00001:root", { validity: "-10m:-5m" }))
                .code,
        ).toBe(255);
    });

    test("-O clear: port forwarding refused", async () => {
        const { code, err } = await sshAs("root", "ws:dev00001:root", {
            args: ["-o", "ExitOnForwardFailure=yes", "-W", "127.0.0.1:22"],
            command: [],
        });
        expect(code).toBe(255);
        expect(err).toMatch(/administratively prohibited|refused/i);
    });

    test("web terminal: WS → signed cert → ssh → shell", async () => {
        const hostKey = (await Bun.file(knownHosts).text())
            .split("\n")
            .find((l) => l.startsWith(`${target} `))
            ?.slice(`${target} `.length);
        const ctx = await startApp({
            caKey: "/data/ca/user_ca",
            caPassword,
        });
        try {
            ctx.addHost("dev00001", target ?? "", hostKey ?? "", {
                alice: "admins",
            });
            const t = ctx.connect("host=dev00001&login=alice");
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
