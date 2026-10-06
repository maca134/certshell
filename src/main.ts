import { createApp } from "./app";
import { ensureCa, readCaPassword } from "./ca";
import { loadConfig } from "./config";
import { openDb } from "./db";
import { lazyDiscovery } from "./oidc";

const config = loadConfig(process.env);

await ensureCa(
    "/data/ca",
    process.env.CA_NAME || "web-ssh",
    await readCaPassword(),
);

const app = createApp({
    config,
    db: openDb("/data/app.sqlite"),
    getOidc: lazyDiscovery(config),
});

const server = Bun.serve({ port: 3000, fetch: app.fetch });
console.log(`listening on :${server.port}`);
