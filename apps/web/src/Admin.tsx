import type { AccessRule, AdminHost, EnrollSnippet } from "@repo/shared";
import { type FormEvent, useEffect, useState } from "react";
import { api } from "./api";

export function Admin() {
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

    return (
        <>
            {error && <p className="error">{error}</p>}
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
