import { createApp } from "./app";
import { loadConfig } from "./config";
import { openDb, prune } from "./db";
import { alerter } from "./lib/alerts";
import { lazyDiscovery } from "./lib/oidc";
import { updateChecker } from "./lib/version";
import { websocket } from "./routes/terminal";
import { ensureCa, readCaPassword } from "./ssh/ca";
import { factsCollector } from "./ssh/facts";
import type { TerminalDeps } from "./ssh/terminal";

const config = loadConfig(process.env);

const caPassword = await readCaPassword();
await ensureCa("/data/ca", process.env.CA_NAME || "certshell", caPassword);

const db = openDb("/data/app.sqlite");
prune(db, config);
setInterval(
    () => {
        try {
            prune(db, config);
        } catch (err) {
            console.warn(`prune failed: ${err}`);
        }
    },
    24 * 60 * 60_000,
);

let latestVersion: (() => string | undefined) | undefined;
if (config.updateCheck && config.version !== "dev") {
    const updates = updateChecker(config.version);
    updates.check();
    setInterval(updates.check, 12 * 60 * 60_000);
    latestVersion = updates.latest;
}

const alerts = alerter({ db, appUrl: config.appUrl, caPassword });
setInterval(alerts.checkHosts, 60_000);
const terminal: TerminalDeps = {
    db,
    caKey: "/data/ca/user_ca",
    caPassword,
    idleMs: 30 * 60_000,
    maxMs: 8 * 60 * 60_000,
    taskMs: 30 * 60_000,
    maxSessions: 64,
    maxSessionsTotal: 190,
    live: new Map(),
    tasks: new Map(),
    endedAt: new Map(),
};
const facts = factsCollector(db, terminal);
setTimeout(facts.collectDue, 60_000);
setInterval(facts.collectDue, 10 * 60_000);

const app = createApp({
    config,
    db,
    getOidc: lazyDiscovery(config),
    terminal,
    alerts,
    facts,
    latestVersion,
});

const server = Bun.serve({ port: 3000, fetch: app.fetch, websocket });
console.log(`listening on :${server.port}`);
