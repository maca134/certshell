import { FitAddon } from "@xterm/addon-fit";
import { type ITheme, Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import type { ClientMessage, HostSummary } from "@repo/shared";
import { cn } from "cn";
import { ChevronLeft, Radio, RotateCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "./components/ui/button";
import { KEYS, type Key, keyBytes, type Mods, withMods } from "./keys";

const NO_MODS: Mods = { ctrl: false, alt: false };

const FONT = '"Geist Mono Variable", ui-monospace, Menlo, monospace';

const THEME: ITheme = {
    background: "#0e0e11",
    foreground: "#e4e4e7",
    cursor: "#e4e4e7",
    cursorAccent: "#0e0e11",
    selectionBackground: "#3b82f666",
    black: "#27272a",
    red: "#f87171",
    green: "#4ade80",
    yellow: "#facc15",
    blue: "#60a5fa",
    magenta: "#c084fc",
    cyan: "#22d3ee",
    white: "#d4d4d8",
    brightBlack: "#71717a",
    brightRed: "#fca5a5",
    brightGreen: "#86efac",
    brightYellow: "#fde047",
    brightBlue: "#93c5fd",
    brightMagenta: "#d8b4fe",
    brightCyan: "#67e8f9",
    brightWhite: "#fafafa",
};

type Status = { state: "connecting" | "connected" | "closed"; reason?: string };

type PaneHandle = {
    send: (d: string) => void;
    sendKey: (key: Key, mods: Mods) => void;
};

export type Target = { host: HostSummary; login: string };

export function TerminalView({
    host,
    login,
    onBack,
}: Target & { onBack: () => void }) {
    const [status, setStatus] = useState<Status>({ state: "connecting" });
    const [attempt, setAttempt] = useState(0);
    const { mods, toggle, take } = useMods();
    const pane = useRef<PaneHandle | null>(null);
    useTitle(`${login}@${host.name}`);

    return (
        <div
            className="flex h-full flex-col"
            style={{ background: THEME.background }}
        >
            <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-sidebar px-2">
                <BackButton onBack={onBack} />
                <span className="truncate px-1 font-mono text-[13px]">
                    <span className="text-muted-foreground">{login}@</span>
                    {host.name}
                </span>
                <div className="ml-auto flex shrink-0 items-center gap-2">
                    {status.state === "closed" && (
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setAttempt((a) => a + 1)}
                        >
                            <RotateCw />
                            Reconnect
                        </Button>
                    )}
                    <StatusPill {...status} />
                </div>
            </header>
            <TerminalPane
                host={host}
                login={login}
                attempt={attempt}
                autoFocus
                className="min-h-0 flex-1 py-2 pl-3"
                paneRef={(h) => {
                    pane.current = h;
                }}
                onInput={(d) => pane.current?.send(withMods(d, take()))}
                onStatus={setStatus}
            />
            <KeyBar
                mods={mods}
                onPress={(key) =>
                    key === "CTRL" || key === "ALT"
                        ? toggle(key)
                        : pane.current?.sendKey(key, take())
                }
            />
        </div>
    );
}

/** One terminal per target; with sync on, typing in any pane goes to all of them. */
export function BroadcastView({
    targets,
    onBack,
}: {
    targets: Target[];
    onBack: () => void;
}) {
    const panes = useRef<(PaneHandle | null)[]>([]);
    const [statuses, setStatuses] = useState<Status[]>(() =>
        targets.map(() => ({ state: "connecting" })),
    );
    const [attempts, setAttempts] = useState(() => targets.map(() => 0));
    const [sync, setSync] = useState(true);
    const [focused, setFocused] = useState(0);
    const { mods, toggle, take } = useMods();
    useTitle(`Broadcast (${targets.length})`);

    const recipients = (i: number) =>
        sync ? panes.current : [panes.current[i]];
    const connected = statuses.filter((s) => s.state === "connected").length;

    return (
        <div
            className="flex h-full flex-col"
            style={{ background: THEME.background }}
        >
            <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-sidebar px-2">
                <BackButton onBack={onBack} />
                <span className="truncate px-1 text-[13px] text-muted-foreground">
                    {connected}/{targets.length} connected
                </span>
                <Button
                    variant={sync ? "default" : "secondary"}
                    size="sm"
                    className="ml-auto"
                    aria-pressed={sync}
                    onClick={() => setSync((s) => !s)}
                >
                    <Radio />
                    {sync ? "Typing to all" : "Typing to one"}
                </Button>
            </header>
            <div className="grid min-h-0 flex-1 auto-rows-[minmax(14rem,1fr)] gap-px overflow-y-auto bg-border md:grid-cols-2">
                {targets.map(({ host, login }, i) => (
                    <section
                        key={`${host.id}:${login}`}
                        aria-label={`${login}@${host.name}`}
                        className={cn(
                            "flex min-h-0 flex-col -outline-offset-1 md:last:odd:col-span-2",
                            sync && "outline-1 outline-primary/40",
                            i === focused && "outline-1 outline-primary",
                        )}
                        style={{ background: THEME.background }}
                        onFocus={() => setFocused(i)}
                    >
                        <div className="flex h-8 shrink-0 items-center gap-2 border-b bg-sidebar px-3 font-mono text-xs">
                            <StatusDot state={statuses[i].state} />
                            <span
                                className="truncate"
                                title={statuses[i].reason}
                            >
                                <span className="text-muted-foreground">
                                    {login}@
                                </span>
                                {host.name}
                            </span>
                            {statuses[i].state === "closed" && (
                                <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    className="ml-auto"
                                    aria-label="Reconnect"
                                    title="Reconnect"
                                    onClick={() =>
                                        setAttempts((a) =>
                                            a.map((n, j) =>
                                                j === i ? n + 1 : n,
                                            ),
                                        )
                                    }
                                >
                                    <RotateCw />
                                </Button>
                            )}
                        </div>
                        <TerminalPane
                            host={host}
                            login={login}
                            attempt={attempts[i]}
                            autoFocus={i === 0}
                            className="min-h-0 flex-1 py-1 pl-2"
                            paneRef={(h) => {
                                panes.current[i] = h;
                            }}
                            onInput={(d) => {
                                const m = take();
                                for (const p of recipients(i))
                                    p?.send(withMods(d, m));
                            }}
                            onStatus={(s) =>
                                setStatuses((prev) =>
                                    prev.map((p, j) => (j === i ? s : p)),
                                )
                            }
                        />
                    </section>
                ))}
            </div>
            <KeyBar
                mods={mods}
                onPress={(key) => {
                    if (key === "CTRL" || key === "ALT") return toggle(key);
                    const m = take();
                    for (const p of recipients(focused)) p?.sendKey(key, m);
                }}
            />
        </div>
    );
}

function TerminalPane({
    host,
    login,
    attempt,
    autoFocus = false,
    className,
    paneRef,
    onInput,
    onStatus,
}: Target & {
    attempt: number;
    autoFocus?: boolean;
    className?: string;
    paneRef: (handle: PaneHandle | null) => void;
    onInput: (d: string) => void;
    onStatus: (s: Status) => void;
}) {
    const ref = useRef<HTMLDivElement>(null);
    // Read through a ref so new callbacks each render don't reconnect.
    const props = useRef({ autoFocus, paneRef, onInput, onStatus });
    props.current = { autoFocus, paneRef, onInput, onStatus };

    // biome-ignore lint/correctness/useExhaustiveDependencies: bumping attempt reconnects
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        props.current.onStatus({ state: "connecting" });
        let live = true;
        let cleanup = () => {};
        // xterm measures the font once on open; a late webfont would leave the grid mis-sized.
        document.fonts.load(`13px ${FONT}`).finally(() => {
            if (live) cleanup = start(el);
        });
        return () => {
            live = false;
            cleanup();
        };

        function start(el: HTMLDivElement) {
            const term = new Terminal({
                cursorBlink: true,
                fontFamily: FONT,
                fontSize: 13,
                lineHeight: 1.2,
                theme: THEME,
            });
            const fit = new FitAddon();
            term.loadAddon(fit);
            term.open(el);
            // Gboard ignores autocorrect="off" (set by xterm); this sometimes stops suggestions.
            term.textarea?.setAttribute("autocomplete", "off");
            fit.fit();

            const url = new URL("/api/terminal", location.href);
            url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
            url.search = new URLSearchParams({
                host: host.id,
                login,
                cols: String(term.cols),
                rows: String(term.rows),
            }).toString();
            const ws = new WebSocket(url);
            ws.binaryType = "arraybuffer";
            ws.onopen = () => props.current.onStatus({ state: "connected" });
            ws.onmessage = (e) => term.write(new Uint8Array(e.data));
            ws.onclose = (e) => {
                const reason = e.reason || "connection lost";
                term.write(`\r\n\x1b[2m[${reason}]\x1b[0m\r\n`);
                props.current.onStatus({ state: "closed", reason });
            };

            const send = (msg: ClientMessage) => {
                if (ws.readyState === WebSocket.OPEN)
                    ws.send(JSON.stringify(msg));
            };
            term.onData((d) => props.current.onInput(d));
            props.current.paneRef({
                send: (d) => send({ t: "in", d }),
                sendKey: (key, mods) =>
                    send({
                        t: "in",
                        d: keyBytes(
                            key,
                            mods,
                            term.modes.applicationCursorKeysMode,
                        ),
                    }),
            });
            term.onResize(({ cols, rows }) =>
                send({ t: "resize", cols, rows }),
            );
            // Fitting inside the callback resizes the observed element again: a ResizeObserver loop error.
            let frame = 0;
            const resize = new ResizeObserver(() => {
                cancelAnimationFrame(frame);
                frame = requestAnimationFrame(() => fit.fit());
            });
            resize.observe(el);
            if (props.current.autoFocus) term.focus();

            return () => {
                resize.disconnect();
                cancelAnimationFrame(frame);
                props.current.paneRef(null);
                ws.onclose = null;
                ws.close();
                term.dispose();
            };
        }
    }, [host.id, login, attempt]);

    return <div ref={ref} className={className} />;
}

// CTRL/ALT on the key bar are one-shot: they apply to the next key, typed or tapped.
function useMods() {
    const [mods, setMods] = useState(NO_MODS);
    const ref = useRef(NO_MODS);
    const set = (m: Mods) => {
        ref.current = m;
        setMods(m);
    };
    return {
        mods,
        toggle: (key: "CTRL" | "ALT") => {
            const k = key === "CTRL" ? "ctrl" : "alt";
            set({ ...ref.current, [k]: !ref.current[k] });
        },
        take: () => {
            const m = ref.current;
            set(NO_MODS);
            return m;
        },
    };
}

function useTitle(title: string) {
    useEffect(() => {
        const prev = document.title;
        document.title = title;
        return () => {
            document.title = prev;
        };
    }, [title]);
}

function BackButton({ onBack }: { onBack: () => void }) {
    return (
        <>
            <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={onBack}
            >
                <ChevronLeft />
                Hosts
            </Button>
            <div className="h-4 w-px bg-border" />
        </>
    );
}

function KeyBar({
    mods,
    onPress,
}: {
    mods: Mods;
    onPress: (key: Key) => void;
}) {
    return (
        <div className="hidden grid-cols-7 gap-1.5 border-t bg-sidebar p-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] pointer-coarse:grid">
            {KEYS.map((key) => (
                <button
                    type="button"
                    key={key}
                    className={cn(
                        "touch-manipulation rounded-md bg-white/7 py-2.5 text-xs font-medium text-foreground/80 shadow-[inset_0_1px_0_oklch(1_0_0/6%)] select-none active:bg-white/15",
                        ((key === "CTRL" && mods.ctrl) ||
                            (key === "ALT" && mods.alt)) &&
                            "bg-primary text-primary-foreground active:bg-primary",
                    )}
                    // pointerdown + preventDefault keeps focus (and the soft keyboard) on the terminal.
                    onPointerDown={(e) => {
                        e.preventDefault();
                        onPress(key);
                    }}
                >
                    {key}
                </button>
            ))}
        </div>
    );
}

function StatusDot({ state }: { state: Status["state"] }) {
    return (
        <span
            className={cn(
                "size-1.5 shrink-0 rounded-full",
                state === "connected" &&
                    "bg-emerald-400 shadow-[0_0_6px] shadow-emerald-400/70",
                state === "connecting" && "animate-pulse bg-amber-400",
                state === "closed" && "bg-red-400",
            )}
        />
    );
}

function StatusPill({ state, reason }: Status) {
    return (
        <span
            title={reason}
            className="flex items-center gap-1.5 rounded-full border bg-background/50 px-2.5 py-1 text-xs text-muted-foreground"
        >
            <StatusDot state={state} />
            {state === "connected"
                ? "Connected"
                : state === "connecting"
                  ? "Connecting…"
                  : "Disconnected"}
        </span>
    );
}
