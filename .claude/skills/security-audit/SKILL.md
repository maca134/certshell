---
name: security-audit
description: >
  Whole-repo security audit of web-ssh. Like the security-reviewer agent, but
  scans the entire tree instead of a diff: a ranked list of vulnerabilities and
  spec violations. Use when the user says "security audit", "audit for
  security", "is this secure", "find vulns", "security-audit", or
  "/security-audit". One-shot report, does not apply fixes.
---

security-reviewer, repo-wide. Scan the whole tree instead of a diff. Rank
findings most severe first.

The app **is an SSH user CA**: a web RCE or auth bypass = certs for any login
on any enrolled host. Audit accordingly.

## Sources of truth

- `SPEC.md`: §3 auth, §4 hosts/enrollment, §5 hardening + audit, §6 deployment.
- The checklist in `.claude/agents/security-reviewer.md`. Work through every
  item against the whole tree, not just recent changes.
- Never flag: §3.3 accepted risks, §11 rejected alternatives, §12 parked
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

## Boundaries

Security only. Over-engineering, style and performance are out of scope —
route them to ponytail-audit or a normal review. Lists findings, applies
nothing. One-shot.
