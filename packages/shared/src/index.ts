export type User = {
    iss: string;
    sub: string;
    email: string | null;
    groups: string[];
};

export type Me = User & { admin: boolean };

export type HostSummary = {
    id: string;
    name: string;
    logins: string[];
};

/** Browser → server over the terminal WebSocket (JSON text frames). Server → browser is raw PTY output (binary frames). */
export type ClientMessage =
    | { t: "in"; d: string }
    | { t: "resize"; cols: number; rows: number };

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

export type AuditEntry = {
    id: number;
    ts: string;
    event: string;
    sub?: string | null;
    [key: string]: unknown;
};

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
