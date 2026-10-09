import type {
    HostSummary,
    RunDetail,
    RunHost,
    RunStatus,
    RunSummary,
    Task,
    TaskInput,
} from "@repo/shared";
import { cn } from "cn";
import {
    ChevronRight,
    ListTodo,
    Pencil,
    Play,
    Plus,
    Trash2,
} from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Link, Route, Switch, useLocation } from "wouter";
import { AMBER, GREEN, When } from "./Admin";
import { api } from "./api";
import { EmptyState, Page } from "./components/layout";
import { Alert, AlertDescription } from "./components/ui/alert";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";

const MAX_TARGETS = 50;

const RED = "border-red-400/20 bg-red-400/10 text-red-300";
const STATUS: Record<RunStatus, { label: string; className: string }> = {
    running: { label: "running", className: AMBER },
    ok: { label: "ok", className: GREEN },
    failed: { label: "failed", className: RED },
};

export function Tasks({ hosts }: { hosts?: HostSummary[] }) {
    return (
        <Switch>
            <Route path="/new">
                <TaskForm hosts={hosts} />
            </Route>
            <Route path="/:id/edit">
                {({ id }) => <TaskForm id={Number(id)} hosts={hosts} />}
            </Route>
            <Route path="/runs/:id">{({ id }) => <RunView id={id} />}</Route>
            <Route>
                <TaskList />
            </Route>
        </Switch>
    );
}

/** POSTs a run and opens it. */
function useRun() {
    const [, navigate] = useLocation();
    const [error, setError] = useState<string>();
    const run = (taskId: number) =>
        api<{ id: string }>(`/api/tasks/${taskId}/run`, "POST").then(
            ({ id }) => navigate(`~/tasks/runs/${id}`),
            (err: Error) => setError(err.message),
        );
    return { run, error };
}

function TaskList() {
    const [tasks, setTasks] = useState<Task[]>();
    const [runs, setRuns] = useState<RunSummary[]>();
    const [loadError, setLoadError] = useState<string>();
    const { run, error: runError } = useRun();
    const error = loadError ?? runError;
    useEffect(() => {
        const fail = (err: Error) => setLoadError(err.message);
        api<Task[]>("/api/tasks").then(setTasks, fail);
        api<RunSummary[]>("/api/tasks/runs").then(setRuns, fail);
    }, []);

    return (
        <Page
            title="Tasks"
            description="Saved scripts and the hosts they run on."
            actions={
                <Button size="sm" asChild>
                    <Link href="/new">
                        <Plus />
                        New task
                    </Link>
                </Button>
            }
        >
            {error && (
                <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            )}
            <Card className="gap-0 py-0">
                {tasks?.length === 0 && (
                    <EmptyState icon={ListTodo} title="No tasks yet">
                        A task is a script and the hosts it runs on, e.g.{" "}
                        <code>apt-get upgrade -y</code> on every web server.
                    </EmptyState>
                )}
                <ul className="divide-y">
                    {tasks?.map((t) => (
                        <li
                            key={t.id}
                            className="flex flex-wrap items-center gap-3 px-4 py-3"
                        >
                            <div className="flex min-w-48 flex-1 flex-col">
                                <span className="truncate font-medium">
                                    {t.name}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                    {t.targets.length} host
                                    {t.targets.length === 1 ? "" : "s"}
                                    {t.lastRun && (
                                        <>
                                            {" · last run "}
                                            <Link
                                                href={`/runs/${t.lastRun.id}`}
                                                className="hover:underline"
                                            >
                                                <When t={t.lastRun.createdAt} />
                                            </Link>
                                        </>
                                    )}
                                </span>
                            </div>
                            {t.lastRun && <Counts counts={t.lastRun.counts} />}
                            <div className="flex gap-2">
                                <Button variant="secondary" size="sm" asChild>
                                    <Link href={`/${t.id}/edit`}>
                                        <Pencil />
                                        Edit
                                    </Link>
                                </Button>
                                <Button size="sm" onClick={() => run(t.id)}>
                                    <Play />
                                    Run
                                </Button>
                            </div>
                        </li>
                    ))}
                </ul>
            </Card>
            {!!runs?.length && (
                <section className="flex flex-col gap-2">
                    <h2 className="text-sm font-medium text-muted-foreground">
                        Recent runs
                    </h2>
                    <Card className="gap-0 py-0">
                        <ul className="divide-y">
                            {runs.map((r) => (
                                <li key={r.id}>
                                    <Link
                                        href={`/runs/${r.id}`}
                                        className="flex flex-wrap items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/60"
                                    >
                                        <span className="min-w-0 flex-1 truncate text-sm">
                                            {r.name}
                                        </span>
                                        <Counts counts={r.counts} />
                                        <span className="text-xs">
                                            <When t={r.createdAt} />
                                        </span>
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </Card>
                </section>
            )}
        </Page>
    );
}

function Counts({ counts }: { counts: Record<RunStatus, number> }) {
    return (
        <span className="flex items-center gap-1.5">
            {(Object.keys(STATUS) as RunStatus[]).map(
                (s) =>
                    counts[s] > 0 && (
                        <Badge key={s} className={STATUS[s].className}>
                            {counts[s]} {STATUS[s].label}
                        </Badge>
                    ),
            )}
        </span>
    );
}

function TaskForm({ id, hosts }: { id?: number; hosts?: HostSummary[] }) {
    const [, navigate] = useLocation();
    const [name, setName] = useState("");
    const [script, setScript] = useState("");
    const [checked, setChecked] = useState<string[]>([]);
    // hostId → login picked in that host's dropdown; unset means its first login.
    const [picked, setPicked] = useState<Record<string, string>>({});
    const [error, setError] = useState<string>();
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (id === undefined) return;
        api<Task[]>("/api/tasks").then((tasks) => {
            const task = tasks.find((t) => t.id === id);
            if (!task) return setError("Task not found");
            setName(task.name);
            setScript(task.script);
            setChecked(task.targets.map((t) => t.host));
            setPicked(
                Object.fromEntries(task.targets.map((t) => [t.host, t.login])),
            );
        });
    }, [id]);

    const loginOn = (host: HostSummary) =>
        host.logins.includes(picked[host.id] ?? "")
            ? (picked[host.id] as string)
            : host.logins[0];
    // Saved targets the user can no longer reach drop out on save.
    const reachable = (hosts ?? []).flatMap((host) => {
        const login = loginOn(host);
        return checked.includes(host.id) && login
            ? [{ host: host.id, login }]
            : [];
    });
    const check = (hostId: string, on: boolean) =>
        setChecked((c) =>
            on ? [...new Set([...c, hostId])] : c.filter((h) => h !== hostId),
        );

    const save = async (e: FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError(undefined);
        const body: TaskInput = {
            name: name.trim(),
            script,
            targets: reachable,
        };
        try {
            if (id === undefined) await api("/api/tasks", "POST", body);
            else await api(`/api/tasks/${id}`, "PUT", body);
            navigate("~/tasks");
        } catch (err) {
            setError((err as Error).message);
            setBusy(false);
        }
    };
    const remove = () => {
        if (!confirm(`Delete task "${name}"? Its past runs are kept.`)) return;
        api(`/api/tasks/${id}`, "DELETE").then(
            () => navigate("~/tasks"),
            (err: Error) => setError(err.message),
        );
    };

    return (
        <Page title={id === undefined ? "New task" : "Edit task"}>
            <Card className="p-4">
                <form onSubmit={save} className="flex flex-col gap-5">
                    <div className="flex flex-col gap-2">
                        <Label htmlFor="task-name">Name</Label>
                        <Input
                            id="task-name"
                            required
                            maxLength={64}
                            autoComplete="off"
                            placeholder="Upgrade packages"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                        />
                    </div>
                    <div className="flex flex-col gap-2">
                        <Label htmlFor="task-script">Script</Label>
                        <textarea
                            id="task-script"
                            rows={8}
                            required
                            maxLength={16 * 1024}
                            spellCheck={false}
                            autoComplete="off"
                            value={script}
                            onChange={(e) => setScript(e.target.value)}
                            placeholder={"apt-get update\napt-get upgrade -y"}
                            className="w-full rounded-lg border border-input bg-transparent px-2.5 py-2 font-mono text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                        />
                        <p className="text-xs text-muted-foreground">
                            Runs in each login's shell, without a terminal:
                            prompts get no input. Killed after 30 minutes.
                        </p>
                    </div>
                    <fieldset className="flex flex-col gap-2">
                        <legend className="mb-2 text-sm font-medium">
                            Hosts{" "}
                            <span className="font-normal text-muted-foreground">
                                · {reachable.length} selected
                            </span>
                        </legend>
                        {hosts?.length === 0 && (
                            <p className="text-sm text-muted-foreground">
                                You don't have access to any hosts yet.
                            </p>
                        )}
                        <ul className="divide-y rounded-lg border">
                            {hosts?.map((host) => (
                                <li
                                    key={host.id}
                                    className="flex items-center gap-3 px-3 py-2"
                                >
                                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-sm">
                                        <input
                                            type="checkbox"
                                            className="size-4 shrink-0 accent-primary"
                                            checked={checked.includes(host.id)}
                                            onChange={(e) =>
                                                check(host.id, e.target.checked)
                                            }
                                        />
                                        <span
                                            className="truncate"
                                            title={host.name}
                                        >
                                            {host.name}
                                        </span>
                                    </label>
                                    <select
                                        aria-label={`Login on ${host.name}`}
                                        value={loginOn(host)}
                                        onChange={(e) => {
                                            setPicked((p) => ({
                                                ...p,
                                                [host.id]: e.target.value,
                                            }));
                                            check(host.id, true);
                                        }}
                                        className="h-8 w-32 shrink-0 rounded-lg border border-input bg-transparent px-2 font-mono text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                                    >
                                        {host.logins.map((login) => (
                                            <option key={login}>{login}</option>
                                        ))}
                                    </select>
                                </li>
                            ))}
                        </ul>
                    </fieldset>
                    {error && (
                        <Alert variant="destructive">
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                        {id !== undefined && (
                            <Button
                                type="button"
                                variant="destructive"
                                onClick={remove}
                            >
                                <Trash2 />
                                Delete
                            </Button>
                        )}
                        <Button
                            type="button"
                            variant="ghost"
                            className="ml-auto"
                            onClick={() => navigate("~/tasks")}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            disabled={
                                busy ||
                                !name.trim() ||
                                !script.trim() ||
                                !reachable.length ||
                                reachable.length > MAX_TARGETS
                            }
                        >
                            Save
                        </Button>
                    </div>
                </form>
            </Card>
        </Page>
    );
}

function RunView({ id }: { id: string }) {
    const [run, setRun] = useState<RunDetail>();
    const [error, setError] = useState<string>();
    const again = useRun();

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
            title={run?.name ?? "Run"}
            description={run && <When t={run.createdAt} />}
            actions={
                <div className="flex gap-2">
                    <Button variant="secondary" size="sm" asChild>
                        <Link href="~/tasks">All tasks</Link>
                    </Button>
                    {run && (
                        <Button size="sm" onClick={() => again.run(run.taskId)}>
                            <Play />
                            Run again
                        </Button>
                    )}
                </div>
            }
        >
            {(error || again.error) && (
                <Alert variant="destructive">
                    <AlertDescription>{error || again.error}</AlertDescription>
                </Alert>
            )}
            {run && (
                <>
                    <pre className="overflow-x-auto rounded-lg border bg-[#0e0e11] p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
                        {run.script}
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
