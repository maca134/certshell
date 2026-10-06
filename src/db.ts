import { Database } from "bun:sqlite";

export function openDb(path: string) {
    const db = new Database(path, { strict: true });
    db.run("PRAGMA journal_mode = WAL");
    db.run(`CREATE TABLE IF NOT EXISTS sessions (
        id_hash TEXT PRIMARY KEY,
        iss TEXT NOT NULL,
        sub TEXT NOT NULL,
        email TEXT,
        groups TEXT NOT NULL,
        expires_at INTEGER NOT NULL
    )`);
    return db;
}
