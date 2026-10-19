---
name: security-audit
description: >
  Whole-repo security audit of CertShell. Like the security-reviewer agent, but
  scans the entire tree instead of a diff: a ranked list of vulnerabilities and
  spec violations. Use when the user says "security audit", "audit for
  security", "is this secure", "find vulns", "security-audit", or
  "/security-audit". Report, then grills the user on findings that need their
  call. Does not apply fixes.
---

security-reviewer, repo-wide. Scan the whole tree instead of a diff. Rank
findings most severe first.

The app **is an SSH user CA**: a web RCE or auth bypass = certs for any login
on any enrolled host. Audit accordingly.

## Sources of truth

- `SPEC.md`: §3 auth, §4 hosts/enrollment, §5 hardening + audit, §6 deployment.
- The checklist in `.claude/agents/security-reviewer.md`. Work through every
  item against the whole tree, not just recent changes.
- Never flag: §3.3 accepted risks, §9 rejected alternatives, §10 parked
  items, the dev-only `./data` bind mount, `docker.sock` on the dev `ingress`.

## Tags

- `authz:` missing/bypassable session, admin or access-map check; public route not in SPEC §5.
- `inject:` shell, argv, SQL, principal (`,`), known_hosts, header or HTML injection.
- `secret:` CA key/password, tokens or session IDs logged, returned, in argv, or stored unhashed.
- `crypto:` weak randomness, missing PKCE/state, hand-rolled JWT/token checks.
- `input:` unvalidated or unbounded input (size, type, charset).
- `expose:` stack traces, verbose errors, headers/CSP gaps, CORS, cookie flags.
- `deps:` vulnerable or unjustified dependency, unpinned image, lockfile drift.
- `harden:` container/compose hardening gap (root, writable rootfs, caps, ports).
- `spec:` code contradicts SPEC.md, or SPEC.md is out of date with deliberate code.

## Hunt

1. `git ls-files` for scope. Read every file in `apps/*/src`, `packages/*/src`,
   `Dockerfile`, `compose*.yaml`, `.dockerignore`.
2. Trace each public route (`PUBLIC_ROUTES` in `apps/api/src/app.ts`) end to end.
3. Trace every value that reaches `ssh-keygen`, `ssh`, `known_hosts`, SQL, the
   enroll snippet, or a response header.
4. Run `bun audit` and `bun run test`; report results.
5. Before emitting a finding, confirm it in the code: show the path and line,
   and a concrete input → wrong outcome. No speculative "consider adding…".

## Output

The reader is dyslexic: short. One line per finding, numbered, ranked, so the
user can say "fix 2 and 5":

```
<N>. [CRIT|HIGH|MED|LOW] <tag> <defect, ≤12 words>. <fix, ≤12 words>. [path:line]
```

End with:

```
bun audit: <result> · bun test: <N pass / M fail>
net: <C> crit, <H> high, <M> med, <L> low.
```

Nothing found: `No findings. Ship.`

## Grill

After the report, grill the user on the findings.

The decisions are the user's calls on findings: real bug or §3.3 accepted
risk, severity, fix the code or update SPEC.md, which of several fixes.

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

Then re-emit the list with each finding marked `confirmed`, `accepted`,
`dropped` or `spec`.

## Boundaries

Security only. Over-engineering, style and performance are out of scope —
route them to ponytail-audit or a normal review. Lists findings, applies
nothing.
