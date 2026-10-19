---
name: implement
description: >
  Builds one already-decided piece of CertShell work (a GH issue, a local sec
  ticket, or the plan agreed in this chat) test-first, reviews it, and opens
  a PR. User-invoked only: `/implement <#N | ticket path | "the plan">`.
disable-model-invocation: true
---

Build work that's already decided. Don't reopen the plan: no new design, no
alternative approach. If the input is unclear, ask; don't redesign.

Adapted from [mattpocock/skills](https://github.com/mattpocock/skills).
Copyright (c) 2026 Matt Pocock, MIT License: see the upstream
[LICENSE](https://github.com/mattpocock/skills/blob/main/LICENSE).

## Input

One of:

- `#N` or an issue URL: `gh issue view <N>`. State its title before starting.
- A sec ticket path `.audit/<ts>/NN-slug.md` (from `/audit-to-tickets`).
- "the plan in this chat": restate it in 3–5 lines first.

A bare number that could mean something else in context (a report finding,
a checklist item) → ask which.

**Sec tickets never leave this machine** until the user says so: local
branch, no push, no PR (SECURITY.md: the fix would disclose the bug before
release). Same for any issue whose fix turns out to be a vulnerability
that should stay private: knowing about it could get someone a cert, the
CA key, a login or a session.

## Steps

1. **Branch.** `git fetch -q origin` first. On `main` →
   `git switch -c <type>/<slug> origin/main` (`fix/`, `feat/`, `docs/`,
   `skills/` …). On a branch already made for this ticket → stay. Any other
   branch → ask.
2. **Seams.** Read the code the ticket touches. Propose the seams (one line
   each: what it catches, what it misses) and ask the user once. Seams
   already written in the ticket → state them and go.
3. **Build** with the `tdd` skill, slice by slice. Typecheck and run single
   test files as you go; full suite once at the end.
4. **Commit** per logical change (test + code for one slice can share a
   commit). No attribution lines.
5. **Review.** Run the `review-code` skill against `origin/main`. Fix every
   `hard`, `missing`, `wrong` and security finding; fix `judgement` and
   `unasked` ones unless they contradict the ticket, and list any you skip.
   Fixes are extra commits. The Security axis covered the earlier commits;
   if the fix commits touch `apps/api/src/`, `Dockerfile`, `compose*.yaml`
   or `.github/workflows/`, run the `security-reviewer` agent on just the
   fix commits and fix what it finds.
6. **Verify.** `bun run verify` must pass. After 3 failed fix attempts,
   stop before pushing: `verify: fail`, and report what fails.
7. **Vuln gate.** If the review, tests or your own reading show the bug is
   a vulnerability that should stay private (see above), switch to
   sec-ticket rules (local only) and ask the user before anything is
   pushed.
8. **PR** (not for sec tickets): `git push -u origin HEAD`, then
   `gh pr create` with a body: what changed, how it was tested, and
   `Closes #N` when the input was an issue. Never push to `main`. A PR for
   the branch already exists → push, report its URL. Push or `gh` fails →
   stop and report the error.

## Output

```
built: <ticket title>
branch: <name> · commits: <n> · verify: pass | fail
review: <fixed n> · skipped: <finding — why> | none
pr: <url> | local only (sec) | not opened: <why>
skipped / risk: <what wasn't done or checked> | none
```

## Boundaries

One ticket per run. Doesn't tick the issue's checkboxes or close it (the
PR's `Closes #N` does that on merge). Doesn't merge.
