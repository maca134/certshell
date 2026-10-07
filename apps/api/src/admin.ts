import type { Database } from "bun:sqlite";
import type { AccessRule, AdminHost, EnrollSnippet } from "@repo/shared";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Config } from "./config";
import { type AppEnv, hashToken, randomToken } from "./sessions";
import { log } from "./terminal";
import {
    parseHostKey,
    validAddress,
    validGroup,
    validLogin,
    validName,
} from "./validate";

const ENROLL_TOKEN_TTL_SECONDS = 600;
const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

const now = () => Math.floor(Date.now() / 1000);

const newHostId = () =>
    `h${[...crypto.getRandomValues(new Uint8Array(7))].map((b) => ID_ALPHABET[b % 36]).join("")}`;

const sq = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

export function renderSnippet(opts: {
    appUrl: string;
    hostId: string;
    caPub: string;
    token: string;
}) {
    return `#!/bin/sh
set -eu
APP_URL=${sq(opts.appUrl)}
HOST_ID=${sq(opts.hostId)}
CA_PUB=${sq(opts.caPub)}
TOKEN=${sq(opts.token)}
CONF=/etc/ssh/sshd_config.d/50-web-ssh.conf

printf '%s\\n' "$CA_PUB" > /etc/ssh/web_ssh_user_ca.pub
cat > "$CONF" <<EOF
TrustedUserCAKeys /etc/ssh/web_ssh_user_ca.pub
AuthorizedPrincipalsCommand /bin/echo ws:$HOST_ID:%u
AuthorizedPrincipalsCommandUser nobody
EOF

sshd -t
sshd -T | grep -qx 'trustedusercakeys /etc/ssh/web_ssh_user_ca.pub' || {
  echo "sshd_config does not Include sshd_config.d/*.conf" >&2; rm "$CONF"; exit 1; }

curl -fsS -X POST "$APP_URL/api/enroll" \\
  -H "Authorization: Bearer $TOKEN" \\
  --data-binary @/etc/ssh/ssh_host_ed25519_key.pub

if [ -d /run/systemd/system ]; then
  systemctl reload ssh 2>/dev/null || systemctl reload sshd
elif command -v rc-service >/dev/null 2>&1; then
  rc-service sshd reload
else
  kill -HUP "$(cat /run/sshd.pid)"
fi
echo "enrolled: $(hostname)"
`;
}

type Deps = { config: Config; db: Database; caPubPath: string };

export function adminRoutes({ config, db }: Omit<Deps, "caPubPath">) {
    const app = new Hono<AppEnv>();

    // Session cookies are SameSite=Lax, which still allows same-site (sibling subdomain) requests.
    app.use(async (c, next) => {
        if (
            c.req.method !== "GET" &&
            c.req.header("origin") !== config.appUrl.origin
        )
            return c.json({ error: "bad origin" }, 403);
        return next();
    });

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
            snippet: `curl -fsS -H ${sq(`Authorization: Bearer ${token}`)} ${sq(`${config.appUrl.origin}/api/enroll`)} | sh`,
            expiresAt,
        };
    }

    const body = async (c: { req: { json: () => Promise<unknown> } }) =>
        (await c.req.json().catch(() => undefined)) as
            | Record<string, unknown>
            | undefined;

    app.get("/hosts", (c) => {
        const hosts = db
            .query<
                { id: string; name: string; address: string; enrolled: number },
                []
            >(
                "SELECT id, name, address, host_key IS NOT NULL AS enrolled FROM hosts ORDER BY name",
            )
            .all();
        const access = db
            .query<{ host_id: string; login: string; grp: string }, []>(
                "SELECT host_id, login, grp FROM access ORDER BY login, grp",
            )
            .all();
        return c.json<AdminHost[]>(
            hosts.map((h) => ({
                ...h,
                enrolled: !!h.enrolled,
                access: access
                    .filter((a) => a.host_id === h.id)
                    .map((a) => ({ login: a.login, group: a.grp })),
            })),
        );
    });

    app.post("/hosts", async (c) => {
        const input = await body(c);
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
        log({
            event: "host_create",
            by: c.var.user.sub,
            host: id,
            name: input.name,
            address: input.address,
        });
        return c.json({ id, ...issueSnippet(id) }, 201);
    });

    app.patch("/hosts/:id", async (c) => {
        const id = c.req.param("id");
        if (!hostExists(id)) return c.json({ error: "not found" }, 404);
        const input = await body(c);
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
        log({
            event: "host_update",
            by: c.var.user.sub,
            host: id,
            name: input?.name,
            address: input?.address,
        });
        return c.body(null, 204);
    });

    app.post("/hosts/:id/snippet", async (c) => {
        const id = c.req.param("id");
        if (!hostExists(id)) return c.json({ error: "not found" }, 404);
        log({ event: "enroll_snippet", by: c.var.user.sub, host: id });
        return c.json(issueSnippet(id));
    });

    app.put("/hosts/:id/access", async (c) => {
        const id = c.req.param("id");
        if (!hostExists(id)) return c.json({ error: "not found" }, 404);
        const rules = await c.req.json().catch(() => undefined);
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
        log({ event: "access_update", by: c.var.user.sub, host: id, rules });
        return c.body(null, 204);
    });

    return app;
}

export function enrollRoute({ config, db, caPubPath }: Deps) {
    const app = new Hono();
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
            log({ event: "enroll", host: row.host_id, host_key: hostKey });
            return c.body(null, 204);
        },
    );
    return app;
}
