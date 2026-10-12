import {
    detached,
    type HostSummary,
    type RunDetail,
    type RunHost,
    type RunStatus,
    type RunSummary,
    type Task,
    type TaskInput,
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
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { Link, Route, Switch, useLocation, useSearch } from "wouter";
import { AMBER, GREEN, When } from "./Admin";
import { api } from "./api";
import { EmptyState, Page, TagFilter } from "./components/layout";
import { Alert, AlertDescription } from "./components/ui/alert";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import {
    diffLines,
    groupOutputs,
    type OutputGroup,
    withContext,
} from "./outputs";
import { withTags } from "./tags";

const MAX_TARGETS = 50;

const RED = "border-red-400/20 bg-red-400/10 text-red-300";
const STATUS: Record<RunStatus, string> = {
    running: AMBER,
    ok: GREEN,
    failed: RED,
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
                        <Badge key={s} className={STATUS[s]}>
                            {counts[s]} {s}
                        </Badge>
                    ),
            )}
        </span>
    );
}

function TaskForm({ id, hosts }: { id?: number; hosts?: HostSummary[] }) {
    const [, navigate] = useLocation();
    const search = useSearch();
    const [name, setName] = useState("");
    const [script, setScript] = useState("");
    const [detach, setDetach] = useState(false);
    // `?hosts=h1,h2` (from Fleet) preselects hosts on a new task.
    const [checked, setChecked] = useState<string[]>(() =>
        id === undefined
            ? (new URLSearchParams(search).get("hosts")?.split(",") ?? [])
            : [],
    );
    // hostId → login picked in that host's dropdown; unset means its first login.
    const [picked, setPicked] = useState<Record<string, string>>({});
    const [error, setError] = useState<string>();
    const [busy, setBusy] = useState(false);
    const [tagFilter, setTagFilter] = useState<string[]>([]);
    const tags = [...new Set(hosts?.flatMap((h) => h.tags))].sort();

    useEffect(() => {
        if (id === undefined) return;
        api<Task[]>("/api/tasks").then((tasks) => {
            const task = tasks.find((t) => t.id === id);
            if (!task) return setError("Task not found");
            setName(task.name);
            setScript(task.script);
            setDetach(task.detach);
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
            detach,
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
                    <div className="flex flex-col gap-1.5">
                        <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium">
                            <input
                                type="checkbox"
                                className="size-4 shrink-0 accent-primary"
                                checked={detach}
                                onChange={(e) => setDetach(e.target.checked)}
                            />
                            Keep running if the connection drops
                        </label>
                        <p className="pl-6.5 text-xs text-muted-foreground">
                            Without this, a dropped connection (app restart, VPN
                            or network blip) can kill the script halfway. Turn
                            it on for anything that can cut the connection
                            itself: NetBird or VPN upgrades, sshd, firewall,
                            network config. Output also goes to a log file on
                            the host, in case the app loses track of the run.
                        </p>
                        {detach && (
                            <details className="pl-6.5">
                                <summary className="cursor-pointer text-xs text-primary select-none">
                                    Show what runs on each host
                                </summary>
                                <pre className="mt-2 max-h-72 overflow-auto rounded-lg border bg-[#0e0e11] p-3 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap">
                                    {detached(script || "your script")}
                                </pre>
                            </details>
                        )}
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
                        {tags.length > 0 && (
                            <TagFilter
                                tags={tags}
                                selected={tagFilter}
                                onChange={setTagFilter}
                            />
                        )}
                        {!!hosts?.length &&
                            withTags(hosts, tagFilter).length === 0 && (
                                <p className="text-sm text-muted-foreground">
                                    No host has all the selected tags.
                                </p>
                            )}
                        <ul className="divide-y rounded-lg border empty:hidden">
                            {withTags(hosts ?? [], tagFilter).map((host) => (
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
    // Unset until the user picks: grouped when at least two hosts share an output.
    const [byOutput, setByOutput] = useState<boolean>();
    const groups = groupOutputs(run?.hosts ?? []);
    const finished = groups.reduce((n, g) => n + g.hosts.length, 0);
    const grouped = finished >= 2 && (byOutput ?? groups.length < finished);

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
                    {run.detach && (
                        <p className="text-xs text-muted-foreground">
                            Kept running if the connection dropped. The log file
                            on each host is named in its output.
                        </p>
                    )}
                    <pre className="overflow-x-auto rounded-lg border bg-[#0e0e11] p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
                        {run.script}
                    </pre>
                    {finished >= 2 && (
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <span className="text-sm text-muted-foreground">
                                {groups.length === 1
                                    ? `All ${finished} finished hosts: same output`
                                    : `${finished} finished hosts: ${groups.length} different outputs`}
                            </span>
                            <div className="flex gap-0.5 rounded-md border p-0.5">
                                {[false, true].map((g) => (
                                    <Button
                                        key={String(g)}
                                        size="xs"
                                        variant={
                                            grouped === g
                                                ? "secondary"
                                                : "ghost"
                                        }
                                        aria-pressed={grouped === g}
                                        onClick={() => setByOutput(g)}
                                    >
                                        {g ? "Group by output" : "By host"}
                                    </Button>
                                ))}
                            </div>
                        </div>
                    )}
                    <Card className="gap-0 py-0">
                        <ul className="divide-y">
                            {grouped
                                ? [
                                      ...groups.map((g, i) => (
                                          <GroupResult
                                              key={`${g.exitCode}:${g.hosts[0]?.hostId}:${g.hosts[0]?.login}`}
                                              group={g}
                                              base={
                                                  i > 0
                                                      ? groups[0]?.output
                                                      : undefined
                                              }
                                          />
                                      )),
                                      ...run.hosts
                                          .filter((h) => h.status === "running")
                                          .map((h) => (
                                              <HostResult
                                                  key={`${h.hostId}:${h.login}`}
                                                  {...h}
                                              />
                                          )),
                                  ]
                                : run.hosts.map((h) => (
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

function StatusBadge({ status }: { status: RunStatus }) {
    return (
        <Badge className={STATUS[status]}>
            <span
                className={cn(
                    "size-1.5 rounded-full bg-current",
                    status === "running" && "animate-pulse",
                )}
            />
            {status}
        </Badge>
    );
}

function ResultRow({
    label,
    status,
    exitCode,
    children,
}: {
    label: ReactNode;
    status: RunStatus;
    exitCode: number | null;
    children: ReactNode;
}) {
    return (
        <li>
            <details className="group">
                <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/60 [&::-webkit-details-marker]:hidden">
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
                    {label}
                    <span className="ml-auto flex shrink-0 items-center gap-2">
                        {exitCode !== null && (
                            <span className="text-xs text-muted-foreground tabular-nums">
                                exit {exitCode}
                            </span>
                        )}
                        <StatusBadge status={status} />
                    </span>
                </summary>
                {children}
            </details>
        </li>
    );
}

const OUTPUT =
    "max-h-96 overflow-auto border-t bg-[#0e0e11] px-4 py-3 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap";

function HostResult({ hostName, login, status, exitCode, output }: RunHost) {
    return (
        <ResultRow
            label={
                <span className="min-w-0 truncate font-mono text-sm">
                    <span className="text-muted-foreground">{login}@</span>
                    {hostName}
                </span>
            }
            status={status}
            exitCode={exitCode}
        >
            <pre className={OUTPUT}>{output || "(no output yet)"}</pre>
        </ResultRow>
    );
}

/** `base`: the biggest group's output; set on every other group, which then shows its diff against it. */
function GroupResult({ group, base }: { group: OutputGroup; base?: string }) {
    const names = group.hosts.map((h) => `${h.login}@${h.hostName}`);
    const diff =
        base === undefined ? [] : withContext(diffLines(base, group.output));
    const sameOutput = diff.every((d) => "skipped" in d);
    return (
        <ResultRow
            label={
                <span className="flex min-w-0 flex-col">
                    <span className="text-sm font-medium">
                        {group.hosts.length} host
                        {group.hosts.length === 1 ? "" : "s"}
                        {base !== undefined && (
                            <span className="font-normal text-muted-foreground">
                                {" · differs from the most common output"}
                            </span>
                        )}
                    </span>
                    <span
                        className="truncate font-mono text-xs text-muted-foreground"
                        title={names.join(", ")}
                    >
                        {names.join(", ")}
                    </span>
                </span>
            }
            status={group.status}
            exitCode={group.exitCode}
        >
            <pre className={OUTPUT}>
                {base === undefined
                    ? group.output || "(no output)"
                    : sameOutput
                      ? "Same output as the most common one; only the exit code differs."
                      : diff.map((d, i) => (
                            <div
                                // biome-ignore lint/suspicious/noArrayIndexKey: lines have no identity of their own
                                key={i}
                                className={cn(
                                    "skipped" in d && "text-muted-foreground",
                                    "op" in d &&
                                        d.op === "-" &&
                                        "bg-red-400/10 text-red-300",
                                    "op" in d &&
                                        d.op === "+" &&
                                        "bg-emerald-400/10 text-emerald-300",
                                )}
                            >
                                {"skipped" in d
                                    ? `… ${d.skipped} unchanged line${d.skipped === 1 ? "" : "s"}`
                                    : `${d.op} ${d.text}`}
                            </div>
                        ))}
            </pre>
        </ResultRow>
    );
}
