// Shapes exchanged between apps/api and apps/web.

export type Me = {
    iss: string;
    sub: string;
    email: string | null;
    groups: string[];
    admin: boolean;
};

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

export type HostInput = { name: string; address: string };

export type EnrollSnippet = { snippet: string; expiresAt: number };

export type ApiError = { error: string };
