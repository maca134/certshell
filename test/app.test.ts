import { expect, test } from "bun:test";
import { app } from "../src/app";

test("/healthz returns 200 with no body", async () => {
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
});
