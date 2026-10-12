# Changelog

Versions follow [semver](https://semver.org). Images: `ghcr.io/maca134/certshell:<version>`.

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
