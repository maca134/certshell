<img src="apps/web/public/favicon.svg" alt="" width="96">

# CertShell

A browser SSH terminal for your servers. You log in with your identity provider (OIDC), and the app signs a short-lived SSH certificate for each session. No SSH keys to hand out, rotate or revoke.

**Website & setup generator: [certshell.dev](https://certshell.dev)**

> **Pre-release.** No image published yet. Build your own with `docker build -t ghcr.io/maca134/certshell:1 .`

## How it works

- You log in through OIDC (e.g. [Pocket ID](https://pocket-id.org)). Your IdP groups decide what you can reach.
- The app is an SSH certificate authority. For every terminal it mints a fresh key and a **15‑minute cert** valid for **one host, one login**, with no forwarding.
- Hosts trust the CA through a one-line enroll script. Existing `authorized_keys` keep working, so enrolling can't lock you out.
- Admins map **IdP group → host → login** in the web UI. No edits on the host after enrollment.
- Every login, cert and session goes to an audit log (in the app and on stdout). The host's sshd logs each cert's ID and serial too.
- **Tasks**: run one command (e.g. `apt-get upgrade -y`) on many hosts at once, with each host's exit code and output. Or open up to 8 terminals and type into all of them.

Scope: browser terminal and tasks. No native `ssh`/`scp`/`sftp` and no port forwarding.

## Quick start (Pocket ID)

You need a server with Docker, ports 80/443 open, and two DNS names pointing at it (e.g. `ssh.example.com`, `id.example.com`). Pick a reverse proxy; both get HTTPS certificates automatically:

- [`examples/caddy`](examples/caddy): Caddy.
- [`examples/traefik`](examples/traefik): Traefik with Let's Encrypt. Routes live in `routes.yml`, so Traefik needs no `docker.sock`.

```sh
cp -r examples/caddy certshell && cd certshell      # or examples/traefik
cp .env.example .env            # set SSH_DOMAIN, ID_DOMAIN, POCKET_ID_ENCRYPTION_KEY

# Optional but recommended: encrypts the CA key at rest. The container runs as uid 1000.
mkdir secrets && openssl rand -base64 32 > secrets/ca_password
chown 1000:1000 secrets/ca_password && chmod 600 secrets/ca_password

docker compose up -d caddy pocket-id           # or: traefik pocket-id
```

> No `ca_password`? Remove the `secrets:` lines from `compose.yaml`. The CA key is then stored unencrypted.

Then in Pocket ID (`https://id.example.com`):

1. Open `/setup` and create your admin account and passkey.
2. **User Groups** → create `certshell-admins` and add yourself.
3. **OIDC Clients** → add `certshell`:
   - Callback URL: `https://ssh.example.com/auth/callback`
   - Allowed user groups: whoever may use CertShell at all.
4. Copy the client ID and secret into `.env` (`OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`).

```sh
docker compose up -d
```

Open `https://ssh.example.com` and log in.

Already have a reverse proxy? Drop the `caddy`/`traefik` service, publish `certshell` on `127.0.0.1:3000`, and set `TRUSTED_PROXIES` to your proxy's address. Already have an IdP? Drop `pocket-id`. Any OIDC provider works if it sends a `groups` claim that users can't change themselves.

## Adding a host

1. **Admin → Hosts → Add host**: a name and the address the app should connect to.
2. **Enroll snippet** → copy it and run it as root on the host. It's valid for 10 minutes and one use.
3. Under the host, **Allow** an IdP group a login (e.g. `ops` → `root`).

Host requirements: Linux, OpenSSH ≥ 7, `curl`, an `sshd_config` that includes `sshd_config.d/*.conf`, and reachable on port 22 from the app. The host must reach `https://ssh.example.com` only while enrolling.

The script writes the CA public key, adds `/etc/ssh/sshd_config.d/50-certshell.conf`, checks sshd loads it, records the host key with the app, and reloads sshd. The app pins that host key, so a different machine at the same address is refused.

## Configuration

| Variable | Required | Default |
|---|---|---|
| `APP_URL` | yes | Public URL, e.g. `https://ssh.example.com` |
| `OIDC_ISSUER` | yes | |
| `OIDC_CLIENT_ID` | yes | |
| `OIDC_CLIENT_SECRET` | yes | |
| `OIDC_ADMIN_GROUP` | no | `certshell-admins` |
| `CA_NAME` | no | `certshell` (comment on the CA key) |
| `TRUSTED_PROXIES` | no | none: `X-Forwarded-For` ignored. Comma-separated IPs. |
| `UPDATE_CHECK` | no | on: checks GitHub tags every 12h and shows admins a newer version. `false` turns it off. |
| `/run/secrets/ca_password` | no | none: CA key stored unencrypted, warning logged |

- HTTPS is required (secure cookies; passkeys at the IdP).
- Sessions last 1 hour, then go back through the IdP. Group changes at the IdP apply to new terminals within the hour.
- Terminals close after 30 minutes idle, and always after 8 hours.

## Security

The app holds the CA key. **If the app is compromised, an attacker can get a shell on any enrolled host as any mapped login.** The design limits that:

- Each host accepts only its own principals: one cert = one host + one login, 15 minutes, no forwarding.
- Small unauthenticated surface, strict security headers, rate limits.
- Hardened container: non-root, read-only root filesystem, all capabilities dropped.
- Audit trail outside the app: stdout logs and each host's sshd logs.

Also trusted: your IdP. Whoever can edit IdP groups can grant whatever the access map gives those groups.

Recommendations:

- Keep a break-glass SSH key offline, not signed by this CA.
- Put it behind a VPN if you can. Internet exposure is supported, not encouraged.
- Never mount `docker.sock` into the `certshell` container.

Full threat model: [SPEC.md §3.3](SPEC.md#33-accepted-risk).

## Backup

- Volume `certshell-data`: the CA key and the app database (hosts, access map, audit log).
- `secrets/ca_password`, **stored separately**. Without it the CA key in the backup is useless; without a password the backup *is* your CA, so protect it.
- Pocket ID: volume `pocket-id-data` and `POCKET_ID_ENCRYPTION_KEY`.

## Development

Bun workspaces: `apps/api` (Hono), `apps/web` (React + xterm.js), `packages/shared`.

```sh
bun install
bun run test        # unit tests
bun run e2e         # Playwright
bun run lint
bun run typecheck
```

Design and decisions: [SPEC.md](SPEC.md).

## License

[MIT](LICENSE)
