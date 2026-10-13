# SSH gateway (proposal, not built)

Plain `ssh` from a phone (Termux) to a CertShell terminal, approved in the browser with a fresh IdP login. Fixes the mobile terminal: xterm.js and Android keyboards don't mix, a native terminal does.

```
ssh -p 2222 alice@ssh.example.com
  → "Open https://ssh.example.com/g/<token>   code 42"
  → tap link, pick 42, IdP asks for passkey
  → host list in the terminal, Enter connects
```

Reverses SPEC.md §9 "Menu-style jump host" with new information: the goal is a usable phone terminal, not `scp`/`sftp`/VS Code Remote. Those stay out of scope.

## Architecture

```
ssh client ──:2222──► gateway (Go, x/crypto/ssh) ──WS, internal port──► app (Bun)
                                                                          └ openTerminal() as today ──► host
```

| | |
|---|---|
| Gateway | Separate container. Go, `golang.org/x/crypto/ssh`, about 150 lines. SSH transport only: no auth decisions, no UI, no state. Never sees the CA key. |
| App | Everything else: login link, approval, host list, `openTerminal()`, limits, audit. Unchanged terminal path. |
| Split | Go owns the SSH parser (the risky part, best-maintained library). Logic stays in TypeScript. |

## Gateway (Go)

- Listens on `:2222`. Host key generated on first boot, kept in its own volume. Fingerprint shown in the app UI so users can check it on first connect.
- Accepts any username with `none` auth. The username is passed to the app, never trusted.
- Session channel: `pty-req`, `window-change`, `shell` only. Rejects `exec`, `subsystem` (sftp), `env`, agent and X11 forwarding, `direct-tcpip`, `tcpip-forward`.
- One session per connection. Handshake timeout and per-IP connection cap.
- Per session, opens a WS to the app's internal listener: first message `{user, ip, cols, rows}`, then raw bytes both ways and resize messages.
- Authenticates to the app with a shared secret (Docker secret `gateway_secret`).

## App (Bun)

- **Internal listener** on a separate port (e.g. 3001), not on the proxy's upstream port, so the proxy can't route it by mistake. Only the gateway's WS. Disabled unless `gateway_secret` exists.
- **Login link.** Per connection: a 256-bit token (stored hashed) + a 2-digit code, valid 2 min, single use. The app writes the link and code into the PTY and waits.
- **Approval page** `/g/<token>`:
  - Forces a fresh IdP login (`max_age=0`, checks `auth_time`), so the IdP asks for the passkey.
  - Shows the SSH username, client IP and time.
  - User picks the code from 3 options. Wrong pick burns the token.
  - SSH username must equal the approving user's IdP username, or the approval is refused.
- **After approval** the connection is bound to that user (`sub`, groups from the fresh login). The PTY shows the host + login pairs the access map allows. Type to filter, Enter connects via `openTerminal()`. On exit, back to the list; `q` quits.
- **Limits.** Gateway connection: 8h absolute from approval, 30 min idle at the list. Terminals keep their own limits (§3.2) and count against the existing per-user and total ssh caps. "End all of a user's sessions" also closes their gateway connections.
- **Rate limits.** Pending logins per IP, approvals per user.
- **Audit.** `gateway_connect` (username, IP), `gateway_approve` / `gateway_deny` / `gateway_expire` (sub, email, username, IP), then the normal `sign` / `session_start` / `session_end`.

## Phishing

An attacker connects and sends a victim their link. Mitigations:

- Code match: the code is only in the attacker's terminal, so the victim can't pick it.
- Username must match the approving user.
- Page shows IP and username.
- Single use, 2 min expiry.
- Every approval is audited; can feed an alert (§3.5).

Not fully closable; same as any device-code flow.

## Threat model changes

- New public port (2222) and a new pre-auth surface: the SSH handshake and the login-link PTY. Pre-auth input to the app is only the username (validated) and IP.
- Gateway compromise ⇒ sees plaintext of terminals passing through it, and can start pending logins. It can't approve them (needs the IdP in a browser) or mint certs.
- App compromise: unchanged (§3.3).
- A shell through the gateway is the same as the browser terminal to the target: same cert, same principal, same limits.

## Deployment

- New image `ghcr.io/maca134/certshell-gateway`, built and released alongside the app, multi-arch, pinned by digest, non-root, same hardening as the app.
- Compose: `gateway` publishes `${GATEWAY_PORT:-2222}`. Exception to §6.3 "only the proxy publishes ports": SSH carries its own encryption.
- Optional: no `gateway_secret`, no gateway service ⇒ feature off.
- Setup generator on certshell.dev and README updated.

## Not in v1

- **Trust this device.** Remember the client key for 8h to skip the link. Adds a standing key; revisit after v1.
- `scp` / `sftp` / port forwarding / `exec`.

## Open questions

- Which claim is the "IdP username"? `preferred_username` (Pocket ID sets it) or email local part. SPEC §3.1 says email is never used for access; here it is only a phishing check, but some IdPs let users edit both.
- Does Pocket ID honour `max_age=0`? If not, `prompt=login`.
- Can Termux open the link with one tap? (Long-press → Select URL works.)

## Spec changes when built

- Header + §1: scope gains "native `ssh` terminal via the gateway"; non-goals keep `scp`/`sftp`/forwarding.
- §2: gateway in the diagram.
- §5: new exposed route `/g/<token>`, internal listener, rate limits, audit events.
- §6: image, compose, port.
- §9: remove "Menu-style jump host" (this doc reverses it).

## Plan

1. Spike: Go gateway + stub app, connect from Termux. Checks resize, keyboard, link tap.
2. App: internal listener, login link, approval page, host list.
3. Gateway: limits, host key, image, release workflow.
4. Compose, setup generator, README, SPEC.
