import type { Database } from "bun:sqlite";
import type { AlertChannel, AlertEvent } from "@repo/shared";
import { type AuditInput, audit, onAudit } from "./audit";
import { reachable } from "./hosts";

type Row = {
    id: number;
    name: string;
    url: string;
    service: string;
    events: string;
    tags: string;
    logins: string;
    last_sent_at: number | null;
    last_error: string | null;
};

export type Message = { title: string; body: string };

/** Audit events that alert as security events, and each one's title. `host` is the host's name. */
const SECURITY_TITLES: Record<string, (e: AuditInput, host: string) => string> =
    {
        host_create: (_, h) => `Host added: ${h}`,
        host_update: (_, h) => `Host changed: ${h}`,
        host_delete: (_, h) => `Host removed: ${h}`,
        access_update: (_, h) => `Access changed on ${h}`,
        enroll_snippet: (_, h) => `Enroll snippet issued for ${h}`,
        enroll: (_, h) => `Host enrolled: ${h}`,
        session_kill: (_, h) => `Terminal ended by an admin on ${h}`,
        user_signout: () => "User signed out by an admin",
        alert_create: (e) => `Alert channel added: ${e.name}`,
        alert_update: (e) => `Alert channel changed: ${e.name}`,
        alert_delete: (e) => `Alert channel removed: ${e.name}`,
        host_key_mismatch: (_, h) => `Host key mismatch on ${h}`,
    };

/** Sends per channel per minute; the rest are dropped with a log line. */
const PER_MINUTE = 20;
const SEND_TIMEOUT_MS = 30_000;
/** Failed port-22 checks in a row before a host counts as offline. */
const DOWN_AFTER = 2;

const proxyEnv = () =>
    Object.fromEntries(
        Object.entries(process.env).filter(
            ([k, v]) => v !== undefined && /^(https?|no)_proxy$/i.test(k),
        ),
    ) as Record<string, string>;

const decode = (s: string) => {
    try {
        return decodeURIComponent(s);
    } catch {
        return s;
    }
};

/** Userinfo, path segments and query values of `url`, decoded, longest first. */
function urlParts(url: string) {
    try {
        const u = new URL(url);
        return [u.username, u.password, ...u.pathname.split("/")]
            .map(decode)
            .concat([...u.searchParams.values()])
            .filter(Boolean)
            .sort((a, b) => b.length - a.length);
    } catch {
        return [];
    }
}

export const channelOf = (r: Row): AlertChannel => ({
    id: r.id,
    name: r.name,
    service: r.service,
    events: JSON.parse(r.events),
    tags: JSON.parse(r.tags),
    logins: JSON.parse(r.logins),
    lastSentAt: r.last_sent_at,
    lastError: r.last_error,
});

export function alerter({
    db,
    appUrl,
    caPassword,
    shoutrrr = [Bun.which("shoutrrr") ?? "shoutrrr"],
    probe = reachable,
}: {
    db: Database;
    appUrl: URL;
    caPassword: string | undefined;
    /** argv prefix; tests swap in a fake. */
    shoutrrr?: string[];
    probe?: (address: string) => Promise<boolean>;
}) {
    const key = caPassword
        ? crypto.subtle
              .importKey(
                  "raw",
                  new TextEncoder().encode(caPassword),
                  "PBKDF2",
                  false,
                  ["deriveKey"],
              )
              .then((base) =>
                  crypto.subtle.deriveKey(
                      {
                          name: "PBKDF2",
                          salt: new TextEncoder().encode(
                              "certshell-alert-urls",
                          ),
                          iterations: 200_000,
                          hash: "SHA-256",
                      },
                      base,
                      { name: "AES-GCM", length: 256 },
                      false,
                      ["encrypt", "decrypt"],
                  ),
              )
        : undefined;

    async function seal(url: string) {
        if (!key) return `plain:${url}`;
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ct = await crypto.subtle.encrypt(
            { name: "AES-GCM", iv },
            await key,
            new TextEncoder().encode(url),
        );
        return `v1:${Buffer.concat([iv, new Uint8Array(ct)]).toString("base64")}`;
    }

    async function unseal(stored: string) {
        if (stored.startsWith("plain:")) return stored.slice(6);
        if (!key)
            throw new Error("URL is encrypted but ca_password is missing");
        const blob = Buffer.from(stored.slice(3), "base64");
        const pt = await crypto.subtle
            .decrypt(
                { name: "AES-GCM", iv: blob.subarray(0, 12) },
                await key,
                blob.subarray(12),
            )
            .catch(() => {
                throw new Error(
                    "can't decrypt the URL (ca_password changed?); enter it again",
                );
            });
        return new TextDecoder().decode(pt);
    }

    const sent = new Map<number, number[]>();
    const queues = new Map<number, Promise<void>>();

    async function deliver(row: Row, msg: Message) {
        let error: string | null = null;
        let url = "";
        try {
            url = await unseal(row.url);
            const proc = Bun.spawn(
                [...shoutrrr, "send", "-t", msg.title, "-m", "-"],
                {
                    // Not all of process.env: shoutrrr needs none of our secrets.
                    env: {
                        ...proxyEnv(),
                        SHOUTRRR_URL: url,
                    },
                    stdin: new TextEncoder().encode(msg.body),
                    stdout: "ignore",
                    stderr: "pipe",
                },
            );
            const timer = setTimeout(() => proc.kill(), SEND_TIMEOUT_MS);
            const [stderr, code] = await Promise.all([
                new Response(proc.stderr).text(),
                proc.exited,
            ]);
            clearTimeout(timer);
            if (code !== 0)
                error =
                    stderr
                        .split("\n")
                        .filter(
                            (l) =>
                                l &&
                                !/^(Reading from STDIN|Read \d+ byte)/.test(l),
                        )
                        .join(" ")
                        .slice(0, 500) || `shoutrrr exited ${code}`;
        } catch (err) {
            error = (err as Error).message;
        }
        // shoutrrr's errors quote the webhook URL, token and all; the URL is write-only (SPEC §3.5).
        if (error && url) {
            error = error.replaceAll(url, "<url>");
            // ...and some (telegram, gotify) echo a malformed token on its own.
            for (const part of urlParts(url))
                error = error.replaceAll(part, "<redacted>");
        }
        error &&= error.replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"']+/gi, "<url>");
        if (error) console.warn(`alert "${row.name}" failed: ${error}`);
        db.run(
            "UPDATE alert_channels SET last_sent_at = ?, last_error = ? WHERE id = ?",
            [Date.now(), error, row.id],
        );
        return error;
    }

    /** Queues `msg` on the channel, one shoutrrr at a time per channel. Resolves with the error, if any. */
    function send(row: Row, msg: Message) {
        const recent = (sent.get(row.id) ?? []).filter(
            (t) => t > Date.now() - 60_000,
        );
        if (recent.length >= PER_MINUTE) {
            console.warn(
                `alert "${row.name}": over ${PER_MINUTE}/min, dropped: ${msg.title}`,
            );
            return Promise.resolve("rate limited");
        }
        sent.set(row.id, [...recent, Date.now()]);
        const result = (queues.get(row.id) ?? Promise.resolve()).then(() =>
            deliver(row, msg),
        );
        queues.set(
            row.id,
            result.then(() => {}),
        );
        return result;
    }

    const rows = () => db.query<Row, []>("SELECT * FROM alert_channels").all();

    const host = (id: unknown) =>
        db
            .query<{ name: string; tags: string }, [string]>(
                "SELECT name, tags FROM hosts WHERE id = ?",
            )
            .get(String(id));
    const hostName = (e: AuditInput) =>
        (e.name as string | undefined) ?? host(e.host)?.name ?? String(e.host);
    const who = (e: AuditInput) => String(e.email ?? e.sub ?? "someone");

    function securityMessage(e: AuditInput): Message {
        const lines = [
            e.event === "host_key_mismatch"
                ? `ssh refused ${hostName(e)}: its host key isn't the one recorded at enrollment. The host was reinstalled, or something else answers at its address. Re-enroll it once you know which.`
                : e.event === "enroll"
                  ? `From ${e.ip}.`
                  : `By ${who(e)}.`,
        ];
        if (e.event === "access_update")
            lines.push(
                ...(e.rules as { login: string; group: string }[]).map(
                    (r) => `${r.group} → ${r.login}`,
                ),
            );
        if (e.event === "session_kill" || e.event === "user_signout")
            lines.push(`User: ${e.user}`);
        lines.push(new URL("/admin/audit", appUrl).href);
        return {
            title: `CertShell: ${SECURITY_TITLES[e.event]?.(e, hostName(e))}`,
            body: lines.join("\n"),
        };
    }

    function taskMessage(runId: string): Message | undefined {
        const hosts = db
            .query<
                {
                    host_name: string;
                    login: string;
                    status: string;
                    exit_code: number | null;
                },
                [string]
            >(
                "SELECT host_name, login, status, exit_code FROM run_hosts WHERE run_id = ? ORDER BY host_name",
            )
            .all(runId);
        if (hosts.some((h) => h.status === "running")) return undefined;
        const failed = hosts.filter((h) => h.status === "failed");
        if (!failed.length) return undefined;
        const run = db
            .query<
                { name: string; email: string | null; sub: string },
                [string]
            >("SELECT name, email, sub FROM runs WHERE id = ?")
            .get(runId);
        return {
            title: `CertShell: task "${run?.name}" failed on ${failed.length} of ${hosts.length} host${hosts.length === 1 ? "" : "s"}`,
            body: [
                `Run by ${run?.email ?? run?.sub}.`,
                ...failed.map(
                    (h) =>
                        `${h.login}@${h.host_name}: ${h.exit_code === null ? "didn't finish" : `exit ${h.exit_code}`}`,
                ),
                new URL(`/tasks/runs/${runId}`, appUrl).href,
            ].join("\n"),
        };
    }

    function dispatch(e: AuditInput) {
        let event: AlertEvent;
        let msg: Message | undefined;
        let matches = (_c: AlertChannel) => true;
        if (Object.hasOwn(SECURITY_TITLES, e.event)) {
            event = "security";
            msg = securityMessage(e);
        } else if (e.event === "task_end") {
            event = "task_failed";
            msg = taskMessage(String(e.run));
        } else if (e.event === "host_down" || e.event === "host_up") {
            event = "host_down";
            msg = {
                title: `CertShell: ${e.name} is ${e.event === "host_down" ? "offline" : "back online"}`,
                body:
                    e.event === "host_down"
                        ? `Port 22 on ${e.address} hasn't answered for ${DOWN_AFTER} checks in a row.`
                        : `Port 22 on ${e.address} answers again.`,
            };
        } else if (e.event === "host_reboot_required") {
            event = "reboot";
            msg = {
                title: `CertShell: ${e.name} needs a reboot`,
                body: `Host facts found the reboot flag set.\n${new URL("/admin/fleet", appUrl).href}`,
            };
        } else if (e.event === "session_start") {
            event = "terminal";
            const [, hostId = "", login = ""] = String(e.principal).split(":");
            const h = host(hostId);
            const tags: string[] = h ? JSON.parse(h.tags) : [];
            matches = (c) =>
                (!c.tags.length && !c.logins.length) ||
                c.logins.includes(login) ||
                c.tags.some((t) => tags.includes(t));
            msg = {
                title: `CertShell: ${who(e)} opened ${login}@${h?.name ?? hostId}`,
                body: `Terminal session ${e.session}.`,
            };
        } else return;
        if (!msg) return;
        for (const row of rows()) {
            const c = channelOf(row);
            if (c.events.includes(event) && matches(c)) void send(row, msg);
        }
    }

    onAudit(db, dispatch);

    const state = new Map<string, { up: boolean; fails: number }>();
    let checking = false;

    /** One round of port-22 checks on enrolled hosts. Audits `host_down` / `host_up` on a change; the first check of a host only records its state. */
    async function checkHosts() {
        if (checking) return;
        checking = true;
        try {
            const hosts = db
                .query<{ id: string; name: string; address: string }, []>(
                    "SELECT id, name, address FROM hosts WHERE host_key IS NOT NULL",
                )
                .all();
            const ids = new Set(hosts.map((h) => h.id));
            for (const id of state.keys()) if (!ids.has(id)) state.delete(id);
            await Promise.all(
                hosts.map(async (h) => {
                    const up = await probe(h.address);
                    const s = state.get(h.id);
                    if (!s)
                        return state.set(h.id, {
                            up,
                            fails: up ? 0 : DOWN_AFTER,
                        });
                    if (up) {
                        s.fails = 0;
                        if (!s.up) {
                            s.up = true;
                            audit(db, {
                                event: "host_up",
                                host: h.id,
                                name: h.name,
                                address: h.address,
                            });
                        }
                    } else if (++s.fails >= DOWN_AFTER && s.up) {
                        s.up = false;
                        audit(db, {
                            event: "host_down",
                            host: h.id,
                            name: h.name,
                            address: h.address,
                        });
                    }
                }),
            );
        } finally {
            checking = false;
        }
    }

    return {
        seal,
        checkHosts,
        /** Sends a test message straight away; resolves with the error, if any. */
        test: (id: number) => {
            const row = db
                .query<Row, [number]>(
                    "SELECT * FROM alert_channels WHERE id = ?",
                )
                .get(id);
            return row
                ? send(row, {
                      title: "CertShell: test alert",
                      body: `Channel "${row.name}" works.\n${appUrl.origin}`,
                  })
                : undefined;
        },
    };
}

export type Alerter = ReturnType<typeof alerter>;
