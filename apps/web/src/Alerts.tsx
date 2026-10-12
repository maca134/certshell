import {
    type AdminHost,
    ALERT_EVENTS,
    type AlertChannel,
    type AlertEvent,
    type AlertInput,
} from "@repo/shared";
import { Bell, Pencil, Plus, Send, Trash2 } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import {
    Empty,
    Head,
    noFill,
    RowAction,
    TagInput,
    tableBody,
    When,
} from "./Admin";
import { api } from "./api";
import { EmptyState, Page } from "./components/layout";
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
    TableRow,
} from "./components/ui/table";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "./components/ui/tooltip";

const SERVICES_DOC =
    "https://github.com/nicholas-fedor/shoutrrr/blob/main/docs/services/overview.md";

const EVENTS = Object.keys(ALERT_EVENTS) as AlertEvent[];

export function Alerts() {
    const [channels, setChannels] = useState<AlertChannel[]>();
    const [tags, setTags] = useState<string[]>([]);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const reload = useCallback(
        () =>
            api<AlertChannel[]>("/api/admin/alerts").then(setChannels, (e) =>
                setError(e.message),
            ),
        [],
    );
    useEffect(() => {
        reload();
        api<AdminHost[]>("/api/admin/hosts").then(
            (hosts) =>
                setTags([...new Set(hosts.flatMap((h) => h.tags))].sort()),
            () => {},
        );
    }, [reload]);

    const test = async (c: AlertChannel) => {
        setError("");
        setNotice("");
        try {
            await api(`/api/admin/alerts/${c.id}/test`, "POST");
            setNotice(`Test alert sent to ${c.name}.`);
        } catch (e) {
            setError(`${c.name}: ${(e as Error).message}`);
        }
        await reload();
    };
    const remove = async (c: AlertChannel) => {
        setError("");
        setNotice("");
        await api(`/api/admin/alerts/${c.id}`, "DELETE").catch((e) =>
            setError(e.message),
        );
        await reload();
    };

    return (
        <Page
            title="Alerts"
            description={
                <>
                    Notifications through{" "}
                    <a
                        href={SERVICES_DOC}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                    >
                        shoutrrr
                    </a>
                    : ntfy, Gotify, Discord, Slack, Telegram, email, webhooks
                    and more.
                </>
            }
            actions={<ChannelDialog allTags={tags} onSaved={reload} />}
        >
            {error && (
                <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            )}
            {notice && (
                <Alert>
                    <AlertDescription>{notice}</AlertDescription>
                </Alert>
            )}
            <Card className="py-0">
                <Table>
                    <Head>
                        <TableHead>Channel</TableHead>
                        <TableHead className="hidden sm:table-cell">
                            Events
                        </TableHead>
                        <TableHead className="hidden sm:table-cell">
                            Last sent
                        </TableHead>
                        <TableHead className="w-0" />
                    </Head>
                    <TableBody className={tableBody}>
                        {channels?.length === 0 && (
                            <Empty cols={4}>
                                <EmptyState
                                    icon={Bell}
                                    title="No alert channels"
                                >
                                    Add a shoutrrr URL, e.g.{" "}
                                    <code>ntfy://ntfy.sh/my-topic</code>, and
                                    pick the events to send to it.
                                </EmptyState>
                            </Empty>
                        )}
                        {channels?.map((c) => (
                            <TableRow key={c.id}>
                                <TableCell className="whitespace-normal">
                                    <div className="font-medium">{c.name}</div>
                                    <div className="font-mono text-xs text-muted-foreground">
                                        {c.service}
                                    </div>
                                </TableCell>
                                <TableCell className="hidden whitespace-normal sm:table-cell">
                                    <div className="flex flex-wrap gap-1">
                                        {c.events.map((e) => (
                                            <Badge
                                                key={e}
                                                variant="secondary"
                                                className="font-normal"
                                            >
                                                {ALERT_EVENTS[e].label}
                                            </Badge>
                                        ))}
                                        {c.events.includes("terminal") &&
                                            [...c.tags, ...c.logins].length >
                                                0 && (
                                                <span className="text-xs text-muted-foreground">
                                                    on{" "}
                                                    {[
                                                        ...c.tags,
                                                        ...c.logins,
                                                    ].join(", ")}
                                                </span>
                                            )}
                                    </div>
                                </TableCell>
                                <TableCell className="hidden whitespace-normal sm:table-cell">
                                    {c.lastSentAt ? (
                                        <When t={c.lastSentAt} />
                                    ) : (
                                        <span className="text-muted-foreground">
                                            Never
                                        </span>
                                    )}
                                    {c.lastError && (
                                        <div
                                            className="text-xs text-red-300"
                                            title={c.lastError}
                                        >
                                            Failed: {c.lastError}
                                        </div>
                                    )}
                                </TableCell>
                                <TableCell>
                                    <div className="flex justify-end gap-0.5">
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Button
                                                    variant="ghost"
                                                    size="icon-sm"
                                                    aria-label={`Send a test alert to ${c.name}`}
                                                    className="text-muted-foreground"
                                                    onClick={() => test(c)}
                                                >
                                                    <Send />
                                                </Button>
                                            </TooltipTrigger>
                                            <TooltipContent>
                                                Send test
                                            </TooltipContent>
                                        </Tooltip>
                                        <ChannelDialog
                                            channel={c}
                                            allTags={tags}
                                            onSaved={reload}
                                        />
                                        <RemoveChannel
                                            channel={c}
                                            onDelete={() => remove(c)}
                                        />
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </Card>
        </Page>
    );
}

/** Add (no `channel`) or edit dialog. On edit the URL field starts empty: blank keeps the stored URL. */
function ChannelDialog({
    channel,
    allTags,
    onSaved,
}: {
    channel?: AlertChannel;
    allTags: string[];
    onSaved: () => Promise<void>;
}) {
    const [open, setOpen] = useState(false);
    const [name, setName] = useState("");
    const [url, setUrl] = useState("");
    const [events, setEvents] = useState<AlertEvent[]>([]);
    const [tags, setTags] = useState<string[]>([]);
    const [logins, setLogins] = useState("");
    const [error, setError] = useState("");
    const id = channel ? `alert-${channel.id}` : "alert-new";
    const openChange = (o: boolean) => {
        setOpen(o);
        if (!o) return;
        setName(channel?.name ?? "");
        setUrl("");
        setEvents(channel?.events ?? ["security"]);
        setTags(channel?.tags ?? []);
        setLogins(channel?.logins.join(", ") ?? "");
        setError("");
    };
    const toggle = (e: AlertEvent, on: boolean) =>
        setEvents((ev) => (on ? [...ev, e] : ev.filter((x) => x !== e)));
    const save = async (e: FormEvent) => {
        e.preventDefault();
        setError("");
        const terminal = events.includes("terminal");
        const body: AlertInput = {
            name: name.trim(),
            events,
            tags: terminal ? tags : [],
            logins: terminal ? logins.split(/[\s,]+/).filter(Boolean) : [],
            ...(url.trim() ? { url: url.trim() } : {}),
        };
        try {
            if (channel)
                await api(`/api/admin/alerts/${channel.id}`, "PUT", body);
            else await api("/api/admin/alerts", "POST", body);
            await onSaved();
            setOpen(false);
        } catch (err) {
            setError((err as Error).message);
        }
    };
    return (
        <Dialog open={open} onOpenChange={openChange}>
            {channel ? (
                <RowAction label={`Edit ${channel.name}`} tooltip="Edit">
                    <Pencil />
                </RowAction>
            ) : (
                <DialogTrigger asChild>
                    <Button size="sm">
                        <Plus />
                        Add channel
                    </Button>
                </DialogTrigger>
            )}
            <DialogContent className="max-h-[calc(100dvh-2rem)] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>
                        {channel ? `Edit ${channel.name}` : "Add alert channel"}
                    </DialogTitle>
                    <DialogDescription>
                        The URL holds the service's token. It's stored encrypted
                        when <code>ca_password</code> is set, and never shown
                        again.
                    </DialogDescription>
                </DialogHeader>
                {error && (
                    <Alert variant="destructive">
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                )}
                <form id={id} className="flex flex-col gap-4" onSubmit={save}>
                    <div className="flex flex-col gap-2">
                        <Label htmlFor={`${id}-name`}>Name</Label>
                        <Input
                            {...noFill}
                            id={`${id}-name`}
                            placeholder="Ops on ntfy"
                            maxLength={64}
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            required
                        />
                    </div>
                    <div className="flex flex-col gap-2">
                        <Label htmlFor={`${id}-url`}>Shoutrrr URL</Label>
                        <Input
                            {...noFill}
                            id={`${id}-url`}
                            className="font-mono"
                            placeholder={
                                channel
                                    ? `${channel.service}://… (blank keeps the current URL)`
                                    : "ntfy://ntfy.sh/my-topic"
                            }
                            maxLength={2048}
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                            required={!channel}
                        />
                        <p className="text-xs text-muted-foreground">
                            URL formats for each service:{" "}
                            <a
                                href={SERVICES_DOC}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:underline"
                            >
                                shoutrrr services
                            </a>
                            .
                        </p>
                    </div>
                    <fieldset className="flex flex-col gap-2.5">
                        <legend className="mb-2 text-sm font-medium">
                            Events
                        </legend>
                        {EVENTS.map((e) => (
                            <label
                                key={e}
                                className="flex cursor-pointer items-start gap-2.5 text-sm"
                            >
                                <input
                                    type="checkbox"
                                    className="mt-0.5 size-4 shrink-0 accent-primary"
                                    checked={events.includes(e)}
                                    onChange={(ev) =>
                                        toggle(e, ev.target.checked)
                                    }
                                />
                                <span className="flex flex-col">
                                    <span className="font-medium">
                                        {ALERT_EVENTS[e].label}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                        {ALERT_EVENTS[e].description}
                                    </span>
                                </span>
                            </label>
                        ))}
                    </fieldset>
                </form>
                {events.includes("terminal") && (
                    <div className="flex flex-col gap-3 rounded-lg border p-3">
                        <p className="text-xs text-muted-foreground">
                            Terminal alerts only for hosts with any of these
                            tags, or for these logins. Leave both empty for
                            every terminal.
                        </p>
                        <div className="flex flex-col gap-2">
                            <Label htmlFor={`${id}-tags`}>Host tags</Label>
                            <TagInput
                                id={`${id}-tags`}
                                tags={tags}
                                allTags={allTags}
                                onChange={setTags}
                            />
                        </div>
                        <div className="flex flex-col gap-2">
                            <Label htmlFor={`${id}-logins`}>Logins</Label>
                            <Input
                                {...noFill}
                                id={`${id}-logins`}
                                form={id}
                                className="font-mono"
                                placeholder="root, admin"
                                value={logins}
                                onChange={(e) => setLogins(e.target.value)}
                            />
                        </div>
                    </div>
                )}
                <DialogFooter>
                    <DialogClose asChild>
                        <Button variant="outline">Cancel</Button>
                    </DialogClose>
                    <Button type="submit" form={id} disabled={!events.length}>
                        Save
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function RemoveChannel({
    channel,
    onDelete,
}: {
    channel: AlertChannel;
    onDelete: () => void;
}) {
    return (
        <Dialog>
            <RowAction
                label={`Remove ${channel.name}`}
                tooltip="Remove"
                className="hover:text-destructive"
            >
                <Trash2 />
            </RowAction>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Remove {channel.name}</DialogTitle>
                    <DialogDescription>
                        No more alerts go to this {channel.service} channel.
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <DialogClose asChild>
                        <Button variant="outline">Cancel</Button>
                    </DialogClose>
                    <Button variant="destructive" onClick={onDelete}>
                        <Trash2 />
                        Remove channel
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
