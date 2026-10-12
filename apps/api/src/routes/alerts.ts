import type { Database } from "bun:sqlite";
import { ALERT_EVENTS, type AlertChannel } from "@repo/shared";
import { Hono } from "hono";
import type { Config } from "../config";
import { type Alerter, channelOf } from "../lib/alerts";
import { audit } from "../lib/audit";
import { jsonBody, writeGuards } from "../lib/http";
import type { AppEnv } from "../lib/sessions";
import {
    validAlertUrl,
    validLogin,
    validName,
    validTags,
} from "../lib/validate";

const MAX_CHANNELS = 20;

export function alertRoutes({
    config,
    db,
    alerts,
}: {
    config: Config;
    db: Database;
    alerts: Alerter;
}) {
    const app = new Hono<AppEnv>();
    app.use(...writeGuards(config));

    const get = (id: number) =>
        db
            .query<Parameters<typeof channelOf>[0], [number]>(
                "SELECT * FROM alert_channels WHERE id = ?",
            )
            .get(id);

    /** The input's fields, or an error. `url` may be absent only on update. */
    function parse(
        input: Record<string, unknown> | undefined,
        create: boolean,
    ) {
        if (!validName(input?.name) || !input.name)
            return { error: "invalid name" };
        if ((create || input.url !== undefined) && !validAlertUrl(input.url))
            return {
                error: "invalid URL: expected a shoutrrr URL like ntfy://…",
            };
        const events = input.events;
        if (
            !Array.isArray(events) ||
            !events.length ||
            !events.every((e) => Object.hasOwn(ALERT_EVENTS, e))
        )
            return { error: "pick at least one event" };
        if (!validTags(input.tags)) return { error: "invalid tags" };
        if (
            !Array.isArray(input.logins) ||
            input.logins.length > 20 ||
            !input.logins.every(validLogin)
        )
            return { error: "invalid logins" };
        return {
            name: input.name,
            url: input.url as string | undefined,
            events: JSON.stringify([...new Set(events)].sort()),
            tags: JSON.stringify([...new Set(input.tags)].sort()),
            logins: JSON.stringify([...new Set(input.logins)].sort()),
        };
    }

    const service = (url: string) => url.slice(0, url.indexOf(":"));

    app.get("/", (c) =>
        c.json<AlertChannel[]>(
            db
                .query<Parameters<typeof channelOf>[0], []>(
                    "SELECT * FROM alert_channels ORDER BY name",
                )
                .all()
                .map(channelOf),
        ),
    );

    app.post("/", async (c) => {
        const p = parse(await jsonBody(c), true);
        if ("error" in p) return c.json({ error: p.error }, 400);
        const n = db
            .query<{ n: number }, []>(
                "SELECT count(*) AS n FROM alert_channels",
            )
            .get()?.n;
        if ((n ?? 0) >= MAX_CHANNELS)
            return c.json({ error: `at most ${MAX_CHANNELS} channels` }, 400);
        const url = p.url as string;
        const id = Number(
            db.run(
                "INSERT INTO alert_channels (name, url, service, events, tags, logins) VALUES (?, ?, ?, ?, ?, ?)",
                [
                    p.name,
                    await alerts.seal(url),
                    service(url),
                    p.events,
                    p.tags,
                    p.logins,
                ],
            ).lastInsertRowid,
        );
        audit(db, {
            event: "alert_create",
            sub: c.var.user.sub,
            email: c.var.user.email,
            alert: id,
            name: p.name,
            service: service(url),
            events: JSON.parse(p.events),
        });
        return c.json({ id }, 201);
    });

    app.put("/:id", async (c) => {
        const id = Number(c.req.param("id"));
        if (!get(id)) return c.json({ error: "not found" }, 404);
        const p = parse(await jsonBody(c), false);
        if ("error" in p) return c.json({ error: p.error }, 400);
        db.run(
            "UPDATE alert_channels SET name = ?, events = ?, tags = ?, logins = ? WHERE id = ?",
            [p.name, p.events, p.tags, p.logins, id],
        );
        if (p.url)
            db.run(
                "UPDATE alert_channels SET url = ?, service = ?, last_error = NULL WHERE id = ?",
                [await alerts.seal(p.url), service(p.url), id],
            );
        audit(db, {
            event: "alert_update",
            sub: c.var.user.sub,
            email: c.var.user.email,
            alert: id,
            name: p.name,
            url_changed: !!p.url,
            events: JSON.parse(p.events),
        });
        return c.body(null, 204);
    });

    app.delete("/:id", (c) => {
        const id = Number(c.req.param("id"));
        const row = get(id);
        if (!row) return c.json({ error: "not found" }, 404);
        db.run("DELETE FROM alert_channels WHERE id = ?", [id]);
        audit(db, {
            event: "alert_delete",
            sub: c.var.user.sub,
            email: c.var.user.email,
            alert: id,
            name: row.name,
        });
        return c.body(null, 204);
    });

    app.post("/:id/test", async (c) => {
        const sent = alerts.test(Number(c.req.param("id")));
        if (!sent) return c.json({ error: "not found" }, 404);
        const error = await sent;
        return error ? c.json({ error }, 502) : c.body(null, 204);
    });

    return app;
}
