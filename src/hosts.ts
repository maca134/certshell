import type { Database } from "bun:sqlite";

export type Host = {
    id: string;
    name: string;
    address: string;
    host_key: string;
};

export function accessibleHosts(db: Database, groups: string[]) {
    if (groups.length === 0) return [];
    const rows = db
        .query<{ id: string; name: string; login: string }, string[]>(
            `SELECT DISTINCT h.id, h.name, a.login FROM hosts h
             JOIN access a ON a.host_id = h.id
             WHERE a.grp IN (${groups.map(() => "?").join(",")})
             ORDER BY h.name, a.login`,
        )
        .all(...groups);
    const hosts = new Map<
        string,
        { id: string; name: string; logins: string[] }
    >();
    for (const { id, name, login } of rows) {
        const host = hosts.get(id) ?? { id, name, logins: [] };
        host.logins.push(login);
        hosts.set(id, host);
    }
    return [...hosts.values()];
}

export function allowedHost(
    db: Database,
    hostId: string,
    login: string,
    groups: string[],
): Host | undefined {
    if (groups.length === 0) return undefined;
    return (
        db
            .query<Host, string[]>(
                `SELECT h.id, h.name, h.address, h.host_key FROM hosts h
                 JOIN access a ON a.host_id = h.id
                 WHERE h.id = ? AND a.login = ? AND a.grp IN (${groups.map(() => "?").join(",")})
                 LIMIT 1`,
            )
            .get(hostId, login, ...groups) ?? undefined
    );
}
