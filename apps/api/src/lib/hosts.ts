import type { Database } from "bun:sqlite";
import type { HostSummary } from "@repo/shared";

export type Host = {
    id: string;
    name: string;
    address: string;
    host_key: string;
};

export function accessibleHosts(db: Database, groups: string[]): HostSummary[] {
    return db
        .query<{ id: string; name: string; logins: string }, [string]>(
            `SELECT h.id, h.name, json_group_array(DISTINCT a.login ORDER BY a.login) AS logins
             FROM hosts h
             JOIN access a ON a.host_id = h.id
             WHERE h.host_key IS NOT NULL
               AND a.grp IN (SELECT value FROM json_each(?))
             GROUP BY h.id
             ORDER BY h.name`,
        )
        .all(JSON.stringify(groups))
        .map((r) => ({ ...r, logins: JSON.parse(r.logins) }));
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
