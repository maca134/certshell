import type { Database } from "bun:sqlite";
import type { ClientMessage, Me } from "@repo/shared";
import { Hono } from "hono";
import {
    websocket as honoWebsocket,
    serveStatic,
    upgradeWebSocket,
} from "hono/bun";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import * as oidc from "openid-client";
import { adminRoutes, enrollRoute } from "./admin";
import { audit } from "./audit";
import type { Config } from "./config";
import { accessibleHosts, allowedHost, type Host } from "./hosts";
import type { GetOidc } from "./oidc";
import { clientIp, rateLimiter } from "./ratelimit";
import {
    type AppEnv,
    createSession,
    getSession,
    SESSION_TTL_SECONDS,
} from "./sessions";
import { openTerminal, type TerminalDeps } from "./terminal";

const WEB_DIST = `${import.meta.dir}/../../web/dist`;

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
    "GET /api/enroll",
    "POST /api/enroll",
]);

type Env = AppEnv & { Variables: { host: Host; login: string } };

// xterm.js injects <style> elements, hence 'unsafe-inline' for styles only.
const SECURITY_HEADERS = {
    "Content-Security-Policy":
        "default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    "Strict-Transport-Security": "max-age=31536000",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
};

// Bun's 16MB default × the pre-sign queue could exceed the container's memory limit.
export const websocket = { ...honoWebsocket, maxPayloadLength: 64 * 1024 };

export type Deps = {
    config: Config;
    db: Database;
    getOidc: GetOidc;
    terminal: TerminalDeps;
};

const termSize = (v: unknown, fallback: number) =>
    Math.min(Math.max(Math.trunc(Number(v)) || fallback, 1), 500);

function parseMessage(raw: unknown): ClientMessage | undefined {
    if (typeof raw !== "string") return undefined;
    let msg: unknown;
    try {
        msg = JSON.parse(raw);
    } catch {
        return undefined;
    }
    if (!msg || typeof msg !== "object") return undefined;
    const m = msg as Record<string, unknown>;
    if (m.t === "in" && typeof m.d === "string") return { t: "in", d: m.d };
    if (m.t === "resize")
        return {
            t: "resize",
            cols: termSize(m.cols, 80),
            rows: termSize(m.rows, 24),
        };
    return undefined;
}

export function createApp({ config, db, getOidc, terminal }: Deps) {
    const app = new Hono<Env>();
    const publicLimit = rateLimiter(60, 60_000);
    const enrollLimit = rateLimiter(10, 60_000);
    const signLimit = rateLimiter(10, 60_000);

    app.use("*", async (c, next) => {
        const peer = (c.env as Bun.Server<unknown> | undefined)?.requestIP?.(
            c.req.raw,
        )?.address;
        const ip = clientIp(
            peer,
            c.req.header("x-forwarded-for"),
            config.trustedProxies,
        );
        c.set("ip", ip);
        if (
            (PUBLIC_ROUTES.has(`${c.req.method} ${c.req.path}`) &&
                !publicLimit(ip)) ||
            (c.req.path === "/api/enroll" && !enrollLimit(ip))
        )
            return c.text("too many requests\n", 429);
        await next();
        for (const [k, v] of Object.entries(SECURITY_HEADERS))
            c.res.headers.set(k, v);
    });

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
    const caPubPath = `${terminal.caKey}.pub`;
    app.route("/", enrollRoute({ config, db, caPubPath }));
    app.route("/api/admin", adminRoutes({ config, db }));

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

    app.get("/api/me", (c) => {
        const { iss, sub, email, groups } = c.var.user;
        return c.json<Me>({
            iss,
            sub,
            email,
            groups,
            admin: groups.includes(config.adminGroup),
        });
    });

    app.get("/api/hosts", (c) =>
        c.json(accessibleHosts(db, c.var.user.groups)),
    );

    app.get(
        "/api/terminal",
        async (c, next) => {
            if (c.req.header("origin") !== config.appUrl.origin)
                return c.json({ error: "bad origin" }, 403);
            const login = c.req.query("login") ?? "";
            const host = allowedHost(
                db,
                c.req.query("host") ?? "",
                login,
                c.var.user.groups,
            );
            if (!host) return c.json({ error: "forbidden" }, 403);
            if (!signLimit(c.var.user.sub))
                return c.json({ error: "too many sessions, slow down" }, 429);
            c.set("host", host);
            c.set("login", login);
            return next();
        },
        upgradeWebSocket((c) => {
            const { user, host, login } = c.var;
            let term: Awaited<ReturnType<typeof openTerminal>> | undefined;
            let closed = false;
            // Input that arrives while the cert is being signed.
            const pending: ClientMessage[] = [];
            const handle = (msg: ClientMessage) => {
                if (!term) {
                    if (pending.length < 256) pending.push(msg);
                } else if (msg.t === "in") term.write(msg.d);
                else term.resize(msg.cols, msg.rows);
            };
            return {
                onOpen(_evt, ws) {
                    openTerminal(terminal, user, host, login, c.var.ip, {
                        cols: termSize(c.req.query("cols"), 80),
                        rows: termSize(c.req.query("rows"), 24),
                        onData: (data) =>
                            ws.send(data as Uint8Array<ArrayBuffer>),
                        onExit: (reason) => ws.close(1000, reason),
                    }).then(
                        (t) => {
                            term = t;
                            if (closed) t.close();
                            for (const msg of pending.splice(0)) handle(msg);
                        },
                        (err) => {
                            console.warn(`terminal failed: ${err}`);
                            ws.close(1011, "failed to start session");
                        },
                    );
                },
                onMessage(evt) {
                    const msg = parseMessage(evt.data);
                    if (msg) handle(msg);
                },
                onClose() {
                    closed = true;
                    term?.close();
                },
            };
        }),
    );

    app.get(
        "/assets/*",
        serveStatic({
            root: WEB_DIST,
            // Vite puts a content hash in every asset name.
            onFound: (_path, c) => {
                c.header(
                    "Cache-Control",
                    "public, max-age=31536000, immutable",
                );
            },
        }),
    );
    // Client-side routes (apps/web/src/App.tsx) all get the SPA shell.
    for (const path of ["/", "/admin/*", "/ssh/*"])
        app.get(path, async (c) => {
            c.header("Cache-Control", "no-cache");
            return c.html(await Bun.file(`${WEB_DIST}/index.html`).text());
        });

    return app;
}
