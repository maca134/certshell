import type { Database } from "bun:sqlite";
import type { AccessRule, AdminHost, AuditEntry, SeenUser } from "@repo/shared";
import { Hono } from "hono";
import { audit } from "./audit";
import type { Config } from "./config";
import { issueSnippet } from "./enroll";
import { jsonBody, writeGuards } from "./http";
import type { AppEnv } from "./sessions";
import { validAddress, validGroup, validLogin, validName } from "./validate";

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

const newHostId = () =>
    `h${[...crypto.getRandomValues(new Uint8Array(7))].map((b) => ID_ALPHABET[b % 36]).join("")}`;

export function adminRoutes({ config, db }: { config: Config; db: Database }) {
    const app = new Hono<AppEnv>();
    app.use(...writeGuards(config));

    const hostExists = (id: string) =>
        !!db.query("SELECT 1 FROM hosts WHERE id = ?").get(id);

    app.get("/hosts", (c) => {
        const hosts = db
            .query<
                {
                    id: string;
                    name: string;
                    address: string;
                    enrolled: number;
                    access: string;
                },
                []
            >(
                `SELECT id, name, address, host_key IS NOT NULL AS enrolled,
                   (SELECT json_group_array(json_object('login', login, 'group', grp) ORDER BY login, grp)
                    FROM access WHERE host_id = h.id) AS access
                 FROM hosts h ORDER BY name`,
            )
            .all();
        return c.json<AdminHost[]>(
            hosts.map((h) => ({
                ...h,
                enrolled: !!h.enrolled,
                access: JSON.parse(h.access),
            })),
        );
    });

    app.post("/hosts", async (c) => {
        const input = await jsonBody(c);
        if (!validName(input?.name))
            return c.json({ error: "invalid name" }, 400);
        if (!validAddress(input?.address))
            return c.json({ error: "invalid address" }, 400);
        const id = newHostId();
        db.run("INSERT INTO hosts (id, name, address) VALUES (?, ?, ?)", [
            id,
            input.name,
            input.address,
        ]);
        audit(db, {
            event: "host_create",
            sub: c.var.user.sub,
            email: c.var.user.email,
            host: id,
            name: input.name,
            address: input.address,
        });
        return c.json({ id, ...issueSnippet(db, config, id) }, 201);
    });

    app.patch("/hosts/:id", async (c) => {
        const id = c.req.param("id");
        if (!hostExists(id)) return c.json({ error: "not found" }, 404);
        const input = await jsonBody(c);
        if (input?.name !== undefined && !validName(input.name))
            return c.json({ error: "invalid name" }, 400);
        if (input?.address !== undefined && !validAddress(input.address))
            return c.json({ error: "invalid address" }, 400);
        db.run(
            "UPDATE hosts SET name = coalesce(?, name), address = coalesce(?, address) WHERE id = ?",
            [
                (input?.name as string | undefined) ?? null,
                (input?.address as string | undefined) ?? null,
                id,
            ],
        );
        audit(db, {
            event: "host_update",
            sub: c.var.user.sub,
            email: c.var.user.email,
            host: id,
            name: input?.name,
            address: input?.address,
        });
        return c.body(null, 204);
    });

    app.delete("/hosts/:id", (c) => {
        const id = c.req.param("id");
        if (!hostExists(id)) return c.json({ error: "not found" }, 404);
        db.transaction(() => {
            db.run("DELETE FROM access WHERE host_id = ?", [id]);
            db.run("DELETE FROM enroll_tokens WHERE host_id = ?", [id]);
            db.run("DELETE FROM hosts WHERE id = ?", [id]);
        })();
        audit(db, {
            event: "host_delete",
            sub: c.var.user.sub,
            email: c.var.user.email,
            host: id,
        });
        return c.body(null, 204);
    });

    app.post("/hosts/:id/snippet", async (c) => {
        const id = c.req.param("id");
        if (!hostExists(id)) return c.json({ error: "not found" }, 404);
        audit(db, {
            event: "enroll_snippet",
            sub: c.var.user.sub,
            email: c.var.user.email,
            host: id,
        });
        return c.json(issueSnippet(db, config, id));
    });

    app.put("/hosts/:id/access", async (c) => {
        const id = c.req.param("id");
        if (!hostExists(id)) return c.json({ error: "not found" }, 404);
        const rules = await jsonBody(c);
        if (!Array.isArray(rules) || rules.length > 500)
            return c.json({ error: "expected a list of rules" }, 400);
        for (const r of rules as Partial<AccessRule>[])
            if (!validLogin(r?.login) || !validGroup(r?.group))
                return c.json(
                    { error: `invalid rule: ${JSON.stringify(r)}` },
                    400,
                );
        db.transaction(() => {
            db.run("DELETE FROM access WHERE host_id = ?", [id]);
            for (const r of rules as AccessRule[])
                db.run(
                    "INSERT OR IGNORE INTO access (host_id, login, grp) VALUES (?, ?, ?)",
                    [id, r.login, r.group],
                );
        })();
        audit(db, {
            event: "access_update",
            sub: c.var.user.sub,
            email: c.var.user.email,
            host: id,
            rules,
        });
        return c.body(null, 204);
    });

    app.get("/users", (c) =>
        c.json<SeenUser[]>(
            db
                .query<
                    {
                        iss: string;
                        sub: string;
                        email: string | null;
                        groups: string;
                        last_login: number;
                    },
                    []
                >(
                    "SELECT iss, sub, email, groups, last_login FROM users ORDER BY last_login DESC",
                )
                .all()
                .map((u) => ({
                    iss: u.iss,
                    sub: u.sub,
                    email: u.email,
                    groups: JSON.parse(u.groups),
                    lastLogin: u.last_login,
                })),
        ),
    );

    app.get("/audit", (c) => {
        const limit = Math.min(
            Math.max(Number(c.req.query("limit")) || 200, 1),
            1000,
        );
        const rows = db
            .query<{ id: number; data: string }, [number]>(
                "SELECT id, data FROM audit ORDER BY id DESC LIMIT ?",
            )
            .all(limit);
        return c.json<AuditEntry[]>(
            rows.map((r) => ({ ...JSON.parse(r.data), id: r.id })),
        );
    });

    return app;
}
