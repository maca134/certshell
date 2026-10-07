import type { Database } from "bun:sqlite";
import type { HostSummary } from "@repo/shared";

export type Host = {
    id: string;
    name: string;
    address: string;
    host_key: string;
};

export function accessibleHosts(db: Database, groups: string[]): HostSummary[] {
    const rows = db
        .query<{ id: string; name: string; login: string }, [string]>(
            `SELECT DISTINCT h.id, h.name, a.login FROM hosts h
             JOIN access a ON a.host_id = h.id
             WHERE h.host_key IS NOT NULL
               AND a.grp IN (SELECT value FROM json_each(?))
             ORDER BY h.name, a.login`,
        )
        .all(JSON.stringify(groups));
    const hosts = new Map<string, HostSummary>();
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
    return (
        db
            .query<Host, [string, string, string]>(
                `SELECT h.id, h.name, h.address, h.host_key FROM hosts h
                 JOIN access a ON a.host_id = h.id
                 WHERE h.id = ? AND a.login = ? AND h.host_key IS NOT NULL
                   AND a.grp IN (SELECT value FROM json_each(?))
                 LIMIT 1`,
            )
            .get(hostId, login, JSON.stringify(groups)) ?? undefined
    );
}
