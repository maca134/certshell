# Contributing

## Reporting bugs and requesting features

Open an issue: <https://github.com/maca134/certshell/issues>. Include your version (shown in the sidebar), how you deployed, and steps to reproduce.

Security vulnerabilities: **don't open a public issue**. See [SECURITY.md](SECURITY.md).

## Pull requests

1. Fork, branch from `main`, and open a PR against `main`.
2. CI (`check`) must pass: lint, typecheck, build, tests and `bun audit`.
3. Keep each commit to one logical change.

Setup and commands: [README → Development](README.md#development). Design and decisions: [SPEC.md](SPEC.md).

## Requirements

- **Tests:** new features and bug fixes come with tests. Unit tests live in `apps/*/test/` and end in `.test.ts` (`bun run test`); browser flows go in `apps/web/e2e/` (`bun run e2e`).
- **Style:** match the surrounding code; `bun run format` applies the Biome rules.
- **Design changes:** update [SPEC.md](SPEC.md) in the same PR.
- **License:** contributions are released under the [MIT License](LICENSE).
