import type { Database } from "bun:sqlite";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import * as oidc from "openid-client";
import { audit } from "./audit";
import type { Config } from "./config";
import type { GetOidc } from "./oidc";
import {
    type AppEnv,
    createSession,
    deleteSession,
    SESSION_TTL_SECONDS,
} from "./sessions";

export const LOGIN_COOKIE = "__Host-certshell_login";
export const SESSION_COOKIE = "__Host-certshell_session";

const cookieOpts = {
    secure: true,
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
} as const;

const SIGNED_OUT_PAGE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Signed out</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#141417;color:#f4f4f5;font:15px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;-webkit-font-smoothing:antialiased">
<main style="width:min(360px,calc(100vw - 32px));padding:32px;box-sizing:border-box;border:1px solid rgb(255 255 255/8%);border-radius:16px;background:#1b1b1f;text-align:center">
<svg width="44" height="44" aria-hidden="true" viewBox="0 0 32 32"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="32" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#3b8cff"/><stop offset="1" stop-color="#2160e0"/></linearGradient></defs><g stroke-width="2.6" stroke-linejoin="round"><path d="M18.1 2.65 26.51 7.51 24.26 8.81 18.1 5.25ZM28.61 11.14 28.61 20.86 26.36 19.56 26.36 12.44ZM26.51 24.49 18.1 29.35 18.1 26.75 24.26 23.19ZM13.9 29.35 5.49 24.49 7.74 23.19 13.9 26.75ZM3.39 20.86 3.39 11.14 5.64 12.44 5.64 19.56ZM5.49 7.51 13.9 2.65 13.9 5.25 7.74 8.81Z" fill="url(#g)" stroke="url(#g)"/><path d="M16 9.1 21.97 12.55 21.97 19.45 16 22.9 10.03 19.45 10.03 12.55Z" fill="#16213a" stroke="#16213a"/></g><path d="M12.7 13.4l2.6 2.6-2.6 2.6M16.7 19h3" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
<h1 style="margin:16px 0 4px;font-size:20px;font-weight:600;letter-spacing:-.01em">You're signed out</h1>
<p style="margin:0 0 24px;color:#a1a1aa;font-size:14px">Your CertShell session has ended.</p>
<a href="/auth/login" style="display:block;padding:9px 0;border-radius:10px;background:#2f7bf5;color:#fff;font-weight:500;font-size:14px;text-decoration:none">Sign in again</a>
</main>`;

export function authRoutes({
    config,
    db,
    getOidc,
}: {
    config: Config;
    db: Database;
    getOidc: GetOidc;
}) {
    const app = new Hono<AppEnv>();

    app.get("/auth/login", async (c) => {
        let oidcConfig: oidc.Configuration;
        try {
            oidcConfig = await getOidc();
        } catch (err) {
            console.warn(`OIDC discovery failed: ${err}`);
            return c.text("identity provider unavailable", 503);
        }
        const state = oidc.randomState();
        const verifier = oidc.randomPKCECodeVerifier();
        setCookie(c, LOGIN_COOKIE, `${state}.${verifier}`, {
            ...cookieOpts,
            maxAge: 600,
        });
        const url = oidc.buildAuthorizationUrl(oidcConfig, {
            redirect_uri: new URL("/auth/callback", config.appUrl).href,
            scope: "openid email profile groups",
            code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
            code_challenge_method: "S256",
            state,
        });
        return c.redirect(url.href);
    });

    app.get("/auth/callback", async (c) => {
        const [state, verifier] = (getCookie(c, LOGIN_COOKIE) ?? "").split(".");
        deleteCookie(c, LOGIN_COOKIE, cookieOpts);
        if (!state || !verifier)
            return c.text("login expired, start again", 400);

        const reqUrl = new URL(c.req.url);
        const callbackUrl = new URL(
            reqUrl.pathname + reqUrl.search,
            config.appUrl,
        );
        let claims: oidc.IDToken | undefined;
        try {
            const tokens = await oidc.authorizationCodeGrant(
                await getOidc(),
                callbackUrl,
                { pkceCodeVerifier: verifier, expectedState: state },
            );
            claims = tokens.claims();
        } catch (err) {
            console.warn(`login failed: ${err}`);
            return c.text("login failed", 400);
        }
        if (!claims) return c.text("login failed", 400);

        const groups = Array.isArray(claims.groups)
            ? claims.groups.filter((g): g is string => typeof g === "string")
            : [];
        const email = typeof claims.email === "string" ? claims.email : null;
        const token = createSession(db, {
            iss: claims.iss,
            sub: claims.sub,
            email,
            groups,
        });
        setCookie(c, SESSION_COOKIE, token, {
            ...cookieOpts,
            maxAge: SESSION_TTL_SECONDS,
        });
        db.run(
            `INSERT INTO users (iss, sub, email, groups, last_login) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (iss, sub) DO UPDATE SET email = excluded.email, groups = excluded.groups, last_login = excluded.last_login`,
            [claims.iss, claims.sub, email, JSON.stringify(groups), Date.now()],
        );
        audit(db, {
            event: "login",
            iss: claims.iss,
            sub: claims.sub,
            email,
            groups,
            ip: c.var.ip,
        });
        return c.redirect("/");
    });

    app.post("/auth/logout", (c) => {
        const user = deleteSession(db, getCookie(c, SESSION_COOKIE));
        deleteCookie(c, SESSION_COOKIE, cookieOpts);
        if (user)
            audit(db, {
                event: "logout",
                iss: user.iss,
                sub: user.sub,
                email: user.email,
                ip: c.var.ip,
            });
        return c.redirect("/auth/logout", 303);
    });

    // Not a redirect to /: that would bounce through the IdP and sign straight back in.
    app.get("/auth/logout", (c) => c.html(SIGNED_OUT_PAGE));

    return app;
}
