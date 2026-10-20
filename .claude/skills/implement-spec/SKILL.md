---
name: implement-spec
description: >
  Builds a whole parent GH issue's sub-issues on one integration branch,
  running up to 3 implementer sub-agents in parallel worktrees in
  `blocked_by` order, then reviews and opens one PR. User-invoked only:
  `/implement-spec #N`.
disable-model-invocation: true
---

Turn a parent issue and its sub-issues into one integration branch and one
PR, every ticket done.

Adapted from [mattpocock/skills](https://github.com/mattpocock/skills).
Copyright (c) 2026 Matt Pocock, MIT License: see the upstream
[LICENSE](https://github.com/mattpocock/skills/blob/main/LICENSE).

## Input

A parent issue `#N` (e.g. the `Audit <date>` parent from `/audit-to-tickets`).

- Tickets: `gh api --paginate repos/{owner}/{repo}/issues/<N>/sub_issues --jq '.[] | select(.state == "open")'`.
- Edges: `gh api repos/{owner}/{repo}/issues/<n>/dependencies/blocked_by`
  per ticket; fall back to the body's `## Blocked by` section.
- Spec: the parent body plus SPEC.md.

The tickets are a **task graph**, not a list. The **frontier** is every open
ticket whose blockers are all done: merged into the integration branch, or a
closed issue. A blocker outside this parent that's still open → report it,
don't start that ticket. A cycle → print it and stop.

Every ticket must name its seams (`## Seams` or equivalent). List the
tickets without them up front and ask the user to add them or name them
now; don't start those until they have seams.

Sec tickets live in `.audit/`, never on GH, so they're never in the graph.

## Context pointers

Talk to sub-agents in pointers: issue numbers, file paths, commit SHAs,
the notes dir. Don't paste what they can read.

## Progress

Every message to the user while it runs starts with this panel, plain code
block, no emoji or table. Bar: one cell per ticket, `█` per merged; omit
empty rows.

```
spec #<N>  [██░░░░░░░░░░░░] <merged>/<total> merged
merged:   #n #n
merging:  #n
waiting:  #n            (built, queued for the merger)
running:  #n #n #n
queued:   #n #n …
stuck:    #n — <why>
then:     review → security pass → PR
```

## Steps

1. **Read** every ticket and its edges; print the graph as
   `#n <title> ← blocked by #m, #k` and the first frontier.
2. **Explore** when 3+ tickets touch the same files, or the tickets need
   docs outside the repo. One `general-purpose` sub-agent (Explore can't
   write files) reads the code and docs and writes
   notes to `<scratchpad>/spec-<N>/notes/`. Implementers read those instead
   of re-exploring.
3. **Integration branch**: `git fetch -q origin`, then
   `git switch -c spec/<N>-<slug> origin/main` and push it. The branch
   already exists (a re-run after a stop) → switch to it; tickets already
   merged into it count as done.
4. **Implement.** One background sub-agent per frontier ticket, max 3 at a
   time, each with `isolation: "worktree"`. Each implementer:
   - checks its worktree is on the integration branch tip, resets onto it if not;
   - runs `bun install --frozen-lockfile`;
   - builds the ticket with the `tdd` skill at the ticket's seams (none →
     stop and report, don't invent);
   - commits per logical change, no attribution lines;
   - merges the integration tip into its branch, runs `bun run verify`;
   - reports: branch, commits, verify result, `vuln: yes|no` (does the fix
     reveal a vulnerability where knowing about it could get someone a
     cert, the CA key, a login or a session?), anything it couldn't do.
5. **Merge**, one at a time: a single merger sub-agent; reports that arrive
   while it runs wait in a queue. `vuln: yes` → don't merge; stop and ask the
   user (sec-ticket rules: nothing about it is pushed). Otherwise it merges
   the branch into the integration branch, fixing only trivial conflicts
   (imports, adjacent hunks), runs `bun run verify`, and pushes. A
   non-trivial conflict or a failed verify → stop and ask the user.
6. **Advance.** Each merge can widen the frontier: launch implementers for
   newly unblocked tickets, keeping the max of 3. Stop when the frontier is
   empty; tickets left unmerged are **stuck**.
7. **Review.** Run the `review-code` skill on the integration branch
   against `origin/main`. One implementer sub-agent, in its own worktree on
   the integration tip like any ticket, fixes every `hard`, `missing`,
   `wrong` and security finding (and the rest unless they contradict a
   ticket), commits, runs verify. If its commits touch `apps/api/src/`,
   `Dockerfile`, `compose*.yaml` or `.github/workflows/`, run the
   `security-reviewer` agent on just those commits and fix what it finds.
   The merger merges it as in step 5.
8. **PR.** Only now, after review and the security pass (CLAUDE.md: before
   the PR). `bun run verify:full` (verify + e2e, as CI) on the integration
   branch passes →
   `gh pr create`, body: `Part of #N` plus `Closes #n` for each **merged**
   ticket only. Any stuck ticket → `--draft`, and the body lists the stuck
   ones. Never push to `main`; the user merges.
9. **Clean up** the worktrees and local branches of merged tickets. Keep
   stuck tickets' branches and name them in the output.

## Output

```
spec: #<N> <title> · branch: <name>
done: #n, #n … · stuck: #n — <why> | none
review: fixed <n> · skipped: <finding — why> | none
verify: pass | fail · pr: <url> (ready | draft) | not opened: <why>
kept branches: <branch — #n> | none
skipped / risk: <what wasn't done or checked> | none
```

## Boundaries

Doesn't merge the PR, close issues by hand, or edit the tickets. A ticket
whose fix turns out to be a private vulnerability (`vuln: yes`) → stop and
ask before anything about it is pushed.
