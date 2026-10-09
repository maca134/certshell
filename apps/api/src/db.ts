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
    db.run(`CREATE TABLE IF NOT EXISTS commands (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sub TEXT NOT NULL,
        name TEXT NOT NULL,
        command TEXT NOT NULL
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        sub TEXT NOT NULL,
        email TEXT,
        command TEXT NOT NULL,
        created_at INTEGER NOT NULL
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS run_hosts (
        run_id TEXT NOT NULL REFERENCES runs(id),
        host_id TEXT NOT NULL,
        host_name TEXT NOT NULL,
        login TEXT NOT NULL,
        status TEXT NOT NULL,
        exit_code INTEGER,
        output TEXT NOT NULL DEFAULT '',
        finished_at INTEGER,
        PRIMARY KEY (run_id, host_id, login)
    )`);
    return db;
}
