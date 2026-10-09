import { afterEach, expect, test } from "bun:test";
import type { Me } from "@repo/shared";
import { loadConfig } from "../src/config";
import { isNewer, updateChecker } from "../src/lib/version";
import { APP_URL, startApp } from "./helpers/app";

let ctx: Awaited<ReturnType<typeof startApp>>;
afterEach(() => ctx.stop());

const me = async () =>
    (await (
        await ctx.app.request(`${APP_URL}/api/me`, {
            headers: { cookie: ctx.cookie },
        })
    ).json()) as Me;

test("/api/me reports the build version, dev when unset", async () => {
    ctx = await startApp({}, ["users"], { CERTSHELL_VERSION: "1.2.3" });
    expect((await me()).version).toBe("1.2.3");
    await ctx.stop();
    ctx = await startApp({}, ["users"]);
    expect((await me()).version).toBe("dev");
});

test("update: newer GitHub version goes to admins only", async () => {
    ctx = await startApp({}, ["certshell-admins"], {}, () => "1.2.0");
    expect((await me()).update).toBe("1.2.0");
    await ctx.stop();
    ctx = await startApp({}, ["users"], {}, () => "1.2.0");
    expect((await me()).update).toBeUndefined();
});

test("isNewer compares semver numerically, ignores non-releases", () => {
    expect(isNewer("v1.10.0", "1.9.9")).toBeTrue();
    expect(isNewer("1.1.1", "1.1.1")).toBeFalse();
    expect(isNewer("v1.0.9", "1.1.0")).toBeFalse();
    expect(isNewer("v2.0.0-rc1", "1.0.0")).toBeFalse();
    expect(isNewer("v2.0.0", "dev")).toBeFalse();
});

test("updateChecker: newest tag above current; failures keep the last answer", async () => {
    let reply: () => Response = () =>
        Response.json([
            { name: "v1.0.0" },
            { name: "v1.10.0" },
            { name: "v1.2.0" },
            { name: "v9.0.0-beta" },
            { name: "<b>x</b>" },
        ]);
    const updates = updateChecker("1.1.1", async () => reply());
    expect(updates.latest()).toBeUndefined();
    await updates.check();
    expect(updates.latest()).toBe("1.10.0");

    reply = () => new Response("rate limited", { status: 403 });
    await updates.check();
    reply = () => Response.json({ message: "not a list" });
    await updates.check();
    reply = () => {
        throw new Error("offline");
    };
    await updates.check();
    expect(updates.latest()).toBe("1.10.0");

    const upToDate = updateChecker("1.10.0", async () =>
        Response.json([{ name: "v1.10.0" }]),
    );
    await upToDate.check();
    expect(upToDate.latest()).toBeUndefined();
});

test("UPDATE_CHECK=false turns the check off", () => {
    const base = {
        APP_URL,
        OIDC_ISSUER: "https://id.test",
        OIDC_CLIENT_ID: "x",
        OIDC_CLIENT_SECRET: "y",
    };
    expect(loadConfig(base).updateCheck).toBeTrue();
    expect(
        loadConfig({ ...base, UPDATE_CHECK: "false" }).updateCheck,
    ).toBeFalse();
});
