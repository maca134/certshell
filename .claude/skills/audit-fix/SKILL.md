---
name: audit-fix
description: >
  Runs /security-audit and /ponytail:ponytail-audit over the whole repo, then
  fixes what they find. Use when the user says "audit and fix", "audit-fix" or
  "/audit-fix". Edits code; does not commit.
disable-model-invocation: true
---

Two audits, one merged list, then fixes.

## 1. Audit

1. Start two `general-purpose` agents in one message so they run in parallel,
   with `run_in_background: false`:
   - one runs the `security-audit` skill and returns its numbered list
     verbatim;
   - one runs the `ponytail:ponytail-audit` skill and returns its list
     verbatim.

   Tell both: read-only, change no files, return only the list.
2. Merge into one list: security findings first (CRIT → LOW), then ponytail.
   Drop duplicates. Check each finding against the code before you fix it.

## 2. Resolve conflicts

Security wins. Skip a ponytail cut that would:

- remove a check, validation, rate limit, header, audit event or test the
  security audit relies on;
- contradict `SPEC.md` (§3, §5, §6), or re-propose anything in §9.

## 3. Ask

Before fixing anything, ask the user (AskUserQuestion) about every ambiguous
finding:

- unclear whether it's a real issue, or the two audits disagree;
- more than one reasonable fix;
- the fix needs a product decision (SPEC change, new dependency, breaking
  API/DB change).

Batch the questions, up to 4 per call, recommended option first. Skip what the
user declines, marked `skipped (user)`. If a fix turns up a new ambiguity
partway through, stop and ask.

## 4. Fix

- One finding at a time, most severe first. Smallest change that resolves it.
- Follow `CLAUDE.md`: match the code style around it, don't touch unrelated
  code, and add or adjust tests under `apps/*/test/` when the behavior changes.
- If a fix breaks tests and the cause isn't obvious, revert it and mark it
  `skipped`.

## 5. Verify

From the repo root, all of these must pass:

```
bun run test && bun run typecheck && bunx biome check && bun run build
```

Then run the `security-reviewer` agent on `git diff` so the fixes get a
security review too. Fix anything it confirms, then run the checks again.

## Output

The reader is dyslexic: keep it short. One line per finding, keeping the audit
numbering:

```
S<N>. fixed|skipped <finding, ≤10 words>. [path:line] — <reason if skipped>
P<N>. fixed|skipped ...
```

End with:

```
test: <N pass / M fail> · typecheck · lint · build: <ok|fail>
reviewer: <clean | N issues>
```

Don't commit. The user reviews the diff.
