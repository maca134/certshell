import type {
    AccessRule,
    AdminHost,
    AuditEntry,
    EnrollSnippet,
    SeenUser,
} from "@repo/shared";
import { cn } from "cn";
import {
    Check,
    ChevronRight,
    Copy,
    Plus,
    ScrollText,
    Server,
    Users as UsersIcon,
    X,
} from "lucide-react";
import {
    type FormEvent,
    type ReactNode,
    useCallback,
    useEffect,
    useState,
} from "react";
import { Redirect, useLocation } from "wouter";
import { api } from "./api";
import { Avatar, EmptyState, HostIcon, Page } from "./components/layout";
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

const RTF = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const UNITS = [
    ["year", 31536e6],
    ["month", 2592e6],
    ["week", 6048e5],
    ["day", 864e5],
    ["hour", 36e5],
    ["minute", 6e4],
] as const;

function When({ t }: { t: string | number }) {
    const d = new Date(t);
    const ago = d.getTime() - Date.now();
    const [unit, ms] = UNITS.find(([, ms]) => Math.abs(ago) >= ms) ?? [
        "second",
        1000,
    ];
    return (
        <time
            dateTime={d.toISOString()}
            title={d.toLocaleString()}
            className="whitespace-nowrap text-muted-foreground tabular-nums"
        >
            {unit === "second"
                ? "just now"
                : RTF.format(Math.round(ago / ms), unit)}
        </time>
    );
}

export function Admin() {
    const [location] = useLocation();
    const view = location.slice(1);
    const [users, setUsers] = useState<SeenUser[]>([]);
    useEffect(() => {
        api<SeenUser[]>("/api/admin/users").then(setUsers);
    }, []);
    if (!(VIEWS as readonly string[]).includes(view))
        return <Redirect to="/hosts" replace />;
    if (view === "hosts") return <Hosts users={users} />;
    if (view === "users") return <Users users={users} />;
    return <Audit />;
}

function Empty({ cols, children }: { cols: number; children: ReactNode }) {
    return (
        <TableRow className="hover:bg-transparent">
            <TableCell colSpan={cols} className="whitespace-normal">
                {children}
            </TableCell>
        </TableRow>
    );
}

function Head({ children }: { children: ReactNode }) {
    return (
        <TableHeader className="bg-muted/50 [&_th]:h-9 [&_th]:text-xs [&_th]:font-medium [&_th]:text-muted-foreground [&_th:first-child]:pl-4 [&_th:last-child]:pr-4">
            <TableRow className="hover:bg-transparent">{children}</TableRow>
        </TableHeader>
    );
}

const tableBody = "[&_td]:py-3 [&_td:first-child]:pl-4 [&_td:last-child]:pr-4";

function Groups({ groups }: { groups: string[] }) {
    return (
        <div className="flex flex-wrap gap-1">
            {groups.map((g) => (
                <Badge key={g} variant="secondary" className="font-normal">
                    {g}
                </Badge>
            ))}
        </div>
    );
}

function Users({ users }: { users: SeenUser[] }) {
    return (
        <Page
            title="Users"
            description="Everyone who has signed in, with their groups as of their last sign-in."
        >
            <Card className="py-0">
                <Table>
                    <Head>
                        <TableHead>User</TableHead>
                        <TableHead className="hidden sm:table-cell">
                            Groups
                        </TableHead>
                        <TableHead className="text-right">
                            Last sign-in
                        </TableHead>
                    </Head>
                    <TableBody className={tableBody}>
                        {users.length === 0 && (
                            <Empty cols={3}>
                                <EmptyState
                                    icon={UsersIcon}
                                    title="No users yet"
                                >
                                    People appear here after their first
                                    sign-in.
                                </EmptyState>
                            </Empty>
                        )}
                        {users.map((u) => (
                            <TableRow key={`${u.iss} ${u.sub}`}>
                                <TableCell
                                    title={u.sub}
                                    className="whitespace-normal"
                                >
                                    <div className="flex items-center gap-3">
                                        <Avatar name={u.email ?? u.sub} />
                                        <div className="flex min-w-0 flex-col gap-1">
                                            <div className="font-medium break-all">
                                                {u.email ?? u.sub}
                                            </div>
                                            <div className="sm:hidden">
                                                <Groups groups={u.groups} />
                                            </div>
                                        </div>
                                    </div>
                                </TableCell>
                                <TableCell className="hidden whitespace-normal sm:table-cell">
                                    <Groups groups={u.groups} />
                                </TableCell>
                                <TableCell className="text-right">
                                    <When t={u.lastLogin} />
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </Card>
        </Page>
    );
}

function Details({ data }: { data: Record<string, unknown> }) {
    return (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-xs text-foreground/80">
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
        <Page
            title="Audit log"
            description="Sign-ins, terminal sessions and admin changes, newest first."
        >
            <Card className="py-0">
                <Table>
                    <Head>
                        <TableHead className="w-0">Time</TableHead>
                        <TableHead>Event</TableHead>
                        <TableHead className="hidden sm:table-cell">
                            User
                        </TableHead>
                        <TableHead className="hidden sm:table-cell">
                            Details
                        </TableHead>
                    </Head>
                    <TableBody className={tableBody}>
                        {entries.length === 0 && (
                            <Empty cols={4}>
                                <EmptyState
                                    icon={ScrollText}
                                    title="No events yet"
                                />
                            </Empty>
                        )}
                        {entries.map(
                            ({ id, ts, event, sub, email, ...rest }) => {
                                const user = String(email ?? sub ?? "");
                                return (
                                    <TableRow key={id} className="*:align-top">
                                        <TableCell>
                                            <When t={ts} />
                                        </TableCell>
                                        <TableCell className="whitespace-normal">
                                            <Badge
                                                variant="outline"
                                                className={cn(
                                                    "font-mono font-normal",
                                                    eventTone(event),
                                                )}
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
                            },
                        )}
                    </TableBody>
                </Table>
            </Card>
        </Page>
    );
}

const GREEN = "border-emerald-400/20 bg-emerald-400/10 text-emerald-300";
const AMBER = "border-amber-400/20 bg-amber-400/10 text-amber-300";

const eventTone = (event: string) =>
    event.startsWith("log")
        ? "border-sky-400/20 bg-sky-400/10 text-sky-300"
        : event.startsWith("session") || event === "sign"
          ? GREEN
          : AMBER;

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
        <Page
            title="Manage hosts"
            description={
                <>
                    {hosts && (
                        <span>
                            {hosts.length} host{hosts.length === 1 ? "" : "s"}
                        </span>
                    )}
                    {hosts && " · "}
                    Enroll servers and choose which groups can log in.
                </>
            }
            actions={<AddHost onAdded={reload} />}
        >
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
            <Card className="py-0">
                <Table>
                    <Head>
                        <TableHead>Host</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="hidden sm:table-cell">
                            Access
                        </TableHead>
                        <TableHead className="w-0" />
                    </Head>
                    <TableBody className={tableBody}>
                        {hosts?.length === 0 && (
                            <Empty cols={4}>
                                <EmptyState icon={Server} title="No hosts yet">
                                    Add a host to get a one-time enroll snippet.
                                </EmptyState>
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
        </Page>
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
            setSnippet(
                await api<EnrollSnippet>("/api/admin/hosts", "POST", {
                    name: name.trim(),
                    address: address.trim(),
                }),
            );
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
                            ? "Run this on the host to trust the CertShell CA."
                            : "Name the host and tell CertShell where to reach it."}
                    </DialogDescription>
                    <Steps current={snippet ? 2 : 1} />
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
                                placeholder="host.example.com or 10.0.0.5"
                                className="font-mono"
                                value={address}
                                onChange={(e) => setAddress(e.target.value)}
                                required
                            />
                        </div>
                        <DialogFooter>
                            <DialogClose asChild>
                                <Button variant="outline">Cancel</Button>
                            </DialogClose>
                            <Button type="submit">
                                Next
                                <ChevronRight data-icon="inline-end" />
                            </Button>
                        </DialogFooter>
                    </form>
                )}
            </DialogContent>
        </Dialog>
    );
}

function Steps({ current }: { current: 1 | 2 }) {
    return (
        <ol className="mt-2 flex items-center gap-2 text-xs">
            {["Details", "Enroll"].map((label, i) => (
                <li
                    key={label}
                    className={cn(
                        "flex items-center gap-2",
                        i + 1 > current && "text-muted-foreground",
                    )}
                >
                    {i > 0 && <span className="h-px w-6 bg-border" />}
                    <span
                        className={cn(
                            "flex size-5 items-center justify-center rounded-full border text-[11px] font-medium",
                            i + 1 === current &&
                                "border-transparent bg-primary text-primary-foreground",
                            i + 1 < current &&
                                "border-transparent bg-primary/20 text-primary",
                        )}
                    >
                        {i + 1 < current ? <Check className="size-3" /> : i + 1}
                    </span>
                    {label}
                </li>
            ))}
        </ol>
    );
}

function Status({ enrolled }: { enrolled: boolean }) {
    return (
        <Badge className={enrolled ? GREEN : AMBER}>
            <span className="size-1.5 rounded-full bg-current" />
            {enrolled ? "Enrolled" : "Pending"}
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
        <>
            <TableRow
                className="cursor-pointer data-[open=true]:border-b-0 data-[open=true]:bg-muted/40"
                data-open={open}
                onClick={onToggle}
            >
                <TableCell className="whitespace-normal">
                    <button
                        type="button"
                        aria-expanded={open}
                        className="flex items-center gap-3 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                        <HostIcon icon={Server} />
                        <div>
                            <div className="font-medium">{host.name}</div>
                            <div className="font-mono text-xs break-all text-muted-foreground">
                                {host.address}
                            </div>
                        </div>
                    </button>
                </TableCell>
                <TableCell>
                    <Status enrolled={host.enrolled} />
                </TableCell>
                <TableCell className="hidden whitespace-normal sm:table-cell">
                    {host.access.length === 0 ? (
                        <span className="text-muted-foreground">No access</span>
                    ) : (
                        <div className="flex flex-wrap gap-1">
                            {host.access.map((r) => (
                                <Badge
                                    key={`${r.login}/${r.group}`}
                                    variant="secondary"
                                    className="font-normal"
                                >
                                    {r.group}
                                    <span className="text-muted-foreground">
                                        →
                                    </span>
                                    <span className="font-mono">{r.login}</span>
                                </Badge>
                            ))}
                        </div>
                    )}
                </TableCell>
                <TableCell>
                    <ChevronRight
                        className={`size-4 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
                    />
                </TableCell>
            </TableRow>
            {open && (
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableCell
                        colSpan={4}
                        className="px-4 pt-1 pb-5 whitespace-normal"
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
        </>
    );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className="flex flex-col gap-2.5 rounded-xl border bg-card p-4">
            <h3 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
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
                        className="flex flex-col gap-3"
                        onSubmit={(e) => {
                            e.preventDefault();
                            onSave(name.trim(), address.trim());
                        }}
                    >
                        <div className="flex flex-col gap-1.5">
                            <Label htmlFor={`name-${host.id}`}>Name</Label>
                            <Input
                                {...noFill}
                                id={`name-${host.id}`}
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                required
                            />
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <Label htmlFor={`address-${host.id}`}>
                                Address
                            </Label>
                            <Input
                                {...noFill}
                                id={`address-${host.id}`}
                                className="font-mono"
                                value={address}
                                onChange={(e) => setAddress(e.target.value)}
                                required
                            />
                        </div>
                        <div className="flex items-center gap-2 pt-1">
                            <code
                                className="truncate font-mono text-xs text-muted-foreground"
                                title="Host ID"
                            >
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
            <p className="text-sm text-muted-foreground">
                Run as root on the host. One-time use, expires at{" "}
                {new Date(expiresAt * 1000).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                })}
                .
            </p>
            <div className="overflow-hidden rounded-lg border bg-[#0e0e11]">
                <div className="flex items-center gap-2 border-b px-3 py-1.5">
                    <span className="font-mono text-xs text-muted-foreground">
                        shell
                    </span>
                    <Button
                        variant="ghost"
                        size="xs"
                        className="ml-auto text-muted-foreground"
                        onClick={() =>
                            navigator.clipboard.writeText(snippet).then(() => {
                                setCopied(true);
                                setTimeout(() => setCopied(false), 2000);
                            })
                        }
                    >
                        {copied ? (
                            <Check className="text-emerald-400" />
                        ) : (
                            <Copy />
                        )}
                        {copied ? "Copied" : "Copy"}
                    </Button>
                </div>
                <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed">
                    {snippet}
                </pre>
            </div>
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
                <p className="rounded-lg border border-dashed px-3 py-3 text-center text-sm text-muted-foreground">
                    No one can log in yet.
                </p>
            ) : (
                <ul className="flex flex-col divide-y rounded-lg border">
                    {rules.map((r) => (
                        <li
                            key={`${r.login}/${r.group}`}
                            className="flex items-center gap-2 py-1.5 pr-1.5 pl-3 text-sm"
                        >
                            <UsersIcon className="size-3.5 text-muted-foreground" />
                            <span className="font-medium">{r.group}</span>
                            <span className="text-muted-foreground">→</span>
                            <span className="font-mono">{r.login}</span>
                            <Button
                                variant="ghost"
                                size="icon-xs"
                                className="ml-auto text-muted-foreground hover:text-destructive"
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
                    className="font-mono"
                    value={login}
                    onChange={(e) => setLogin(e.target.value)}
                    required
                />
                <Button type="submit" variant="secondary">
                    <Plus />
                    Allow
                </Button>
            </form>
        </div>
    );
}
