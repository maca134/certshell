# Changelog

Versions follow [semver](https://semver.org). Images: `ghcr.io/maca134/certshell:<version>`.

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
