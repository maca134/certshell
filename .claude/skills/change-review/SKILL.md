---
name: change-review
description: >
  Reviews CertShell changes since a fixed point (default `origin/main`) on
  separate axes run in parallel sub-agents: Standards (CLAUDE.md,
  CONTRIBUTING.md, code smells), Spec (does it do what the issue / SPEC.md
  asked), and Security (`security-reviewer`, when sensitive paths changed).
  Use when the user says "change-review", "/change-review", "review my
  branch", "review since X", or when `/implement` or `/implement-spec`
  calls it. Reports findings, applies nothing.
---

Review `git diff <base>...HEAD` on separate axes, side by side:

- **Standards**: does the code follow this repo's documented rules?
- **Spec**: does it do what the issue or SPEC.md asked, no more, no less?
- **Security**: does it hold SPEC.md §3, §5, §6? Only when sensitive paths changed.

A change can pass one axis and fail another. Each axis runs in its own
sub-agent so one can't mask the other.

Adapted from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT).

## Steps

1. **Pin the base.** Whatever the user named (SHA, branch, tag, `HEAD~3`),
   else `origin/main`. `git fetch -q origin`, then `git rev-parse <base>`
   must resolve and `git diff <base>...HEAD` must be non-empty; fail here,
   not in the sub-agents. If `git status --porcelain` shows changes, say they
   aren't reviewed (commit first). Note `git log <base>..HEAD --oneline`.
2. **Find the spec**, in order:
   - `#N` / `Closes #N` in commit messages or the branch's PR body
     (`gh pr view --json body`): `gh issue view <N>`, plus its parent
     (`gh api repos/{owner}/{repo}/issues/<N>/parent`) if it has one.
   - A path or `.audit/<ts>/NN-slug.md` ticket the user passed.
   - The plan agreed in this conversation.
   - Nothing → ask. "No spec" → skip the Spec axis and say so.
   SPEC.md is always context for the Spec axis.
3. **Security axis needed?** Yes if the diff touches `apps/api/src/`,
   `Dockerfile`, `compose*.yaml` or `.github/workflows/`.
4. **Spawn the axes in parallel**: launch all of them in one message and
   wait for every report before writing the output. Each prompt carries the
   diff command, commit list, its brief below, and its line format from
   Output pasted in literally (sub-agents can't see this file).
5. **Report** (see Output). Don't merge, dedupe or re-rank across axes.

## Standards brief

Sources: `CLAUDE.md`, `CONTRIBUTING.md`, the neighbouring code's patterns.
Skip anything Biome (`bun run lint`) or `tsc` enforces. A documented repo
rule beats the smells below; where the repo endorses something a smell
would flag, drop the smell.

Repo rules worth checking by hand:

- Tests come with every feature and fix, in `apps/*/test/` or `apps/web/e2e/`, ending `.test.ts`.
- No `find`/`grep` in tests (Bun `Glob` instead).
- Comments only where the next reader would otherwise spend several tool calls; a paragraph justifying a workaround means the code is wrong.
- Nothing changed beyond what was asked.
- One logical change per commit.
- Design change → SPEC.md updated in the same branch.

Smells (always `judgement`, never `hard`): Mysterious Name, Duplicated
Code, Feature Envy, Data Clumps, Primitive Obsession, Repeated Switches,
Shotgun Surgery, Divergent Change, Speculative Generality, Message Chains,
Middle Man, Refused Bequest (Fowler, _Refactoring_ ch. 3). Name the smell,
quote the hunk, give the fix.

Brief: "Report every breach of a repo rule (`hard`, cite file + rule) and
every smell (`judgement`), one line each in the format below. Under 400 words."

## Spec brief

Pass the spec contents (issue body, ticket file, or agreed plan) and SPEC.md.

Brief: "Report (a) asked-for requirements missing or partial, (b) behaviour
in the diff nobody asked for, (c) requirements that look done but are
wrong. Quote the spec line for each, one line each in the format below.
Under 400 words."

## Security axis

Launch the `security-reviewer` agent on `<base>...HEAD`. Pass its findings
through as they come.

## Output

```
## Standards
<N>. [hard|judgement] <rule or smell>: <defect>. <fix>. [path:line]

## Spec
<N>. [missing|unasked|wrong] <defect>. <fix>. [path:line] (spec: "<quote>")

## Security
<security-reviewer findings | not run: no sensitive paths changed>
```

Number findings across the whole report so the user can say "fix 2 and 5".
End with one line per axis: `<axis>: <count> findings, worst: <N>` (or
`clean`). Never pick a winner across axes.

## Boundaries

Reviews, applies nothing. Bug-hunting is the built-in `/code-review`;
whole-repo audits are `/project-audit`.
