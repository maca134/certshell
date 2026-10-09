import { generate } from "./generate.js";

const HOST = /^[a-z0-9.-]+$/i;
const PARAMS = {
    proxy: /^(caddy|traefik|none)$/,
    idp: /^(pocket-id|external)$/,
    sshDomain: HOST,
    idDomain: HOST,
    issuer: /^https?:\/\/[\w.:/-]+$/,
    trustedProxies: /^[0-9a-f.:/, ]+$/i,
    caPassword: /^[01]$/,
};

export default {
    async fetch(req, env) {
        const url = new URL(req.url);
        if (url.pathname !== "/install") return env.ASSETS.fetch(req);
        const opts = {};
        for (const [k, v] of url.searchParams) {
            if (!Object.hasOwn(PARAMS, k) || !PARAMS[k].test(v))
                return new Response(
                    `echo "bad install parameter" >&2; exit 1\n`,
                    { status: 400 },
                );
            opts[k] = v;
        }
        opts.caPassword = opts.caPassword !== "0";
        return new Response(`set -e\n${generate(opts).script}`, {
            headers: { "content-type": "text/plain; charset=utf-8" },
        });
    },
};
