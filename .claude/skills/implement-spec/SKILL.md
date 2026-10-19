---
name: implement-spec
description: >
  Builds a whole parent GH issue's sub-issues on one integration branch,
  running up to 3 implementer sub-agents in parallel worktrees in
  `blocked_by` order, then reviews and opens one PR. Use when the user says
  "implement-spec #N", "/implement-spec".
disable-model-invocation: true
---

Turn a parent issue and its sub-issues into one integration branch and one
PR, every ticket done.

Adapted from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT).

## Input

A parent issue `#N` (e.g. the `Audit <date>` parent from `/audit-to-tickets`).

- Tickets: `gh api repos/{owner}/{repo}/issues/<N>/sub_issues`, open ones only.
- Edges: `gh api repos/{owner}/{repo}/issues/<n>/dependencies/blocked_by`
  per ticket; fall back to the body's `## Blocked by` section.
- Spec: the parent body plus SPEC.md.

The tickets are a **task graph**, not a list. The **frontier** is every open
ticket whose blockers are all done on the integration branch.

Every ticket must name its seams (`## Seams` or equivalent). List the
tickets without them up front and ask the user to add them or name them
now; don't start those until they have seams.

Sec tickets live in `.audit/`, never on GH, so they're never in the graph.

## Context pointers

Talk to sub-agents in pointers: issue numbers, file paths, commit SHAs,
the notes dir. Don't paste what they can read.

## Steps

1. **Read** every ticket and its edges; print the graph as
   `#n <title> ← blocked by #m, #k` and the first frontier.
2. **Explore** (optional). One sub-agent reads the code and docs the tickets
   need and writes notes to `<scratchpad>/spec-<N>/notes/`. Implementers
   read those instead of re-exploring.
3. **Integration branch**: `git fetch -q origin && git switch -c spec/<N>-<slug> origin/main`,
   push it.
4. **Implement.** One background sub-agent per frontier ticket, max 3 at a
   time, each with `isolation: "worktree"`. Each implementer:
   - checks its worktree is on the integration branch tip, resets onto it if not;
   - runs `bun install --frozen-lockfile`;
   - builds the ticket with the `tdd` skill at the ticket's seams (none →
     stop and report, don't invent);
   - commits per logical change, no attribution lines;
   - merges the integration tip into its branch, runs `bun run verify`;
   - reports: branch, commits, verify result, anything it couldn't do.
5. **Merge.** As each implementer reports, a merger sub-agent merges its
   branch into the integration branch, fixing only trivial conflicts
   (imports, adjacent hunks), then runs `bun run verify`. A non-trivial
   conflict or a failed verify → stop and ask the user. Push. After the
   first merge, open a draft PR: `gh pr create --draft`, body lists every
   ticket as `Closes #n` plus `Part of #N`.
6. **Advance.** Each merge can widen the frontier: launch implementers for
   newly unblocked tickets, keeping the max of 3.
7. **Review.** All tickets merged → run the `change-review` skill on the
   integration branch against `origin/main`. One implementer sub-agent fixes
   every `hard`, `missing`, `wrong` and security finding (and the rest
   unless they contradict a ticket), commits, runs verify.
8. **Ready.** `bun run verify` on the integration branch passes →
   `gh pr ready`. Never push to `main`; the user merges.
9. **Clean up** every implementer worktree and its local branch.

## Output

```
spec: #<N> <title> · branch: <name>
done: #n, #n … · stuck: #n — <why> | none
review: fixed <n> · skipped: <finding — why> | none
verify: pass · pr: <url>
```

## Boundaries

Doesn't merge the PR, close issues by hand, or edit the tickets. A ticket
whose fix turns out to be a vulnerability → stop and ask before anything
about it is pushed.
