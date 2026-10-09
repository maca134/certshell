import type { Database } from "bun:sqlite";

// stdout first: an attacker in the container can rewrite the DB, not log lines already shipped.
export function audit(
    db: Database,
    entry: { event: string; sub?: string | null } & Record<string, unknown>,
) {
    const ts = Date.now();
    const line = JSON.stringify({ ts: new Date(ts).toISOString(), ...entry });
    console.log(line);
    db.run("INSERT INTO audit (ts, event, sub, data) VALUES (?, ?, ?, ?)", [
        ts,
        entry.event,
        entry.sub ?? null,
        line,
    ]);
}
