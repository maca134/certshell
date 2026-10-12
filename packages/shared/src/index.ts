export type User = {
    iss: string;
    sub: string;
    email: string | null;
    groups: string[];
};

/** `update`: a newer release on GitHub, sent to admins only. */
export type Me = User & { admin: boolean; version: string; update?: string };

/** `tags`: sorted, each `[a-z0-9-]{1,32}`. */
export type HostSummary = {
    id: string;
    name: string;
    tags: string[];
    logins: string[];
};

/** Browser → server over the terminal WebSocket (JSON text frames). Server → browser is raw PTY output (binary frames). */
export type ClientMessage =
    | { t: "in"; d: string }
    | { t: "resize"; cols: number; rows: number };

export type RunTarget = { host: string; login: string };

/** A saved script and the host logins it runs on. `detach`: keeps running on the host if the connection drops. */
export type Task = {
    id: number;
    name: string;
    script: string;
    targets: RunTarget[];
    detach: boolean;
    lastRun?: RunSummary;
};

export type TaskInput = Pick<Task, "name" | "script" | "targets" | "detach">;

export type RunStatus = "running" | "ok" | "failed";

export type RunSummary = {
    id: string;
    taskId: number;
    name: string;
    createdAt: number;
    counts: Record<RunStatus, number>;
};

/** `exitCode`: null while running, or when ssh never ran or was killed. */
export type RunHost = {
    hostId: string;
    hostName: string;
    login: string;
    status: RunStatus;
    exitCode: number | null;
    output: string;
};

export type RunDetail = {
    id: string;
    taskId: number;
    name: string;
    script: string;
    detach: boolean;
    createdAt: number;
    hosts: RunHost[];
};

export type AccessRule = { login: string; group: string };

/** `factsLogin`: the login host facts are collected as; null = not collected. */
export type AdminHost = {
    id: string;
    name: string;
    address: string;
    enrolled: boolean;
    tags: string[];
    access: AccessRule[];
    factsLogin: string | null;
};

/**
 * What the facts script found; a key is missing when the host couldn't tell (e.g. no known package manager).
 * `uptime`: seconds. `disk`: % used on /. `updates`/`security`: pending package updates, from the host's package cache.
 */
export type HostFacts = {
    os?: string;
    kernel?: string;
    arch?: string;
    uptime?: number;
    reboot?: boolean;
    updates?: number;
    security?: number;
    disk?: number;
    openssh?: string;
};

/** One enrolled host's facts. `facts`: the last good collection, kept when a later one fails (`error`). */
export type HostFactsRow = {
    hostId: string;
    hostName: string;
    tags: string[];
    login: string | null;
    collectedAt: number | null;
    facts: HostFacts | null;
    error: string | null;
    collecting: boolean;
};

export type EnrollSnippet = { snippet: string; expiresAt: number };

export const ALERT_EVENTS = {
    task_failed: {
        label: "Task failed",
        description: "A task run finished with at least one failed host.",
    },
    host_down: {
        label: "Host offline",
        description:
            "A host's port 22 stopped answering (2 checks a minute apart), or answers again.",
    },
    reboot: {
        label: "Reboot needed",
        description:
            "Host facts (Fleet) show a host needs a reboot that it didn't before.",
    },
    security: {
        label: "Security",
        description:
            "Hosts, access, enrollment and alert channels changed; an admin ended sessions; a host key didn't match.",
    },
    terminal: {
        label: "Terminal opened",
        description: "Someone opened a terminal.",
    },
} as const;

export type AlertEvent = keyof typeof ALERT_EVENTS;

/**
 * A shoutrrr URL and the events sent to it. The URL is write-only: the API returns its scheme (`service`), never the URL.
 * `tags`/`logins`: the `terminal` event fires for hosts with any of these tags or logins in this list; both empty, for every terminal.
 */
export type AlertChannel = {
    id: number;
    name: string;
    service: string;
    events: AlertEvent[];
    tags: string[];
    logins: string[];
    lastSentAt: number | null;
    lastError: string | null;
};

/** `url`: required on create; on update, omitted keeps the stored one. */
export type AlertInput = Pick<
    AlertChannel,
    "name" | "events" | "tags" | "logins"
> & { url?: string };

/**
 * Someone who has logged in at least once; groups as of their last login.
 * `certs.inUse`: open terminals + running task targets. `certs.unexpired`: certs signed within the cert TTL.
 */
export type SeenUser = User & {
    lastLogin: number;
    certs: { inUse: number; unexpired: number };
};

/** An open terminal. `startedAt`: ms since epoch. */
export type LiveSession = {
    id: string;
    sub: string;
    email: string | null;
    hostId: string;
    hostName: string;
    login: string;
    startedAt: number;
};

export type AuditEntry = {
    id: number;
    ts: string;
    event: string;
    sub?: string | null;
    [key: string]: unknown;
};

/** Single-quotes `s` for sh. */
export const sq = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

/**
 * Runs `script` under nohup with its output in a host temp file, streamed back by tail.
 * When the connection drops, sshd closes the session's pipes: tail dies, the script doesn't.
 */
export const detached = (
    script: string,
) => `log=$(mktemp /tmp/certshell.XXXXXX) || exit 1
echo "[log: $log]"
nohup "\${SHELL:-/bin/sh}" -c ${sq(script)} >"$log" 2>&1 </dev/null &
pid=$!
tail -n +1 -f "$log" &
tail_pid=$!
wait $pid
rc=$?
sleep 1 # tail -f polls about once a second: let it print the last lines
kill $tail_pid 2>/dev/null
exit $rc`;

/** Sets SSH_DIR to the config dir of the sshd on PATH (OPNsense and ports OpenSSH: /usr/local/etc/ssh). */
export const SSH_DIR_SH = `case "$(command -v sshd)" in
  /usr/local/*) SSH_DIR=/usr/local/etc/ssh ;;
  *) SSH_DIR=/etc/ssh ;;
esac`;

/**
 * systemd only if actually running (containers often ship systemctl without it), else OpenRC, else FreeBSD rc, else SIGHUP.
 * systemd/FreeBSD reload only a running sshd: a stopped one (e.g. socket-activated in LXCs) reads the config when it starts.
 * Socket-activated sshd is restarted, not reloaded: on SIGHUP it tries to bind the port the socket unit holds, and exits.
 * SIGHUP uses the pidfile sshd reports (FreeBSD/OPNsense: /var/run, Linux: /run); no pidfile means sshd isn't running.
 * `sshd -T` keywords are lowercase in older OpenSSH, mixed case (PidFile) in newer: match them case-insensitively.
 */
export const RELOAD_SSHD = `if [ -d /run/systemd/system ]; then
  for u in ssh sshd; do
    if systemctl is-active -q "$u.socket"; then systemctl try-restart "$u.service"; break; fi
    if systemctl is-active -q "$u.service"; then systemctl reload "$u.service"; break; fi
  done
elif command -v rc-service >/dev/null 2>&1; then
  rc-service sshd reload
elif [ -x /etc/rc.d/sshd ] && [ "$(uname)" = FreeBSD ]; then
  if service sshd onestatus >/dev/null 2>&1; then service sshd onereload; fi
else
  PIDFILE=$(sshd -T | grep -i "^pidfile " | cut -d " " -f 2)
  if [ -f "$PIDFILE" ]; then kill -HUP "$(cat "$PIDFILE")"; fi
fi`;

/**
 * A paste-anywhere command that runs `script` in sh: each line is a single-quoted printf arg, which
 * sh, bash, csh and tcsh (root's shell on FreeBSD/OPNsense) all read the same way. csh can't end a heredoc.
 */
export function forAnyShell(script: string) {
    if (/['!]/.test(script)) throw new Error("script can't contain ' or !");
    return `printf '%s\\n' \\\n${script
        .split("\n")
        .map((l) => `  '${l}' \\\n`)
        .join("")}  | sh`;
}

/** Undoes the enroll script on the host. Run as root. */
export const REMOVAL_SNIPPET = forAnyShell(`set -eu
${SSH_DIR_SH}
rm -f "$SSH_DIR/sshd_config.d/50-certshell.conf" "$SSH_DIR/certshell_user_ca.pub"
sshd -t
${RELOAD_SSHD}`);
