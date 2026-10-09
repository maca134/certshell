import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { ensureCa } from "../src/ssh/ca";
import { mintUserCert } from "../src/ssh/certs";
import { run } from "../src/ssh/exec";

let root: string;
afterEach(() => rm(root, { recursive: true, force: true }));

async function setup() {
    root = await mkdtemp(`${tmpdir()}/certs-`);
    await ensureCa(`${root}/ca`, "test-ca", "s3cret");
    return {
        caKey: `${root}/ca/user_ca`,
        caPassword: "s3cret",
        dir: root,
        keyId: "a@b.c/user-1/sess-1",
        serial: 42,
    };
}

test("cert: single principal, pty only, key id, serial, 15m", async () => {
    const key = await mintUserCert({
        ...(await setup()),
        principal: "ws:h7f3k2ab:root",
    });
    const info = await run(["ssh-keygen", "-L", "-f", `${key}-cert.pub`]);
    expect(info).toContain(
        "Type: ssh-ed25519-cert-v01@openssh.com user certificate",
    );
    expect(info).toContain('Key ID: "a@b.c/user-1/sess-1"');
    expect(info).toContain("Serial: 42");
    expect(info).toMatch(/Principals: \n\s+ws:h7f3k2ab:root\n\s+Critical/);
    expect(info).toMatch(/Extensions: \n\s+permit-pty\n?$/);

    const to = info.match(/Valid: from \S+ to (\S+)/)?.[1] ?? "";
    const minutesLeft = (Date.parse(to) - Date.now()) / 60000;
    expect(minutesLeft).toBeGreaterThan(14);
    expect(minutesLeft).toBeLessThanOrEqual(15);
});

test("rejects principals that could inject extra principals", async () => {
    const opts = await setup();
    for (const principal of [
        "ws:h1:root,ws:h1:alice",
        "ws:h1:Root",
        "root",
        "ws:h1:",
        "ws:h1:root ",
    ])
        await expect(mintUserCert({ ...opts, principal })).rejects.toThrow(
            "invalid principal",
        );
});
