---
name: tdd
description: >
  Test-first development for CertShell: red → green in vertical slices, tests
  only at agreed seams, real dependencies over mocks. Use when the user wants
  to build a feature or fix a bug test-first, says "tdd", "red-green", or
  "/tdd", or when `/implement` or `/implement-spec` calls it.
---

The red → green loop, plus the rules that make its tests worth keeping.

Adapted from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT).

## A good test

Tests check behaviour through a public interface, never internals. The code
underneath can be rewritten; the test shouldn't change. Name it like a spec:
`"sign rejects a login not in the access map"`, not `"calls checkAccess"`.

## Seams

A **seam** is the public boundary a test observes: a route
(`app.fetch(new Request(...))`), a WebSocket, an exported function.

**Test only at agreed seams.** Before the first test, list the seams, each
with one line on what it catches and what it misses, and get them confirmed:

- The invoking prompt or ticket lists seams → they're confirmed; state
  them and go (`/implement` confirmed them already; `/implement-spec`
  tickets carry them).
- Otherwise, called by the user directly → ask them once.
- Otherwise, inside an `/implement-spec` implementer → stop and report
  `BLOCKED: no seams in ticket #<n>`; don't invent them.

## Where tests go

- API: `apps/api/test/<area>.test.ts`. Web unit: `apps/web/test/`.
  Browser flows: `apps/web/e2e/`. Repo-level: `test/`. All end in `.test.ts`.
- Run one file while looping: `bun test <path>` (from the app dir for app
  tests). Typecheck often: `bun run typecheck`.
- E2E: `bun run e2e` (Playwright). `bun run verify` doesn't run it: run it
  whenever you touch `apps/web/e2e/` or the flows it covers.
- No `find`/`grep` in tests; use Bun's `Glob` and built-ins.

## Real, not mocked

Use the real thing; the helpers already exist:

- Server + WS + session + throwaway CA: `startApp()` in `apps/api/test/helpers/app.ts`.
- OIDC: `startMockIdp()` in `apps/api/test/helpers/mock-idp.ts`.
- SQLite: `openDb(":memory:")`. `ssh-keygen`: the real binary.
- ssh: swap the command through `startApp`'s terminal deps for a local `sh`
  that inspects the real cert (`fakeSsh` in `apps/api/test/terminal.test.ts`).
- Real target host only for sshd-side behaviour: `apps/api/test/ssh-target.test.ts`,
  skipped unless `SSH_TARGET` is set; its header comment has the compose command.

The only fakes: ssh (above), the OIDC IdP (`startMockIdp`), time
(`setSystemTime`) and outbound alerts (`apps/api/test/fixtures/shoutrrr.ts`).
Never mock our own modules.

## Anti-patterns

- **Implementation-coupled**: mocks an internal module, tests a private
  function, or checks through a side channel (querying SQLite instead of the
  route). Tell: a refactor breaks it with no behaviour change.
- **Tautological**: the expected value is computed the way the code computes
  it, so it can't fail. Expected values are literals, worked examples, or
  SPEC.md.
- **Horizontal slicing**: all tests first, then all code. Tests written that
  way check an imagined shape, not behaviour.

## Loop rules

- **Red first.** Write one failing test, watch it fail for the right reason
  (its assertion fails, not a compile, import or setup error), then write
  just enough code to pass.
- **One slice per cycle**: one seam, one test, the minimal code.
- **No refactoring in the loop.** Called from `/implement` or
  `/implement-spec`: refactor in their review-fix step, after
  `/change-review`. Called directly: one refactor pass once everything is
  green, keeping it green.
- Security behaviour (authz, input checks, headers, rate limits, audit
  events) gets a test that fails without the check.

## Done when

Every agreed seam has a passing test, `bun run verify` passes, and `bun run e2e`
passes if you touched `apps/web/e2e/` or the flows it covers.
