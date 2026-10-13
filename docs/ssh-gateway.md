# SSH gateway (proposal, not built)

Plain `ssh` from a phone (Termux) to a CertShell terminal, approved in the browser with a fresh IdP login. Fixes the mobile terminal: xterm.js and Android keyboards don't mix, a native terminal does.

```
ssh -p 2222 alice@ssh.example.com
  → "Open https://ssh.example.com/g/<token>   code 42"
  → tap link, pick 42, pick host + login, IdP asks for passkey
  → terminal on that host
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
| App | Everything else: login link, approval and host pick, `openTerminal()`, limits, audit. Unchanged terminal path. |
| Split | Go owns the SSH parser (the risky part, best-maintained library). Logic stays in TypeScript. |

## Gateway (Go)

- Listens on `:2222`. Host key generated on first boot, kept in its own volume. Fingerprint shown in the app UI so users can check it on first connect.
- Accepts any username. The username is passed to the app, never trusted.
- Auth: `keyboard-interactive` with no prompts, accepted at once. It approves nothing; approval happens in the app.
- Session channel: `pty-req`, `window-change`, `shell` only. Rejects `exec`, `subsystem` (sftp), `env`, agent and X11 forwarding, `direct-tcpip`, `tcpip-forward`.
- One session per connection. Handshake timeout and per-IP connection cap. Global cap on connections waiting for approval (e.g. 50); past it, new connections are refused.
- Per session, opens a WS to the app's internal listener: first message `{user, ip, cols, rows}`, then raw bytes both ways and resize messages.
- Authenticates to the app with a shared secret (Docker secret `gateway_secret`).

## App (Bun)

- **Internal listener** on a separate port (e.g. 3001), not on the proxy's upstream port, so the proxy can't route it by mistake. Only the gateway's WS. Disabled unless `gateway_secret` exists.
- **Login link.** Per connection: a 256-bit token (stored hashed) + a 2-digit code, valid 2 min, single use. The app writes the link, a QR code of it (half-block characters, only if the terminal is wide enough) and the code into the PTY and waits. QR is for SSH from a laptop; on the phone, tap the link (Termux: `terminal-onclick-url-open=true` in `~/.termux/termux.properties`, else long-press → More → Select URL).
- **Approval page** `/g/<token>`:
  - Forces a fresh IdP login (`max_age=0`, checks `auth_time`), so the IdP asks for the passkey.
  - Shows the SSH username, client IP and time.
  - User types the 2-digit code shown in the terminal. Wrong code burns the token.
  - SSH username must equal the approving user's IdP username, or the approval is refused.
  - User picks a host + login from the pairs the access map allows (same list and check as the web UI). Last used is preselected.
- **After approval** the connection is bound to that user (`sub`, groups from the fresh login) and target. `openTerminal()` connects; the access check runs again there. Input typed before the terminal opens is dropped, not replayed. When the terminal exits, the SSH connection closes. Another host = a new connection and approval.
- **Limits.** Terminals keep their own limits (§3.2) and count against the existing per-user and total ssh caps. "End all of a user's sessions" also closes their gateway connections.
- **Rate limits.** Pending logins per IP and in total (same global cap as the gateway, enforced here too), approvals per user.
- **Audit.** `gateway_connect` (username, IP), `gateway_approve` (sub, email, username, IP, host, login) / `gateway_deny` / `gateway_expire` (sub, email, username, IP), then the normal `sign` / `session_start` / `session_end`.

## Phishing

An attacker connects and sends a victim their link. Mitigations:

- Code match: the code is only in the attacker's terminal, so the victim can't type it. A guess is right 1 time in 100.
- Username must match the approving user.
- Page shows IP and username.
- Single use, 2 min expiry.
- Every approval is audited; can feed an alert (§3.5).

Not fully closable; same as any device-code flow.

## Threat model changes

- New public port (2222) and a new pre-auth surface: the SSH handshake and the login-link PTY. Pre-auth input to the app is only the username (validated) and IP.
- Gateway compromise ⇒ sees and can type into every terminal passing through it, and can start pending logins. It can't approve them (needs the IdP in a browser) or mint certs. Can't be prevented: the gateway must decrypt SSH to show the link; end-to-end would need a client script. Contained instead (Deployment).
- App compromise: unchanged (§3.3).
- A shell through the gateway is the same as the browser terminal to the target: same cert, same principal, same limits.

## Deployment

- New image `ghcr.io/maca134/certshell-gateway`, built and released alongside the app, multi-arch, pinned by digest. Distroless static image: no shell, no tools.
- Gateway hardening: non-root, `read_only`, `cap_drop: [ALL]`, `no-new-privileges`, `pids_limit`, `mem_limit`. Only writable path is its host key volume.
- Gateway networks: an `internal: true` network shared with the app only (to reach the internal listener), plus its own bridge network with no other containers, for the published port (Docker can't publish ports on an internal network). No other containers reachable. That bridge still has outbound internet; blocking it needs host firewall rules, so it's a documented option, not default.
- The app's internal listener is on that network only, not on the proxy's network.
- Compose: `gateway` publishes `${GATEWAY_PORT:-2222}`. Exception to §6.3 "only the proxy publishes ports": SSH carries its own encryption.
- Optional: no `gateway_secret`, no gateway service ⇒ feature off.
- Setup generator on certshell.dev and README updated.

## After v1: push approval

Sends the login link as a push to the user's browser, so SSH from a laptop can be approved on the phone. The link and QR stay as the fallback.

- **Web Push** (VAPID, service worker). Users opt in per browser in the web UI. No admin alert channels (§3.5): those are shared, not per user.
- **SSH keys list** in the web UI, per user: paste a public key, list, revoke, last used. A key from an approved connection is added automatically. Unused for 30 days ⇒ removed.
- **Gateway `publickey` auth**, tried before `keyboard-interactive` (`none` refused, else OpenSSH never offers its keys). Success means the client signed with the private key (checked by `x/crypto/ssh`); the fingerprint goes to the app as `key` in the first message. It still approves nothing.
- **Known-key gate.** A push is sent only if the client proved a key on the user's list. Public keys are public, so offering one is not enough. No key ⇒ link/QR only. Termux has no key until `ssh-keygen` is run once.
- A key only allows the push. It never skips the approval page, code pick or passkey.
- **Spam backstops.** Same notification tag, so a new push replaces the old one. Per username: 1 per 30 s, 5 per hour, then link only. No approve button: the push only opens the page. Snooze action: no pushes for 1h.
- **Audit:** `gateway_key_add` / `gateway_key_remove` (sub, fingerprint, by user or by approval), `gateway_push` (sub, IP).
- Later, the same list can hold FIDO2 keys (`sk-ssh-ed25519`) as a full login for laptop users.

## Not in v1

- Push approval and the SSH keys list (above).
- **Trust this device.** A known key skips approval for 8h. Turns the key into a login; revisit after push.
- `scp` / `sftp` / port forwarding / `exec`.

## Open questions

- Which claim is the "IdP username"? `preferred_username` (Pocket ID sets it) or email local part. SPEC §3.1 says email is never used for access; here it is only a phishing check, but some IdPs let users edit both.
- Does Pocket ID honour `max_age=0`? If not, `prompt=login`.
- Does Termux render OSC 8 hyperlinks? Untested.

## Spec changes when built

- Header + §1: scope gains "native `ssh` terminal via the gateway"; non-goals keep `scp`/`sftp`/forwarding.
- §2: gateway in the diagram.
- §5: new exposed route `/g/<token>`, internal listener, rate limits, audit events.
- §6: image, compose, port.
- §9: remove "Menu-style jump host" (this doc reverses it).

## Plan

1. Spike: Go gateway + stub app, connect from Termux. Checks resize, keyboard, link tap.
2. App: internal listener, login link, approval page with host pick.
3. Gateway: limits, host key, image, release workflow.
4. Compose, setup generator, README, SPEC.
5. After v1: SSH keys list, then push.
