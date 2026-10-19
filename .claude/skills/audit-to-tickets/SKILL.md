---
name: audit-to-tickets
description: >
  Files the findings from the latest `/project-audit` report as GitHub
  issues: a parent issue per audit with one sub-issue per ticket. Use when
  the user says "audit-to-tickets", "/audit-to-tickets", or "file the audit
  findings". Private security findings are never filed; they're written to
  local ticket files in `.audit/` instead.
disable-model-invocation: true
---

Turn the latest `.audit/*.md` report into GitHub issues on this repo.

The repo is **public**. A `sec:` finding with `Disclosure: private`
(knowing about it could get someone a cert, the CA key, a login or a
session) is **never filed**, nor its details put in any issue: it goes to a local file
(step 8) for the user to file as a security advisory. A `sec:` finding with
no `Disclosure:` line counts as private. `Disclosure: public` ones are filed
like any other finding.

## Steps

1. **Read** the newest `.audit/*.md`. Parse each `## <N>. [<SEV>] <area>:<tag> <title>`
   heading with its `Status:`, `Issue:`, `Disclosure:` and `Where:` lines.
2. **Select** findings with `Status:` `confirmed`, `spec` or `cut` and
   `Issue: none`. Set aside every private `sec:` finding. If the report
   has no statuses yet, stop: the user hasn't finished the `/project-audit` grill.
3. **Dedupe.** `gh issue list --state open --label audit --limit 200` and
   `gh issue list --state open --search "<path>"` per finding. A finding
   already covered by an open issue gets that number, not a new issue.
4. **Draft tickets.** Merge findings that one fix closes. Order them so a
   ticket comes after anything it depends on (a refactor before the fix that
   uses it). Each ticket fits one PR. Name its seams: the public boundaries
   its tests observe (a route, the WebSocket, an exported function), each
   with one line on what it catches. `cut:` tickets with no behaviour
   change: the existing tests that must stay green.
5. **Quiz the user** with the draft, numbered:

   ```
   <T>. <title> [<labels>] (findings <N>, <N>) blocked by: <T|none>
      seams: <seam — what it catches>; …
   ```

   Ask: is the granularity right (merge or split?), are the blocking edges
   and seams right, anything to drop? Iterate until the user approves. Nothing is
   published before that.
6. **Labels.** Create `audit` if missing:
   `gh label create audit --color 5319e7 --description "Found by /project-audit"`.
   Per ticket add `bug` (`bug:`, `load:`, `perf:`), `enhancement` (`test:`,
   `cut:`), `documentation` (`spec` status), `dependencies` (deps findings).
7. **Publish**, blockers first:
   - Parent: `Audit <YYYY-MM-DD>`, label `audit`, body = the report's
     what-this-repo-does line, the footer, and a checklist of ticket titles.
   - Each ticket: `gh issue create --title ... --label audit,<label> --body-file <scratchpad file>`,
     then attach it as a sub-issue of the parent:
     `gh api -X POST repos/{owner}/{repo}/issues/<parent>/sub_issues -F sub_issue_id=<ticket database id>`.
   - Blocking: `gh api -X POST repos/{owner}/{repo}/issues/<n>/dependencies/blocked_by -F issue_id=<blocker database id>`;
     if that fails, keep the `Blocked by:` line in the body.
   - Get a database id with `gh api repos/{owner}/{repo}/issues/<n> --jq .id`.
8. **Sec tickets.** For each set-aside private `sec:` finding, write the
   ticket body below to `.audit/<report-ts>/<NN>-<slug>.md` (NN = finding
   number, slug = kebab title). Never overwrite an existing file: the user may have edited it.
9. **Write back** each issue number, or sec file path, into the matching
   finding's `Issue:` line (`Issue: #<n>` / `Issue: .audit/<report-ts>/<NN>-<slug>.md`),
   so a re-run doesn't double-file.

## Ticket body

```
## Finding
<severity, area:tag, What this is + Problem from the report>
Where: path:line

## What to build
<the Fix from the report, plus anything the grill decided>

## Seams
- <seam>: <what it catches>

## Acceptance criteria
- [ ] <observable outcome, e.g. "POST /x without session → 401">
- [ ] test covering it (for bug/load/test findings)

## Blocked by
#<n> | none
```

No AI-generated note, no attribution lines.

## Output

```
parent: #<n>
<T>. #<n> <title>
sec (file via security advisories): .audit/<report-ts>/<NN>-<slug>.md … | none
already filed: <N> → #<n> | none
```

## Boundaries

Files issues and writes sec ticket files, nothing else: no code changes, no
advisories, no closing or editing existing issues.
