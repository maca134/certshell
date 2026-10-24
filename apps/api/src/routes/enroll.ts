import type { Database } from "bun:sqlite";
import {
    type EnrollSnippet,
    psq,
    RELOAD_SSHD,
    SSH_DIR_SH,
    sq,
} from "@repo/shared";
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
${SSH_DIR_SH}
CONF=$SSH_DIR/sshd_config.d/50-certshell.conf
CA_FILE=$SSH_DIR/certshell_user_ca.pub
MAIN=$SSH_DIR/sshd_config

# A failed first enroll leaves nothing behind; a failed re-enroll keeps the working config.
[ -e "$CONF" ] || trap 'rm -f "$CONF" "$CA_FILE"' EXIT
mkdir -p "$SSH_DIR/sshd_config.d"
printf '%s\\n' "$CA_PUB" > "$CA_FILE"
cat > "$CONF" <<EOF
TrustedUserCAKeys $CA_FILE
AuthorizedPrincipalsCommand /bin/echo ws:$HOST_ID:%u
AuthorizedPrincipalsCommandUser nobody
EOF

loaded() { sshd -T | grep -qix "trustedusercakeys $CA_FILE"; }
sshd -t
if ! loaded; then
  cp -p "$MAIN" "$MAIN.certshell.bak"
  { printf 'Include %s/sshd_config.d/*.conf\\n' "$SSH_DIR"; cat "$MAIN.certshell.bak"; } > "$MAIN"
  if ! { sshd -t && loaded; }; then
    cat "$MAIN.certshell.bak" > "$MAIN"
    echo "could not load $CONF via an Include in $MAIN; $MAIN restored" >&2; exit 1
  fi
  echo "added Include $SSH_DIR/sshd_config.d/*.conf to $MAIN (backup: $MAIN.certshell.bak)"
fi

HOST_KEY=$(sshd -T | awk 'tolower($1) == "hostkey" { n = split($2, p, "/"); if (p[n] == "ssh_host_ed25519_key") print $2 }')
[ -f "$HOST_KEY.pub" ] || { echo "sshd has no ssh_host_ed25519_key HostKey" >&2; exit 1; }

printf 'Authorization: Bearer %s\\n' "$TOKEN" | curl -fsS -X POST "$APP_URL/api/enroll" \\
  -H @- \\
  --data-binary "@$HOST_KEY.pub"
trap - EXIT

${RELOAD_SSHD}
echo "enrolled: $(hostname)"
}
main "$@"
`;
}

/** The Windows counterpart of renderSnippet, for OpenSSH for Windows. Wrapped in `& { }` for the same reason. */
export function renderWindowsSnippet(opts: {
    appUrl: string;
    hostId: string;
    caPub: string;
    token: string;
}) {
    return String.raw`& {
$ErrorActionPreference = 'Stop'
$APP_URL = ${psq(opts.appUrl)}
$HOST_ID = ${psq(opts.hostId)}
$CA_PUB = ${psq(opts.caPub)}
$TOKEN = ${psq(opts.token)}
$dir = "$env:ProgramData\ssh"
$conf = "$dir\sshd_config.d\50-certshell.conf"
$caFile = "$dir\certshell_user_ca.pub"
$principals = "$dir\certshell_principals.ps1"
$main = "$dir\sshd_config"
$sshd = (Get-CimInstance Win32_Service -Filter "Name='sshd'").PathName.Trim('"')
$ps = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
function fwd($p) { $p -replace '\\', '/' }
function save($path, $lines) { [IO.File]::WriteAllText($path, (@($lines) + '') -join [char]10) }
function check { & $sshd -t; if ($LASTEXITCODE) { throw "sshd -t failed" } }
function loaded { [bool]((& $sshd -T) -match '^trustedusercakeys .*/certshell_user_ca\.pub$') }

# A failed first enroll leaves nothing behind; a failed re-enroll keeps the working config.
$first = -not (Test-Path $conf)
try {
  New-Item -ItemType Directory -Force "$dir\sshd_config.d" | Out-Null
  save $caFile $CA_PUB
  # -File passes %u as a plain string: never parsed as PowerShell. A login with a space would arrive as extra args.
  save $principals ('param([string]$u) if (-not $args.Count -and $u -cmatch ''^[a-z_][a-z0-9_-]{0,31}$'') { "ws:' + $HOST_ID + ':$u" }')
  save $conf @(
    "TrustedUserCAKeys $(fwd $caFile)",
    "AuthorizedPrincipalsCommand $(fwd $ps) -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $(fwd $principals) %u",
    'AuthorizedPrincipalsCommandUser SYSTEM'
  )
  # sshd checks only powershell.exe's ACL, not the script's, which runs as SYSTEM: don't trust what it inherits.
  foreach ($f in $caFile, $principals, $conf) {
    icacls $f /inheritance:r /grant:r '*S-1-5-18:F' '*S-1-5-32-544:F' '*S-1-5-11:RX' | Out-Null
    if ($LASTEXITCODE) { throw "icacls $f failed" }
  }
  check
  if (-not (loaded)) {
    Copy-Item -Force $main "$main.certshell.bak"
    # Relative: OpenSSH for Windows 9.5 loads nothing from an absolute Include glob.
    [IO.File]::WriteAllText($main, "Include sshd_config.d/*.conf" + [char]10 + [IO.File]::ReadAllText("$main.certshell.bak"))
    $ok = $false
    try { check; $ok = loaded } catch {}
    if (-not $ok) {
      Copy-Item -Force "$main.certshell.bak" $main
      throw "could not load $conf via an Include in $main; $main restored"
    }
    "added Include sshd_config.d/*.conf to $main (backup: $main.certshell.bak)"
  }
  $hostKey = "$dir\ssh_host_ed25519_key.pub"
  if (-not (Test-Path $hostKey)) { throw "sshd has no ssh_host_ed25519_key HostKey" }
  "Authorization: Bearer $TOKEN" | curl.exe -fsS -X POST "$APP_URL/api/enroll?os=windows" -H '@-' --data-binary "@$hostKey"
  if ($LASTEXITCODE) { throw "enroll request failed" }
} catch {
  if ($first) { Remove-Item -Force -ErrorAction SilentlyContinue $conf, $caFile, $principals }
  throw
}
Restart-Service sshd
"enrolled: $env:COMPUTERNAME"
}
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
        windows: `${psq(`Authorization: Bearer ${token}`)} | curl.exe -fsS -H '@-' ${psq(`${config.appUrl.origin}/api/enroll?os=windows`)} | Out-String | Invoke-Expression`,
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
        const render =
            c.req.query("os") === "windows"
                ? renderWindowsSnippet
                : renderSnippet;
        return c.text(
            render({
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
            const os = c.req.query("os") === "windows" ? "windows" : null;
            db.run("UPDATE hosts SET host_key = ?, os = ? WHERE id = ?", [
                hostKey,
                os,
                row.host_id,
            ]);
            audit(db, {
                event: "enroll",
                host: row.host_id,
                host_key: hostKey,
                os: os ?? undefined,
                ip: c.var.ip,
            });
            return c.body(null, 204);
        },
    );
    return app;
}
