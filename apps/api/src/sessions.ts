import type { Database } from "bun:sqlite";

export const SESSION_TTL_SECONDS = 3600;

export type User = {
    iss: string;
    sub: string;
    email: string | null;
    groups: string[];
};

export type AppEnv = { Variables: { user: User; ip: string } };

export const randomToken = () =>
    Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
        "base64url",
    );

export const hashToken = (token: string) =>
    new Bun.CryptoHasher("sha256").update(token).digest("hex");

const now = () => Math.floor(Date.now() / 1000);

export function createSession(db: Database, user: User) {
    db.run("DELETE FROM sessions WHERE expires_at <= ?", [now()]);
    const token = randomToken();
    db.run(
        "INSERT INTO sessions (id_hash, iss, sub, email, groups, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
        [
            hashToken(token),
            user.iss,
            user.sub,
            user.email,
            JSON.stringify(user.groups),
            now() + SESSION_TTL_SECONDS,
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
            [string, number]
        >(
            "SELECT iss, sub, email, groups FROM sessions WHERE id_hash = ? AND expires_at > ?",
        )
        .get(hashToken(token), now());
    return row ? { ...row, groups: JSON.parse(row.groups) } : undefined;
}
