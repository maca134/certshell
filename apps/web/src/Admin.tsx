import type {
    AccessRule,
    AdminHost,
    AuditEntry,
    EnrollSnippet,
    SeenUser,
} from "@repo/shared";
import { type FormEvent, useEffect, useState } from "react";
import { api } from "./api";

export function Admin() {
    const [view, setView] = useState<"hosts" | "users" | "audit">("hosts");
    const [users, setUsers] = useState<SeenUser[]>([]);
    useEffect(() => {
        api<SeenUser[]>("/api/admin/users").then(setUsers);
    }, []);
    return (
        <>
            <nav className="sub">
                {(["hosts", "users", "audit"] as const).map((v) => (
                    <button
                        type="button"
                        key={v}
                        className={view === v ? "" : "link"}
                        onClick={() => setView(v)}
                    >
                        {v[0]?.toUpperCase() + v.slice(1)}
                    </button>
                ))}
            </nav>
            {view === "hosts" && <Hosts users={users} />}
            {view === "users" && <Users users={users} />}
            {view === "audit" && <Audit />}
        </>
    );
}

function Users({ users }: { users: SeenUser[] }) {
    return (
        <table>
            <thead>
                <tr>
                    <th>User</th>
                    <th>Groups</th>
                    <th>Last login</th>
                </tr>
            </thead>
            <tbody>
                {users.map((u) => (
                    <tr key={`${u.iss} ${u.sub}`}>
                        <td title={u.sub}>{u.email ?? u.sub}</td>
                        <td>{u.groups.join(", ")}</td>
                        <td>{new Date(u.lastLogin).toLocaleString()}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

function Audit() {
    const [entries, setEntries] = useState<AuditEntry[]>([]);
    useEffect(() => {
        api<AuditEntry[]>("/api/admin/audit?limit=200").then(setEntries);
    }, []);
    return (
        <table>
            <thead>
                <tr>
                    <th>Time</th>
                    <th>Event</th>
                    <th>User</th>
                    <th>Details</th>
                </tr>
            </thead>
            <tbody>
                {entries.map(({ id, ts, event, sub, email, ...rest }) => (
                    <tr key={id}>
                        <td>{new Date(ts).toLocaleString()}</td>
                        <td>{event}</td>
                        <td title={sub ?? ""}>{String(email ?? sub ?? "")}</td>
                        <td>
                            <code>{JSON.stringify(rest)}</code>
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

function Hosts({ users }: { users: SeenUser[] }) {
    const [hosts, setHosts] = useState<AdminHost[]>();
    const [error, setError] = useState("");
    const [snippets, setSnippets] = useState<Record<string, EnrollSnippet>>({});

    const reload = () =>
        api<AdminHost[]>("/api/admin/hosts").then(setHosts, (e) =>
            setError(e.message),
        );
    useEffect(() => {
        api<AdminHost[]>("/api/admin/hosts").then(setHosts, (e) =>
            setError(e.message),
        );
    }, []);

    // Every mutation: clear the error, run, reload; show failures at the top.
    const act = async (fn: () => Promise<unknown>) => {
        setError("");
        try {
            await fn();
            await reload();
        } catch (e) {
            setError((e as Error).message);
        }
    };

    const showSnippet = (id: string, s: EnrollSnippet) =>
        setSnippets((all) => ({ ...all, [id]: s }));

    const groups = [
        ...new Set([
            ...users.flatMap((u) => u.groups),
            ...(hosts ?? []).flatMap((h) => h.access.map((a) => a.group)),
        ]),
    ].sort();

    return (
        <>
            {error && <p className="error">{error}</p>}
            <datalist id="idp-groups">
                {groups.map((g) => (
                    <option key={g} value={g} />
                ))}
            </datalist>
            <AddHost
                onAdd={(name, address) =>
                    act(async () => {
                        const { id, ...s } = await api<
                            EnrollSnippet & { id: string }
                        >("/api/admin/hosts", "POST", {
                            name,
                            address,
                        });
                        showSnippet(id, s);
                    })
                }
            />
            <ul className="cards admin">
                {hosts?.map((host) => (
                    <HostCard
                        key={host.id}
                        host={host}
                        snippet={snippets[host.id]}
                        onSave={(name, address) =>
                            act(() =>
                                api(`/api/admin/hosts/${host.id}`, "PATCH", {
                                    name,
                                    address,
                                }),
                            )
                        }
                        onSnippet={() =>
                            act(async () =>
                                showSnippet(
                                    host.id,
                                    await api<EnrollSnippet>(
                                        `/api/admin/hosts/${host.id}/snippet`,
                                        "POST",
                                    ),
                                ),
                            )
                        }
                        onAccess={(rules) =>
                            act(() =>
                                api(
                                    `/api/admin/hosts/${host.id}/access`,
                                    "PUT",
                                    rules,
                                ),
                            )
                        }
                    />
                ))}
            </ul>
        </>
    );
}

function AddHost({
    onAdd,
}: {
    onAdd: (name: string, address: string) => Promise<void>;
}) {
    const [name, setName] = useState("");
    const [address, setAddress] = useState("");
    const submit = async (e: FormEvent) => {
        e.preventDefault();
        await onAdd(name.trim(), address.trim());
        setName("");
        setAddress("");
    };
    return (
        <form className="row" onSubmit={submit}>
            <input
                autoComplete="off"
                data-lpignore="true"
                placeholder="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
            />
            <input
                autoComplete="off"
                data-lpignore="true"
                placeholder="address (hostname or IP)"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                required
            />
            <button type="submit">Add host</button>
        </form>
    );
}

function HostCard({
    host,
    snippet,
    onSave,
    onSnippet,
    onAccess,
}: {
    host: AdminHost;
    snippet?: EnrollSnippet;
    onSave: (name: string, address: string) => void;
    onSnippet: () => void;
    onAccess: (rules: AccessRule[]) => void;
}) {
    const [name, setName] = useState(host.name);
    const [address, setAddress] = useState(host.address);
    const changed = name !== host.name || address !== host.address;

    return (
        <li>
            <div className="row">
                <input
                    autoComplete="off"
                    data-lpignore="true"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    aria-label="name"
                />
                <input
                    autoComplete="off"
                    data-lpignore="true"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    aria-label="address"
                />
                {changed && (
                    <button
                        type="button"
                        onClick={() => onSave(name.trim(), address.trim())}
                    >
                        Save
                    </button>
                )}
                <code className="muted">{host.id}</code>
                <span className={host.enrolled ? "ok" : "warn"}>
                    {host.enrolled ? "enrolled" : "pending"}
                </span>
                <button type="button" className="link" onClick={onSnippet}>
                    {host.enrolled ? "Re-enroll" : "Enroll snippet"}
                </button>
            </div>
            {snippet && <Snippet {...snippet} />}
            <Access rules={host.access} onSave={onAccess} />
        </li>
    );
}

function Snippet({ snippet, expiresAt }: EnrollSnippet) {
    const [copied, setCopied] = useState(false);
    return (
        <div className="snippet">
            <div className="row">
                <span className="muted">
                    Run as root on the host. One-time, expires{" "}
                    {new Date(expiresAt * 1000).toLocaleTimeString()}.
                </span>
                <button
                    type="button"
                    onClick={() =>
                        navigator.clipboard
                            .writeText(snippet)
                            .then(() => setCopied(true))
                    }
                >
                    {copied ? "Copied" : "Copy"}
                </button>
            </div>
            <pre>{snippet}</pre>
        </div>
    );
}

function Access({
    rules,
    onSave,
}: {
    rules: AccessRule[];
    onSave: (rules: AccessRule[]) => void;
}) {
    const [login, setLogin] = useState("");
    const [group, setGroup] = useState("");
    const add = (e: FormEvent) => {
        e.preventDefault();
        onSave([...rules, { login: login.trim(), group: group.trim() }]);
        setLogin("");
    };
    return (
        <div className="access">
            {rules.length === 0 && (
                <span className="muted">No one can log in yet.</span>
            )}
            {rules.map((r) => (
                <span className="chip" key={`${r.login}/${r.group}`}>
                    {r.group} → {r.login}
                    <button
                        type="button"
                        className="link"
                        aria-label={`remove ${r.group} → ${r.login}`}
                        onClick={() => onSave(rules.filter((x) => x !== r))}
                    >
                        ×
                    </button>
                </span>
            ))}
            <form className="row" onSubmit={add}>
                <input
                    autoComplete="off"
                    data-lpignore="true"
                    placeholder="IdP group"
                    list="idp-groups"
                    value={group}
                    onChange={(e) => setGroup(e.target.value)}
                    required
                />
                <input
                    autoComplete="off"
                    data-lpignore="true"
                    placeholder="login"
                    value={login}
                    onChange={(e) => setLogin(e.target.value)}
                    required
                />
                <button type="submit">Allow</button>
            </form>
        </div>
    );
}
