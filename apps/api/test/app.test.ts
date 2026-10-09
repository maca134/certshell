import { expect, test } from "bun:test";
import { createApp } from "../src/app";
import { loadConfig } from "../src/config";
import { openDb } from "../src/db";

test("/healthz returns 200 with no body", async () => {
    const config = loadConfig({
        APP_URL: "https://ssh.test",
        OIDC_ISSUER: "https://id.test",
        OIDC_CLIENT_ID: "x",
        OIDC_CLIENT_SECRET: "y",
    });
    const getOidc = () => Promise.reject(new Error("unused"));
    const db = openDb(":memory:");
    const app = createApp({
        config,
        db,
        getOidc,
        terminal: {
            db,
            caKey: "",
            caPassword: undefined,
            idleMs: 0,
            maxMs: 0,
            taskMs: 0,
            maxSessions: 0,
            maxSessionsTotal: 0,
        },
    });
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
});
