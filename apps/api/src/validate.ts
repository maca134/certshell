// Anything here ends up in ssh-keygen -n, known_hosts or the ssh argv.
export const LOGIN = /^[a-z_][a-z0-9_-]{0,31}$/;
const LABEL = "[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?";
const HOSTNAME = new RegExp(`^(?=.{1,253}$)${LABEL}(?:\\.${LABEL})*$`);
const IPV6 = /^[0-9A-Fa-f]*:[0-9A-Fa-f:.]*$/;
const TEXT = /^[^\p{Cc}]+$/u;

export const validAddress = (s: unknown): s is string =>
    typeof s === "string" &&
    (HOSTNAME.test(s) || (IPV6.test(s) && s.length <= 45));

export const validName = (s: unknown): s is string =>
    typeof s === "string" && s.trim() === s && s.length <= 64 && TEXT.test(s);

export const validGroup = (s: unknown): s is string =>
    typeof s === "string" && s.length <= 128 && TEXT.test(s);

export const validLogin = (s: unknown): s is string =>
    typeof s === "string" && LOGIN.test(s);

const ED25519_PREFIX = Buffer.from("\0\0\0\x0bssh-ed25519\0\0\0\x20", "latin1");

// Accepts the contents of ssh_host_ed25519_key.pub; returns "ssh-ed25519 <base64>".
export function parseHostKey(text: string): string | undefined {
    const b64 = text
        .trim()
        .match(/^ssh-ed25519 ([A-Za-z0-9+/]+={0,2})(?: [^\n]*)?$/)?.[1];
    if (!b64) return undefined;
    const blob = Buffer.from(b64, "base64");
    if (
        blob.length !== ED25519_PREFIX.length + 32 ||
        !blob.subarray(0, ED25519_PREFIX.length).equals(ED25519_PREFIX)
    )
        return undefined;
    return `ssh-ed25519 ${b64}`;
}
