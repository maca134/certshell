import { afterEach, expect, test } from "bun:test";
import type { Me } from "@repo/shared";
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
