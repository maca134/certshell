import { caPassphraseEnv } from "./ca";
import { run } from "./exec";

const PRINCIPAL = /^ws:[a-z0-9]+:[a-z_][a-z0-9_-]*$/;

type MintOptions = {
    caKey: string;
    caPassword: string | undefined;
    dir: string;
    principal: string;
    keyId: string;
    serial: number;
    validity?: string;
};

// Writes dir/id + dir/id-cert.pub; `ssh -i dir/id` picks up the cert.
export async function mintUserCert(opts: MintOptions) {
    if (!PRINCIPAL.test(opts.principal))
        throw new Error(`invalid principal: ${opts.principal}`);
    const key = `${opts.dir}/id`;
    await run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", key]);
    await run(
        [
            "ssh-keygen",
            "-q",
            "-s",
            opts.caKey,
            "-I",
            opts.keyId,
            "-n",
            opts.principal,
            "-V",
            opts.validity ?? "+15m",
            "-z",
            String(opts.serial),
            "-O",
            "clear",
            "-O",
            "permit-pty",
            `${key}.pub`,
        ],
        opts.caPassword ? caPassphraseEnv(opts.caPassword) : undefined,
    );
    return key;
}
