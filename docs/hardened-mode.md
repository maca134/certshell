# Hardened mode (parked proposal, not built)

Opt-in mode where a separate **signer** container holds the SSH user CA, so a web-app RCE can no longer mint certs on its own. Closes the gap in SPEC.md §3.3 ("A web RCE ⇒ certs for any login on any enrolled host").

Reverses SPEC.md §9 "Separate signer service". Grilled 2026-10-20, then security-reviewed; parked with one design question open (below).

```
app ── HTTP (compose network) ──► signer ── JWKS ──► OIDC provider
                                   └─ /data: CA key, access map
```

## Prerequisite: drop Fleet

Host facts (SPEC.md §3.6) is the only cert the app mints with no user behind it. The signer has no such path, so Fleet goes first: facts page, facts login, background collection, `reboot` alert, plus a DB step dropping `hosts.facts_login`, `host_facts` and `reboot` from alert channels. Beszel covers it. The port-22 online dot and `host_down` alerts stay.

## Agreed decisions

- **Default mode unchanged.** Hardened mode is opt-in.
- **Fixed at install.** Mode stored in the DB at first boot; a mismatch with `SIGNER_URL` refuses boot, as does a local CA key in hardened mode. No switching or migration: moving = new install + re-enroll every host.
- **Same image, different command.** Same hardening as the app (read-only, non-root, `cap_drop`), own `signer-data` volume. Generates the CA on first boot with its own `ca_password` (the §6.2 logic moves to the signer). The app gets a new `alerts_password` secret for alert URLs (§3.5).
- **Any OIDC provider.** Standard OIDC only: `nonce`, `max_age`, JWKS-verified ID token, `groups` claim. The signer needs no client secret.
- **One fresh login per terminal / task run**, in a popup (a full redirect kills the page's open terminals; on phones it opens as a tab). Same client, `/auth/callback` told apart by `state`, `max_age=0`, `nonce` = SHA-256 of the sign request. The app trades the code and passes the ID token + request to the signer. Never silent SSO.
- **Signer checks:** JWKS signature (cached, refetched on unknown `kid`), `iss`, `aud` = client ID, `exp`, `auth_time` ≤ 60 s, nonce matches the request, nonce not used before (in memory until `exp`), every principal against its own access map with the token's `groups`.
- **Signer sets** TTL (15 min), serial and key ID (from token claims), never the app. Same cert options as §3.2.
- **Task runs:** request = list of `{pubkey, principal}`, one keypair and cert per target, `pty: false`, at most 50, all-or-nothing. Never one cert with many principals.
- **Access map on the signer.** Edited in the UI as today; each save is one login with `nonce` = SHA-256 of the new map, admin group required. The app keeps a mirror for display and task save checks. Signer knows host IDs only, never host keys.
- **Transport:** plain HTTP on the compose network, port 3001, no published port, no extra auth (the fresh token is the auth; a shared secret or mTLS would sit in the RCE'd app). Endpoints: `POST /sign`, `GET`/`POST /access-map`, `GET /ca.pub`, `/healthz`.
- **Signer audit:** stdout only, `sign`, `access_map_change`, `rejected` (+ reason). The app can't touch it.
- **Down:** fails closed, errors in the terminal pane with Retry (popup blocked, cancelled, IdP didn't re-authenticate, signer unreachable, signer can't reach IdP). App polls signer `/healthz` every 60 s: admin banner + `signer_down` / `signer_up` `security` alerts.
- **End sessions** stays app-only. Revoke = access map save or disable at the IdP.
- **Setup:** "Hardened mode" checkbox in the setup generator; `examples/` stay default mode.

## Security review findings (2026-10-20)

Must be folded in before this is buildable.

**High**

1. **Admin login ⇒ attacker map.** The app picks which request a popup token binds to, so any admin popup (even a terminal Connect) can save an attacker-written map granting the attacker's own account any login on any host. It persists on the signer, and the UI shows the app's mirror, so the admin never sees it. **Open question below.**
2. **One login ⇒ many signs for 60 s.** The app writes the auth URL, so it can drop `max_age=0` and loop silent re-auths: same `auth_time`, new nonces. Fix: signer accepts each `(iss, sub, auth_time)` once, kept 60 s.
3. **Hosts enrolled during a compromise are lost.** The app serves the root enroll script, so it can plant its own CA or anything. State in the accepted risk; signer logs its CA fingerprint at boot for admins to compare.

**Medium**

4. Deleting a host doesn't stop the signer signing `ws:<id>:*` until the next map save. Make host delete a signer map save, or state the gap.
5. Signer validates its own inputs: map (host ID format, login `^[a-z_][a-z0-9_-]*$`, size cap) and each principal `^ws:[a-z0-9]+:[a-z_][a-z0-9_-]*$`, ≤ 50 entries. Else a comma in a login injects principals.
6. Accepted risk wording: one login ⇒ up to 50 certs, any of the user's allowed host logins, `pty` as the app likes.

**Low**

7. Token checks: reject missing `auth_time`; `aud` exactly the client ID (string or one-element array), `azp` = client ID if present; `groups` must be in the ID token (no userinfo); IdP client allows only the authorization-code grant. `auth_time` doesn't prove a passkey — don't claim it does.
8. DoS: throttle JWKS refetch (≤ 1/min), cap body size, verify the token before parsing entries or spawning `ssh-keygen`.
9. The signer's JWKS fetch goes through the reverse proxy alias, so the proxy can forge tokens. Document it, or give the signer a direct route to the IdP.
10. Random 64-bit serials (no persistent counter). Key ID drops `sessionId` — update §3.2/§5 or add a link to the signer log. `sign` logs pubkey fingerprints, `auth_time`, pty flag.
11. App refuses a popup token whose `sub` differs from the session's.

Checked fine: the mode lock, replay after restart, nonce = SHA-256 of raw body bytes (specify encoding), no app↔signer auth, `alerts_password`, default mode not weakened.

## Open question

How to close finding 1:

- **A.** Admit it in the accepted risk; signer logs the full map + admin `sub`; operators verify via `docker logs signer`.
- **B.** Access map as a config file on the signer, hand-edited (host IDs copied by hand). The app can't change it. Recommended.
- **C.** Signer serves its own small confirm page for map saves, showing the map before the login. Needs its own proxy route and UI.

## Accepted risk once built

Hardened mode: the app holds no key. A web RCE ⇒ certs only when a user completes a fresh IdP login, for host logins that user is allowed; it can pick which of them, up to 50 per login. It also controls terminals and task output already open in the app, and any host enrolled while compromised.
