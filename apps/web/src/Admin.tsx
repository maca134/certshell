import type {
    AccessRule,
    AdminHost,
    AuditEntry,
    EnrollSnippet,
    SeenUser,
} from "@repo/shared";
import { Check, Copy, Plus, X } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Redirect, useLocation } from "wouter";
import { api } from "./api";
import { Alert, AlertDescription } from "./components/ui/alert";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { Input } from "./components/ui/input";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "./components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "./components/ui/tabs";

const VIEWS = ["hosts", "users", "audit"] as const;

const noFill = { autoComplete: "off", "data-lpignore": "true" };

export function Admin() {
    const [location, navigate] = useLocation();
    const view = location.slice(1);
    const [users, setUsers] = useState<SeenUser[]>([]);
    useEffect(() => {
        api<SeenUser[]>("/api/admin/users").then(setUsers);
    }, []);
    if (!(VIEWS as readonly string[]).includes(view))
        return <Redirect to="/hosts" replace />;
    return (
        <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4 sm:p-6">
            <Tabs value={view} onValueChange={(v) => navigate(`/${v}`)}>
                <TabsList>
                    {VIEWS.map((v) => (
                        <TabsTrigger key={v} value={v}>
                            {v[0]?.toUpperCase() + v.slice(1)}
                        </TabsTrigger>
                    ))}
                </TabsList>
            </Tabs>
            {view === "hosts" && <Hosts users={users} />}
            {view === "users" && <Users users={users} />}
            {view === "audit" && <Audit />}
        </div>
    );
}

function Users({ users }: { users: SeenUser[] }) {
    return (
        <Card className="py-0">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>User</TableHead>
                        <TableHead>Groups</TableHead>
                        <TableHead>Last login</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {users.map((u) => (
                        <TableRow key={`${u.iss} ${u.sub}`}>
                            <TableCell title={u.sub}>
                                {u.email ?? u.sub}
                            </TableCell>
                            <TableCell>
                                <div className="flex flex-wrap gap-1">
                                    {u.groups.map((g) => (
                                        <Badge key={g} variant="secondary">
                                            {g}
                                        </Badge>
                                    ))}
                                </div>
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                                {new Date(u.lastLogin).toLocaleString()}
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </Card>
    );
}

function Audit() {
    const [entries, setEntries] = useState<AuditEntry[]>([]);
    useEffect(() => {
        api<AuditEntry[]>("/api/admin/audit?limit=200").then(setEntries);
    }, []);
    return (
        <Card className="py-0">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Time</TableHead>
                        <TableHead>Event</TableHead>
                        <TableHead>User</TableHead>
                        <TableHead>Details</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {entries.map(({ id, ts, event, sub, email, ...rest }) => (
                        <TableRow key={id} className="align-top">
                            <TableCell className="text-muted-foreground">
                                {new Date(ts).toLocaleString()}
                            </TableCell>
                            <TableCell>
                                <Badge variant="outline" className="font-mono">
                                    {event}
                                </Badge>
                            </TableCell>
                            <TableCell title={sub ?? ""}>
                                {String(email ?? sub ?? "")}
                            </TableCell>
                            <TableCell className="min-w-64 whitespace-normal">
                                <code className="font-mono text-xs break-all text-muted-foreground">
                                    {JSON.stringify(rest)}
                                </code>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </Card>
    );
}

function Hosts({ users }: { users: SeenUser[] }) {
    const [hosts, setHosts] = useState<AdminHost[]>();
    const [error, setError] = useState("");
    const [snippets, setSnippets] = useState<Record<string, EnrollSnippet>>({});

    const reload = useCallback(
        () =>
            api<AdminHost[]>("/api/admin/hosts").then(setHosts, (e) =>
                setError(e.message),
            ),
        [],
    );
    useEffect(() => {
        reload();
    }, [reload]);

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
            {error && (
                <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            )}
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
            <ul className="flex flex-col gap-3">
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
        <Card>
            <CardHeader>
                <CardTitle>Add host</CardTitle>
            </CardHeader>
            <CardContent>
                <form
                    className="flex flex-col gap-2 sm:flex-row"
                    onSubmit={submit}
                >
                    <Input
                        {...noFill}
                        placeholder="name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                    />
                    <Input
                        {...noFill}
                        placeholder="address (hostname or IP)"
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        required
                    />
                    <Button type="submit">
                        <Plus />
                        Add host
                    </Button>
                </form>
            </CardContent>
        </Card>
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
            <Card>
                <CardContent className="flex flex-col gap-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <Input
                            {...noFill}
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            aria-label="name"
                        />
                        <Input
                            {...noFill}
                            value={address}
                            onChange={(e) => setAddress(e.target.value)}
                            aria-label="address"
                        />
                        {changed && (
                            <Button
                                onClick={() =>
                                    onSave(name.trim(), address.trim())
                                }
                            >
                                Save
                            </Button>
                        )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <Badge
                            className={
                                host.enrolled
                                    ? "bg-emerald-500/15 text-emerald-400"
                                    : "bg-amber-500/15 text-amber-400"
                            }
                        >
                            {host.enrolled ? "enrolled" : "pending"}
                        </Badge>
                        <code className="font-mono text-xs text-muted-foreground">
                            {host.id}
                        </code>
                        <Button
                            variant="outline"
                            size="sm"
                            className="ml-auto"
                            onClick={onSnippet}
                        >
                            {host.enrolled ? "Re-enroll" : "Enroll snippet"}
                        </Button>
                    </div>
                    {snippet && <Snippet {...snippet} />}
                    <Access rules={host.access} onSave={onAccess} />
                </CardContent>
            </Card>
        </li>
    );
}

function Snippet({ snippet, expiresAt }: EnrollSnippet) {
    const [copied, setCopied] = useState(false);
    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                    Run as root on the host. One-time, expires{" "}
                    {new Date(expiresAt * 1000).toLocaleTimeString()}.
                </span>
                <Button
                    variant="outline"
                    size="sm"
                    className="ml-auto"
                    onClick={() =>
                        navigator.clipboard
                            .writeText(snippet)
                            .then(() => setCopied(true))
                    }
                >
                    {copied ? <Check /> : <Copy />}
                    {copied ? "Copied" : "Copy"}
                </Button>
            </div>
            <pre className="overflow-x-auto rounded-lg bg-black p-3 font-mono text-xs">
                {snippet}
            </pre>
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
        <div className="flex flex-col gap-3 border-t pt-4">
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">Access</span>
                {rules.length === 0 && (
                    <span className="text-sm text-muted-foreground">
                        No one can log in yet.
                    </span>
                )}
                {rules.map((r) => (
                    <Badge
                        variant="secondary"
                        className="h-6 pr-0.5"
                        key={`${r.login}/${r.group}`}
                    >
                        {r.group} → {r.login}
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            className="size-5 rounded-full"
                            aria-label={`remove ${r.group} → ${r.login}`}
                            onClick={() => onSave(rules.filter((x) => x !== r))}
                        >
                            <X />
                        </Button>
                    </Badge>
                ))}
            </div>
            <form className="flex flex-col gap-2 sm:flex-row" onSubmit={add}>
                <Input
                    {...noFill}
                    placeholder="IdP group"
                    list="idp-groups"
                    value={group}
                    onChange={(e) => setGroup(e.target.value)}
                    required
                />
                <Input
                    {...noFill}
                    placeholder="login"
                    value={login}
                    onChange={(e) => setLogin(e.target.value)}
                    required
                />
                <Button type="submit" variant="secondary">
                    Allow
                </Button>
            </form>
        </div>
    );
}
