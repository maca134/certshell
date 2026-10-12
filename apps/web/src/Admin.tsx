import {
    type AccessRule,
    type AdminHost,
    type AuditEntry,
    type EnrollSnippet,
    type LiveSession,
    REMOVAL_SNIPPET,
    type SeenUser,
} from "@repo/shared";
import { cn } from "cn";
import {
    Check,
    ChevronRight,
    Copy,
    MonitorDot,
    Pencil,
    Plus,
    ScrollText,
    Server,
    SquareTerminal,
    Trash2,
    Users as UsersIcon,
    X,
} from "lucide-react";
import {
    type FormEvent,
    type KeyboardEvent,
    type ReactNode,
    useCallback,
    useEffect,
    useState,
} from "react";
import { Redirect, useLocation } from "wouter";
import { Alerts } from "./Alerts";
import { api } from "./api";
import { Avatar, EmptyState, HostIcon, Page, Tag } from "./components/layout";
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
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "./components/ui/tooltip";
import { cleanTag } from "./tags";

const VIEWS = ["hosts", "users", "sessions", "alerts", "audit"] as const;

export const noFill = { autoComplete: "off", "data-lpignore": "true" };

const RTF = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const UNITS = [
    ["year", 31536e6],
    ["month", 2592e6],
    ["week", 6048e5],
    ["day", 864e5],
    ["hour", 36e5],
    ["minute", 6e4],
] as const;

export function When({ t }: { t: string | number }) {
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
    const reloadUsers = useCallback(
        () => api<SeenUser[]>("/api/admin/users").then(setUsers),
        [],
    );
    // biome-ignore lint/correctness/useExhaustiveDependencies: refetch on view change so cert counts are current
    useEffect(() => {
        reloadUsers();
    }, [reloadUsers, view]);
    if (!(VIEWS as readonly string[]).includes(view))
        return <Redirect to="/hosts" replace />;
    if (view === "hosts") return <Hosts users={users} />;
    if (view === "users") return <Users users={users} reload={reloadUsers} />;
    if (view === "sessions") return <Sessions />;
    if (view === "alerts") return <Alerts />;
    return <Audit />;
}

export function Empty({
    cols,
    children,
}: {
    cols: number;
    children: ReactNode;
}) {
    return (
        <TableRow className="hover:bg-transparent">
            <TableCell colSpan={cols} className="whitespace-normal">
                {children}
            </TableCell>
        </TableRow>
    );
}

export function Head({ children }: { children: ReactNode }) {
    return (
        <TableHeader className="bg-muted/50 [&_th]:h-9 [&_th]:text-xs [&_th]:font-medium [&_th]:text-muted-foreground [&_th:first-child]:pl-4 [&_th:last-child]:pr-4">
            <TableRow className="hover:bg-transparent">{children}</TableRow>
        </TableHeader>
    );
}

export const tableBody =
    "[&_td]:py-3 [&_td:first-child]:pl-4 [&_td:last-child]:pr-4";

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

function Users({
    users,
    reload,
}: {
    users: SeenUser[];
    reload: () => Promise<void>;
}) {
    const [error, setError] = useState("");
    const endAll = async (u: SeenUser) => {
        if (
            !confirm(
                `Sign out ${u.email ?? u.sub}? This also closes their terminals and stops their running tasks.`,
            )
        )
            return;
        setError("");
        await api(
            `/api/admin/sessions?sub=${encodeURIComponent(u.sub)}`,
            "DELETE",
        ).then(reload, (e) => setError(e.message));
    };
    return (
        <Page
            title="Users"
            description="Everyone who has signed in, with their groups as of their last sign-in."
        >
            {error && (
                <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            )}
            <Card className="py-0">
                <Table>
                    <Head>
                        <TableHead>User</TableHead>
                        <TableHead className="hidden sm:table-cell">
                            Groups
                        </TableHead>
                        <TableHead
                            className="text-right"
                            title="In use: open terminals and running task targets. Unexpired: certs signed in the last 15 minutes."
                        >
                            Certs
                        </TableHead>
                        <TableHead className="text-right">
                            Last sign-in
                        </TableHead>
                        <TableHead className="w-0" />
                    </Head>
                    <TableBody className={tableBody}>
                        {users.length === 0 && (
                            <Empty cols={5}>
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
                                <TableCell className="text-right whitespace-nowrap tabular-nums">
                                    <div>{u.certs.inUse} in use</div>
                                    <div className="text-xs text-muted-foreground">
                                        {u.certs.unexpired} unexpired
                                    </div>
                                </TableCell>
                                <TableCell className="text-right">
                                    <When t={u.lastLogin} />
                                </TableCell>
                                <TableCell>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => endAll(u)}
                                    >
                                        Sign out &amp; end sessions
                                    </Button>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </Card>
        </Page>
    );
}

function Sessions() {
    const [sessions, setSessions] = useState<LiveSession[]>([]);
    const [error, setError] = useState("");
    const reload = useCallback(
        () =>
            api<LiveSession[]>("/api/admin/sessions").then(setSessions, (e) =>
                setError(e.message),
            ),
        [],
    );
    useEffect(() => {
        reload();
        const visibleReload = () => {
            if (!document.hidden) reload();
        };
        const timer = setInterval(visibleReload, 5000);
        document.addEventListener("visibilitychange", visibleReload);
        return () => {
            clearInterval(timer);
            document.removeEventListener("visibilitychange", visibleReload);
        };
    }, [reload]);
    const end = async (s: LiveSession) => {
        if (!confirm(`End ${s.email ?? s.sub} on ${s.hostName}?`)) return;
        setError("");
        await api(`/api/admin/sessions/${s.id}`, "DELETE").catch((e) =>
            setError(e.message),
        );
        await reload();
    };
    return (
        <Page
            title="Sessions"
            description="Open terminals, oldest first. Ending one closes it right away."
        >
            {error && (
                <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            )}
            <Card className="py-0">
                <Table>
                    <Head>
                        <TableHead>User</TableHead>
                        <TableHead>Host</TableHead>
                        <TableHead className="hidden sm:table-cell">
                            Started
                        </TableHead>
                        <TableHead className="w-0" />
                    </Head>
                    <TableBody className={tableBody}>
                        {sessions.length === 0 && (
                            <Empty cols={4}>
                                <EmptyState
                                    icon={MonitorDot}
                                    title="No open terminals"
                                />
                            </Empty>
                        )}
                        {sessions.map((s) => (
                            <TableRow key={s.id}>
                                <TableCell
                                    title={s.sub}
                                    className="whitespace-normal break-all"
                                >
                                    {s.email ?? s.sub}
                                </TableCell>
                                <TableCell className="whitespace-normal">
                                    <span className="font-medium">
                                        {s.hostName}
                                    </span>{" "}
                                    <span className="font-mono text-muted-foreground">
                                        {s.login}
                                    </span>
                                </TableCell>
                                <TableCell className="hidden sm:table-cell">
                                    <When t={s.startedAt} />
                                </TableCell>
                                <TableCell className="text-right">
                                    <Button
                                        variant="destructive"
                                        size="sm"
                                        onClick={() => end(s)}
                                    >
                                        End
                                    </Button>
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

export const GREEN = "border-emerald-400/20 bg-emerald-400/10 text-emerald-300";
export const AMBER = "border-amber-400/20 bg-amber-400/10 text-amber-300";

const eventTone = (event: string) =>
    event.startsWith("log")
        ? "border-sky-400/20 bg-sky-400/10 text-sky-300"
        : event.startsWith("session") || event === "sign"
          ? GREEN
          : AMBER;

function Hosts({ users }: { users: SeenUser[] }) {
    const [hosts, setHosts] = useState<AdminHost[]>();
    const [error, setError] = useState("");

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

    const groups = [
        ...new Set([
            ...users.flatMap((u) => u.groups),
            ...(hosts ?? []).flatMap((h) => h.access.map((a) => a.group)),
        ]),
    ].sort();
    const tags = [...new Set(hosts?.flatMap((h) => h.tags))].sort();

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
                        <TableHead className="hidden sm:table-cell">
                            Tags
                        </TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="hidden sm:table-cell">
                            Access
                        </TableHead>
                        <TableHead className="w-0" />
                    </Head>
                    <TableBody className={tableBody}>
                        {hosts?.length === 0 && (
                            <Empty cols={5}>
                                <EmptyState icon={Server} title="No hosts yet">
                                    Add a host to get a one-time enroll snippet.
                                </EmptyState>
                            </Empty>
                        )}
                        {hosts?.map((host) => (
                            <HostRow
                                key={host.id}
                                host={host}
                                allTags={tags}
                                onChanged={reload}
                                onRemove={() =>
                                    act(() =>
                                        api(
                                            `/api/admin/hosts/${host.id}`,
                                            "DELETE",
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
    allTags,
    onChanged,
    onRemove,
}: {
    host: AdminHost;
    allTags: string[];
    onChanged: () => Promise<void>;
    onRemove: () => void;
}) {
    return (
        <TableRow>
            <TableCell className="whitespace-normal">
                <div className="flex items-center gap-3">
                    <HostIcon />
                    <div>
                        <div className="font-medium">{host.name}</div>
                        <div className="font-mono text-xs break-all text-muted-foreground">
                            {host.address}
                        </div>
                    </div>
                </div>
            </TableCell>
            <TableCell className="hidden whitespace-normal sm:table-cell">
                {host.tags.length === 0 ? (
                    <span className="text-muted-foreground">—</span>
                ) : (
                    <div className="flex flex-wrap gap-1">
                        {host.tags.map((t) => (
                            <Tag key={t} name={t} />
                        ))}
                    </div>
                )}
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
                                <span className="text-muted-foreground">→</span>
                                <span className="font-mono">{r.login}</span>
                            </Badge>
                        ))}
                    </div>
                )}
            </TableCell>
            <TableCell>
                <div className="flex justify-end gap-0.5">
                    <EnrollHost host={host} onClose={onChanged} />
                    <EditHost
                        host={host}
                        allTags={allTags}
                        onSaved={onChanged}
                    />
                    <RemoveHost host={host} onDelete={onRemove} />
                </div>
            </TableCell>
        </TableRow>
    );
}

/** Icon button that opens the enclosing Dialog. */
export function RowAction({
    label,
    tooltip,
    className,
    children,
}: {
    label: string;
    tooltip: string;
    className?: string;
    children: ReactNode;
}) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <DialogTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={label}
                        className={cn("text-muted-foreground", className)}
                    >
                        {children}
                    </Button>
                </DialogTrigger>
            </TooltipTrigger>
            <TooltipContent>{tooltip}</TooltipContent>
        </Tooltip>
    );
}

function EnrollHost({
    host,
    onClose,
}: {
    host: AdminHost;
    onClose: () => void;
}) {
    const [snippet, setSnippet] = useState<EnrollSnippet>();
    const [error, setError] = useState("");
    const action = host.enrolled ? "Re-enroll" : "Enroll";
    const openChange = (open: boolean) => {
        setSnippet(undefined);
        setError("");
        if (!open) return onClose();
        api<EnrollSnippet>(`/api/admin/hosts/${host.id}/snippet`, "POST").then(
            setSnippet,
            (e) => setError(e.message),
        );
    };
    return (
        <Dialog onOpenChange={openChange}>
            <RowAction label={`${action} ${host.name}`} tooltip={action}>
                <SquareTerminal />
            </RowAction>
            <DialogContent className="grid-cols-[minmax(0,1fr)] sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>
                        {action} {host.name}
                    </DialogTitle>
                    <DialogDescription>
                        {host.enrolled
                            ? "Run this on the host again, e.g. after its host key changed."
                            : "Run this on the host to trust the CertShell CA."}
                    </DialogDescription>
                </DialogHeader>
                {error && (
                    <Alert variant="destructive">
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                )}
                {snippet && <Snippet {...snippet} />}
                <DialogFooter showCloseButton />
            </DialogContent>
        </Dialog>
    );
}

function EditHost({
    host,
    allTags,
    onSaved,
}: {
    host: AdminHost;
    allTags: string[];
    onSaved: () => Promise<void>;
}) {
    const [open, setOpen] = useState(false);
    const [name, setName] = useState(host.name);
    const [address, setAddress] = useState(host.address);
    const [tags, setTags] = useState(host.tags);
    const [rules, setRules] = useState(host.access);
    const [error, setError] = useState("");
    const url = `/api/admin/hosts/${host.id}`;
    const formId = `edit-${host.id}`;
    const openChange = (o: boolean) => {
        setOpen(o);
        if (!o) return;
        setName(host.name);
        setAddress(host.address);
        setTags(host.tags);
        setRules(host.access);
        setError("");
    };
    const save = async (e: FormEvent) => {
        e.preventDefault();
        setError("");
        try {
            if (
                name.trim() !== host.name ||
                address.trim() !== host.address ||
                JSON.stringify(tags) !== JSON.stringify(host.tags)
            )
                await api(url, "PATCH", {
                    name: name.trim(),
                    address: address.trim(),
                    tags,
                });
            if (JSON.stringify(rules) !== JSON.stringify(host.access))
                await api(`${url}/access`, "PUT", rules);
            await onSaved();
            setOpen(false);
        } catch (e) {
            setError((e as Error).message);
        }
    };
    return (
        <Dialog open={open} onOpenChange={openChange}>
            <RowAction label={`Edit ${host.name}`} tooltip="Edit">
                <Pencil />
            </RowAction>
            <DialogContent className="grid-cols-[minmax(0,1fr)] sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Edit {host.name}</DialogTitle>
                    <DialogDescription>
                        Host ID <code className="font-mono">{host.id}</code>{" "}
                        stays the same, so renaming needs no change on the host.
                    </DialogDescription>
                </DialogHeader>
                {error && (
                    <Alert variant="destructive">
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                )}
                <form
                    id={formId}
                    className="flex flex-col gap-4"
                    onSubmit={save}
                >
                    <div className="flex flex-col gap-2">
                        <Label htmlFor={`name-${host.id}`}>Name</Label>
                        <Input
                            {...noFill}
                            id={`name-${host.id}`}
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            required
                        />
                    </div>
                    <div className="flex flex-col gap-2">
                        <Label htmlFor={`address-${host.id}`}>Address</Label>
                        <Input
                            {...noFill}
                            id={`address-${host.id}`}
                            className="font-mono"
                            value={address}
                            onChange={(e) => setAddress(e.target.value)}
                            required
                        />
                    </div>
                </form>
                <div className="flex flex-col gap-2">
                    <Label htmlFor={`tags-${host.id}`}>Tags</Label>
                    <TagInput
                        id={`tags-${host.id}`}
                        tags={tags}
                        allTags={allTags}
                        onChange={setTags}
                    />
                </div>
                <div className="flex flex-col gap-2">
                    <Label>Access</Label>
                    <Access rules={rules} onChange={setRules} />
                </div>
                <DialogFooter>
                    <DialogClose asChild>
                        <Button variant="outline">Cancel</Button>
                    </DialogClose>
                    <Button type="submit" form={formId}>
                        Save
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function RemoveHost({
    host,
    onDelete,
}: {
    host: AdminHost;
    onDelete: () => void;
}) {
    return (
        <Dialog>
            <RowAction
                label={`Remove ${host.name}`}
                tooltip="Remove"
                className="hover:text-destructive"
            >
                <Trash2 />
            </RowAction>
            <DialogContent className="grid-cols-[minmax(0,1fr)] sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Remove {host.name}</DialogTitle>
                    <DialogDescription>
                        CertShell stops signing certs for this host right away.
                        {host.enrolled &&
                            " To make the host stop trusting the CertShell CA, run this as root on it too."}
                    </DialogDescription>
                </DialogHeader>
                {host.enrolled && <Shell text={REMOVAL_SNIPPET} />}
                <DialogFooter>
                    <DialogClose asChild>
                        <Button variant="outline">Cancel</Button>
                    </DialogClose>
                    <Button variant="destructive" onClick={onDelete}>
                        <Trash2 />
                        Remove host
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
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

function Snippet({ snippet, expiresAt }: EnrollSnippet) {
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
            <Shell text={snippet} />
        </Section>
    );
}

function Shell({ text }: { text: string }) {
    const [copied, setCopied] = useState(false);
    return (
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
                        navigator.clipboard.writeText(text).then(() => {
                            setCopied(true);
                            setTimeout(() => setCopied(false), 2000);
                        })
                    }
                >
                    {copied ? <Check className="text-emerald-400" /> : <Copy />}
                    {copied ? "Copied" : "Copy"}
                </Button>
            </div>
            <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed">
                {text}
            </pre>
        </div>
    );
}

function Access({
    rules,
    onChange,
}: {
    rules: AccessRule[];
    onChange: (rules: AccessRule[]) => void;
}) {
    const [login, setLogin] = useState("");
    const [group, setGroup] = useState("");
    const add = (e: FormEvent) => {
        e.preventDefault();
        const rule = { login: login.trim(), group: group.trim() };
        if (
            !rules.some((r) => r.login === rule.login && r.group === rule.group)
        )
            onChange([...rules, rule]);
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
                                    onChange(rules.filter((x) => x !== r))
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

/** Tags as removable chips over a textbox; suggestions (existing tags, or a new one) listed below it. */
export function TagInput({
    id,
    tags,
    allTags,
    onChange,
}: {
    id: string;
    tags: string[];
    allTags: string[];
    onChange: (tags: string[]) => void;
}) {
    const [text, setText] = useState("");
    const [focused, setFocused] = useState(false);
    const [active, setActive] = useState(0);
    const q = cleanTag(text);
    const options = [
        ...(q && !allTags.includes(q) && !tags.includes(q) ? [q] : []),
        ...allTags.filter((t) => !tags.includes(t) && t.includes(q)),
    ];
    const full = tags.length >= 20;
    const add = (tag?: string) => {
        if (tag && !tags.includes(tag)) onChange([...tags, tag].sort());
        setText("");
        setActive(0);
    };
    const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            const n = options.length || 1;
            setActive((a) => (a + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
        } else if (e.key === "Enter") {
            e.preventDefault();
            add(options[Math.min(active, options.length - 1)]);
        }
    };
    return (
        <div className="flex flex-col gap-2">
            {tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                    {tags.map((t) => (
                        <Tag
                            key={t}
                            name={t}
                            onRemove={() =>
                                onChange(tags.filter((x) => x !== t))
                            }
                        />
                    ))}
                </div>
            )}
            <div className="relative">
                <Input
                    {...noFill}
                    id={id}
                    placeholder={full ? "20 tags max" : "Add a tag…"}
                    disabled={full}
                    value={text}
                    onChange={(e) => {
                        setText(e.target.value);
                        setActive(0);
                    }}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    onKeyDown={onKeyDown}
                />
                {focused && options.length > 0 && (
                    <ul className="absolute top-full z-50 mt-1 flex max-h-48 w-full flex-col overflow-y-auto rounded-lg border bg-popover p-1 shadow-md">
                        {options.map((t, i) => (
                            <li key={t}>
                                <button
                                    type="button"
                                    tabIndex={-1}
                                    className={cn(
                                        "flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-sm",
                                        i === active && "bg-accent",
                                    )}
                                    onMouseDown={(e) => e.preventDefault()}
                                    onMouseEnter={() => setActive(i)}
                                    onClick={() => add(t)}
                                >
                                    {!allTags.includes(t) && "Create"}
                                    <Tag name={t} />
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}
