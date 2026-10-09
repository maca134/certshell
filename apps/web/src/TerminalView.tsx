import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { type ITheme, Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import type { ClientMessage, HostSummary } from "@repo/shared";
import { cn } from "cn";
import {
    ChevronDown,
    ChevronLeft,
    ChevronUp,
    RotateCw,
    Search,
    X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
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

export function TerminalView({
    host,
    login,
    onBack,
}: {
    host: HostSummary;
    login: string;
    onBack: () => void;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const [status, setStatus] = useState<Status>({ state: "connecting" });
    const [attempt, setAttempt] = useState(0);
    const [mods, setMods] = useState(NO_MODS);
    const modsRef = useRef(NO_MODS);
    const pressRef = useRef<(key: Key) => void>(() => {});
    const termRef = useRef<Terminal>(undefined);
    const searchRef = useRef<SearchAddon>(undefined);
    const [searching, setSearching] = useState(false);
    const [query, setQuery] = useState("");
    const [missing, setMissing] = useState(false);

    const find = (back = false, q = query, incremental = false) => {
        const search = searchRef.current;
        if (!search || !q) return setMissing(false);
        setMissing(
            !(back
                ? search.findPrevious(q)
                : search.findNext(q, { incremental })),
        );
    };
    const closeSearch = () => {
        setSearching(false);
        setMissing(false);
        termRef.current?.clearSelection();
        termRef.current?.focus();
    };

    useEffect(() => {
        const prev = document.title;
        document.title = `${login}@${host.name}`;
        return () => {
            document.title = prev;
        };
    }, [host.name, login]);

    // biome-ignore lint/correctness/useExhaustiveDependencies: bumping attempt reconnects
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        setStatus({ state: "connecting" });
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
            const search = new SearchAddon();
            term.loadAddon(search);
            termRef.current = term;
            searchRef.current = search;
            term.attachCustomKeyEventHandler((e) => {
                if (
                    e.type !== "keydown" ||
                    !(e.ctrlKey && e.shiftKey && e.code === "KeyF")
                )
                    return true;
                e.preventDefault();
                setSearching(true);
                return false;
            });
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
            ws.onopen = () => setStatus({ state: "connected" });
            ws.onmessage = (e) => term.write(new Uint8Array(e.data));
            ws.onclose = (e) => {
                const reason = e.reason || "connection lost";
                term.write(`\r\n\x1b[2m[${reason}]\x1b[0m\r\n`);
                setStatus({ state: "closed", reason });
            };

            const send = (msg: ClientMessage) => {
                if (ws.readyState === WebSocket.OPEN)
                    ws.send(JSON.stringify(msg));
            };
            // CTRL/ALT on the key bar are one-shot: they apply to the next key, typed or tapped.
            const takeMods = () => {
                const m = modsRef.current;
                modsRef.current = NO_MODS;
                setMods(NO_MODS);
                return m;
            };
            term.onData((d) => send({ t: "in", d: withMods(d, takeMods()) }));
            pressRef.current = (key) => {
                if (key === "CTRL" || key === "ALT") {
                    const k = key === "CTRL" ? "ctrl" : "alt";
                    modsRef.current = {
                        ...modsRef.current,
                        [k]: !modsRef.current[k],
                    };
                    setMods(modsRef.current);
                } else
                    send({
                        t: "in",
                        d: keyBytes(
                            key,
                            takeMods(),
                            term.modes.applicationCursorKeysMode,
                        ),
                    });
            };
            term.onResize(({ cols, rows }) =>
                send({ t: "resize", cols, rows }),
            );
            // Also refits when the search bar opens or closes.
            const resized = new ResizeObserver(() => fit.fit());
            resized.observe(el);
            // Capture runs before xterm's own paste handler. With bracketed paste on, the shell doesn't run pasted lines.
            const onPaste = (e: ClipboardEvent) => {
                const n =
                    e.clipboardData?.getData("text").match(/\r\n|\r|\n/g)
                        ?.length ?? 0;
                if (
                    n &&
                    !term.modes.bracketedPasteMode &&
                    !confirm(
                        `This paste runs ${n} command${n === 1 ? "" : "s"} straight away. Paste anyway?`,
                    )
                ) {
                    e.preventDefault();
                    e.stopPropagation();
                }
            };
            el.addEventListener("paste", onPaste, true);
            term.focus();

            return () => {
                resized.disconnect();
                el.removeEventListener("paste", onPaste, true);
                ws.onclose = null;
                ws.close();
                term.dispose();
            };
        }
    }, [host.id, login, attempt]);

    return (
        <div
            className="flex h-full flex-col"
            style={{ background: THEME.background }}
        >
            <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-sidebar px-2">
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
                <span className="truncate px-1 font-mono text-[13px]">
                    <span className="text-muted-foreground">{login}@</span>
                    {host.name}
                </span>
                <div className="ml-auto flex shrink-0 items-center gap-2">
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground"
                        aria-label="Search scrollback"
                        title="Search scrollback (Ctrl+Shift+F)"
                        onClick={() =>
                            searching ? closeSearch() : setSearching(true)
                        }
                    >
                        <Search />
                    </Button>
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
            {searching && (
                <div className="flex shrink-0 items-center gap-1 border-b bg-sidebar px-2 py-1.5">
                    <Input
                        autoFocus
                        aria-label="Search"
                        placeholder="Search scrollback"
                        className="h-7 max-w-64"
                        value={query}
                        onChange={(e) => {
                            setQuery(e.target.value);
                            find(false, e.target.value, true);
                        }}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") find(e.shiftKey);
                            else if (e.key === "Escape") closeSearch();
                        }}
                    />
                    {missing && (
                        <span className="px-1 text-xs text-muted-foreground">
                            No match
                        </span>
                    )}
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Previous match"
                        onClick={() => find(true)}
                    >
                        <ChevronUp />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Next match"
                        onClick={() => find()}
                    >
                        <ChevronDown />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Close search"
                        onClick={closeSearch}
                    >
                        <X />
                    </Button>
                </div>
            )}
            <div ref={ref} className="min-h-0 flex-1 py-2 pl-3" />
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
                            pressRef.current(key);
                        }}
                    >
                        {key}
                    </button>
                ))}
            </div>
        </div>
    );
}

function StatusPill({ state, reason }: Status) {
    return (
        <span
            title={reason}
            className="flex items-center gap-1.5 rounded-full border bg-background/50 px-2.5 py-1 text-xs text-muted-foreground"
        >
            <span
                className={cn(
                    "size-1.5 rounded-full",
                    state === "connected" &&
                        "bg-emerald-400 shadow-[0_0_6px] shadow-emerald-400/70",
                    state === "connecting" && "animate-pulse bg-amber-400",
                    state === "closed" && "bg-red-400",
                )}
            />
            {state === "connected"
                ? "Connected"
                : state === "connecting"
                  ? "Connecting…"
                  : "Disconnected"}
        </span>
    );
}
