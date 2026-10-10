# No-OIDC mode (proposal, not built)

A single-user mode that signs in with passkeys stored by CertShell itself, so no external IdP is needed. Reverses SPEC.md §9 "Built-in passkeys / accounts" for this mode only. OIDC mode is unchanged.

## Decisions

| | |
|---|---|
| Switch | `AUTH_MODE=passkey` (default `oidc`). Exclusive: in passkey mode any `OIDC_*` var set = boot error; in oidc mode the `OIDC_*` vars stay required. The mode is stored in the DB; if it differs at boot, all sessions are deleted (and logged as `auth_mode_change`) so no session from the old mode survives. |
| Users | Exactly one, always admin. Session user `{iss: "local", sub: "owner", email: null, groups: [OIDC_ADMIN_GROUP]}`. The access map grants hosts to that group. |
| Login | Passkey only (WebAuthn, `@simplewebauthn/server`, pinned). No password fallback. |
| Key types | Any (synced or hardware). `userVerification: "required"` (PIN/biometric). No attestation checks. README notes hardware keys are stronger. |
| CLI | A `certshell` script on the image's PATH (added at build time, so the read-only filesystem is fine): `docker compose exec certshell certshell <command>`. It writes the same SQLite file as the running server; WAL is already on. |
| `add-passkey` | CLI. Prints a setup link `/auth/setup?token=…` (256-bit token) and, on a separate line, a short code (6 digits). Both are stored hashed, valid for 10 min, single-use. User opens the link and types the code to register one more passkey; existing ones stay. 5 wrong codes = token burned. Only one token is valid at a time: issuing a new one deletes any old one. First setup is just `add-passkey` with no passkeys yet. Never printed at boot, never from env, never first-visitor registration. |
| `reset-passkey` | CLI. Deletes **all** passkeys **and** all sessions directly in the DB, then prints an `add-passkey` link + code and the line "now run `docker compose restart certshell`". No web reset flow. Also the fix for a lost device: reset, restart, then `add-passkey` for each remaining device. |
| Session | Unchanged: 1h absolute, then sign in again with a passkey. Open terminals keep their own 30 min idle / 8h max limits. |
| Admin UI | The frontend is told the mode. In passkey mode the Users tab is hidden and the access map's group field is filled in with the admin group and not editable. |
| In-app passkey management | None. |

Why token + code: a URL can end up in proxy/CDN logs, browser history or a screen share, so the link alone must not be enough. A leaked link is useless without the code, which never goes in a URL. And since the code can only be tried against a valid token, 6 digits with a 5-try burn is enough, and the link stays clickable. Both come from the same terminal output, so this is not two independent factors. It only protects against the link leaking.

Why CLI only: Docker access can already read the CA key on the volume, so a CLI adds no new trust boundary. A same-origin XSS can't add a passkey, because there's no in-app way to add one. Setup tokens only ever add a passkey, so a token can't be turned into a reset, and there's no half-finished web reset that can lock you out.

## Security requirements

These are the risks this mode adds compared to running Pocket ID:

- **Passkey parsing runs in the CA process.** `@simplewebauthn/server` handles untrusted input before login. Pin the version, keep it updated, and put the existing per-IP rate limit on every `/auth/*` passkey route.
- **We own the checks.** Challenges are stored server-side, single-use, short-lived and tied to the login cookie. Expected origin = `APP_URL`, site ID = `APP_URL` host, user verification required.
- **No external kill switch.** The incident response is `reset-passkey` and then a container restart. Document both steps in the README. The restart is needed because open terminals and running tasks live in the server's memory: the CLI is a separate process, so deleting session rows doesn't end them. Without a restart, an attacker's open terminal lasts up to 8h and a running task up to 30 min.
- **Audit.** Add events: `passkey_setup_token`, `passkey_register`, `passkey_reset`, `login` (with credential id and a fail flag). Like all audit events they go to stdout as well as SQLite. This matters most for `passkey_register`: adding a passkey doesn't sign anyone out, so the shipped stdout line is the only trace an attacker can't rewrite.
- **Don't run the CLI from automation that logs output.** A logged run captures the link and the code together, which defeats token + code. README note.
- **Session cookie is `SameSite=Strict` in passkey mode.** OIDC mode needs `Lax` for the IdP redirect back; passkey mode has no cross-site redirect.

Not relied on: the sign counter, because synced passkeys report 0.

Side effect: changing `APP_URL`'s hostname invalidates every passkey, so you'd need a reset to get back in.

## Rough shape

- `credentials` table: `id`, `public_key`, `created_at`.
- Setup tokens follow the `enroll_tokens` pattern (hashed, expiry, single-use), using `randomToken` / `hashToken` from `apps/api/src/lib/sessions.ts`.
- Setup and login POSTs go through the existing same-origin JSON guard in `apps/api/src/lib/http.ts`.
- `/auth/login` serves the passkey page instead of redirecting to the IdP. The signed-out page's "Sign in again" link keeps working.
- No OIDC discovery in this mode (`main.ts`).
- `/api/me` reports the auth mode so the admin UI can hide the Users tab and lock the group field.
- Size estimate: ~200–250 lines API + web, plus tests.
