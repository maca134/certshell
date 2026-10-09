export type User = {
    iss: string;
    sub: string;
    email: string | null;
    groups: string[];
};

/** `update`: a newer release on GitHub, sent to admins only. */
export type Me = User & { admin: boolean; version: string; update?: string };

export type HostSummary = {
    id: string;
    name: string;
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

export type AdminHost = {
    id: string;
    name: string;
    address: string;
    enrolled: boolean;
    access: AccessRule[];
};

export type EnrollSnippet = { snippet: string; expiresAt: number };

/** Someone who has logged in at least once; groups as of their last login. */
export type SeenUser = User & { lastLogin: number };

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

/** systemd only if actually running (containers often ship systemctl without it), else OpenRC, else SIGHUP. */
export const RELOAD_SSHD = `if [ -d /run/systemd/system ]; then
  systemctl reload ssh 2>/dev/null || systemctl reload sshd
elif command -v rc-service >/dev/null 2>&1; then
  rc-service sshd reload
else
  kill -HUP "$(cat /run/sshd.pid)"
fi`;

/** Undoes the enroll script on the host. Run as root. */
export const REMOVAL_SNIPPET = `rm -f /etc/ssh/sshd_config.d/50-certshell.conf /etc/ssh/certshell_user_ca.pub
sshd -t && ${RELOAD_SSHD}`;
