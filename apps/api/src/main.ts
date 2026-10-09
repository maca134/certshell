import { createApp, websocket } from "./app";
import { ensureCa, readCaPassword } from "./ca";
import { loadConfig } from "./config";
import { openDb } from "./db";
import { lazyDiscovery } from "./oidc";
import { updateChecker } from "./version";

const config = loadConfig(process.env);

const caPassword = await readCaPassword();
await ensureCa("/data/ca", process.env.CA_NAME || "certshell", caPassword);

const db = openDb("/data/app.sqlite");

let latestVersion: (() => string | undefined) | undefined;
if (config.updateCheck && config.version !== "dev") {
    const updates = updateChecker(config.version);
    updates.check();
    setInterval(updates.check, 12 * 60 * 60_000);
    latestVersion = updates.latest;
}

const app = createApp({
    config,
    db,
    getOidc: lazyDiscovery(config),
    terminal: {
        db,
        caKey: "/data/ca/user_ca",
        caPassword,
        idleMs: 30 * 60_000,
        maxMs: 8 * 60 * 60_000,
    },
    latestVersion,
});

const server = Bun.serve({ port: 3000, fetch: app.fetch, websocket });
console.log(`listening on :${server.port}`);
