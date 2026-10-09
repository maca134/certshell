import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { loadConfig } from "../src/config";
import { MIGRATIONS, migrate, openDb, prune } from "../src/db";

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

test("prune: drops audit entries and runs past their days; unset keeps all", () => {
    const db = openDb(":memory:");
    const day = 24 * 60 * 60_000;
    const old = Date.now() - 10 * day;
    for (const [ts, event] of [
        [old, "old"],
        [Date.now(), "new"],
    ] as const)
        db.run("INSERT INTO audit (ts, event, data) VALUES (?, ?, '{}')", [
            ts,
            event,
        ]);
    for (const [id, at] of [
        ["r-old", old],
        ["r-new", Date.now()],
    ] as const) {
        db.run(
            "INSERT INTO runs (id, task_id, sub, name, script, created_at) VALUES (?, 1, 's', 't', 'x', ?)",
            [id, at],
        );
        db.run(
            "INSERT INTO run_hosts (run_id, host_id, host_name, login, status) VALUES (?, 'h1', 'web1', 'root', 'ok')",
            [id],
        );
    }
    const events = () =>
        db
            .query<{ event: string }, []>("SELECT event FROM audit ORDER BY id")
            .all()
            .map((r) => r.event);
    const runs = (table: string, col: string) =>
        db.query(`SELECT ${col} AS id FROM ${table}`).all();

    prune(db, {});
    expect(events()).toEqual(["old", "new"]);
    expect(runs("runs", "id")).toHaveLength(2);

    prune(db, { auditDays: 7, runDays: 7 });
    expect(events()).toEqual(["new", "audit_prune", "run_prune"]);
    expect(runs("runs", "id")).toEqual([{ id: "r-new" }]);
    expect(runs("run_hosts", "run_id")).toEqual([{ id: "r-new" }]);
});

test("AUDIT_DAYS / RUN_DAYS: optional whole days", () => {
    const base = {
        APP_URL: "https://x",
        OIDC_ISSUER: "https://id",
        OIDC_CLIENT_ID: "a",
        OIDC_CLIENT_SECRET: "b",
    };
    expect(loadConfig(base)).toMatchObject({
        auditDays: undefined,
        runDays: undefined,
    });
    expect(
        loadConfig({ ...base, AUDIT_DAYS: "90", RUN_DAYS: "30" }),
    ).toMatchObject({ auditDays: 90, runDays: 30 });
    for (const bad of ["0", "-1", "1.5", "abc"])
        expect(() => loadConfig({ ...base, AUDIT_DAYS: bad })).toThrow(
            "AUDIT_DAYS must be a whole number of days",
        );
});
