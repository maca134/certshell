import type { Database } from "bun:sqlite";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import * as oidc from "openid-client";
import type { Config } from "./config";
import type { GetOidc } from "./oidc";
import {
    createSession,
    getSession,
    SESSION_TTL_SECONDS,
    type User,
} from "./sessions";

export const LOGIN_COOKIE = "__Host-wsh_login";
export const SESSION_COOKIE = "__Host-wsh_session";

const cookieOpts = {
    secure: true,
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
} as const;

const PUBLIC_ROUTES = new Set([
    "GET /healthz",
    "GET /auth/login",
    "GET /auth/callback",
]);

type Env = { Variables: { user: User } };

export type Deps = { config: Config; db: Database; getOidc: GetOidc };

export function createApp({ config, db, getOidc }: Deps) {
    const app = new Hono<Env>();

    app.use(
        "*",
        createMiddleware<Env>(async (c, next) => {
            if (PUBLIC_ROUTES.has(`${c.req.method} ${c.req.path}`))
                return next();
            const user = getSession(db, getCookie(c, SESSION_COOKIE));
            if (!user)
                return c.req.path.startsWith("/api/")
                    ? c.json({ error: "unauthenticated" }, 401)
                    : c.redirect("/auth/login");
            c.set("user", user);
            return next();
        }),
    );

    app.use("/api/admin/*", async (c, next) => {
        if (!c.var.user.groups.includes(config.adminGroup))
            return c.json({ error: "forbidden" }, 403);
        return next();
    });

    app.get("/healthz", (c) => c.body(null, 200));

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
        console.log(
            JSON.stringify({
                event: "login",
                iss: claims.iss,
                sub: claims.sub,
                email,
                groups,
            }),
        );
        return c.redirect("/");
    });

    app.get("/api/me", (c) => {
        const { iss, sub, email, groups } = c.var.user;
        return c.json({
            iss,
            sub,
            email,
            groups,
            admin: groups.includes(config.adminGroup),
        });
    });

    app.get("/", (c) =>
        c.text(`signed in as ${c.var.user.email ?? c.var.user.sub}`),
    );

    return app;
}
