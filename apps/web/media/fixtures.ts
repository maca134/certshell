import type { Page } from "@playwright/test";
import type {
    AdminHost,
    AlertChannel,
    AuditEntry,
    EnrollSnippet,
    HostFactsRow,
    HostSummary,
    LiveSession,
    Me,
    RunDetail,
    RunHost,
    SeenUser,
    Task,
} from "@repo/shared";

const min = 60_000;
const now = Date.now();
const ago = (m: number) => now - m * min;

const me = (version: string): Me => ({
    iss: "https://id.example.com",
    sub: "u1",
    email: "alice@example.com",
    groups: ["ops", "dba"],
    admin: true,
    version,
});

const adminHosts: AdminHost[] = [
    {
        id: "h1",
        name: "web1",
        address: "10.0.1.11",
        enrolled: true,
        factsLogin: "root",
        os: null,
        tags: ["edge", "prod", "web"],
        access: [
            { login: "deploy", group: "web" },
            { login: "root", group: "ops" },
        ],
    },
    {
        id: "h2",
        name: "web2",
        address: "10.0.1.12",
        enrolled: true,
        factsLogin: "root",
        os: null,
        tags: ["prod", "web"],
        access: [
            { login: "deploy", group: "web" },
            { login: "root", group: "ops" },
        ],
    },
    {
        id: "h3",
        name: "db1",
        address: "10.0.2.21",
        enrolled: true,
        factsLogin: "root",
        os: null,
        tags: ["db", "prod"],
        access: [
            { login: "postgres", group: "dba" },
            { login: "postgres", group: "ops" },
        ],
    },
    {
        id: "h4",
        name: "staging1",
        address: "10.0.3.11",
        enrolled: true,
        factsLogin: "root",
        os: null,
        tags: ["docker", "staging", "web"],
        access: [
            { login: "deploy", group: "web" },
            { login: "root", group: "ops" },
        ],
    },
    {
        id: "h5",
        name: "ci-runner",
        address: "10.0.3.40",
        enrolled: true,
        factsLogin: "root",
        os: null,
        tags: ["dev", "docker"],
        access: [{ login: "ci", group: "ops" }],
    },
    {
        id: "h6",
        name: "backup1",
        address: "10.0.3.31",
        enrolled: true,
        factsLogin: "root",
        os: null,
        tags: ["backup"],
        access: [{ login: "root", group: "ops" }],
    },
    {
        id: "h7",
        name: "monitor1",
        address: "10.0.3.50",
        enrolled: false,
        factsLogin: null,
        os: null,
        tags: [],
        access: [],
    },
];

const summaries = (): HostSummary[] =>
    adminHosts
        .filter((h) => h.enrolled)
        .map((h) => ({
            id: h.id,
            name: h.name,
            tags: h.tags,
            logins: [...new Set(h.access.map((a) => a.login))].sort(),
        }));

const status = { h1: true, h2: true, h3: true, h4: true, h5: true, h6: false };

const users: SeenUser[] = [
    {
        iss: "https://id.example.com",
        sub: "u1",
        email: "alice@example.com",
        groups: ["ops", "dba"],
        lastLogin: ago(2),
        certs: { inUse: 1, unexpired: 2 },
    },
    {
        iss: "https://id.example.com",
        sub: "u2",
        email: "bob@example.com",
        groups: ["web"],
        lastLogin: ago(47),
        certs: { inUse: 1, unexpired: 1 },
    },
    {
        iss: "https://id.example.com",
        sub: "u3",
        email: "carol@example.com",
        groups: ["dba"],
        lastLogin: ago(60 * 26),
        certs: { inUse: 0, unexpired: 0 },
    },
];

const sessions: LiveSession[] = [
    {
        id: "s1",
        sub: "u1",
        email: "alice@example.com",
        hostId: "h1",
        hostName: "web1",
        login: "root",
        startedAt: ago(3),
    },
    {
        id: "s2",
        sub: "u2",
        email: "bob@example.com",
        hostId: "h4",
        hostName: "staging1",
        login: "deploy",
        startedAt: ago(18),
    },
];

const audit: AuditEntry[] = [
    {
        id: 9,
        ts: new Date(ago(1)).toISOString(),
        event: "host_update",
        sub: "u1",
        email: "alice@example.com",
        host: "h3",
        name: "db1",
        address: "10.0.2.21",
        tags: ["db", "prod"],
    },
    {
        id: 8,
        ts: new Date(ago(2)).toISOString(),
        event: "task_run",
        sub: "u1",
        email: "alice@example.com",
        run: "r1",
        task: 2,
        script: "df -h / /var",
        targets: ["h1:deploy", "h2:deploy", "h3:postgres"],
    },
    {
        id: 7,
        ts: new Date(ago(3)).toISOString(),
        event: "sign",
        sub: "u1",
        email: "alice@example.com",
        principal: "root",
        host: "h1",
        ttl: "15m",
        serial: 1042,
    },
    {
        id: 6,
        ts: new Date(ago(4)).toISOString(),
        event: "login",
        sub: "u1",
        email: "alice@example.com",
        groups: ["ops", "dba"],
        ip: "203.0.113.7",
    },
    {
        id: 5,
        ts: new Date(ago(18)).toISOString(),
        event: "sign",
        sub: "u2",
        email: "bob@example.com",
        principal: "deploy",
        host: "h4",
        ttl: "15m",
        serial: 1041,
    },
    {
        id: 4,
        ts: new Date(ago(19)).toISOString(),
        event: "login",
        sub: "u2",
        email: "bob@example.com",
        groups: ["web"],
        ip: "198.51.100.23",
    },
    {
        id: 3,
        ts: new Date(ago(60 * 3)).toISOString(),
        event: "access_update",
        sub: "u1",
        email: "alice@example.com",
        host: "h3",
        rules: [
            { login: "postgres", group: "dba" },
            { login: "postgres", group: "ops" },
        ],
    },
    {
        id: 2,
        ts: new Date(ago(60 * 3 + 2)).toISOString(),
        event: "enroll",
        host: "h3",
        host_key: "SHA256:Qm4rT2uYbN8cVx1kLp0sDf7Hj3Zw9eAoR6iGtE5yU2M",
        ip: "10.0.2.21",
    },
    {
        id: 1,
        ts: new Date(ago(60 * 3 + 5)).toISOString(),
        event: "host_create",
        sub: "u1",
        email: "alice@example.com",
        host: "h3",
        name: "db1",
        address: "10.0.2.21",
    },
];

const DF: Record<string, string> = {
    web1: `Filesystem      Size  Used Avail Use% Mounted on
/dev/sda1        40G   29G  8.9G  77% /
/dev/sdb1       200G   61G  129G  33% /var
`,
    web2: `Filesystem      Size  Used Avail Use% Mounted on
/dev/sda1        40G   22G   16G  58% /
/dev/sdb1       200G   58G  132G  31% /var
`,
    db1: `Filesystem      Size  Used Avail Use% Mounted on
/dev/nvme0n1p2  100G   31G   64G  33% /
/dev/nvme1n1    500G  341G  134G  72% /var
`,
};

const tasks: Task[] = [
    {
        id: 1,
        name: "Upgrade packages",
        script: "apt-get update && apt-get upgrade -y",
        targets: [
            { host: "h1", login: "root" },
            { host: "h2", login: "root" },
            { host: "h4", login: "root" },
        ],
        detach: true,
        lastRun: {
            id: "r0",
            taskId: 1,
            name: "Upgrade packages",
            createdAt: ago(60 * 22),
            counts: { running: 0, ok: 3, failed: 0 },
        },
    },
    {
        id: 2,
        name: "Disk usage",
        script: "df -h / /var",
        targets: [
            { host: "h1", login: "deploy" },
            { host: "h2", login: "deploy" },
            { host: "h3", login: "postgres" },
        ],
        detach: false,
        lastRun: {
            id: "r1",
            taskId: 2,
            name: "Disk usage",
            createdAt: ago(60 * 5),
            counts: { running: 0, ok: 3, failed: 0 },
        },
    },
    {
        id: 3,
        name: "Reload nginx",
        script: "nginx -t && systemctl reload nginx",
        targets: [
            { host: "h1", login: "root" },
            { host: "h2", login: "root" },
        ],
        detach: false,
    },
];

function diskRun(id: string, done: boolean): RunDetail {
    const host = (hostId: string, login: string): RunHost => {
        const hostName = adminHosts.find((h) => h.id === hostId)?.name ?? "";
        return {
            hostId,
            hostName,
            login,
            status: done ? "ok" : "running",
            exitCode: done ? 0 : null,
            output: done ? (DF[hostName] ?? "") : "",
        };
    };
    return {
        id,
        taskId: 2,
        name: "Disk usage",
        script: "df -h / /var",
        detach: false,
        createdAt: now,
        hosts: [
            host("h1", "deploy"),
            host("h2", "deploy"),
            host("h3", "postgres"),
        ],
    };
}

const UPGRADED = `Reading package lists...
Building dependency tree...
Calculating upgrade...
The following packages will be upgraded:
  libssl3 openssl
2 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.
Setting up libssl3:amd64 (3.0.17-1~deb12u3) ...
Setting up openssl (3.0.17-1~deb12u3) ...
`;

/** Three hosts upgraded the same two packages, one also took a kernel. r0 is the past run; `done` false is a fresh one still running. */
function upgradeRun(id: string, done: boolean): RunDetail {
    const host = (hostId: string, output: string): RunHost => ({
        hostId,
        hostName: adminHosts.find((h) => h.id === hostId)?.name ?? "",
        login: "root",
        status: done ? "ok" : "running",
        exitCode: done ? 0 : null,
        output: done ? output : "",
    });
    return {
        id,
        taskId: 1,
        name: "Upgrade packages",
        script: "apt-get update && apt-get upgrade -y",
        detach: true,
        createdAt: id === "r0" ? ago(60 * 22) : now,
        hosts: [
            host("h1", UPGRADED),
            host("h2", UPGRADED),
            host("h3", UPGRADED),
            host(
                "h4",
                UPGRADED.replace(
                    "  libssl3 openssl",
                    "  libssl3 linux-image-amd64 openssl",
                )
                    .replace("2 upgraded", "3 upgraded")
                    .replace(
                        "Setting up openssl",
                        "Setting up linux-image-amd64 (6.1.153-1) ...\nSetting up openssl",
                    ),
            ),
        ],
    };
}

const facts = (
    hostId: string,
    f: HostFactsRow["facts"],
    over: Partial<HostFactsRow> = {},
): HostFactsRow => {
    const h = adminHosts.find((x) => x.id === hostId);
    return {
        hostId,
        hostName: h?.name ?? "",
        tags: h?.tags ?? [],
        login: "root",
        collectedAt: ago(42),
        facts: f,
        error: null,
        collecting: false,
        ...over,
    };
};

const debian = (o: object) => ({
    os: "Debian GNU/Linux 12 (bookworm)",
    kernel: "6.1.0-28-amd64",
    arch: "x86_64",
    openssh: "OpenSSH_9.2p1",
    ...o,
});

const fleet: HostFactsRow[] = [
    facts(
        "h1",
        debian({
            uptime: 23 * 86400 + 4 * 3600,
            reboot: true,
            updates: 14,
            security: 3,
            disk: 77,
        }),
    ),
    facts(
        "h2",
        debian({
            uptime: 23 * 86400 + 2 * 3600,
            reboot: true,
            updates: 14,
            security: 3,
            disk: 58,
        }),
    ),
    facts(
        "h3",
        debian({
            uptime: 61 * 86400,
            reboot: false,
            updates: 2,
            security: 0,
            disk: 33,
        }),
    ),
    facts("h4", {
        os: "Ubuntu 24.04.3 LTS",
        kernel: "6.8.0-85-generic",
        arch: "x86_64",
        openssh: "OpenSSH_9.6p1",
        uptime: 5 * 86400 + 7 * 3600,
        reboot: false,
        updates: 0,
        security: 0,
        disk: 41,
    }),
    facts("h5", {
        os: "Alpine Linux v3.22",
        kernel: "6.12.48-0-lts",
        arch: "aarch64",
        openssh: "OpenSSH_10.0p2",
        uptime: 9 * 86400,
        updates: 6,
        disk: 93,
    }),
    facts(
        "h6",
        debian({
            uptime: 140 * 86400,
            reboot: false,
            updates: 31,
            security: 9,
            disk: 64,
        }),
        {
            collectedAt: ago(60 * 7),
            error: "ssh: connect to host 10.0.3.31 port 22: Connection timed out",
        },
    ),
];

const alerts: AlertChannel[] = [
    {
        id: 1,
        name: "Ops phone",
        service: "ntfy",
        events: ["host_down", "reboot", "security", "terminal"],
        tags: ["prod"],
        logins: ["root"],
        lastSentAt: ago(14),
        lastError: null,
    },
    {
        id: 2,
        name: "#infra",
        service: "discord",
        events: ["task_failed", "host_down"],
        tags: [],
        logins: [],
        lastSentAt: ago(60 * 7),
        lastError: null,
    },
];

const snippet: EnrollSnippet = {
    snippet:
        "echo 'Authorization: Bearer 7f3c…' | curl -fsS -H @- 'https://ssh.example.com/api/enroll' | sh",
    windows:
        "'Authorization: Bearer 7f3c…' | curl.exe -fsS -H '@-' 'https://ssh.example.com/api/enroll?os=windows' | Out-String | Invoke-Expression",
    expiresAt: Math.floor(now / 1000) + 15 * 60,
};

const PROMPT = "\x1b[1;32mroot@web1\x1b[0m:\x1b[1;34m~\x1b[0m# ";
const SHELL: Record<string, string> = {
    uptime: " 09:41:07 up 23 days,  4:12,  1 user,  load average: 0.08, 0.12, 0.09\r\n",
    "journalctl -u ssh -n 2 --no-pager":
        "Oct 12 09:40:58 web1 sshd[48211]: \x1b[33mAccepted publickey\x1b[0m for root from 10.0.0.5 port 50412 ssh2: ED25519-CERT SHA256:Xk3qN8vT2bLwYp4rEo7HcJ1mZsUdF6gAiQyKx0n9fA ID alice@example.com/u1/t1 (serial 1042) CA ED25519 SHA256:cA7vRb3WmT9pKe2XoNz5hLyG8sJdQ1uVfI4wC6tLq2\r\n" +
        "Oct 12 09:40:58 web1 sshd[48211]: pam_unix(sshd:session): session opened for user root(uid=0)\r\n",
};

/** Fakes every /api call and the terminal socket. Host tag and alert channel edits stick, so a saved edit shows in the table. */
export async function mockApi(page: Page, version: string) {
    const json = (body: unknown) => ({ json: body });
    await page.route("/api/me", (r) => r.fulfill(json(me(version))));
    await page.route("/api/hosts", (r) => r.fulfill(json(summaries())));
    await page.route("/api/hosts/status", (r) => r.fulfill(json(status)));
    await page.route("/api/admin/users", (r) => r.fulfill(json(users)));
    await page.route("/api/admin/sessions**", (r) => r.fulfill(json(sessions)));
    await page.route("/api/admin/audit**", (r) => r.fulfill(json(audit)));
    await page.route("/api/admin/alerts**", (r) => {
        const req = r.request();
        if (req.method() === "GET") return r.fulfill(json(alerts));
        const id = Number(new URL(req.url()).pathname.split("/")[4]);
        const channel = alerts.find((c) => c.id === id);
        if (channel && req.method() === "PUT") {
            const { events, tags, logins } = req.postDataJSON();
            Object.assign(channel, { events, tags, logins });
        }
        return r.fulfill({ status: 204 });
    });
    await page.route("/api/admin/facts**", (r) =>
        r.request().method() === "GET"
            ? r.fulfill(json(fleet))
            : r.fulfill({ status: 204 }),
    );
    await page.route("/api/admin/hosts**", (r) => {
        const req = r.request();
        if (req.method() === "GET") return r.fulfill(json(adminHosts));
        if (req.url().endsWith("/snippet")) return r.fulfill(json(snippet));
        const id = new URL(req.url()).pathname.split("/")[4];
        const host = adminHosts.find((h) => h.id === id);
        if (host && req.method() === "PATCH")
            Object.assign(host, req.postDataJSON());
        return r.fulfill({ status: 204 });
    });
    await page.route("/api/tasks", (r) => r.fulfill(json(tasks)));
    await page.route("/api/tasks/runs", (r) =>
        r.fulfill(json(tasks.flatMap((t) => t.lastRun ?? []))),
    );
    // Task 1 (Upgrade packages) runs get u-ids, so their run page shows the upgrade output.
    let runs = 1;
    await page.route(/\/api\/tasks\/\d+\/run$/, (r) => {
        const task = r.request().url().split("/").at(-2);
        r.fulfill({
            status: 201,
            json: { id: `${task === "1" ? "u" : "r"}${++runs}` },
        });
    });
    const polls = new Map<string, number>();
    await page.route(/\/api\/tasks\/runs\/[ru]\d+$/, (r) => {
        const id = new URL(r.request().url()).pathname.split("/").pop() ?? "";
        const n = (polls.get(id) ?? 0) + 1;
        polls.set(id, n);
        r.fulfill(
            json(
                id === "r0" || id.startsWith("u")
                    ? upgradeRun(id, id === "r0" || n > 1)
                    : diskRun(id, id === "r1" || n > 1),
            ),
        );
    });
    await page.routeWebSocket(/\/api\/terminal/, (ws) => {
        const out = (s: string) => ws.send(Buffer.from(s));
        out(
            "Linux web1 6.1.0-28-amd64 #1 SMP PREEMPT_DYNAMIC Debian 6.1.119-1 x86_64\r\n\r\n" +
                PROMPT,
        );
        let line = "";
        ws.onMessage((m) => {
            const msg = JSON.parse(String(m));
            if (msg.t !== "in") return;
            for (const c of msg.d as string) {
                if (c === "\r") {
                    out(`\r\n${SHELL[line] ?? ""}${PROMPT}`);
                    line = "";
                } else {
                    line += c;
                    out(c);
                }
            }
        });
    });
}
