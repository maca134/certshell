import * as oidc from "openid-client";
import type { Config } from "./config";

export type GetOidc = () => Promise<oidc.Configuration>;

// Lazy + retried so the app boots and serves /healthz while the IdP is down.
export function lazyDiscovery(
    config: Config,
    options?: oidc.DiscoveryRequestOptions,
): GetOidc {
    let pending: Promise<oidc.Configuration> | undefined;
    return () => {
        pending ??= oidc
            .discovery(
                config.oidcIssuer,
                config.oidcClientId,
                config.oidcClientSecret,
                undefined,
                options,
            )
            .catch((err) => {
                pending = undefined;
                throw err;
            });
        return pending;
    };
}
