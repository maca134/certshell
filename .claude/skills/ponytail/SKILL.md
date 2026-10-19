---
name: ponytail
description: >
  CertShell's coding stance: the smallest change that fully solves the task,
  reuse before stdlib before dependencies, no speculative code, and a reply a
  busy human reads once. Always on: CLAUDE.md imports it into every session
  and sub-agent. Invoke it only when the user says "ponytail", "be lazy",
  "simplest solution", "yagni", or complains about bloat.
---

# Ponytail

Be a lazy senior developer: the best code is the code never written. Solve
the whole problem with the least new code. End every reply that changed
code with one line: `skipped / risk: <what you skipped or didn't check, and
any risk the user must know>`, or `skipped / risk: none`. When a skill
defines its own Output block, the line goes inside it.

Always on, for every session and sub-agent; there's no off switch.

Adapted from [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) (MIT).

## Precedence

The user's current request, then the rest of CLAUDE.md and SPEC.md, then
the `tdd` skill, then this file.

## Before you write

Read the task and the code it touches. List every place the change must
reach: callers, tests, fixtures, config, exports, SPEC.md. Check what it
could break: data it destroys or exposes, callers that stop working. That's
scope. Extra features aren't.

## The smallest complete change

Take the first option that fully works:

1. **Does it need to exist?** Skip features, options and flexibility nobody
   asked for; name them in one line.
2. **Already in this repo?** Use it the way the surrounding code does (see
   Reuse first).
3. **Bun or the platform?** `Bun.spawn`/`run()` argv, Bun `Glob`, `bun:test`,
   Web Crypto (`crypto.getRandomValues`, `crypto.subtle`). Never `$` for `ssh`/`ssh-keygen` (it drops
   empty args).
4. **An installed dependency?** Use it. A new one needs a reason a reviewer
   accepts (CONTRIBUTING), never for a few lines.
5. **One line a reader gets at a glance?** One line.
6. Otherwise, the minimum code that works.

- Lazy about the solution, never about the change: finish every part it
  needs, including the callers, tests and fixtures it breaks.
- No abstraction, wrapper, option, config or "for later" code nobody asked
  for. Keep values in the form the platform gives you. Deletion beats
  addition. Keep the repo's structure: `routes/` → `lib/` / `ssh/`.
- The shortest working diff wins, once you know everything it must touch. A
  one-liner that needs decoding isn't short.
- Comments: CLAUDE.md's rule. Only the why the code can't show, one line.
- Bug fix: grep every caller of the function first, then fix the root cause
  once in the shared code.
- Moved or merged code keeps its error handling and validation.
- Between options of equal size, take the one correct on edge cases.
- Every change is tested (CLAUDE.md), trivial or not. New behaviour or a
  bug fix goes through `tdd`; a pure rename, move or docs change just keeps
  the existing tests green.
- A shortcut with a known limit gets `// shortcut: <the limit>, <when to upgrade>`.
  `/project-audit` treats these as recorded decisions.

## Reuse first

- argv commands: `run()` in `apps/api/src/ssh/exec.ts`.
- Input checks: `valid*` and `parseHostKey` in `apps/api/src/lib/validate.ts`.
- Access: `accessibleHosts` / `allowedHost` in `apps/api/src/lib/hosts.ts`.
- Audit events: `audit()` in `apps/api/src/lib/audit.ts`.
- Rate/concurrency limits: `apps/api/src/lib/ratelimit.ts`.
- JSON body + write guards: `apps/api/src/lib/http.ts`.
- Shell quoting and host-side snippets: `sq`, `forAnyShell` in `packages/shared/src/index.ts`.
- API/web types: `packages/shared/src/index.ts`.
- Web fetch: `api()` in `apps/web/src/api.ts`. UI: `apps/web/src/components/ui/`
  (shadcn) before any native widget.
- Tests: `startApp`, `startMockIdp` in `apps/api/test/helpers/`.

## Never cut

Anything SPEC.md §3 (Auth model), §5 (App implementation notes) or §6
(Deployment) requires, or the user asked for: auth and
access-map checks, validation at trust boundaries, rate limits, security
headers, audit events, tests security relies on, error handling that
prevents data loss, accessibility. Don't re-propose SPEC.md §9 (Rejected alternatives).
