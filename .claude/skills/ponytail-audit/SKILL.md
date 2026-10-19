---
name: ponytail-audit
description: >
  Whole-repo audit of CertShell for over-engineering: a ranked list of what to
  delete, simplify, or replace with stdlib/native equivalents. Use when the
  user says "audit this codebase", "audit for over-engineering", "what can I
  delete from this repo", "find bloat", "ponytail-audit", or
  "/ponytail-audit". Report, then grills the user on findings that need their
  call. Does not apply fixes.
---

Scan the whole tree for over-engineering. Rank findings biggest cut first.

## Tags

- `delete:` dead code, unused flexibility, speculative feature. Replacement: nothing.
- `stdlib:` hand-rolled thing the standard library ships. Name the function.
- `native:` dependency or code doing what the platform already does. Name the feature.
- `reuse:` equivalent helper, util, or pattern already in this repo. Name the path.
- `yagni:` abstraction with one implementation, config nobody sets, layer with one caller.
- `shrink:` same logic, fewer lines. Show the shorter form.

## Never cut

The app is an SSH user CA. Don't propose a cut that would:

- remove a check, validation, rate limit, header, audit event or test that
  security relies on;
- contradict `SPEC.md` (§3, §5, §6), or re-propose anything in §9.

## Hunt

Deps the stdlib or platform already ships, single-implementation interfaces,
factories with one product, wrappers that only delegate, files exporting one
thing, dead flags and config, hand-rolled stdlib, helpers duplicating an
equivalent that already lives in this repo.
Before emitting `delete:`, grep the whole tree for the symbol, including tests,
fixtures and string or dynamic references.

## Output

The reader is dyslexic: short. One line per finding, numbered, ranked, so the
user can say "fix 2 and 5":

```
<N>. <tag> <what to cut>. <replacement>. [path]
```

End with `net: -<N> lines, -<M> deps possible.` Nothing to cut: `Lean already. Ship.`

## Grill

After the report, grill the user on the findings.

The decisions are the user's calls on findings: cut it or keep it, which
replacement, whether a cut is worth the churn.

Interview the user relentlessly until you reach a shared understanding. Map this as a **design tree**: every decision branches into the decisions that hang off it.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled: the questions you can ask _now_ without guessing at answers you haven't heard yet. Ask the whole frontier in one round: number each question and give your recommended answer. Then wait for the user's answers before the next round.

Format a round like so:

```
❓ **Q1** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>

---

❓ **Q2** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>
```

Word each question so "yes" accepts your recommended answer.

Each round the user answers reshapes the tree: settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a _later_ round, not this one.

Finding _facts_ is your job, never the user's. When a frontier question needs a fact from the environment (filesystem, tools, etc.), dispatch a sub-agent to find it; don't ask the user for anything you could look up yourself. Don't block on it: a running exploration is an unsettled prerequisite, so only the questions downstream of it wait for the sub-agent to report; ask the rest of the frontier now. The _decisions_ are the user's: put each to them and wait.

The session is done when the frontier is empty: every branch of the design tree visited, nothing left silently assumed. Do not act on it until the user confirms you have reached a shared understanding.

Then re-emit the list with each finding marked `cut` or `keep`.

## Boundaries

Over-engineering and complexity only. Correctness bugs, security holes and
performance are out of scope — route security to `/security-audit`, the rest
to a normal review. Lists findings, applies nothing.
