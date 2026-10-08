import type {
    AccessRule,
    AdminHost,
    AuditEntry,
    EnrollSnippet,
    SeenUser,
} from "@repo/shared";
import { Check, ChevronRight, Copy, Plus, X } from "lucide-react";
import {
    type FormEvent,
    Fragment,
    type ReactNode,
    useCallback,
    useEffect,
    useState,
} from "react";
import { Redirect, useLocation } from "wouter";
import { api } from "./api";
import { Alert, AlertDescription } from "./components/ui/alert";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card } from "./components/ui/card";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "./components/ui/dialog";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "./components/ui/table";

const VIEWS = ["hosts", "users", "audit"] as const;

const noFill = { autoComplete: "off", "data-lpignore": "true" };

const when = (t: string | number) =>
    new Date(t).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });

export function Admin() {
    const [location] = useLocation();
    const view = location.slice(1);
    const [users, setUsers] = useState<SeenUser[]>([]);
    useEffect(() => {
        api<SeenUser[]>("/api/admin/users").then(setUsers);
    }, []);
    if (!(VIEWS as readonly string[]).includes(view))
        return <Redirect to="/hosts" replace />;
    return (
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 sm:p-6">
            {view === "hosts" && <Hosts users={users} />}
            {view === "users" && <Users users={users} />}
            {view === "audit" && <Audit />}
        </div>
    );
}

function Empty({ cols, children }: { cols: number; children: ReactNode }) {
    return (
        <TableRow className="hover:bg-transparent">
            <TableCell
                colSpan={cols}
                className="py-10 text-center text-muted-foreground"
            >
                {children}
            </TableCell>
        </TableRow>
    );
}

function Groups({ groups }: { groups: string[] }) {
    return (
        <div className="flex flex-wrap gap-1">
            {groups.map((g) => (
                <Badge key={g} variant="secondary">
                    {g}
                </Badge>
            ))}
        </div>
    );
}

function Users({ users }: { users: SeenUser[] }) {
    return (
        <Card className="py-0">
            <Table>
                <TableHeader>
                    <TableRow className="hover:bg-transparent">
                        <TableHead>User</TableHead>
                        <TableHead className="hidden sm:table-cell">
                            Groups
                        </TableHead>
                        <TableHead className="text-right">Last login</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {users.length === 0 && (
                        <Empty cols={3}>No one has logged in yet.</Empty>
                    )}
                    {users.map((u) => (
                        <TableRow key={`${u.iss} ${u.sub}`}>
                            <TableCell
                                title={u.sub}
                                className="whitespace-normal"
                            >
                                <div className="font-medium break-all">
                                    {u.email ?? u.sub}
                                </div>
                                <div className="mt-1 sm:hidden">
                                    <Groups groups={u.groups} />
                                </div>
                            </TableCell>
                            <TableCell className="hidden whitespace-normal sm:table-cell">
                                <Groups groups={u.groups} />
                            </TableCell>
                            <TableCell className="text-right text-muted-foreground tabular-nums">
                                {when(u.lastLogin)}
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </Card>
    );
}

function Details({ data }: { data: Record<string, unknown> }) {
    return (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-xs">
            {Object.entries(data)
                .filter(([, v]) => v != null)
                .map(([k, v]) => (
                    <span key={k} className="break-all">
                        <span className="text-muted-foreground">{k}=</span>
                        {typeof v === "string" ? v : JSON.stringify(v)}
                    </span>
                ))}
        </div>
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
                    <TableRow className="hover:bg-transparent">
                        <TableHead className="w-0">Time</TableHead>
                        <TableHead>Event</TableHead>
                        <TableHead className="hidden sm:table-cell">
                            User
                        </TableHead>
                        <TableHead className="hidden sm:table-cell">
                            Details
                        </TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {entries.length === 0 && (
                        <Empty cols={4}>No events yet.</Empty>
                    )}
                    {entries.map(({ id, ts, event, sub, email, ...rest }) => {
                        const user = String(email ?? sub ?? "");
                        return (
                            <TableRow key={id} className="*:align-top">
                                <TableCell className="text-muted-foreground tabular-nums">
                                    {when(ts)}
                                </TableCell>
                                <TableCell className="whitespace-normal">
                                    <Badge
                                        variant="outline"
                                        className="font-mono"
                                    >
                                        {event}
                                    </Badge>
                                    <div className="mt-1 flex flex-col gap-0.5 sm:hidden">
                                        <span className="break-all">
                                            {user}
                                        </span>
                                        <Details data={rest} />
                                    </div>
                                </TableCell>
                                <TableCell
                                    title={sub ?? ""}
                                    className="hidden sm:table-cell"
                                >
                                    {user}
                                </TableCell>
                                <TableCell className="hidden min-w-64 whitespace-normal sm:table-cell">
                                    <Details data={rest} />
                                </TableCell>
                            </TableRow>
                        );
                    })}
                </TableBody>
            </Table>
        </Card>
    );
}

function Hosts({ users }: { users: SeenUser[] }) {
    const [hosts, setHosts] = useState<AdminHost[]>();
    const [error, setError] = useState("");
    const [snippets, setSnippets] = useState<Record<string, EnrollSnippet>>({});
    const [open, setOpen] = useState<string>();

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

    const showSnippet = (id: string, s: EnrollSnippet) => {
        setSnippets((all) => ({ ...all, [id]: s }));
        setOpen(id);
    };

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
            <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                    {hosts &&
                        `${hosts.length} host${hosts.length === 1 ? "" : "s"}`}
                </span>
                <AddHost onAdded={reload} />
            </div>
            <Card className="py-0">
                <Table>
                    <TableHeader>
                        <TableRow className="hover:bg-transparent">
                            <TableHead>Host</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="hidden sm:table-cell">
                                Access
                            </TableHead>
                            <TableHead className="w-0" />
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {hosts?.length === 0 && (
                            <Empty cols={4}>
                                No hosts yet. Add one to get an enroll snippet.
                            </Empty>
                        )}
                        {hosts?.map((host) => (
                            <HostRow
                                key={host.id}
                                host={host}
                                open={open === host.id}
                                onToggle={() =>
                                    setOpen(
                                        open === host.id ? undefined : host.id,
                                    )
                                }
                                snippet={snippets[host.id]}
                                onSave={(name, address) =>
                                    act(() =>
                                        api(
                                            `/api/admin/hosts/${host.id}`,
                                            "PATCH",
                                            { name, address },
                                        ),
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
                    </TableBody>
                </Table>
            </Card>
        </>
    );
}

function AddHost({ onAdded }: { onAdded: () => void }) {
    const [open, setOpen] = useState(false);
    const [name, setName] = useState("");
    const [address, setAddress] = useState("");
    const [error, setError] = useState("");
    const [snippet, setSnippet] = useState<EnrollSnippet>();
    const reset = (o: boolean) => {
        setOpen(o);
        if (o) return;
        setName("");
        setAddress("");
        setError("");
        setSnippet(undefined);
    };
    const submit = async (e: FormEvent) => {
        e.preventDefault();
        setError("");
        try {
            const { snippet, expiresAt } = await api<EnrollSnippet>(
                "/api/admin/hosts",
                "POST",
                { name: name.trim(), address: address.trim() },
            );
            setSnippet({ snippet, expiresAt });
            onAdded();
        } catch (e) {
            setError((e as Error).message);
        }
    };
    return (
        <Dialog open={open} onOpenChange={reset}>
            <DialogTrigger asChild>
                <Button>
                    <Plus />
                    Add host
                </Button>
            </DialogTrigger>
            <DialogContent className="grid-cols-[minmax(0,1fr)] sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>
                        {snippet ? `Enroll ${name.trim()}` : "Add host"}
                    </DialogTitle>
                    <DialogDescription>
                        {snippet
                            ? "Step 2 of 2: run the snippet on the host."
                            : "Step 1 of 2: name the host and where to reach it."}
                    </DialogDescription>
                </DialogHeader>
                {snippet ? (
                    <>
                        <Snippet {...snippet} />
                        <DialogFooter showCloseButton />
                    </>
                ) : (
                    <form className="flex flex-col gap-4" onSubmit={submit}>
                        {error && (
                            <Alert variant="destructive">
                                <AlertDescription>{error}</AlertDescription>
                            </Alert>
                        )}
                        <div className="flex flex-col gap-2">
                            <Label htmlFor="add-name">Name</Label>
                            <Input
                                {...noFill}
                                id="add-name"
                                placeholder="web1"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                required
                            />
                        </div>
                        <div className="flex flex-col gap-2">
                            <Label htmlFor="add-address">Address</Label>
                            <Input
                                {...noFill}
                                id="add-address"
                                placeholder="hostname or IP"
                                value={address}
                                onChange={(e) => setAddress(e.target.value)}
                                required
                            />
                        </div>
                        <DialogFooter>
                            <DialogClose asChild>
                                <Button variant="outline">Cancel</Button>
                            </DialogClose>
                            <Button type="submit">Next</Button>
                        </DialogFooter>
                    </form>
                )}
            </DialogContent>
        </Dialog>
    );
}

function Status({ enrolled }: { enrolled: boolean }) {
    return (
        <Badge
            className={
                enrolled
                    ? "bg-emerald-500/15 text-emerald-400"
                    : "bg-amber-500/15 text-amber-400"
            }
        >
            <span className="size-1.5 rounded-full bg-current" />
            {enrolled ? "enrolled" : "pending"}
        </Badge>
    );
}

function HostRow({
    host,
    open,
    onToggle,
    snippet,
    onSave,
    onSnippet,
    onAccess,
}: {
    host: AdminHost;
    open: boolean;
    onToggle: () => void;
    snippet?: EnrollSnippet;
    onSave: (name: string, address: string) => void;
    onSnippet: () => void;
    onAccess: (rules: AccessRule[]) => void;
}) {
    return (
        <Fragment>
            <TableRow
                className="cursor-pointer data-[open=true]:border-b-0 data-[open=true]:bg-muted/50"
                data-open={open}
                onClick={onToggle}
            >
                <TableCell className="whitespace-normal">
                    <button
                        type="button"
                        aria-expanded={open}
                        className="text-left outline-none focus-visible:underline"
                    >
                        <div className="font-medium">{host.name}</div>
                        <div className="font-mono text-xs break-all text-muted-foreground">
                            {host.address}
                        </div>
                    </button>
                </TableCell>
                <TableCell>
                    <Status enrolled={host.enrolled} />
                </TableCell>
                <TableCell className="hidden whitespace-normal sm:table-cell">
                    {host.access.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                    ) : (
                        <Groups
                            groups={host.access.map(
                                (r) => `${r.group} → ${r.login}`,
                            )}
                        />
                    )}
                </TableCell>
                <TableCell>
                    <ChevronRight
                        className={`size-4 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
                    />
                </TableCell>
            </TableRow>
            {open && (
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableCell
                        colSpan={4}
                        className="px-4 pt-2 pb-5 whitespace-normal"
                    >
                        <HostPanel
                            host={host}
                            snippet={snippet}
                            onSave={onSave}
                            onSnippet={onSnippet}
                            onAccess={onAccess}
                        />
                    </TableCell>
                </TableRow>
            )}
        </Fragment>
    );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className="flex flex-col gap-2">
            <h3 className="text-xs font-medium text-muted-foreground">
                {title}
            </h3>
            {children}
        </section>
    );
}

function HostPanel({
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
        <div className="flex flex-col gap-5">
            <div className="grid gap-5 md:grid-cols-2">
                <Section title="Details">
                    <form
                        className="flex flex-col gap-2"
                        onSubmit={(e) => {
                            e.preventDefault();
                            onSave(name.trim(), address.trim());
                        }}
                    >
                        <Input
                            {...noFill}
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            aria-label="name"
                            required
                        />
                        <Input
                            {...noFill}
                            value={address}
                            onChange={(e) => setAddress(e.target.value)}
                            aria-label="address"
                            required
                        />
                        <div className="flex items-center gap-2">
                            <code className="font-mono text-xs text-muted-foreground">
                                {host.id}
                            </code>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="ml-auto"
                                onClick={onSnippet}
                            >
                                {host.enrolled ? "Re-enroll" : "Enroll snippet"}
                            </Button>
                            {changed && (
                                <Button type="submit" size="sm">
                                    Save
                                </Button>
                            )}
                        </div>
                    </form>
                </Section>
                <Section title="Access">
                    <Access rules={host.access} onSave={onAccess} />
                </Section>
            </div>
            {snippet && <Snippet {...snippet} />}
        </div>
    );
}

function Snippet({ snippet, expiresAt }: EnrollSnippet) {
    const [copied, setCopied] = useState(false);
    return (
        <Section title="Enroll">
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
        </Section>
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
        <div className="flex flex-col gap-2">
            {rules.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                    No one can log in yet.
                </p>
            ) : (
                <ul className="flex flex-col divide-y rounded-lg border bg-background">
                    {rules.map((r) => (
                        <li
                            key={`${r.login}/${r.group}`}
                            className="flex items-center gap-2 py-1 pr-1 pl-3 text-sm"
                        >
                            <span className="font-medium">{r.group}</span>
                            <span className="text-muted-foreground">→</span>
                            <span className="font-mono">{r.login}</span>
                            <Button
                                variant="ghost"
                                size="icon-xs"
                                className="ml-auto"
                                aria-label={`remove ${r.group} → ${r.login}`}
                                onClick={() =>
                                    confirm(
                                        `Remove ${r.group} → ${r.login}?`,
                                    ) && onSave(rules.filter((x) => x !== r))
                                }
                            >
                                <X />
                            </Button>
                        </li>
                    ))}
                </ul>
            )}
            <form className="flex gap-2" onSubmit={add}>
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
