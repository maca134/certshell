import { Database } from "bun:sqlite";
import { audit } from "./lib/audit";

// Append only: never edit a released step. PRAGMA user_version = how many steps a DB has applied.
export const MIGRATIONS: string[][] = [
    // 1: the v1.0.0 schema. IF NOT EXISTS because v1.0.0 DBs have these tables but user_version 0.
    [
        `CREATE TABLE IF NOT EXISTS sessions (
            id_hash TEXT PRIMARY KEY,
            iss TEXT NOT NULL,
            sub TEXT NOT NULL,
            email TEXT,
            groups TEXT NOT NULL,
            expires_at INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS hosts (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            address TEXT NOT NULL,
            host_key TEXT
        )`,
        `CREATE TABLE IF NOT EXISTS enroll_tokens (
            token_hash TEXT PRIMARY KEY,
            host_id TEXT NOT NULL REFERENCES hosts(id),
            expires_at INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS access (
            host_id TEXT NOT NULL REFERENCES hosts(id),
            login TEXT NOT NULL,
            grp TEXT NOT NULL,
            PRIMARY KEY (host_id, login, grp)
        )`,
        `CREATE TABLE IF NOT EXISTS signs (
            serial INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at INTEGER NOT NULL,
            sub TEXT NOT NULL,
            email TEXT,
            principal TEXT NOT NULL,
            host_id TEXT NOT NULL,
            session_id TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS audit (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts INTEGER NOT NULL,
            event TEXT NOT NULL,
            sub TEXT,
            data TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS users (
            iss TEXT NOT NULL,
            sub TEXT NOT NULL,
            email TEXT,
            groups TEXT NOT NULL,
            last_login INTEGER NOT NULL,
            PRIMARY KEY (iss, sub)
        )`,
    ],
    // 2: tasks. Unreleased dev builds made runs/run_hosts/commands in an older shape.
    [
        "DROP TABLE IF EXISTS run_hosts",
        "DROP TABLE IF EXISTS runs",
        "DROP TABLE IF EXISTS commands",
        `CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sub TEXT NOT NULL,
            name TEXT NOT NULL,
            script TEXT NOT NULL,
            targets TEXT NOT NULL
        )`,
        `CREATE TABLE runs (
            id TEXT PRIMARY KEY,
            task_id INTEGER NOT NULL,
            sub TEXT NOT NULL,
            email TEXT,
            name TEXT NOT NULL,
            script TEXT NOT NULL,
            created_at INTEGER NOT NULL
        )`,
        `CREATE TABLE run_hosts (
            run_id TEXT NOT NULL REFERENCES runs(id),
            host_id TEXT NOT NULL,
            host_name TEXT NOT NULL,
            login TEXT NOT NULL,
            status TEXT NOT NULL,
            exit_code INTEGER,
            output TEXT NOT NULL DEFAULT '',
            finished_at INTEGER,
            PRIMARY KEY (run_id, host_id, login)
        )`,
    ],
    // 3: detached tasks.
    [
        "ALTER TABLE tasks ADD COLUMN detach INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE runs ADD COLUMN detach INTEGER NOT NULL DEFAULT 0",
    ],
];

export function migrate(db: Database, migrations = MIGRATIONS) {
    const from =
        db.query<{ user_version: number }, []>("PRAGMA user_version").get()
            ?.user_version ?? 0;
    for (let v = from; v < migrations.length; v++)
        db.transaction(() => {
            for (const sql of migrations[v] ?? []) db.run(sql);
            db.run(`PRAGMA user_version = ${v + 1}`);
        })();
}

export function openDb(path: string) {
    const db = new Database(path, { strict: true });
    db.run("PRAGMA journal_mode = WAL");
    migrate(db);
    return db;
}

const DAY_MS = 24 * 60 * 60_000;

/** Deletes audit entries and task runs older than the given days. */
export function prune(
    db: Database,
    { auditDays, runDays }: { auditDays?: number; runDays?: number },
) {
    if (auditDays) {
        const { changes } = db.run("DELETE FROM audit WHERE ts < ?", [
            Date.now() - auditDays * DAY_MS,
        ]);
        if (changes)
            audit(db, {
                event: "audit_prune",
                days: auditDays,
                deleted: changes,
            });
    }
    if (runDays) {
        const before = Date.now() - runDays * DAY_MS;
        const { changes } = db.transaction(() => {
            db.run(
                "DELETE FROM run_hosts WHERE run_id IN (SELECT id FROM runs WHERE created_at < ?)",
                [before],
            );
            return db.run("DELETE FROM runs WHERE created_at < ?", [before]);
        })();
        if (changes)
            audit(db, { event: "run_prune", days: runDays, deleted: changes });
    }
}
