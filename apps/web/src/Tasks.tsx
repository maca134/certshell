import type {
    HostSummary,
    RunDetail,
    RunHost,
    RunStatus,
    RunSummary,
    SavedCommand,
} from "@repo/shared";
import { cn } from "cn";
import { ChevronRight, ListTodo, Play, Save, Trash2 } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { Link, Route, Switch, useLocation, useSearch } from "wouter";
import { AMBER, GREEN, When } from "./Admin";
import { api } from "./api";
import { EmptyState, Page } from "./components/layout";
import { Alert, AlertDescription } from "./components/ui/alert";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";

export const MAX_TARGETS = 50;

const RED = "border-red-400/20 bg-red-400/10 text-red-300";
const STATUS: Record<RunStatus, { label: string; className: string }> = {
    running: { label: "running", className: AMBER },
    ok: { label: "ok", className: GREEN },
    failed: { label: "failed", className: RED },
};

type Target = { host: HostSummary; login: string };

/** `t=h1:root,h2:alice` → the targets the user still has access to. */
export function parseTargets(search: string, hosts: HostSummary[]): Target[] {
    const keys = new URLSearchParams(search).get("t")?.split(",") ?? [];
    return [...new Set(keys)].flatMap((key) => {
        const [hostId, login = ""] = key.split(":");
        const host = hosts.find((h) => h.id === hostId);
        return host?.logins.includes(login) ? [{ host, login }] : [];
    });
}

export function Tasks({ hosts }: { hosts?: HostSummary[] }) {
    return (
        <Switch>
            <Route path="/:id">{({ id }) => <RunView id={id} />}</Route>
            <Route>
                <TaskHome hosts={hosts} />
            </Route>
        </Switch>
    );
}

function TaskHome({ hosts }: { hosts?: HostSummary[] }) {
    const targets = parseTargets(useSearch(), hosts ?? []).slice(
        0,
        MAX_TARGETS,
    );
    const [command, setCommand] = useState("");
    const [saved, setSaved] = useState<SavedCommand[]>();
    const [runs, setRuns] = useState<RunSummary[]>();
    const loadSaved = () =>
        api<SavedCommand[]>("/api/tasks/commands").then(setSaved);
    // biome-ignore lint/correctness/useExhaustiveDependencies: load once
    useEffect(() => {
        loadSaved();
        api<RunSummary[]>("/api/tasks/runs").then(setRuns);
    }, []);

    return (
        <Page
            title="Tasks"
            description="Run one command on many hosts at once."
        >
            {targets.length ? (
                <NewRun
                    targets={targets}
                    command={command}
                    setCommand={setCommand}
                    onSaved={loadSaved}
                />
            ) : (
                <Card className="py-0">
                    <EmptyState icon={ListTodo} title="Pick hosts first">
                        On{" "}
                        <Link href="~/" className="text-primary">
                            Hosts
                        </Link>
                        , choose Select, pick accounts, then Run command.
                    </EmptyState>
                </Card>
            )}
            <Section title="Saved commands">
                {saved?.length === 0 && (
                    <p className="px-4 py-3.5 text-sm text-muted-foreground">
                        None yet. Save one from the form above.
                    </p>
                )}
                {saved?.map((c) => (
                    <li
                        key={c.id}
                        className="flex items-center gap-3 px-4 py-2.5"
                    >
                        <div className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate text-sm font-medium">
                                {c.name}
                            </span>
                            <code className="truncate text-xs text-muted-foreground">
                                {c.command}
                            </code>
                        </div>
                        {!!targets.length && (
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => setCommand(c.command)}
                            >
                                Use
                            </Button>
                        )}
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-muted-foreground"
                            aria-label={`Delete ${c.name}`}
                            title="Delete"
                            onClick={() =>
                                api(
                                    `/api/tasks/commands/${c.id}`,
                                    "DELETE",
                                ).then(loadSaved)
                            }
                        >
                            <Trash2 />
                        </Button>
                    </li>
                ))}
            </Section>
            <Section title="Recent runs">
                {runs?.length === 0 && (
                    <p className="px-4 py-3.5 text-sm text-muted-foreground">
                        No runs yet.
                    </p>
                )}
                {runs?.map((r) => (
                    <li key={r.id}>
                        <Link
                            href={`/${r.id}`}
                            className="flex flex-wrap items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/60"
                        >
                            <code className="min-w-0 flex-1 truncate text-sm">
                                {r.command}
                            </code>
                            <span className="flex items-center gap-1.5">
                                {(Object.keys(STATUS) as RunStatus[]).map(
                                    (s) =>
                                        r.counts[s] > 0 && (
                                            <Badge
                                                key={s}
                                                className={STATUS[s].className}
                                            >
                                                {r.counts[s]} {STATUS[s].label}
                                            </Badge>
                                        ),
                                )}
                            </span>
                            <span className="text-xs">
                                <When t={r.createdAt} />
                            </span>
                        </Link>
                    </li>
                ))}
            </Section>
        </Page>
    );
}

function NewRun({
    targets,
    command,
    setCommand,
    onSaved,
}: {
    targets: Target[];
    command: string;
    setCommand: (c: string) => void;
    onSaved: () => void;
}) {
    const [, navigate] = useLocation();
    const [name, setName] = useState("");
    const [error, setError] = useState<string>();
    const [busy, setBusy] = useState(false);

    const run = async (e: FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError(undefined);
        try {
            const { id } = await api<{ id: string }>(
                "/api/tasks/runs",
                "POST",
                {
                    command,
                    targets: targets.map((t) => ({
                        host: t.host.id,
                        login: t.login,
                    })),
                },
            );
            navigate(`/${id}`);
        } catch (err) {
            setError((err as Error).message);
            setBusy(false);
        }
    };
    const save = () =>
        api("/api/tasks/commands", "POST", { name: name.trim(), command }).then(
            () => {
                setName("");
                onSaved();
            },
            (err: Error) => setError(err.message),
        );

    return (
        <Card className="gap-4 p-4">
            <form onSubmit={run} className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                    <Label>Targets</Label>
                    <div className="flex flex-wrap gap-1.5">
                        {targets.map(({ host, login }) => (
                            <Badge
                                key={`${host.id}:${login}`}
                                variant="outline"
                                className="font-mono font-normal"
                            >
                                <span>
                                    <span className="text-muted-foreground">
                                        {login}@
                                    </span>
                                    {host.name}
                                </span>
                            </Badge>
                        ))}
                    </div>
                </div>
                <div className="flex flex-col gap-2">
                    <Label htmlFor="task-command">Command</Label>
                    <textarea
                        id="task-command"
                        rows={3}
                        required
                        maxLength={4096}
                        spellCheck={false}
                        autoComplete="off"
                        value={command}
                        onChange={(e) => setCommand(e.target.value)}
                        placeholder="apt-get update && apt-get upgrade -y"
                        className="w-full rounded-lg border border-input bg-transparent px-2.5 py-2 font-mono text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                    />
                    <p className="text-xs text-muted-foreground">
                        Runs without a terminal, so prompts get no input. Killed
                        after 30 minutes.
                    </p>
                </div>
                {error && (
                    <Alert variant="destructive">
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                )}
                <div className="flex flex-wrap items-center gap-2">
                    <Input
                        aria-label="Name"
                        placeholder="Name"
                        maxLength={64}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-40"
                    />
                    <Button
                        type="button"
                        variant="secondary"
                        disabled={!name.trim() || !command.trim()}
                        onClick={save}
                    >
                        <Save />
                        Save
                    </Button>
                    <Button
                        type="submit"
                        className="ml-auto"
                        disabled={busy || !command.trim()}
                    >
                        <Play />
                        Run on {targets.length} host
                        {targets.length === 1 ? "" : "s"}
                    </Button>
                </div>
            </form>
        </Card>
    );
}

function RunView({ id }: { id: string }) {
    const [run, setRun] = useState<RunDetail>();
    const [error, setError] = useState<string>();

    useEffect(() => {
        let live = true;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const load = () =>
            api<RunDetail>(`/api/tasks/runs/${id}`).then(
                (r) => {
                    if (!live) return;
                    setRun(r);
                    if (r.hosts.some((h) => h.status === "running"))
                        timer = setTimeout(load, 1500);
                },
                (err: Error) => live && setError(err.message),
            );
        load();
        return () => {
            live = false;
            clearTimeout(timer);
        };
    }, [id]);

    return (
        <Page
            title="Run"
            description={run && <When t={run.createdAt} />}
            actions={
                <Button variant="secondary" size="sm" asChild>
                    <Link href="/">All tasks</Link>
                </Button>
            }
        >
            {error && (
                <Card className="py-0">
                    <EmptyState icon={ListTodo} title="Run not found">
                        {error}
                    </EmptyState>
                </Card>
            )}
            {run && (
                <>
                    <pre className="overflow-x-auto rounded-lg border bg-[#0e0e11] p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
                        {run.command}
                    </pre>
                    <Card className="gap-0 py-0">
                        <ul className="divide-y">
                            {run.hosts.map((h) => (
                                <HostResult
                                    key={`${h.hostId}:${h.login}`}
                                    {...h}
                                />
                            ))}
                        </ul>
                    </Card>
                </>
            )}
        </Page>
    );
}

function HostResult({ hostName, login, status, exitCode, output }: RunHost) {
    return (
        <li>
            <details className="group">
                <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/60 [&::-webkit-details-marker]:hidden">
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
                    <span className="min-w-0 truncate font-mono text-sm">
                        <span className="text-muted-foreground">{login}@</span>
                        {hostName}
                    </span>
                    <span className="ml-auto flex shrink-0 items-center gap-2">
                        {exitCode !== null && (
                            <span className="text-xs text-muted-foreground tabular-nums">
                                exit {exitCode}
                            </span>
                        )}
                        <Badge className={STATUS[status].className}>
                            <span
                                className={cn(
                                    "size-1.5 rounded-full bg-current",
                                    status === "running" && "animate-pulse",
                                )}
                            />
                            {STATUS[status].label}
                        </Badge>
                    </span>
                </summary>
                <pre className="max-h-96 overflow-auto border-t bg-[#0e0e11] px-4 py-3 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap">
                    {output || "(no output yet)"}
                </pre>
            </details>
        </li>
    );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium text-muted-foreground">
                {title}
            </h2>
            <Card className="gap-0 py-0">
                <ul className="divide-y">{children}</ul>
            </Card>
        </section>
    );
}
