import type { Database } from "bun:sqlite";
import { type EnrollSnippet, RELOAD_SSHD, sq } from "@repo/shared";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Config } from "../config";
import { audit } from "../lib/audit";
import { type AppEnv, hashToken, now, randomToken } from "../lib/sessions";
import { parseHostKey } from "../lib/validate";

const ENROLL_TOKEN_TTL_SECONDS = 600;

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

export function issueSnippet(
    db: Database,
    config: Config,
    hostId: string,
): EnrollSnippet {
    const token = randomToken();
    const expiresAt = now() + ENROLL_TOKEN_TTL_SECONDS;
    db.run("DELETE FROM enroll_tokens WHERE expires_at <= ? OR host_id = ?", [
        now(),
        hostId,
    ]);
    db.run(
        "INSERT INTO enroll_tokens (token_hash, host_id, expires_at) VALUES (?, ?, ?)",
        [hashToken(token), hostId, expiresAt],
    );
    return {
        snippet: `echo ${sq(`Authorization: Bearer ${token}`)} | curl -fsS -H @- ${sq(`${config.appUrl.origin}/api/enroll`)} | sh`,
        expiresAt,
    };
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
