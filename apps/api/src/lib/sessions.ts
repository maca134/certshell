import type { Database } from "bun:sqlite";
import type { User } from "@repo/shared";

export const SESSION_IDLE_SECONDS = 30 * 60;
export const SESSION_MAX_SECONDS = 8 * 3600;

export type AppEnv = { Variables: { user: User; ip: string } };

export const randomToken = () =>
    Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
        "base64url",
    );

export const hashToken = (token: string) =>
    new Bun.CryptoHasher("sha256").update(token).digest("hex");

export const now = () => Math.floor(Date.now() / 1000);

export function createSession(db: Database, user: User) {
    db.run("DELETE FROM sessions WHERE expires_at <= ?", [now()]);
    const token = randomToken();
    db.run(
        "INSERT INTO sessions (id_hash, iss, sub, email, groups, expires_at, max_expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
            hashToken(token),
            user.iss,
            user.sub,
            user.email,
            JSON.stringify(user.groups),
            now() + SESSION_IDLE_SECONDS,
            now() + SESSION_MAX_SECONDS,
        ],
    );
    return token;
}

export function getSession(
    db: Database,
    token: string | undefined,
): User | undefined {
    if (!token) return undefined;
    const row = db
        .query<
            { iss: string; sub: string; email: string | null; groups: string },
            [number, string, number]
        >(
            "UPDATE sessions SET expires_at = MIN(?, max_expires_at) WHERE id_hash = ? AND expires_at > ? RETURNING iss, sub, email, groups",
        )
        .get(now() + SESSION_IDLE_SECONDS, hashToken(token), now());
    return row ? { ...row, groups: JSON.parse(row.groups) } : undefined;
}

export function deleteSession(db: Database, token: string | undefined) {
    const user = getSession(db, token);
    if (token)
        db.run("DELETE FROM sessions WHERE id_hash = ?", [hashToken(token)]);
    return user;
}
