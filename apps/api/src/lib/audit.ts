import type { Database } from "bun:sqlite";

export type AuditInput = { event: string; sub?: string | null } & Record<
    string,
    unknown
>;

const listeners = new WeakMap<Database, (entry: AuditInput) => void>();

/** Called after each audit entry is written to `db`. One listener per DB. */
export const onAudit = (db: Database, fn: (entry: AuditInput) => void) =>
    listeners.set(db, fn);

// stdout first: an attacker in the container can rewrite the DB, not log lines already shipped.
export function audit(db: Database, entry: AuditInput) {
    const ts = Date.now();
    const line = JSON.stringify({ ts: new Date(ts).toISOString(), ...entry });
    console.log(line);
    db.run("INSERT INTO audit (ts, event, sub, data) VALUES (?, ?, ?, ?)", [
        ts,
        entry.event,
        entry.sub ?? null,
        line,
    ]);
    listeners.get(db)?.(entry);
}
