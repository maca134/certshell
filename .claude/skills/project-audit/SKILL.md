---
name: project-audit
description: >
  Whole-repo audit of CertShell, security and code quality in one pass:
  vulnerabilities, spec violations, bugs, what breaks under load, risky code
  without tests, slow paths, and what to delete, merge or split. A ranked list,
  saved to `.audit/`. Use when the user says "full audit", "audit the
  project", "audit this codebase", "security audit", "is this secure", "find
  vulns", "find bloat", "what can I delete", "project-audit", or
  "/project-audit". Report, then grills the user on findings that need their
  call. Does not apply fixes.
---

Audit the whole tree. Rank findings most severe first; at equal severity,
`sec` ranks above everything else.

The app **is an SSH user CA**: a web RCE or auth bypass = certs for any login
on any enrolled host. Audit accordingly.

## Sources of truth

- `SPEC.md`: §3 auth, §4 hosts/enrollment, §5 hardening + audit, §6 deployment.
- Never flag: §3.3 accepted risks, §9 rejected alternatives, §10 parked
  items, the dev-only `./data` bind mount, `docker.sock` on the dev `ingress`.
- `shortcut:` comments are recorded decisions, not findings.

## Areas and tags

Every finding gets `<area>:<tag>`.

- `sec:authz` missing/bypassable session, admin or access-map check; public route not in SPEC §5.
- `sec:inject` shell, argv, SQL, principal (`,`), known_hosts, header or HTML injection.
- `sec:secret` CA key/password, tokens or session IDs logged, returned, in argv, or stored unhashed.
- `sec:crypto` weak randomness, missing PKCE/state, hand-rolled JWT/token checks.
- `sec:input` unvalidated or unbounded input (size, type, charset).
- `sec:expose` stack traces, verbose errors, headers/CSP gaps, CORS, cookie flags.
- `sec:deps` vulnerable or unjustified dependency, unpinned image, lockfile drift.
- `sec:harden` container/compose hardening gap (root, writable rootfs, caps, ports).
- `sec:spec` code contradicts SPEC.md, or SPEC.md is out of date with deliberate code.
- `bug:logic` wrong result for a real input.
- `bug:error` swallowed error, missing cleanup on an error path, wrong status code.
- `load:race` concurrent requests/sockets interleave into a wrong state.
- `load:unbounded` map, queue, buffer, table or log that grows without limit.
- `load:leak` process, socket, timer, temp dir or listener never released.
- `test:missing` risky behaviour (security, data loss, state) with no test.
- `perf:slow` N+1, sync I/O on a hot path, repeated work that could be done once.
- `cut:delete` dead code, unused flexibility, speculative feature.
- `cut:stdlib` / `cut:native` hand-rolled thing Bun, the stdlib or the platform ships. Name it.
- `cut:reuse` equivalent helper already in this repo. Name the path.
- `cut:yagni` abstraction with one implementation, config nobody sets, layer with one caller.
- `cut:shrink` same logic, fewer lines. Show the shorter form.
- `cut:merge` / `cut:split` two files doing one job, or one file doing two.

## Never cut

Don't propose a `cut:` that would remove a check, validation, rate limit,
header, audit event or test that security relies on, contradict SPEC.md §3,
§5 or §6, or re-propose anything in §9.

## Security checklist

Every item, against the whole tree. Skip items for code that doesn't exist.

**Auth / session (§3.1)**
- Only `/auth/login`, `/auth/callback`, `/healthz`, `GET`/`POST /api/enroll`
  are reachable without a session (`PUBLIC_ROUTES` in `apps/api/src/app.ts`).
  Admin routes require `OIDC_ADMIN_GROUP`. Check registration order and
  middleware coverage, not just handlers.
- OIDC: auth code + PKCE (S256), `state` checked, ID token validated by the
  library. Nonce, if used, checked.
- Identity = `iss` + `sub`. **Any access decision using email is critical.**
- Groups from the ID token `groups` claim, exact compare, re-read each login.
  Session 30 min idle (slid per request), 8h absolute.
- Cookies `Secure`, `HttpOnly`, `SameSite=Lax`; session IDs from a CSPRNG.
- Scheme/origin from `APP_URL` only, never `X-Forwarded-Proto`/`Host`.
  `X-Forwarded-For` only from `TRUSTED_PROXIES`. No "is internal" IP logic.

**Cert signing (§3.2)**
- Access map checked **before** any key is generated or signed.
- Principal exactly `ws:<hostId>:<login>`, single principal. Logins match
  `^[a-z_][a-z0-9_-]*$` on write; hostIds app-generated. Nothing reaching
  `ssh-keygen -n` can contain `,`.
- `-V +15m`, `-O clear -O permit-pty`, serial recorded, key ID `email/sub/sessionId`.
- External commands via argv arrays (`Bun.spawn`/`run()`), never a shell
  string. Bun's `$` drops empty-string args: flag any `$` for `ssh-keygen`/`ssh`.
- `ssh` gets `--` before the destination, pinned `UserKnownHostsFile`,
  `StrictHostKeyChecking=yes`, no user-controlled `-o`.
- Ephemeral key dir `0700` in tmpfs, removed on every exit path.
- CA private key / password never logged, returned, or written outside `/data/ca`.

**Terminal / WebSocket**
- Upgrade requires a session and checks `Origin` against `APP_URL`.
- Idle 30 min / max 8h enforced server-side.
- Host/login from the client re-checked against the access map server-side.

**Enrollment (§4.1)**
- Admin-only snippet. Tokens: CSPRNG, single-use, 10 min, bound to one
  hostId, stored hashed, constant-time compare.
- hostId, APP_URL, CA pubkey safely quoted in the shell snippet.
- `/api/enroll` validates the host key format before storing.

**Hardening (§5, §6)**
- CSP `default-src 'self'; frame-ancestors 'none'` (no inline scripts), HSTS,
  `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`.
- Rate limits per IP on unauthenticated routes, per user on sign.
- `/healthz` returns status only. SQL parameterised. No user input in file paths.
- Errors leak no stack traces, paths or secrets.
- Audit (logins, every sign, session start/end) to **stdout** and SQLite.
- Dockerfile/compose: non-root, read-only rootfs, `cap_drop: ALL`,
  `no-new-privileges`, no `docker.sock` in the app service, ports on localhost.
- Dependencies justified, lockfile current, `--frozen-lockfile` in the image.

## Steps

1. **Map.** `git ls-files` for scope. Read README, SPEC.md, Dockerfile,
   compose files, package manifests, entry points, tests. Write down what the
   repo does, the load it should expect (users, sockets, signs/min), and the
   main flows. For each assumption a flow makes (caller is authed, input is
   bounded, dir is cleaned up), cite the line that enforces it, or mark it
   `nothing enforces this`: those are the hunt targets.
2. **Baseline.** Run `bun run verify` and `bun audit`; keep the results for
   the footer.
3. **Hunt.** Launch 4 subagents in parallel, each given the map and its
   slice of this file (tags, checklist, never-flag, never-cut):
   - `sec`: the security checklist, every public route traced end to end,
     every value reaching `ssh-keygen`, `ssh`, `known_hosts`, SQL, the enroll
     snippet or a response header.
   - `bug` + `load`: every flow in the map, error paths, concurrency,
     anything long-lived.
   - `test` + `perf`: risky code from the map vs `test/`, `apps/*/test` and `apps/web/e2e`;
     hot paths.
   - `cut`: the `cut:` tags. Before any `cut:delete`, grep the whole tree
     for the symbol, including tests, fixtures and string/dynamic references.
   Hunters collect candidates with `path:line` and a one-line claim; they
   don't judge severity.
4. **Dedup** candidates on `path:line`; merge ones with the same root cause.
5. **Verify.** Launch verifier subagents (≤15 candidates each). A verifier
   starts every candidate as **refuted** and keeps it only if it shows:
   reachable from a real entry point, input the attacker/user controls (or
   the load that triggers it), no guard on the path, and a concrete input →
   wrong outcome. For `cut:`, the grep showing zero callers or the shorter
   form. Incomplete trace = dropped.
6. **Variants.** For each survivor, grep for the same pattern elsewhere;
   fold verified hits into the same finding.
7. **Rank and cap.** Severity: CRIT = cert for a login the user shouldn't
   have, CA key exposure, RCE; HIGH = auth/authz bypass, data loss, crash
   any user can trigger; MED = needs unusual config or load, or a real bug
   with limited reach; LOW = everything else. Keep the top 20, with up to 5
   slots reserved for `cut:` findings (biggest saving first) so severity
   order can't crowd them out. Summarise the rest as a count per tag.

## Rationalizations to reject

- "It's behind auth": any signed-in user is an attacker for authz bugs.
- "Only admins hit it": admins are still bounded by SPEC.md.
- "Tests pass": tests prove what they test, nothing else.
- "This is clearly critical": LLMs overrate severity. Prove the impact.
- "Unused, so delete": not until the whole-tree grep is clean.
- "Consider adding…": not a finding. No case, no finding.

## Output

Chat: keep it short. What this repo does in one line, then one line per
finding, numbered, ranked, so the user can say "fix 2 and 5":

```
<N>. [CRIT|HIGH|MED|LOW] <area>:<tag> <defect, ≤12 words>. <fix, ≤12 words>. [path:line]
```

End with:

```
verify: <lint/typecheck/build/test pass|fail> · bun audit: <result>
net: <C> crit, <H> high, <M> med, <L> low · cuts: -<N> lines, -<M> deps
not checked: <what wasn't read, or none>
report: .audit/<YYYY-MM-DD-HHMM>.md
```

Nothing found: `No findings. Ship.`

Report file: write `.audit/<YYYY-MM-DD-HHMM>.md` (local time) with the
same header and footer, and per finding:

```
## <N>. [<SEV>] <area>:<tag> <title>

Status: open
Issue: none
Where: path:line[, path:line…]

**What this is:** <the code and what it's for, one or two sentences>
**Problem:** <concrete input → wrong outcome, or the grep proof for a cut>
**Fix:** <smallest fix; a 1–5 line snippet beats prose>
**If we skip it:** <what happens in production>
**Variants:** <other locations, or none>
```

Keep the heading, `Status:` and `Issue:` lines exactly in this shape:
`/audit-to-tickets` parses them.

## Grill

After the report, grill the user on the findings.

The decisions are the user's calls on findings: real bug or §3.3 accepted
risk, severity, fix the code or update SPEC.md, cut it or keep it, which of
several fixes, whether a cut is worth the churn.

One question per finding, never a bundle of findings. Each question stands
alone: its body restates the finding (what, where, the concrete impact) so
the user never has to scroll back to the report, and lists the choices as
(a)/(b)/(c).

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

Then set every finding's `Status:` in the report file and re-emit the chat
list with each marked:

- `confirmed`: real, fix it.
- `accepted`: real, accepted risk (§3.3) or not worth fixing.
- `dropped`: not real.
- `spec`: code is right, update SPEC.md.
- `cut`: cut it.
- `keep`: keep it.

Point the user at `/audit-to-tickets` to file them.

## Boundaries

Lists findings, applies nothing. Style and formatting are out of scope:
`bun run lint` owns them.
