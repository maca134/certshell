import { afterEach, expect, test } from "bun:test";
import type { AuditEntry, SeenUser } from "@repo/shared";
import { clientIp, rateLimiter } from "../src/ratelimit";
import { APP_URL, startApp } from "./helpers/app";

let ctx: Awaited<ReturnType<typeof startApp>> | undefined;
afterEach(async () => {
    await ctx?.stop();
    ctx = undefined;
});

test("clientIp: XFF only trusted from trusted proxies, right to left", () => {
    const trusted = new Set(["172.30.0.2", "100.64.0.2"]);
    expect(clientIp("203.0.113.5", "1.1.1.1", trusted)).toBe("203.0.113.5");
    expect(clientIp("172.30.0.2", undefined, trusted)).toBe("172.30.0.2");
    expect(clientIp("172.30.0.2", "198.51.100.7, 100.64.0.2", trusted)).toBe(
        "198.51.100.7",
    );
    expect(
        clientIp("172.30.0.2", "6.6.6.6, 198.51.100.7, 100.64.0.2", trusted),
    ).toBe("198.51.100.7");
    expect(clientIp("172.30.0.2", "100.64.0.2", trusted)).toBe("172.30.0.2");
    expect(clientIp(undefined, "1.1.1.1", trusted)).toBe("unknown");
    expect(clientIp("::ffff:172.30.0.2", "198.51.100.7", trusted)).toBe(
        "198.51.100.7",
    );
    expect(clientIp("::ffff:203.0.113.5", undefined, trusted)).toBe(
        "203.0.113.5",
    );
});

test("rateLimiter: limit per key per window", async () => {
    const allow = rateLimiter(2, 100);
    expect([allow("a"), allow("a"), allow("a"), allow("b")]).toEqual([
        true,
        true,
        false,
        true,
    ]);
    await Bun.sleep(120);
    expect(allow("a")).toBeTrue();
});

test("rateLimiter: past maxKeys, the oldest key is evicted", () => {
    const allow = rateLimiter(1, 60_000, 2);
    expect([allow("a"), allow("b"), allow("c")]).toEqual([true, true, true]);
    expect([allow("b"), allow("c"), allow("a")]).toEqual([false, false, true]);
});

test("security headers on every response", async () => {
    ctx = await startApp();
    for (const res of [
        await ctx.app.request(`${APP_URL}/healthz`),
        await ctx.app.request(`${APP_URL}/api/me`),
        await ctx.app.request(`${APP_URL}/`),
    ]) {
        expect(res.headers.get("content-security-policy")).toBe(
            "default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
        );
        expect(res.headers.get("strict-transport-security")).toBe(
            "max-age=31536000",
        );
        expect(res.headers.get("referrer-policy")).toBe("no-referrer");
        expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    }
});

test("per-IP limits on public routes, keyed by the real client IP", async () => {
    ctx = await startApp({}, ["admins"], { TRUSTED_PROXIES: "::1" });
    const hit = (path: string, ip: string) =>
        fetch(new URL(path, ctx?.server.url), {
            headers: { "x-forwarded-for": ip },
            redirect: "manual",
        });

    for (let i = 0; i < 60; i++)
        expect((await hit("/healthz", "198.51.100.1")).status).toBe(200);
    const limited = await hit("/healthz", "198.51.100.1");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await hit("/healthz", "198.51.100.2")).status).toBe(200);

    for (let i = 0; i < 10; i++)
        expect((await hit("/api/enroll", "198.51.100.3")).status).toBe(401);
    expect((await hit("/api/enroll", "198.51.100.3")).status).toBe(429);
});

test("per-user limit on terminal sessions", async () => {
    ctx = await startApp({ command: () => ["true"] });
    ctx.addHost("h1", "h1.test", "ssh-ed25519 AAAA", { root: "admins" });
    for (let i = 0; i < 10; i++) await ctx.connect("host=h1&login=root").closed;
    const signs = ctx.db
        .query<{ n: number }, []>("SELECT count(*) AS n FROM signs")
        .get();
    expect(signs?.n).toBe(10);
    const res = await ctx.app.request(
        `${APP_URL}/api/terminal?host=h1&login=root`,
        {
            headers: { cookie: ctx.cookie, origin: APP_URL },
        },
    );
    expect(res.status).toBe(429);
}, 30_000);

test("admin: seen users and audit log", async () => {
    ctx = await startApp({}, ["certshell-admins"]);
    ctx.db.run(
        "INSERT INTO users (iss, sub, email, groups, last_login) VALUES (?, ?, ?, ?, ?)",
        ["https://id.test", "u2", "b@c.d", '["ops","certshell-admins"]', 1000],
    );
    const get = (path: string) =>
        ctx?.app.request(`${APP_URL}${path}`, {
            headers: { cookie: ctx.cookie },
        }) ?? Promise.reject();

    expect(
        (await (await get("/api/admin/users")).json()) as SeenUser[],
    ).toEqual([
        {
            iss: "https://id.test",
            sub: "u2",
            email: "b@c.d",
            groups: ["ops", "certshell-admins"],
            lastLogin: 1000,
        },
    ]);

    await ctx.app.request(`${APP_URL}/api/admin/hosts`, {
        method: "POST",
        headers: {
            cookie: ctx.cookie,
            origin: APP_URL,
            "content-type": "application/json",
        },
        body: JSON.stringify({ name: "web1", address: "web1.lan" }),
    });
    const audit = (await (
        await get("/api/admin/audit?limit=5")
    ).json()) as AuditEntry[];
    expect(audit[0]).toMatchObject({
        event: "host_create",
        sub: "user-1",
        email: "a@b.c",
        name: "web1",
    });
    expect(audit[0]?.ts).toMatch(/^\d{4}-\d\d-\d\dT/);
});
