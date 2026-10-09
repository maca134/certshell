import type { Database } from "bun:sqlite";
import {
    type AccessRule,
    type AdminHost,
    type AuditEntry,
    type EnrollSnippet,
    RELOAD_SSHD,
    type SeenUser,
} from "@repo/shared";
import { Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { audit } from "./audit";
import type { Config } from "./config";
import { type AppEnv, hashToken, now, randomToken } from "./sessions";
import {
    parseHostKey,
    validAddress,
    validGroup,
    validLogin,
    validName,
} from "./validate";

const ENROLL_TOKEN_TTL_SECONDS = 600;
const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

const newHostId = () =>
    `h${[...crypto.getRandomValues(new Uint8Array(7))].map((b) => ID_ALPHABET[b % 36]).join("")}`;

export const sq = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

export function renderSnippet(opts: {
    appUrl: string;
    hostId: string;
    caPub: string;
    token: string;
}) {
    // Wrapped in main() so a download cut short by `curl | sh` is a syntax error, not half a run.
    return `#!/bin/sh
main() {
set -eu
APP_URL=${sq(opts.appUrl)}
HOST_ID=${sq(opts.hostId)}
CA_PUB=${sq(opts.caPub)}
TOKEN=${sq(opts.token)}
CONF=/etc/ssh/sshd_config.d/50-certshell.conf

printf '%s\\n' "$CA_PUB" > /etc/ssh/certshell_user_ca.pub
cat > "$CONF" <<EOF
TrustedUserCAKeys /etc/ssh/certshell_user_ca.pub
AuthorizedPrincipalsCommand /bin/echo ws:$HOST_ID:%u
AuthorizedPrincipalsCommandUser nobody
EOF

sshd -t
sshd -T | grep -qx 'trustedusercakeys /etc/ssh/certshell_user_ca.pub' || {
  echo "sshd_config does not Include sshd_config.d/*.conf" >&2; rm "$CONF"; exit 1; }

printf 'Authorization: Bearer %s\\n' "$TOKEN" | curl -fsS -X POST "$APP_URL/api/enroll" \\
  -H @- \\
  --data-binary @/etc/ssh/ssh_host_ed25519_key.pub

${RELOAD_SSHD}
echo "enrolled: $(hostname)"
}
main "$@"
`;
}

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

export function adminRoutes({ config, db }: { config: Config; db: Database }) {
    const app = new Hono<AppEnv>();
    app.use(...writeGuards(config));

    const hostExists = (id: string) =>
        !!db.query("SELECT 1 FROM hosts WHERE id = ?").get(id);

    function issueSnippet(hostId: string): EnrollSnippet {
        const token = randomToken();
        const expiresAt = now() + ENROLL_TOKEN_TTL_SECONDS;
        db.run(
            "DELETE FROM enroll_tokens WHERE expires_at <= ? OR host_id = ?",
            [now(), hostId],
        );
        db.run(
            "INSERT INTO enroll_tokens (token_hash, host_id, expires_at) VALUES (?, ?, ?)",
            [hashToken(token), hostId, expiresAt],
        );
        return {
            snippet: `echo ${sq(`Authorization: Bearer ${token}`)} | curl -fsS -H @- ${sq(`${config.appUrl.origin}/api/enroll`)} | sh`,
            expiresAt,
        };
    }

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
        return c.json({ id, ...issueSnippet(id) }, 201);
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
        return c.json(issueSnippet(id));
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

export function enrollRoute({
    config,
    db,
    caPubPath,
}: {
    config: Config;
    db: Database;
    caPubPath: string;
}) {
    const app = new Hono<AppEnv>();
    const bearer = (c: {
        req: { header: (h: string) => string | undefined };
    }) => c.req.header("authorization")?.match(/^Bearer (\S+)$/)?.[1];

    app.get("/api/enroll", async (c) => {
        const token = bearer(c);
        const row =
            token &&
            db
                .query<{ host_id: string }, [string, number]>(
                    "SELECT host_id FROM enroll_tokens WHERE token_hash = ? AND expires_at > ?",
                )
                .get(hashToken(token), now());
        if (!token || !row) return c.text("invalid or expired token\n", 401);
        return c.text(
            renderSnippet({
                appUrl: config.appUrl.origin,
                hostId: row.host_id,
                caPub: (await Bun.file(caPubPath).text()).trim(),
                token,
            }),
        );
    });

    app.post(
        "/api/enroll",
        bodyLimit({
            maxSize: 4096,
            onError: (c) => c.text("too large\n", 413),
        }),
        async (c) => {
            const token = bearer(c);
            if (!token) return c.text("missing token\n", 401);
            const hostKey = parseHostKey(await c.req.text());
            if (!hostKey)
                return c.text("expected an ssh-ed25519 public key\n", 400);
            const row = db
                .query<{ host_id: string; expires_at: number }, [string]>(
                    "DELETE FROM enroll_tokens WHERE token_hash = ? RETURNING host_id, expires_at",
                )
                .get(hashToken(token));
            if (!row || row.expires_at <= now())
                return c.text("invalid or expired token\n", 401);
            db.run("UPDATE hosts SET host_key = ? WHERE id = ?", [
                hostKey,
                row.host_id,
            ]);
            audit(db, {
                event: "enroll",
                host: row.host_id,
                host_key: hostKey,
                ip: c.var.ip,
            });
            return c.body(null, 204);
        },
    );
    return app;
}
