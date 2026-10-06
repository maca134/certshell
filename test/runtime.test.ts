// Step 1 (SPEC §9): prove openid-client, PTY spawning and ssh work under Bun.
import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as oidc from "openid-client";
import { run } from "../src/exec";

function runInPty(cmd: string[]) {
    let out = "";
    const proc = Bun.spawn(cmd, {
        terminal: {
            cols: 100,
            rows: 30,
            data: (_t, d) => (out += new TextDecoder().decode(d)),
        },
    });
    return proc.exited.then((code) => {
        proc.terminal?.close();
        return { code, out };
    });
}

test("PTY: child gets a tty with the requested size", async () => {
    const { code, out } = await runInPty(["sh", "-c", "tty; stty size"]);
    expect(code).toBe(0);
    expect(out).toMatch(/^\/dev\/pts\/\d+\r\n30 100\r\n$/);
});

const dir = await mkdtemp(`${tmpdir()}/s-`);
afterAll(() => rm(dir, { recursive: true, force: true }));

test("ssh: runs in a PTY with an ephemeral key and pinned known_hosts", async () => {
    await run([
        "ssh-keygen",
        "-q",
        "-t",
        "ed25519",
        "-N",
        "",
        "-f",
        `${dir}/id`,
    ]);
    await Bun.write(`${dir}/known_hosts`, "");
    const { code, out } = await runInPty([
        "ssh",
        "-i",
        `${dir}/id`,
        "-p",
        "1",
        "-o",
        `UserKnownHostsFile=${dir}/known_hosts`,
        "-o",
        "StrictHostKeyChecking=yes",
        "-o",
        "BatchMode=yes",
        "--",
        "nobody@127.0.0.1",
    ]);
    expect(code).toBe(255);
    expect(out).toContain("Connection refused");
    expect(out).not.toMatch(
        /Could not create directory|Permission denied|Read-only/,
    );
});

test("openid-client: discovery + PKCE code exchange + ID token validation", async () => {
    const keys = await crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["sign", "verify"],
    );
    const jwk = {
        ...(await crypto.subtle.exportKey("jwk", keys.publicKey)),
        kid: "k1",
        alg: "ES256",
        use: "sig",
    };
    const b64 = (v: object | ArrayBuffer) =>
        Buffer.from(
            v instanceof ArrayBuffer ? new Uint8Array(v) : JSON.stringify(v),
        ).toString("base64url");
    let challenge = "";

    const idp = Bun.serve({
        port: 0,
        async fetch(req) {
            const url = new URL(req.url);
            const iss = url.origin;
            if (url.pathname === "/.well-known/openid-configuration")
                return Response.json({
                    issuer: iss,
                    authorization_endpoint: `${iss}/authorize`,
                    token_endpoint: `${iss}/token`,
                    jwks_uri: `${iss}/jwks`,
                    response_types_supported: ["code"],
                    id_token_signing_alg_values_supported: ["ES256"],
                });
            if (url.pathname === "/jwks") return Response.json({ keys: [jwk] });
            if (url.pathname === "/token") {
                const form = await req.formData();
                const verifier = String(form.get("code_verifier"));
                const hash = await crypto.subtle.digest(
                    "SHA-256",
                    new TextEncoder().encode(verifier),
                );
                if (
                    b64(hash) !== challenge ||
                    form.get("client_secret") !== "csecret"
                )
                    return Response.json(
                        { error: "invalid_grant" },
                        { status: 400 },
                    );
                const now = Math.floor(Date.now() / 1000);
                const input = `${b64({ alg: "ES256", kid: "k1" })}.${b64({
                    iss,
                    aud: "cid",
                    sub: "user-1",
                    iat: now,
                    exp: now + 60,
                    email: "a@b.c",
                    groups: ["web-ssh-admins"],
                })}`;
                const sig = await crypto.subtle.sign(
                    { name: "ECDSA", hash: "SHA-256" },
                    keys.privateKey,
                    new TextEncoder().encode(input),
                );
                return Response.json({
                    access_token: "at",
                    token_type: "Bearer",
                    id_token: `${input}.${b64(sig)}`,
                });
            }
            return new Response(null, { status: 404 });
        },
    });

    try {
        const config = await oidc.discovery(
            new URL(idp.url),
            "cid",
            "csecret",
            undefined,
            {
                execute: [oidc.allowInsecureRequests],
            },
        );
        const verifier = oidc.randomPKCECodeVerifier();
        challenge = await oidc.calculatePKCECodeChallenge(verifier);
        const state = oidc.randomState();
        const authUrl = oidc.buildAuthorizationUrl(config, {
            redirect_uri: "https://app.test/auth/callback",
            scope: "openid email profile groups",
            code_challenge: challenge,
            code_challenge_method: "S256",
            state,
        });
        expect(authUrl.searchParams.get("code_challenge")).toBe(challenge);

        const tokens = await oidc.authorizationCodeGrant(
            config,
            new URL(`https://app.test/auth/callback?code=c1&state=${state}`),
            { pkceCodeVerifier: verifier, expectedState: state },
        );
        expect(tokens.claims()).toMatchObject({
            sub: "user-1",
            groups: ["web-ssh-admins"],
        });
    } finally {
        idp.stop(true);
    }
});
