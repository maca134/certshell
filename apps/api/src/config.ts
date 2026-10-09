export type Config = {
    appUrl: URL;
    oidcIssuer: URL;
    oidcClientId: string;
    oidcClientSecret: string;
    adminGroup: string;
    trustedProxies: Set<string>;
    version: string;
};

export function loadConfig(env: Record<string, string | undefined>): Config {
    const need = (key: string) => {
        const value = env[key];
        if (!value) throw new Error(`${key} is required`);
        return value;
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
    };
}
