import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { run } from "./exec";

export async function readCaPassword(path = "/run/secrets/ca_password") {
    const file = Bun.file(path);
    return (await file.exists())
        ? (await file.text()).trim() || undefined
        : undefined;
}

// Keeps the passphrase out of argv (visible in `ps` on the Docker host).
export function caPassphraseEnv(password: string) {
    return {
        SSH_ASKPASS: `${import.meta.dir}/askpass.sh`,
        SSH_ASKPASS_REQUIRE: "force",
        CA_PASSPHRASE: password,
    };
}

export async function ensureCa(
    dir: string,
    name: string,
    password: string | undefined,
) {
    const key = `${dir}/user_ca`;
    if (existsSync(key)) return;
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const cmd = ["ssh-keygen", "-q", "-t", "ed25519", "-f", key, "-C", name];
    if (password) await run(cmd, caPassphraseEnv(password));
    else {
        console.warn("no ca_password secret: CA key stored unencrypted");
        await run([...cmd, "-N", ""]);
    }
    console.log(`generated user CA ${key}.pub`);
}
