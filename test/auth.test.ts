import { afterAll, beforeEach, expect, test } from "bun:test";
import * as oidc from "openid-client";
import { createApp, LOGIN_COOKIE, SESSION_COOKIE } from "../src/app";
import { loadConfig } from "../src/config";
import { openDb } from "../src/db";
import { lazyDiscovery } from "../src/oidc";
import { startMockIdp } from "./helpers/mock-idp";

const idp = await startMockIdp("cid", "csecret");
afterAll(() => idp.server.stop(true));

const config = loadConfig({
    APP_URL: "https://ssh.test",
    OIDC_ISSUER: idp.server.url.href,
    OIDC_CLIENT_ID: "cid",
    OIDC_CLIENT_SECRET: "csecret",
});
const insecure = { execute: [oidc.allowInsecureRequests] };

let db: ReturnType<typeof openDb>;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
    db = openDb(":memory:");
    app = createApp({
        config,
        db,
        getOidc: lazyDiscovery(config, insecure),
        terminal: { db, caKey: "", caPassword: undefined, idleMs: 0, maxMs: 0 },
    });
    app.get("/api/admin/ping", (c) => c.text("pong"));
    idp.nextClaims = {
        sub: "user-1",
        email: "a@b.c",
        groups: ["web-ssh-admins"],
    };
});

const get = (path: string, cookie = "") =>
    app.request(`https://ssh.test${path}`, { headers: { cookie } });

const cookieValue = (res: Response, name: string) =>
    res.headers
        .getSetCookie()
        .find((c) => c.startsWith(`${name}=`))
        ?.split(";")[0];

async function login() {
    const res = await get("/auth/login");
    expect(res.status).toBe(302);
    const authUrl = new URL(res.headers.get("location") ?? "");
    idp.challenge = authUrl.searchParams.get("code_challenge") ?? "";
    const state = authUrl.searchParams.get("state");
    return {
        authUrl,
        res,
        loginCookie: cookieValue(res, LOGIN_COOKIE) ?? "",
        callback: (query = `code=c1&state=${state}`, cookie?: string) =>
            get(`/auth/callback?${query}`, cookie),
    };
}

async function loggedIn() {
    const flow = await login();
    const res = await flow.callback(undefined, flow.loginCookie);
    expect(res.status).toBe(302);
    return cookieValue(res, SESSION_COOKIE) ?? "";
}

test("public routes need no session", async () => {
    expect((await get("/healthz")).status).toBe(200);
    expect((await get("/auth/login")).status).toBe(302);
});

test("no session → 401 on /api, redirect to login elsewhere", async () => {
    expect((await get("/api/me")).status).toBe(401);
    expect((await get("/api/admin/ping")).status).toBe(401);
    const res = await get("/");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/auth/login");
});

test("login redirect: PKCE S256, state, groups scope, APP_URL callback", async () => {
    const { authUrl, res } = await login();
    expect(authUrl.origin + authUrl.pathname).toBe(
        `${idp.server.url.origin}/authorize`,
    );
    expect(Object.fromEntries(authUrl.searchParams)).toMatchObject({
        client_id: "cid",
        redirect_uri: "https://ssh.test/auth/callback",
        scope: "openid email profile groups",
        code_challenge_method: "S256",
    });
    expect(authUrl.searchParams.get("state")).toBeTruthy();
    const cookie = res.headers.getSetCookie()[0] ?? "";
    expect(cookie).toStartWith(`${LOGIN_COOKIE}=`);
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
});

test("callback creates a 1h session from iss+sub+groups", async () => {
    const flow = await login();
    const res = await flow.callback(undefined, flow.loginCookie);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
    expect(idp.lastRedirectUri).toBe("https://ssh.test/auth/callback");

    const set = res.headers.getSetCookie();
    const session = set.find((c) => c.startsWith(`${SESSION_COOKIE}=`)) ?? "";
    expect(session).toContain("Max-Age=3600");
    expect(session).toContain("Secure");
    expect(session).toContain("HttpOnly");
    expect(session).toContain("SameSite=Lax");
    expect(set.some((c) => c.startsWith(`${LOGIN_COOKIE}=;`))).toBeTrue();

    const me = await get("/api/me", cookieValue(res, SESSION_COOKIE));
    expect(await me.json()).toEqual({
        iss: idp.server.url.origin,
        sub: "user-1",
        email: "a@b.c",
        groups: ["web-ssh-admins"],
        admin: true,
    });
});

test("callback rejects wrong state, missing login cookie, bad code", async () => {
    const flow = await login();
    expect(
        (await flow.callback("code=c1&state=evil", flow.loginCookie)).status,
    ).toBe(400);
    expect((await flow.callback(undefined, "")).status).toBe(400);
    idp.challenge = "mismatch";
    expect((await flow.callback(undefined, flow.loginCookie)).status).toBe(400);
    expect(db.query("SELECT count(*) AS n FROM sessions").get()).toEqual({
        n: 0,
    });
});

test("admin gate: admin group → 200, other groups → 403", async () => {
    expect((await get("/api/admin/ping", await loggedIn())).status).toBe(200);
    idp.nextClaims.groups = ["users", "Web-SSH-Admins"];
    expect((await get("/api/admin/ping", await loggedIn())).status).toBe(403);
    idp.nextClaims.groups = "web-ssh-admins";
    expect((await get("/api/admin/ping", await loggedIn())).status).toBe(403);
});

test("expired or unknown session → 401", async () => {
    const cookie = await loggedIn();
    expect((await get("/api/me", cookie)).status).toBe(200);
    expect((await get("/api/me", `${SESSION_COOKIE}=nope`)).status).toBe(401);
    db.run("UPDATE sessions SET expires_at = 0");
    expect((await get("/api/me", cookie)).status).toBe(401);
});

test("session token is stored hashed", async () => {
    const token = (await loggedIn()).split("=")[1] ?? "";
    const row = db
        .query<{ id_hash: string }, []>("SELECT id_hash FROM sessions")
        .get();
    expect(row?.id_hash).not.toBe(token);
    expect(row?.id_hash).toHaveLength(64);
});

test("IdP down → 503, then retries discovery", async () => {
    let calls = 0;
    const real = lazyDiscovery(config, insecure);
    const flaky = () =>
        ++calls === 1 ? Promise.reject(new Error("down")) : real();
    app = createApp({
        config,
        db,
        getOidc: flaky,
        terminal: { db, caKey: "", caPassword: undefined, idleMs: 0, maxMs: 0 },
    });
    expect((await get("/auth/login")).status).toBe(503);
    expect((await get("/auth/login")).status).toBe(302);
});

test("lazyDiscovery retries after a failure", async () => {
    const down = loadConfig({
        ...process.env,
        APP_URL: "https://ssh.test",
        OIDC_ISSUER: "http://127.0.0.1:1",
        OIDC_CLIENT_ID: "x",
        OIDC_CLIENT_SECRET: "y",
    });
    const getOidc = lazyDiscovery(down, insecure);
    const first = getOidc();
    await expect(first).rejects.toThrow();
    const second = getOidc();
    expect(second).not.toBe(first);
    await expect(second).rejects.toThrow();
});

test("loadConfig requires the OIDC vars", () => {
    expect(() => loadConfig({ APP_URL: "https://x" })).toThrow(
        "OIDC_ISSUER is required",
    );
});
