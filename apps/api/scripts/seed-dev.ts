// Dev-only: registers the compose `ssh-target` and grants web-ssh-admins root + alice.
// Replaced by the enrollment UI in step 5. Run:
// docker compose run --rm --no-deps -T -v ./apps/api/scripts:/app/apps/api/scripts:ro --entrypoint bun web-ssh apps/api/scripts/seed-dev.ts
import { openDb } from "../src/db";
import { run } from "../src/exec";

const db = openDb("/data/app.sqlite");
const scan = await run(["ssh-keyscan", "-t", "ed25519", "ssh-target"]);
const hostKey = scan
    .split("\n")
    .find((line) => line.startsWith("ssh-target "))
    ?.slice("ssh-target ".length);
if (!hostKey) throw new Error(`no host key from ssh-keyscan: ${scan}`);

db.run(
    "INSERT OR REPLACE INTO hosts (id, name, address, host_key) VALUES (?, ?, ?, ?)",
    ["dev00001", "ssh-target", "ssh-target", hostKey],
);
for (const login of ["root", "alice"])
    db.run(
        "INSERT OR IGNORE INTO access (host_id, login, grp) VALUES (?, ?, ?)",
        ["dev00001", login, "web-ssh-admins"],
    );
console.log(`seeded dev00001 (${hostKey})`);
