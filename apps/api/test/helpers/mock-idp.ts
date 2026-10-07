// Minimal OIDC provider: discovery, JWKS, and a token endpoint that checks
// PKCE + client secret and returns an ES256 ID token with `nextClaims`.
export async function startMockIdp(clientId: string, clientSecret: string) {
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

    const state = {
        nextClaims: {} as Record<string, unknown>,
        lastRedirectUri: null as string | null,
        challenge: "",
    };
    const idp = Object.assign(state, {
        server: Bun.serve({
            port: 0,
            async fetch(req): Promise<Response> {
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
                if (url.pathname === "/jwks")
                    return Response.json({ keys: [jwk] });
                if (url.pathname === "/token") {
                    const form = await req.formData();
                    idp.lastRedirectUri = String(form.get("redirect_uri"));
                    const hash = await crypto.subtle.digest(
                        "SHA-256",
                        new TextEncoder().encode(
                            String(form.get("code_verifier")),
                        ),
                    );
                    if (
                        b64(hash) !== idp.challenge ||
                        form.get("client_id") !== clientId ||
                        form.get("client_secret") !== clientSecret
                    )
                        return Response.json(
                            { error: "invalid_grant" },
                            { status: 400 },
                        );
                    const now = Math.floor(Date.now() / 1000);
                    const input: string = `${b64({ alg: "ES256", kid: "k1" })}.${b64(
                        {
                            iss,
                            aud: clientId,
                            iat: now,
                            exp: now + 60,
                            ...idp.nextClaims,
                        },
                    )}`;
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
        }),
    });
    return idp;
}
