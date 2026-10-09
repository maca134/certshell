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
