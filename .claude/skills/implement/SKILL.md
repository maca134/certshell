---
name: implement
description: >
  Builds one already-decided piece of CertShell work (a GH issue, a local sec
  ticket, or the plan agreed in this chat) test-first, reviews it, and opens
  a PR. Use when the user says "implement #N", "/implement".
disable-model-invocation: true
---

Build work that's already decided. Don't reopen the plan: no new design, no
alternative approach. If the input is unclear, ask; don't redesign.

Adapted from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT).

## Input

One of:

- `#N` or an issue URL: `gh issue view <N>`. State its title before starting.
- A sec ticket path `.audit/<ts>/NN-slug.md` (from `/audit-to-tickets`).
- "the plan in this chat": restate it in 3–5 lines first.

A bare number that could mean something else in context (a report finding,
a checklist item) → ask which.

**Sec tickets never leave this machine** until the user says so: local
branch, no push, no PR (SECURITY.md: the fix would disclose the bug before
release). Same for any issue whose fix turns out to be a vulnerability.

## Steps

1. **Branch.** On `main` → `git fetch -q origin && git switch -c <type>/<slug> origin/main`
   (`fix/`, `feat/`, `docs/`, `skills/` …). Already on a feature branch → stay.
2. **Seams.** Read the code the ticket touches. Propose the seams (one line
   each: what it catches, what it misses) and ask the user once. Seams
   already written in the ticket → state them and go.
3. **Build** with the `tdd` skill, slice by slice. Typecheck and run single
   test files as you go; full suite once at the end.
4. **Commit** per logical change (test + code for one slice can share a
   commit). No attribution lines.
5. **Review.** Run the `change-review` skill against `origin/main`. Fix every
   `hard`, `missing`, `wrong` and security finding; fix `judgement` and
   `unasked` ones unless they contradict the ticket, and list any you skip.
   Fixes are extra commits. If they touch `apps/api/src/`, `Dockerfile`,
   `compose*.yaml` or `.github/workflows/`, run the `security-reviewer`
   agent on just those commits and fix what it finds.
6. **Verify.** `bun run verify` must pass. Don't report done otherwise.
7. **PR** (not for sec tickets): `git push -u origin HEAD`, then
   `gh pr create` with a body: what changed, how it was tested, and
   `Closes #N`. Never push to `main`.

## Output

```
built: <ticket title>
branch: <name> · commits: <n> · verify: pass
review: <fixed n> · skipped: <finding — why> | none
pr: <url> | local only (sec)
```

## Boundaries

One ticket per run. Doesn't tick the issue's checkboxes or close it (the
PR's `Closes #N` does that on merge). Doesn't merge.
