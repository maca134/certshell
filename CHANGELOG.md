# Changelog

Versions follow [semver](https://semver.org). Images: `ghcr.io/maca134/certshell:<version>`.

## 1.12.0 - 2026-10-13
- When your session has ended, a **Session ended** popup now asks you to sign in again, instead of the page jumping straight to sign-in on your next click. Open terminals keep running. The check also runs as soon as you switch back to the tab.
- Signing in takes you back to the page you were on, instead of the host list.

## 1.11.1 - 2026-10-12
- Fixed: Fleet's **Refresh all** showed "JSON.parse: unexpected end of data".
- Fixed: Fleet showed an uptime of about 56 years on FreeBSD and OPNsense hosts. Hosts collected before this fix show the right uptime after their next collection, or straight away with **Refresh**.

## 1.11.0 - 2026-10-12
- Tasks: a run's results can be grouped by output. Hosts with the same exit code and output are grouped, biggest group first, and each other group shows a diff against it. **By host** lists each host as before.
- Alerts (Admin → Alerts): notifications through [shoutrrr](https://github.com/nicholas-fedor/shoutrrr) (ntfy, Gotify, Discord, Slack, Telegram, email, webhooks, …). Each channel picks its events: a task run with a failed host, a host offline or back online, a host newly needing a reboot, security changes, or a terminal opened (optionally only on some tags or logins). URLs can't be read back after saving, and are stored encrypted when `ca_password` is set. The image now includes the `shoutrrr` binary.
- Fleet (Admin → Fleet): OS, uptime, pending and security updates, reboot flag and disk use for each host, with counts and **New task on these hosts**. Off until you set a facts login under Hosts → Edit; CertShell then logs in as it every 6 hours with a no-terminal cert.
- The app checks port 22 on every enrolled host once a minute and logs `host_down` / `host_up` to the audit log.
- Audit: new `host_key_mismatch` event when ssh refuses a host because its host key changed. `host_delete` entries include the host's name.

## 1.10.0 - 2026-10-12
- Sessions end after 30 minutes idle or 8 hours, instead of exactly 1 hour after sign-in. Group changes at the IdP can now take up to 8 hours to reach new terminals; **Sign out & end sessions** still cuts a user off at once.
- Admin: the Sessions page stops refreshing while its tab is hidden, so an idle admin tab no longer keeps the login alive.
- Fixed: another site on the same domain could sign you out of CertShell. Sign-out is now only accepted from CertShell's own pages.

## 1.9.0 - 2026-10-12
- Admin: deleting a host, or changing its access, ends the open terminals and running task targets that lose access.
- Startup: if the CA key exists but the `ca_password` secret is missing or wrong, CertShell now exits with a clear error instead of starting and failing every terminal and task.
- `AUDIT_DAYS` also prunes cert sign records, which kept every user's email and host history forever.
- Fixed: the Tasks page showed no last run for a task whose last run was older than your 50 newest runs.
- Fixed: a terminal or task still getting its cert when an admin ended the user's sessions or removed their access could still open.

## 1.8.0 - 2026-10-12
- Terminal: full screen button next to Search. Not shown where the browser doesn't allow it (Safari on iPhone).

## 1.7.2 - 2026-10-12
- Fixed: on short screens (e.g. a tablet in landscape) the sidebar menu scrolled with no visible scrollbar, so its last items looked missing. The scrollbar now shows.

## 1.7.1 - 2026-10-12
- Fixed: on tablets (Firefox, and other browsers whose toolbar hides on scroll) the sidebar was shorter than the screen and cut off its last item (Audit).
- Removed: the terminal key bar on touch devices (Esc, Tab, Ctrl, Alt, arrows). Use a keyboard app with those keys instead.

## 1.7.0 - 2026-10-12
- Host tags. Admins add them in Manage hosts → Edit, with suggestions from tags already in use. Each tag gets a colour from its name. Tags only organise hosts; they don't affect access.
- Hosts page: filter by tags (a host must have every selected tag) and a "Group by tag" view.
- Task editor: the host list has the same tag filter. Hosts hidden by the filter stay selected.

## 1.6.1 - 2026-10-12
- Fixed: enrolling failed with "could not load … via an Include" on hosts whose OpenSSH prints `sshd -T` settings in mixed case (e.g. current OPNsense). The enroll script and sshd reload now read them in either case.

## 1.6.0 - 2026-10-12
- OPNsense hosts can be enrolled. The enroll script takes its paths from the installed sshd (`/usr/local/etc/ssh` on OPNsense) and reads the host key location from sshd. See README → Adding a host for OPNsense's SSH settings.
- A failed first enroll removes the files it wrote; a failed re-enroll keeps the working setup.
- The host removal command also works pasted into csh/tcsh (root's shell on FreeBSD and OPNsense).
- Fixed: reloading sshd on hosts without systemd, OpenRC or FreeBSD rc used a fixed `/run/sshd.pid`; it now uses sshd's own pidfile and skips the reload if sshd isn't running.

## 1.5.1 - 2026-10-12
- Admin Hosts: each row has Enroll, Edit and Remove buttons that open dialogs. Edit covers name, address and access rules, and sends nothing until Save.
- Fixed: the enroll snippet overflowed the host panel.
- Fixed: enrolling or removing a host with socket-activated sshd (Debian 13 LXCs) failed at the reload with "Cannot bind any address". sshd is now restarted there instead of reloaded; open sessions stay up.

## 1.5.0 - 2026-10-12
- FreeBSD hosts can be enrolled. Install `curl` first (`pkg install curl`).
- Enroll adds `Include /etc/ssh/sshd_config.d/*.conf` to `sshd_config` when it's missing, on any OS. It keeps a backup, and restores the file if sshd still doesn't load the drop-in.
- Admin Users page shows each user's certs in use and unexpired.
- Fixed: enrolling a host whose sshd wasn't running (socket-activated, common in LXCs) failed at the final reload, after the host was already enrolled.

## 1.4.2 - 2026-10-10

### Security
- Host IDs are generated without modulo bias.
- Base image bumped to pick up patched gzip, perl, OpenSSL, SQLite and PCRE2.
- Release images are scanned with Trivy before publishing and carry SBOM and provenance attestations.
- CI runs lint, typecheck, tests and `bun audit` on every push and PR; CodeQL, OpenSSF Scorecard and Dependabot are enabled.
- [SECURITY.md](SECURITY.md): report vulnerabilities privately via GitHub security advisories.

### Docs
- README: Using CertShell, Upgrading, Troubleshooting and removing a host.
- Pocket ID walkthrough moved to [docs/pocket-id.md](docs/pocket-id.md).
- [CONTRIBUTING.md](CONTRIBUTING.md) and this changelog.

## 1.4.1 - 2026-10-09
- Release workflow logs in to Docker Hub to avoid the anonymous pull rate limit. No app changes.

## 1.4.0 - 2026-10-09
- Admin Sessions page lists open terminals; end one, or all of a user's.
- Ending all of a user's sessions also stops their running tasks and signs them out.
- Online/offline dot next to each host (TCP check on port 22, cached 30s).
- Terminal scrollback search (button or Ctrl+Shift+F).
- Terminal confirms pastes that would run commands, unless bracketed paste is on.
- Optional `AUDIT_DAYS` / `RUN_DAYS` retention, pruned at startup and daily.

## 1.3.0 - 2026-10-09
- Tasks: saved scripts run on many hosts with a no-PTY cert, with live per-host results.
- Detach option keeps a task's script running if the connection drops.
- Concurrent ssh process caps: 64 per user, 200 overall.
- Database schema migrations.

## 1.2.0 - 2026-10-09
- Version shown in the sidebar; admins see when a newer release is out.

## 1.1.1 - 2026-10-09
- Terminal is lazy-loaded, preloaded from the host list.

## 1.1.0 - 2026-10-09
- Remove a host from the admin UI, with a host removal snippet.

## 1.0.0 - 2026-10-09
- First release.
