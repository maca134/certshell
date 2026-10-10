# Pocket ID walkthrough

Setting up [Pocket ID](https://pocket-id.org) for CertShell. Assumes the [Quick start](../README.md#quick-start-pocket-id) stack is running.

Labels follow Pocket ID v2 and may differ slightly between versions.

**First account.** Open `https://id.example.com/setup`, enter a username, email and name, then add a passkey. This page only works until the first account exists, so do it straight after `docker compose up`.

**Groups.** **Administration → User Groups → Add group**:

- `certshell-admins` (or whatever `OIDC_ADMIN_GROUP` says): may enroll hosts and edit the access map. Add yourself.
- One group per kind of access, e.g. `ops`, `web-deploy`. You **Allow** these on hosts in CertShell.

CertShell matches the group's **name**, not its friendly name.

**OIDC client.** **Administration → OIDC Clients → Add OIDC Client**:

- Name: `certshell`. Client type: **confidential** (not public).
- Callback URL: `https://ssh.example.com/auth/callback`.
- **Create**, then copy the client ID and secret into `.env`. The secret is shown only once; if you lose it, add a new one under **Credentials**.
- **Access**: pick the groups that may use CertShell at all. A new client lets nobody in until you set this.

**Adding a user.** **Administration → Users → Add user**, then add them to groups. To let them register a passkey, open the user's **⋯** menu → **Login Code** and send them the link.

**Changing access.** Group changes apply at the user's next CertShell login (sessions last up to 1h). To cut someone off now: disable them in Pocket ID, then **Admin → Users → Sign out & end sessions** in CertShell.

**Lost passkey.** An admin sends a new **Login Code** as above. Locked out yourself:

```sh
docker compose exec pocket-id /app/pocket-id one-time-access-token <username or email>
```

It prints a sign-in link valid for 1 hour; add a new passkey from your account page.
