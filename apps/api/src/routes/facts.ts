import type { Database } from "bun:sqlite";
import type { HostFactsRow } from "@repo/shared";
import { Hono } from "hono";
import type { Config } from "../config";
import { writeGuards } from "../lib/http";
import type { AppEnv } from "../lib/sessions";
import type { FactsCollector } from "../ssh/facts";

export function factsRoutes({
    config,
    db,
    facts,
}: {
    config: Config;
    db: Database;
    facts: FactsCollector;
}) {
    const app = new Hono<AppEnv>();
    app.use(...writeGuards(config));

    app.get("/", (c) =>
        c.json<HostFactsRow[]>(
            db
                .query<
                    {
                        id: string;
                        name: string;
                        tags: string;
                        facts_login: string | null;
                        collected_at: number | null;
                        facts: string | null;
                        error: string | null;
                    },
                    []
                >(
                    `SELECT h.id, h.name, h.tags, h.facts_login, f.collected_at, f.facts, f.error
                     FROM hosts h LEFT JOIN host_facts f ON f.host_id = h.id AND f.login = h.facts_login
                     WHERE h.host_key IS NOT NULL ORDER BY h.name`,
                )
                .all()
                .map((r) => ({
                    hostId: r.id,
                    hostName: r.name,
                    tags: JSON.parse(r.tags),
                    login: r.facts_login,
                    collectedAt: r.collected_at,
                    facts: r.facts && JSON.parse(r.facts),
                    error: r.error,
                    collecting: facts.isCollecting(r.id),
                })),
        ),
    );

    /** Starts collecting; the list shows `collecting` until it's done. */
    app.post("/refresh", (c) => {
        const ids = db
            .query<{ id: string }, []>(
                "SELECT id FROM hosts WHERE facts_login IS NOT NULL AND host_key IS NOT NULL",
            )
            .all()
            .map((r) => r.id);
        void facts.collectAll(ids);
        return c.body(null, 202);
    });

    app.post("/:hostId/refresh", async (c) => {
        if (!(await facts.collect(c.req.param("hostId"))))
            return c.json({ error: "no facts login set for this host" }, 404);
        return c.body(null, 204);
    });

    return app;
}
