import type { Database } from "bun:sqlite";
import type { Me } from "@repo/shared";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { getCookie } from "hono/cookie";
import type { Config } from "./config";
import { accessibleHosts, reachable } from "./lib/hosts";
import type { GetOidc } from "./lib/oidc";
import { clientIp, concurrencyLimit, rateLimiter } from "./lib/ratelimit";
import { type AppEnv, getSession } from "./lib/sessions";
import { adminRoutes } from "./routes/admin";
import { authRoutes, SESSION_COOKIE } from "./routes/auth";
import { enrollRoute } from "./routes/enroll";
import { taskRoutes } from "./routes/tasks";
import { terminalRoute } from "./routes/terminal";
import type { TerminalDeps } from "./ssh/terminal";

const WEB_DIST = `${import.meta.dir}/../../web/dist`;

const PUBLIC_ROUTES = new Set([
    "GET /healthz",
    "GET /auth/login",
    "GET /auth/callback",
    "GET /auth/logout",
    "POST /auth/logout",
    "GET /api/enroll",
    "POST /api/enroll",
]);

// xterm.js injects <style> elements, hence 'unsafe-inline' for styles only.
const SECURITY_HEADERS = {
    "Content-Security-Policy":
        "default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    "Strict-Transport-Security": "max-age=31536000",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
};

export type Deps = {
    config: Config;
    db: Database;
    getOidc: GetOidc;
    terminal: TerminalDeps;
    latestVersion?: () => string | undefined;
};

export function createApp({
    config,
    db,
    getOidc,
    terminal,
    latestVersion,
}: Deps) {
    const app = new Hono<AppEnv>();
    const publicLimit = rateLimiter(60, 60_000);
    const enrollLimit = rateLimiter(10, 60_000);
    const signLimit = rateLimiter(10, 60_000);
    const sshLimit = concurrencyLimit(
        terminal.maxSessions,
        terminal.maxSessionsTotal,
    );

    app.use("*", async (c, next) => {
        await next();
        for (const [k, v] of Object.entries(SECURITY_HEADERS))
            c.res.headers.set(k, v);
    });

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
        return next();
    });

    app.use("*", async (c, next) => {
        if (PUBLIC_ROUTES.has(`${c.req.method} ${c.req.path}`)) return next();
        const user = getSession(db, getCookie(c, SESSION_COOKIE));
        if (!user)
            return c.req.path.startsWith("/api/")
                ? c.json({ error: "unauthenticated" }, 401)
                : c.redirect("/auth/login");
        c.set("user", user);
        return next();
    });

    app.use("/api/admin/*", async (c, next) => {
        if (!c.var.user.groups.includes(config.adminGroup))
            return c.json({ error: "forbidden" }, 403);
        return next();
    });

    app.get("/healthz", (c) => c.body(null, 200));
    const caPubPath = `${terminal.caKey}.pub`;
    app.route("/", enrollRoute({ config, db, caPubPath }));
    app.route("/api/admin", adminRoutes({ config, db, terminal }));
    app.route("/", authRoutes({ config, db, getOidc }));
    app.route(
        "/api/tasks",
        taskRoutes({ config, db, terminal, signLimit, sshLimit }),
    );
    app.route(
        "/",
        terminalRoute({ config, db, terminal, signLimit, sshLimit }),
    );

    app.get("/api/me", (c) => {
        const { iss, sub, email, groups } = c.var.user;
        const admin = groups.includes(config.adminGroup);
        return c.json<Me>({
            iss,
            sub,
            email,
            groups,
            admin,
            version: config.version,
            update: admin ? latestVersion?.() : undefined,
        });
    });

    app.get("/api/hosts", (c) =>
        c.json(accessibleHosts(db, c.var.user.groups)),
    );

    // Cached so page loads can't make the app hammer hosts.
    const checks = new Map<string, { at: number; up: Promise<boolean> }>();
    app.get("/api/hosts/status", async (c) => {
        const ids = accessibleHosts(db, c.var.user.groups).map((h) => h.id);
        const hosts = db
            .query<{ id: string; address: string }, [string]>(
                "SELECT id, address FROM hosts WHERE id IN (SELECT value FROM json_each(?))",
            )
            .all(JSON.stringify(ids));
        const status = await Promise.all(
            hosts.map(async ({ id, address }) => {
                let check = checks.get(address);
                if (!check || check.at < Date.now() - 30_000) {
                    check = { at: Date.now(), up: reachable(address) };
                    checks.set(address, check);
                }
                return [id, await check.up] as const;
            }),
        );
        return c.json<Record<string, boolean>>(Object.fromEntries(status));
    });

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
    app.get("/favicon.svg", serveStatic({ root: WEB_DIST }));
    // Client-side routes (apps/web/src/App.tsx) all get the SPA shell.
    for (const path of ["/", "/admin/*", "/ssh/*", "/tasks/*"])
        app.get(path, async (c) => {
            c.header("Cache-Control", "no-cache");
            return c.html(await Bun.file(`${WEB_DIST}/index.html`).text());
        });

    return app;
}
