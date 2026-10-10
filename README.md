<img src="apps/web/public/favicon.svg" alt="" width="96">

# CertShell

[![CI](https://github.com/maca134/certshell/actions/workflows/ci.yml/badge.svg)](https://github.com/maca134/certshell/actions/workflows/ci.yml) [![CodeQL](https://github.com/maca134/certshell/actions/workflows/github-code-scanning/codeql/badge.svg)](https://github.com/maca134/certshell/security/code-scanning) [![Release](https://img.shields.io/github/v/tag/maca134/certshell?sort=semver&label=release)](https://github.com/maca134/certshell/pkgs/container/certshell) [![License](https://img.shields.io/github/license/maca134/certshell)](LICENSE) [![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/maca134/certshell/badge)](https://scorecard.dev/viewer/?uri=github.com/maca134/certshell) [![OpenSSF Best Practices](https://www.bestpractices.dev/projects/15358/badge)](https://www.bestpractices.dev/projects/15358)

A browser SSH terminal for your servers. You log in with your identity provider (OIDC), and the app signs a short-lived SSH certificate for each session. No SSH keys to hand out, rotate or revoke.

![CertShell demo: open a terminal, run a task on several hosts, manage host access](docs/media/demo.gif)

**Website & setup generator: [certshell.dev](https://certshell.dev)**

## How it works

- You log in through OIDC (e.g. [Pocket ID](https://pocket-id.org)). Your IdP groups decide what you can reach.
- The app is an SSH certificate authority. For every terminal it mints a fresh key and a **15‑minute cert** valid for **one host, one login**, with no forwarding.
- Hosts trust the CA through a one-line enroll script. Existing `authorized_keys` keep working, so enrolling can't lock you out.
- Admins map **IdP group → host → login** in the web UI. No edits on the host after enrollment.
- Every login, cert and session goes to an audit log (in the app and on stdout). The host's sshd logs each cert's ID and serial too.
- **Tasks**: save a script and the hosts it runs on (e.g. `apt-get upgrade -y` on every web server), run it in one click, and see each host's exit code and output.

Scope: browser terminal and tasks. No native `ssh`/`scp`/`sftp` and no port forwarding.

## Quick start (Pocket ID)

You need a server with Docker, ports 80/443 open, and two DNS names pointing at it (e.g. `ssh.example.com`, `id.example.com`). Pick a reverse proxy; both get HTTPS certificates automatically:

- [`examples/caddy`](examples/caddy): Caddy.
- [`examples/traefik`](examples/traefik): Traefik with Let's Encrypt. Routes live in `routes.yml`, so Traefik needs no `docker.sock`.

Or skip the clone: the [setup generator](https://certshell.dev/setup) writes these files for you, or installs them with one command.

```sh
git clone --depth 1 https://github.com/maca134/certshell.git certshell-src
cp -r certshell-src/examples/caddy certshell && cd certshell      # or examples/traefik
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

Open `https://ssh.example.com` and log in. More detail, plus adding users and recovery: [Pocket ID walkthrough](docs/pocket-id.md).

Already have a reverse proxy? Drop the `caddy`/`traefik` service, publish `certshell` on `127.0.0.1:3000`, and set `TRUSTED_PROXIES` to your proxy's address. Already have an IdP? Drop `pocket-id`. Any OIDC provider works if it sends a `groups` claim that users can't change themselves.

## Adding a host

1. **Admin → Hosts → Add host**: a name and the address the app should connect to.
2. **Enroll snippet** → copy it and run it as root on the host. It's valid for 10 minutes and one use.
3. Under the host, **Allow** an IdP group a login (e.g. `ops` → `root`).

Host requirements: Linux, OpenSSH ≥ 7, `curl`, an `sshd_config` that includes `sshd_config.d/*.conf`, and reachable on port 22 from the app. The host must reach `https://ssh.example.com` only while enrolling.

The script writes the CA public key, adds `/etc/ssh/sshd_config.d/50-certshell.conf`, checks sshd loads it, records the host key with the app, and reloads sshd. The app pins that host key, so a different machine at the same address is refused.

**Removing a host.** **Remove** on the host's panel. CertShell stops signing certs for it straight away. The host still trusts the CA until you run the command the dialog shows, as root on the host. It deletes `/etc/ssh/sshd_config.d/50-certshell.conf` and `/etc/ssh/certshell_user_ca.pub`, then reloads sshd. Open terminals to the host stay open until they close or you end them under **Admin → Sessions**.

## Using CertShell

### Terminals

- **Hosts** lists every host + login the access map gives you. A dot shows whether the host's port 22 is reachable from the app. Click a login to open a terminal.
- **Search the scrollback** with the search button or Ctrl+Shift+F. Enter finds the next match, Shift+Enter the previous one, Esc closes.
- **Multi-line pastes** ask before running, unless the shell has bracketed paste on (then nothing runs until you press Enter).
- **On touch devices** a key bar adds Esc, Tab, Ctrl, Alt, arrows, Home/End and PgUp/PgDn. Ctrl and Alt apply to the next key.
- Terminals close after 30 minutes idle, and always after 8 hours.

### Tasks

A task is a saved script plus the host logins it runs on, e.g. `apt-get upgrade -y` on every web server.

- **Tasks → New task**: a name, the script, then tick hosts and pick a login on each. Only host logins the access map gives you are offered, and that is checked again on every run.
- **Run** starts every host at once. Each host shows ok or failed, its exit code and its output (the last 256 KB). **Run again** repeats it.
- The script runs in the login's shell without a terminal, so prompts get no input: use `-y` and similar. Runs are killed after 30 minutes.
- **Keep running if the connection drops**: turn on for scripts that can cut their own connection (VPN, sshd, firewall or network changes). The script then finishes even if the app loses the connection, and its output also goes to a log file in `/tmp` on the host.
- Tasks and runs are private to the user who made them. Limits: 100 tasks, 50 hosts per task, 16 KB per script. A run keeps its own copy of the script, so editing a task doesn't change past runs.

### Admin

Members of `OIDC_ADMIN_GROUP` get an **Admin** section:

- **Hosts**: add, enroll, edit and delete hosts, and edit the access map ([Adding a host](#adding-a-host)).
- **Users**: everyone who has signed in, with their groups as of their last sign-in. **Sign out & end sessions** closes their terminals, stops their running tasks and signs them out of CertShell. Disable them at the IdP too, or they can sign straight back in.
- **Sessions**: open terminals right now. End any one of them.
- **Audit**: logins, every cert signed, terminal start/end, task runs, host and access map changes, enrollments. The same events go to stdout.

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
| `AUDIT_DAYS` | no | none: audit log kept forever. Whole days; older entries deleted at startup and daily. |
| `RUN_DAYS` | no | none: task runs and their output kept forever. Whole days, as `AUDIT_DAYS`. |
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

## Upgrading

The examples use `ghcr.io/maca134/certshell:1`, which follows every 1.x release. Pin `1.4` or `1.4.1` instead if you'd rather upgrade by hand.

```sh
docker compose pull && docker compose up -d
```

- Back up `certshell-data` first. Database migrations run at startup.
- The restart closes open terminals and marks running task targets failed. Detached task scripts still finish on the host.
- Admins see a "… available" notice in the sidebar when a newer release exists (`UPDATE_CHECK`).

## Troubleshooting

`docker compose logs certshell` shows the reason behind most errors.

- **"identity provider unavailable"**: the container can't reach `OIDC_ISSUER`. Check DNS from inside the container, or the `ID_DOMAIN` network alias the examples set for Pocket ID.
- **"login failed"**: usually the callback URL doesn't match `https://ssh.example.com/auth/callback` exactly, or the client ID/secret is wrong. The log line after `login failed:` names the cause.
- **The IdP says you're not allowed**: add your group to the OIDC client's allowed groups (Pocket ID: the client's **Access** tab).
- **Logged in, but no hosts**: none of your groups is allowed on a host. Group names must match exactly (Pocket ID: the **name**, not the friendly name). Groups are read at sign-in, so sign out and back in after changing them.
- **No Admin section**: you're not in `OIDC_ADMIN_GROUP`, or haven't signed in again since being added.
- **Enroll: "sshd_config does not Include sshd_config.d/*.conf"**: add `Include /etc/ssh/sshd_config.d/*.conf` near the top of `/etc/ssh/sshd_config`, then run a new snippet.
- **Enroll: curl fails**: the host can't reach `https://ssh.example.com`, or the snippet is older than 10 minutes or already used. Generate a new one.
- **Host shows offline**: port 22 on the host's address isn't reachable from the CertShell container. Check the address and firewalls.

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
