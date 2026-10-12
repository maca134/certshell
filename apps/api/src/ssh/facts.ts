import type { Database } from "bun:sqlite";
import { rm } from "node:fs/promises";
import type { HostFacts, User } from "@repo/shared";
import { audit } from "../lib/audit";
import type { Host } from "../lib/hosts";
import { signSession, sshArgv, type TerminalDeps } from "./terminal";

export const SYSTEM_USER: User = {
    iss: "certshell",
    sub: "system",
    email: null,
    groups: [],
};

/** Collected again once older than this. */
export const FACTS_MAX_AGE_MS = 6 * 60 * 60_000;
const TIMEOUT_MS = 60_000;
const MAX_OUTPUT = 16 * 1024;
const PARALLEL = 8;

/**
 * Fed to `sh -s` on stdin, so it runs in sh whatever the login's shell is. Wrapped in main() so sh
 * reads all of it before running anything: a command reading stdin would otherwise eat the script.
 * Package counts come from the host's own package cache; nothing here refreshes it.
 */
export const FACTS_SCRIPT = `main() {
PATH=$PATH:/usr/sbin:/sbin:/usr/local/sbin
os=
if command -v opnsense-version >/dev/null 2>&1; then os=$(opnsense-version)
elif [ -r /etc/os-release ]; then os=$(. /etc/os-release; echo "\${PRETTY_NAME:-$NAME}")
fi
[ -n "$os" ] || os=$(uname -sr)
echo "os=$os"
echo "kernel=$(uname -r)"
echo "arch=$(uname -m)"
if [ -r /proc/uptime ]; then echo "uptime=$(cut -d. -f1 /proc/uptime)"
else
  b=$(sysctl -n kern.boottime 2>/dev/null | sed -n 's/.*sec = \\([0-9]*\\).*/\\1/p')
  [ -n "$b" ] && echo "uptime=$(( $(date +%s) - b ))"
fi
if [ -e /var/run/reboot-required ]; then echo reboot=1
elif command -v needs-restarting >/dev/null 2>&1; then
  needs-restarting -r >/dev/null 2>&1; [ $? -eq 1 ] && echo reboot=1 || echo reboot=0
elif command -v freebsd-version >/dev/null 2>&1; then
  [ "$(freebsd-version -k)" != "$(uname -r)" ] && echo reboot=1 || echo reboot=0
elif [ -d /var/lib/dpkg ]; then echo reboot=0
fi
if command -v apt-get >/dev/null 2>&1; then
  if ls /var/lib/apt/lists/*_Packages* >/dev/null 2>&1; then
    u=$(apt-get -s -o Debug::NoLocking=1 upgrade 2>/dev/null | grep '^Inst ')
    echo "updates=$(printf '%s' "$u" | grep -c .)"
    echo "security=$(printf '%s' "$u" | grep -ci security)"
  fi
elif command -v dnf >/dev/null 2>&1; then
  u=$(dnf -q -C check-update 2>/dev/null); s=$?
  if [ $s -ne 1 ]; then
    echo "updates=$(printf '%s\n' "$u" | awk 'NF==3' | wc -l)"
    echo "security=$(dnf -q -C updateinfo list --security 2>/dev/null | awk 'NF>=3' | wc -l)"
  fi
elif command -v apk >/dev/null 2>&1; then
  echo "updates=$(apk -s upgrade 2>/dev/null | grep -c Upgrading)"
elif command -v pkg >/dev/null 2>&1; then
  echo "updates=$(pkg version -qRUl '<' 2>/dev/null | wc -l)"
fi
echo "disk=$(df -P / | awk 'NR==2 { sub("%", "", $5); print $5 }')"
echo "openssh=$( (sshd -V; ssh -V) 2>&1 | grep -o 'OpenSSH_[^ ,]*' | head -n 1)"
}
main </dev/null
`;

const TEXT = /^[^\p{Cc}]{1,200}$/u;
const NUM = /^\d{1,12}$/;

/** Known `key=value` lines from the script's output; anything else is ignored. */
export function parseFacts(output: string): HostFacts {
    const facts: HostFacts = {};
    for (const line of output.split("\n")) {
        const i = line.indexOf("=");
        const key = line.slice(0, i);
        const value = line.slice(i + 1).trim();
        if (i < 1 || !value) continue;
        if (
            (key === "os" ||
                key === "kernel" ||
                key === "arch" ||
                key === "openssh") &&
            TEXT.test(value)
        )
            facts[key] = value;
        else if (
            (key === "uptime" ||
                key === "updates" ||
                key === "security" ||
                key === "disk") &&
            NUM.test(value)
        )
            facts[key] = Number(value);
        else if (key === "reboot" && (value === "0" || value === "1"))
            facts.reboot = value === "1";
    }
    return facts;
}

export function factsCollector(db: Database, terminal: TerminalDeps) {
    const collecting = new Set<string>();

    async function run(host: Host, login: string) {
        const s = await signSession(terminal, SYSTEM_USER, host, login, "-", {
            pty: false,
            system: true,
        });
        try {
            const proc = Bun.spawn(
                sshArgv(terminal, {
                    key: s.key,
                    knownHosts: s.knownHosts,
                    login,
                    host,
                    remote: "sh -s",
                }),
                {
                    stdin: new TextEncoder().encode(FACTS_SCRIPT),
                    stdout: "pipe",
                    stderr: "pipe",
                },
            );
            const timer = setTimeout(() => proc.kill(), TIMEOUT_MS);
            const [out, err, code] = await Promise.all([
                new Response(proc.stdout).text(),
                new Response(proc.stderr).text(),
                proc.exited,
            ]);
            clearTimeout(timer);
            const facts = parseFacts(out.slice(0, MAX_OUTPUT));
            if (!Object.keys(facts).length)
                throw new Error(
                    err.trim().split("\n").at(-1)?.slice(0, 300) ||
                        `ssh exited ${code}`,
                );
            return facts;
        } finally {
            await rm(s.dir, { recursive: true, force: true });
        }
    }

    /** Collects one host's facts now. Resolves once stored; false if the host has no facts login. */
    async function collect(hostId: string) {
        const row = db
            .query<Host & { facts_login: string | null }, [string]>(
                "SELECT id, name, address, host_key, facts_login FROM hosts WHERE id = ? AND host_key IS NOT NULL",
            )
            .get(hostId);
        if (!row?.facts_login || collecting.has(hostId))
            return !!row?.facts_login;
        const { facts_login: login, ...host } = row;
        collecting.add(hostId);
        let facts: HostFacts | null = null;
        let error: string | null = null;
        try {
            facts = await run(host, login);
        } catch (err) {
            error = (err as Error).message;
        } finally {
            collecting.delete(hostId);
        }
        db.run(
            `INSERT INTO host_facts (host_id, login, collected_at, facts, error) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (host_id) DO UPDATE SET login = excluded.login, collected_at = excluded.collected_at,
               facts = coalesce(excluded.facts, facts), error = excluded.error`,
            [hostId, login, Date.now(), facts && JSON.stringify(facts), error],
        );
        audit(db, {
            event: "facts",
            sub: SYSTEM_USER.sub,
            host: hostId,
            login,
            error: error ?? undefined,
        });
        return true;
    }

    /** Collects hosts in `ids`, PARALLEL at a time. */
    async function collectAll(ids: string[]) {
        const queue = [...ids];
        await Promise.all(
            Array.from({ length: PARALLEL }, async () => {
                for (let id = queue.shift(); id; id = queue.shift())
                    await collect(id);
            }),
        );
    }

    /** Hosts with a facts login whose facts are missing or older than FACTS_MAX_AGE_MS. */
    const due = () =>
        db
            .query<{ id: string }, [number]>(
                `SELECT h.id FROM hosts h LEFT JOIN host_facts f ON f.host_id = h.id
                 WHERE h.facts_login IS NOT NULL AND h.host_key IS NOT NULL
                   AND (f.collected_at IS NULL OR f.collected_at < ? OR f.login != h.facts_login)`,
            )
            .all(Date.now() - FACTS_MAX_AGE_MS)
            .map((r) => r.id);

    return {
        collect,
        collectAll,
        collectDue: () => collectAll(due()),
        isCollecting: (hostId: string) => collecting.has(hostId),
    };
}

export type FactsCollector = ReturnType<typeof factsCollector>;
