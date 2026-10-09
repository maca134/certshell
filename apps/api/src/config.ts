export type Config = {
    appUrl: URL;
    oidcIssuer: URL;
    oidcClientId: string;
    oidcClientSecret: string;
    adminGroup: string;
    trustedProxies: Set<string>;
    version: string;
    updateCheck: boolean;
    /** Unset: kept forever. */
    auditDays?: number;
    runDays?: number;
};

export function loadConfig(env: Record<string, string | undefined>): Config {
    const need = (key: string) => {
        const value = env[key];
        if (!value) throw new Error(`${key} is required`);
        return value;
    };
    const days = (key: string) => {
        if (!env[key]) return undefined;
        const n = Number(env[key]);
        if (!Number.isInteger(n) || n < 1)
            throw new Error(`${key} must be a whole number of days`);
        return n;
    };
    return {
        appUrl: new URL(need("APP_URL")),
        oidcIssuer: new URL(need("OIDC_ISSUER")),
        oidcClientId: need("OIDC_CLIENT_ID"),
        oidcClientSecret: need("OIDC_CLIENT_SECRET"),
        adminGroup: env.OIDC_ADMIN_GROUP || "certshell-admins",
        trustedProxies: new Set(
            (env.TRUSTED_PROXIES ?? "")
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
        ),
        version: env.CERTSHELL_VERSION || "dev",
        updateCheck: env.UPDATE_CHECK !== "false",
        auditDays: days("AUDIT_DAYS"),
        runDays: days("RUN_DAYS"),
    };
}
