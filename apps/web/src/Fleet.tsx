import type { HostFactsRow } from "@repo/shared";
import { cn } from "cn";
import { Gauge, ListTodo, RotateCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { Empty, Head, tableBody, When } from "./Admin";
import { api } from "./api";
import { EmptyState, Page, Tag } from "./components/layout";
import { Alert, AlertDescription } from "./components/ui/alert";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card } from "./components/ui/card";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
} from "./components/ui/table";

const DISK_FULL = 90;

const FILTERS = {
    reboot: {
        label: "Need a reboot",
        test: (r: HostFactsRow) => !!r.facts?.reboot,
    },
    updates: {
        label: "Have updates",
        test: (r: HostFactsRow) => (r.facts?.updates ?? 0) > 0,
    },
    disk: {
        label: `Disk ≥ ${DISK_FULL}%`,
        test: (r: HostFactsRow) => (r.facts?.disk ?? 0) >= DISK_FULL,
    },
    missing: {
        label: "Not collected",
        test: (r: HostFactsRow) => !r.login || !r.facts || !!r.error,
    },
} as const;

type Filter = keyof typeof FILTERS;

function uptime(seconds: number) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    return d ? `${d}d ${h}h` : `${h}h ${Math.floor((seconds % 3600) / 60)}m`;
}

export function Fleet() {
    const [rows, setRows] = useState<HostFactsRow[]>();
    const [filter, setFilter] = useState<Filter>();
    const [error, setError] = useState("");
    const reload = useCallback(
        () =>
            api<HostFactsRow[]>("/api/admin/facts").then(setRows, (e) =>
                setError(e.message),
            ),
        [],
    );
    useEffect(() => {
        reload();
    }, [reload]);
    const busy = rows?.some((r) => r.collecting);
    useEffect(() => {
        if (!busy) return;
        const timer = setInterval(reload, 2000);
        return () => clearInterval(timer);
    }, [busy, reload]);

    const act = async (path: string) => {
        setError("");
        const done = api(path, "POST").catch((e) => setError(e.message));
        await reload();
        await done;
        await reload();
    };

    const shown = rows?.filter((r) => !filter || FILTERS[filter].test(r));
    const security = (rows ?? [])
        .filter(FILTERS.updates.test)
        .reduce((n, r) => n + (r.facts?.security ?? 0), 0);

    return (
        <Page
            title="Fleet"
            description="What each enrolled host reports, collected every 6 hours with its facts login (Manage hosts → Edit)."
            actions={
                <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => act("/api/admin/facts/refresh")}
                >
                    <RotateCw className={cn(busy && "animate-spin")} />
                    Refresh all
                </Button>
            }
        >
            {error && (
                <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            )}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {(Object.keys(FILTERS) as Filter[]).map((f) => (
                    <button
                        key={f}
                        type="button"
                        aria-pressed={filter === f}
                        onClick={() => setFilter(filter === f ? undefined : f)}
                        className="flex cursor-pointer flex-col gap-1 rounded-xl border bg-card p-4 text-left transition-colors hover:bg-muted/60 aria-pressed:border-primary"
                    >
                        <span className="text-sm text-muted-foreground">
                            {FILTERS[f].label}
                        </span>
                        <span className="text-2xl font-semibold tabular-nums">
                            {rows?.filter(FILTERS[f].test).length ?? "–"}
                        </span>
                        {f === "updates" && security > 0 && (
                            <span className="text-xs text-red-300">
                                {security} security update
                                {security === 1 ? "" : "s"}
                            </span>
                        )}
                    </button>
                ))}
            </div>
            {filter && !!shown?.length && (
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="text-sm text-muted-foreground">
                        {FILTERS[filter].label}: {shown.length} host
                        {shown.length === 1 ? "" : "s"}
                    </span>
                    <Button size="sm" variant="secondary" asChild>
                        <Link
                            href={`~/tasks/new?hosts=${shown.map((r) => r.hostId).join(",")}`}
                        >
                            <ListTodo />
                            New task on these hosts
                        </Link>
                    </Button>
                </div>
            )}
            <Card className="py-0">
                <Table>
                    <Head>
                        <TableHead>Host</TableHead>
                        <TableHead className="hidden md:table-cell">
                            System
                        </TableHead>
                        <TableHead className="hidden sm:table-cell">
                            Uptime
                        </TableHead>
                        <TableHead>Updates</TableHead>
                        <TableHead className="hidden sm:table-cell">
                            Disk /
                        </TableHead>
                        <TableHead className="hidden sm:table-cell">
                            Collected
                        </TableHead>
                        <TableHead className="w-0" />
                    </Head>
                    <TableBody className={tableBody}>
                        {shown?.length === 0 && (
                            <Empty cols={7}>
                                <EmptyState
                                    icon={Gauge}
                                    title={
                                        filter
                                            ? "No hosts match"
                                            : "No enrolled hosts"
                                    }
                                />
                            </Empty>
                        )}
                        {shown?.map((r) => (
                            <FactsRow
                                key={r.hostId}
                                row={r}
                                onRefresh={() =>
                                    act(`/api/admin/facts/${r.hostId}/refresh`)
                                }
                            />
                        ))}
                    </TableBody>
                </Table>
            </Card>
        </Page>
    );
}

function FactsRow({
    row: r,
    onRefresh,
}: {
    row: HostFactsRow;
    onRefresh: () => void;
}) {
    const f = r.facts;
    const dash = <span className="text-muted-foreground">—</span>;
    return (
        <TableRow>
            <TableCell className="whitespace-normal">
                <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">{r.hostName}</span>
                    {f?.reboot && (
                        <Badge className="border-amber-400/20 bg-amber-400/10 text-amber-300">
                            reboot
                        </Badge>
                    )}
                </div>
                {r.error && (
                    <div
                        className="text-xs text-red-300 sm:hidden"
                        title={r.error}
                    >
                        Collection failed
                    </div>
                )}
                {r.tags.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                        {r.tags.map((t) => (
                            <Tag key={t} name={t} />
                        ))}
                    </div>
                )}
            </TableCell>
            <TableCell className="hidden whitespace-normal md:table-cell">
                {f?.os ?? dash}
                {f && (
                    <div className="font-mono text-xs text-muted-foreground">
                        {[f.kernel, f.arch, f.openssh]
                            .filter(Boolean)
                            .join(" · ")}
                    </div>
                )}
            </TableCell>
            <TableCell className="hidden tabular-nums sm:table-cell">
                {f?.uptime === undefined ? dash : uptime(f.uptime)}
            </TableCell>
            <TableCell className="whitespace-normal tabular-nums">
                {f?.updates === undefined ? (
                    dash
                ) : (
                    <>
                        {f.updates}
                        {!!f.security && (
                            <div className="text-xs text-red-300">
                                {f.security} security
                            </div>
                        )}
                    </>
                )}
            </TableCell>
            <TableCell
                className={cn(
                    "hidden tabular-nums sm:table-cell",
                    (f?.disk ?? 0) >= DISK_FULL && "text-red-300",
                )}
            >
                {f?.disk === undefined ? dash : `${f.disk}%`}
            </TableCell>
            <TableCell className="hidden whitespace-normal sm:table-cell">
                {!r.login ? (
                    <span className="text-muted-foreground">
                        No facts login
                    </span>
                ) : r.collectedAt ? (
                    <>
                        <When t={r.collectedAt} />{" "}
                        <span className="font-mono text-xs text-muted-foreground">
                            as {r.login}
                        </span>
                    </>
                ) : (
                    <span className="text-muted-foreground">Not yet</span>
                )}
                {r.error && (
                    <div className="text-xs text-red-300" title={r.error}>
                        Failed: {r.error}
                    </div>
                )}
            </TableCell>
            <TableCell>
                {r.login && (
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Refresh ${r.hostName}`}
                        className="text-muted-foreground"
                        disabled={r.collecting}
                        onClick={onRefresh}
                    >
                        <RotateCw
                            className={cn(r.collecting && "animate-spin")}
                        />
                    </Button>
                )}
            </TableCell>
        </TableRow>
    );
}
