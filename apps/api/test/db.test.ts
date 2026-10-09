import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { MIGRATIONS, migrate, openDb } from "../src/db";

const version = (db: Database) =>
    db.query<{ user_version: number }, []>("PRAGMA user_version").get()
        ?.user_version;

const columns = (db: Database, table: string) =>
    db
        .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
        .all()
        .map((c) => c.name);

const tables = (db: Database) =>
    db
        .query<{ name: string }, []>(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all()
        .map((t) => t.name);

// What v1.0.0 left behind: its tables, user_version never set.
function v1Db() {
    const db = new Database(":memory:");
    for (const sql of MIGRATIONS[0] ?? []) db.run(sql);
    db.run("INSERT INTO hosts (id, name, address) VALUES ('h1', 'web1', 'a')");
    return db;
}

test("new DB: every step applied", () => {
    const db = openDb(":memory:");
    expect(version(db)).toBe(MIGRATIONS.length);
    expect(tables(db)).toEqual([
        "access",
        "audit",
        "enroll_tokens",
        "hosts",
        "run_hosts",
        "runs",
        "sessions",
        "signs",
        "tasks",
        "users",
    ]);
});

test("v1.0.0 DB: upgrades in place, data kept; migrating again is a no-op", () => {
    const db = v1Db();
    expect(version(db)).toBe(0);
    migrate(db);
    migrate(db);
    expect(version(db)).toBe(MIGRATIONS.length);
    expect(db.query("SELECT id, name FROM hosts").all()).toEqual([
        { id: "h1", name: "web1" },
    ]);
    expect(columns(db, "runs")).toContain("task_id");
});

test("unreleased dev DB: old runs/commands replaced, saved tasks kept", () => {
    const db = v1Db();
    db.run(
        "CREATE TABLE commands (id INTEGER PRIMARY KEY, sub TEXT, name TEXT, command TEXT)",
    );
    db.run(
        "CREATE TABLE runs (id TEXT PRIMARY KEY, sub TEXT, email TEXT, command TEXT, created_at INTEGER)",
    );
    db.run(
        "CREATE TABLE run_hosts (run_id TEXT, host_id TEXT, host_name TEXT, login TEXT, status TEXT)",
    );
    db.run(
        "CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, sub TEXT NOT NULL, name TEXT NOT NULL, script TEXT NOT NULL, targets TEXT NOT NULL)",
    );
    db.run(
        "INSERT INTO tasks (sub, name, script, targets) VALUES ('u', 'Upgrade', 'x', '[]')",
    );
    migrate(db);
    expect(tables(db)).not.toContain("commands");
    expect(columns(db, "runs")).toContain("task_id");
    expect(columns(db, "run_hosts")).toContain("exit_code");
    expect(db.query("SELECT name FROM tasks").all()).toEqual([
        { name: "Upgrade" },
    ]);
});

test("a failing step rolls back and stops at the last good version", () => {
    const db = new Database(":memory:");
    const steps = [
        ["CREATE TABLE a (x)"],
        ["CREATE TABLE b (x)", "not sql"],
        ["CREATE TABLE c (x)"],
    ];
    expect(() => migrate(db, steps)).toThrow();
    expect(version(db)).toBe(1);
    expect(tables(db)).toEqual(["a"]);
});
