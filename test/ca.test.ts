import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { ensureCa, readCaPassword } from "../src/ca";
import { run } from "../src/exec";

const pubFrom = (key: string, pw: string) =>
    run(["ssh-keygen", "-y", "-P", pw, "-f", key]);

let root: string;
afterEach(() => rm(root, { recursive: true, force: true }));

test("generates an encrypted CA once, 0700 dir", async () => {
    root = await mkdtemp(`${tmpdir()}/ca-`);
    const dir = `${root}/ca`;
    await ensureCa(dir, "test-ca", "s3cret");

    expect((await stat(dir)).mode & 0o777).toBe(0o700);
    const pub = await Bun.file(`${dir}/user_ca.pub`).text();
    expect(pub).toMatch(/^ssh-ed25519 \S+ test-ca\n$/);
    await expect(pubFrom(`${dir}/user_ca`, "wrong")).rejects.toThrow();
    expect((await pubFrom(`${dir}/user_ca`, "s3cret")).split(" ")[1]).toBe(
        pub.split(" ")[1],
    );

    await ensureCa(dir, "test-ca", "s3cret");
    expect(await Bun.file(`${dir}/user_ca.pub`).text()).toBe(pub);
});

test("no password → unencrypted key", async () => {
    root = await mkdtemp(`${tmpdir()}/ca-`);
    await ensureCa(`${root}/ca`, "test-ca", undefined);
    expect(await pubFrom(`${root}/ca/user_ca`, "")).toStartWith("ssh-ed25519 ");
});

test("readCaPassword trims, treats missing/blank as none", async () => {
    root = await mkdtemp(`${tmpdir()}/pw-`);
    expect(await readCaPassword(`${root}/missing`)).toBeUndefined();
    await Bun.write(`${root}/blank`, "\n");
    expect(await readCaPassword(`${root}/blank`)).toBeUndefined();
    await Bun.write(`${root}/pw`, "abc\n");
    expect(await readCaPassword(`${root}/pw`)).toBe("abc");
});
