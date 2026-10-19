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

- Called from `/implement` or directly: ask the user once.
- Called from an `/implement-spec` implementer: the seams come from the
  ticket. No seams in the ticket → stop and report; don't invent them.

## Where tests go

- API: `apps/api/test/<area>.test.ts`. Web unit: `apps/web/test/`.
  Browser flows: `apps/web/e2e/`. Repo-level: `test/`. All end in `.test.ts`.
- Run one file while looping: `bun test <path>` (from the app dir for app
  tests). Typecheck often: `bun run typecheck`.
- No `find`/`grep` in tests; use Bun's `Glob` and built-ins.

## Real, not mocked

Use the real thing; the helpers already exist:

- Server + WS + session + throwaway CA: `startApp()` in `apps/api/test/helpers/app.ts`.
- OIDC: `startMockIdp()` in `apps/api/test/helpers/mock-idp.ts`.
- SQLite: `openDb(":memory:")`. `ssh-keygen`: the real binary.
- Target host: the sshd container in `apps/api/test/ssh-target/`.

Mock only time and outbound alerts (`apps/api/test/fixtures/shoutrrr.ts`).
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

- **Red first.** Write one failing test, watch it fail for the right reason,
  then write just enough code to pass.
- **One slice per cycle**: one seam, one test, the minimal code.
- **No refactoring in the loop.** That's `/change-review`'s job.
- Security behaviour (authz, input checks, headers, rate limits, audit
  events) gets a test that fails without the check.
