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
    db.run(`CREATE TABLE IF NOT EXISTS hosts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        address TEXT NOT NULL,
        host_key TEXT
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS enroll_tokens (
        token_hash TEXT PRIMARY KEY,
        host_id TEXT NOT NULL REFERENCES hosts(id),
        expires_at INTEGER NOT NULL
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS access (
        host_id TEXT NOT NULL REFERENCES hosts(id),
        login TEXT NOT NULL,
        grp TEXT NOT NULL,
        PRIMARY KEY (host_id, login, grp)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS signs (
        serial INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at INTEGER NOT NULL,
        sub TEXT NOT NULL,
        email TEXT,
        principal TEXT NOT NULL,
        host_id TEXT NOT NULL,
        session_id TEXT NOT NULL
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        event TEXT NOT NULL,
        sub TEXT,
        data TEXT NOT NULL
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS users (
        iss TEXT NOT NULL,
        sub TEXT NOT NULL,
        email TEXT,
        groups TEXT NOT NULL,
        last_login INTEGER NOT NULL,
        PRIMARY KEY (iss, sub)
    )`);
    return db;
}
