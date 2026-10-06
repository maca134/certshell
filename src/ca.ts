import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { run } from "./exec";

export async function readCaPassword(path = "/run/secrets/ca_password") {
    const file = Bun.file(path);
    return (await file.exists())
        ? (await file.text()).trim() || undefined
        : undefined;
}

export async function ensureCa(
    dir: string,
    name: string,
    password: string | undefined,
) {
    const key = `${dir}/user_ca`;
    if (existsSync(key)) return;
    await mkdir(dir, { recursive: true, mode: 0o700 });
    if (!password)
        console.warn("no ca_password secret: CA key stored unencrypted");
    await run([
        "ssh-keygen",
        "-q",
        "-t",
        "ed25519",
        "-f",
        key,
        "-C",
        name,
        "-N",
        password ?? "",
    ]);
    console.log(`generated user CA ${key}.pub`);
}
