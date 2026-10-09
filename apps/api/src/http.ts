import type { MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Config } from "./config";

/** For JSON APIs that change state: same-origin writes, 64 KB bodies. */
export const writeGuards = (config: Config): MiddlewareHandler[] => [
    // Session cookies are SameSite=Lax, which still allows same-site (sibling subdomain) requests.
    async (c, next) => {
        if (
            c.req.method !== "GET" &&
            c.req.header("origin") !== config.appUrl.origin
        )
            return c.json({ error: "bad origin" }, 403);
        return next();
    },
    bodyLimit({
        maxSize: 64 * 1024,
        onError: (c) => c.json({ error: "too large" }, 413),
    }),
];

export const jsonBody = async (c: { req: { json: () => Promise<unknown> } }) =>
    (await c.req.json().catch(() => undefined)) as
        | Record<string, unknown>
        | undefined;
