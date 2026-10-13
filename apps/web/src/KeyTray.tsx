import type { Terminal } from "@xterm/xterm";
import { cn } from "cn";
import {
    ArrowDown,
    ArrowLeft,
    ArrowRight,
    ArrowUp,
    ChevronDown,
    CornerDownLeft,
    Keyboard,
    Pencil,
} from "lucide-react";
import {
    type ReactNode,
    useEffect,
    useLayoutEffect,
    useReducer,
    useRef,
    useState,
} from "react";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { diffInput } from "./diff-input";
import { type Key, keyBytes, type Mods, withMods } from "./keys";

export const TOUCH = matchMedia("(pointer: coarse)").matches;

/** 0 = off, 1 = next key only, 2 = locked. */
type Sticky = 0 | 1 | 2;

/** Shared between the terminal's start() and the tray: where bytes go and what is held. */
export class TouchIO {
    send: (d: string) => void = () => {};
    appCursor = () => false;
    ctrl: Sticky = 0;
    alt: Sticky = 0;
    onMods = () => {};
    direct: HTMLTextAreaElement | null = null;
    compose: HTMLInputElement | null = null;

    focus() {
        (this.compose ?? this.direct)?.focus({ preventScroll: true });
    }
    held() {
        return this.ctrl > 0 || this.alt > 0;
    }
    /** The active modifiers; one-shot ones are used up. */
    take(): Mods {
        const m = { ctrl: this.ctrl > 0, alt: this.alt > 0 };
        if (this.ctrl === 1) this.ctrl = 0;
        if (this.alt === 1) this.alt = 0;
        this.onMods();
        return m;
    }
    cycle(k: "ctrl" | "alt") {
        this[k] = ((this[k] + 1) % 3) as Sticky;
        this.onMods();
    }
    /** Sends text waiting in the compose bar, so a tray key lands after it. Set by ComposeBar. */
    flush = () => {};
}

const NAV: Record<string, Key> = {
    ArrowUp: "up",
    ArrowDown: "down",
    ArrowLeft: "left",
    ArrowRight: "right",
    Home: "home",
    End: "end",
    PageUp: "pgup",
    PageDown: "pgdn",
    Tab: "tab",
    Escape: "esc",
};

/**
 * Typing on touch goes to our own hidden textarea, not xterm's: Gboard re-sends words through
 * xterm's ("hello" ← "123" → "hellohello123"); here only the change is sent (diffInput).
 */
export function attachTouchInput(el: HTMLElement, term: Terminal, io: TouchIO) {
    const ta = document.createElement("textarea");
    ta.setAttribute("aria-label", "Type into terminal");
    ta.setAttribute("autocapitalize", "none");
    ta.spellcheck = false;
    // 16px stops iOS zooming in on focus.
    ta.className =
        "absolute bottom-0 left-0 size-px resize-none border-0 p-0 text-base opacity-0";
    el.appendChild(ta);
    io.direct = ta;
    let last = "";
    const clear = () => {
        ta.value = "";
        last = "";
    };
    ta.addEventListener("input", () => {
        let d = diffInput(last, ta.value);
        last = ta.value;
        if (io.held() && [...d].length === 1 && d >= " " && d !== "\x7f")
            d = withMods(d, io.take());
        io.send(d);
        if (ta.value.includes("\n")) clear();
    });
    ta.addEventListener("keydown", (e) => {
        const key = NAV[e.key];
        if (e.key === "Enter") {
            e.preventDefault();
            io.send("\r");
            clear();
        } else if (e.key === "Backspace" && !ta.value) {
            e.preventDefault();
            io.send("\x7f");
        } else if (key) {
            e.preventDefault();
            io.send(keyBytes(key, io.take(), io.appCursor()));
        } else if ((e.ctrlKey || e.altKey) && e.key.length === 1) {
            e.preventDefault();
            io.send(withMods(e.key, { ctrl: e.ctrlKey, alt: e.altKey }));
        }
    });
    // TerminalView's capture listener may already have cancelled it.
    ta.addEventListener("paste", (e) => {
        if (e.defaultPrevented) return;
        e.preventDefault();
        term.paste(e.clipboardData?.getData("text") ?? "");
    });
    const focus = () => io.focus();
    el.addEventListener("click", focus);
    term.textarea?.addEventListener("focus", focus);
    return () => {
        el.removeEventListener("click", focus);
        term.textarea?.removeEventListener("focus", focus);
        ta.remove();
        io.direct = null;
    };
}

const landscape = () => {
    const o = screen.orientation;
    return o ? o.type.startsWith("landscape") : screen.width > screen.height;
};

/** Side tray follows the screen, not the viewport, so opening the keyboard can't flip it. */
export function useSideLayout() {
    const [side, setSide] = useState(landscape);
    useEffect(() => {
        const sync = () => setSide(landscape());
        screen.orientation?.addEventListener("change", sync);
        window.addEventListener("orientationchange", sync);
        return () => {
            screen.orientation?.removeEventListener("change", sync);
            window.removeEventListener("orientationchange", sync);
        };
    }, []);
    return side;
}

type Id = Key | "ctrl" | "alt" | "compose" | "hide";

const LABEL: Partial<Record<Id, ReactNode>> = {
    esc: "Esc",
    tab: "Tab",
    ctrl: "Ctrl",
    alt: "Alt",
    cc: "^C",
    cd: "^D",
    home: "Home",
    end: "End",
    pgup: "PgUp",
    pgdn: "PgDn",
    up: <ArrowUp />,
    down: <ArrowDown />,
    left: <ArrowLeft />,
    right: <ArrowRight />,
    compose: <Pencil />,
    hide: <ChevronDown />,
};

const ARIA: Partial<Record<Id, string>> = {
    cc: "Control C",
    cd: "Control D",
    pgup: "Page up",
    pgdn: "Page down",
    up: "Up",
    down: "Down",
    left: "Left",
    right: "Right",
    compose: "Compose line",
    hide: "Hide keys",
};

const REPEAT = new Set<Id>(["up", "down", "left", "right", "pgup", "pgdn"]);

// Arrows form an inverted T in both layouts.
const ORDER: Record<"bottom" | "side", Id[]> = {
    bottom: [
        "esc",
        "ctrl",
        "cc",
        "home",
        "up",
        "end",
        "pgup",
        "compose",
        "tab",
        "alt",
        "cd",
        "left",
        "down",
        "right",
        "pgdn",
        "hide",
    ],
    side: [
        "esc",
        "cc",
        "compose",
        "hide",
        "tab",
        "home",
        "up",
        "end",
        "ctrl",
        "left",
        "down",
        "right",
        "alt",
        "cd",
        "pgup",
        "pgdn",
    ],
};

export function KeyTray({
    io,
    side,
    composing,
    onCompose,
    onHide,
}: {
    io: TouchIO;
    side: boolean;
    composing: boolean;
    onCompose: () => void;
    onHide: () => void;
}) {
    const [, render] = useReducer((n: number) => n + 1, 0);
    useEffect(() => {
        io.onMods = render;
        return () => {
            io.onMods = () => {};
        };
    }, [io]);
    const repeat = useRef(0);
    const stop = () => clearTimeout(repeat.current);
    useEffect(() => () => clearTimeout(repeat.current), []);

    const press = (id: Id) => {
        navigator.vibrate?.(8);
        if (id === "ctrl" || id === "alt") return io.cycle(id);
        if (id === "compose") return onCompose();
        if (id === "hide") return onHide();
        io.flush();
        io.send(keyBytes(id, io.take(), io.appCursor()));
    };

    return (
        <section
            aria-label="Terminal keys"
            className={cn(
                "shrink-0 bg-sidebar",
                side
                    ? "flex w-62 border-l p-1.5 pr-[calc(0.375rem+env(safe-area-inset-right))]"
                    : "border-t p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]",
            )}
        >
            <div
                className={cn(
                    "grid flex-1",
                    side
                        ? "auto-rows-[minmax(0,1fr)] grid-cols-4 gap-1.25"
                        : "grid-cols-8 gap-1.5",
                )}
            >
                {ORDER[side ? "side" : "bottom"].map((id) => {
                    const mod = id === "ctrl" || id === "alt" ? io[id] : 0;
                    const tool = id === "compose" || id === "hide";
                    const on = mod > 0 || (id === "compose" && composing);
                    return (
                        <button
                            key={id}
                            type="button"
                            aria-label={ARIA[id]}
                            aria-pressed={
                                id === "ctrl" ||
                                id === "alt" ||
                                id === "compose"
                                    ? on
                                    : undefined
                            }
                            className={cn(
                                "relative flex min-w-0 touch-none select-none items-center justify-center rounded-md font-mono text-[13px] [&_svg]:size-4.5",
                                "shadow-[inset_0_-2px_0_rgb(0_0_0/0.35)] active:translate-y-px active:bg-white/14 active:shadow-none motion-reduce:active:translate-y-0",
                                side ? "min-h-0 text-xs" : "h-11",
                                tool
                                    ? "text-muted-foreground shadow-none ring-1 ring-border ring-inset"
                                    : id === "cc"
                                      ? "bg-destructive/16 text-red-300"
                                      : "bg-white/7 text-foreground",
                                on &&
                                    (tool
                                        ? "text-primary ring-primary"
                                        : "bg-primary font-semibold text-primary-foreground shadow-none"),
                                mod === 2 &&
                                    "after:absolute after:bottom-1.25 after:h-0.5 after:w-3.5 after:rounded-full after:bg-current",
                            )}
                            // preventDefault keeps focus, and the soft keyboard, where it is.
                            onPointerDown={(e) => {
                                e.preventDefault();
                                e.currentTarget.setPointerCapture(e.pointerId);
                                press(id);
                                if (!REPEAT.has(id)) return;
                                stop();
                                repeat.current = window.setTimeout(
                                    function tick() {
                                        press(id);
                                        repeat.current = window.setTimeout(
                                            tick,
                                            60,
                                        );
                                    },
                                    400,
                                );
                            }}
                            onPointerUp={stop}
                            onPointerCancel={stop}
                            onLostPointerCapture={stop}
                            // Keyboard activation (detail 0); taps already fired on pointerdown.
                            onClick={(e) => e.detail === 0 && press(id)}
                        >
                            {LABEL[id]}
                        </button>
                    );
                })}
            </div>
        </section>
    );
}

export function ComposeBar({ io }: { io: TouchIO }) {
    const ref = useRef<HTMLInputElement>(null);
    const prev = useRef("");
    // Layout effect: focus moves inside the tap, so the soft keyboard stays up.
    useLayoutEffect(() => {
        io.compose = ref.current;
        io.flush = () => {
            const input = ref.current;
            if (!input?.value) return;
            io.send(input.value);
            input.value = "";
            prev.current = "";
        };
        io.focus();
        return () => {
            io.compose = null;
            io.flush = () => {};
            io.focus();
        };
    }, [io]);
    return (
        <form
            className="flex shrink-0 gap-2 border-t bg-sidebar p-2"
            onSubmit={(e) => {
                e.preventDefault();
                const input = ref.current;
                if (!input) return;
                io.send(`${input.value}\r`);
                input.value = "";
                prev.current = "";
            }}
        >
            <Input
                ref={ref}
                aria-label="Compose a line"
                placeholder="Compose, then Enter to send"
                enterKeyHint="send"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="h-11 font-mono text-base"
                onInput={(e) => {
                    const input = e.currentTarget;
                    const data = (e.nativeEvent as InputEvent).data;
                    // A held Ctrl/Alt turns the next typed character into a key press.
                    if (
                        io.held() &&
                        data?.length === 1 &&
                        input.value.length === prev.current.length + 1
                    ) {
                        input.value = prev.current;
                        io.flush();
                        io.send(withMods(data, io.take()));
                    }
                    prev.current = input.value;
                }}
            />
            <Button
                type="submit"
                size="icon"
                className="size-11"
                aria-label="Send line"
            >
                <CornerDownLeft />
            </Button>
        </form>
    );
}

export function ShowKeysButton({ onClick }: { onClick: () => void }) {
    return (
        <Button
            variant="secondary"
            size="icon"
            aria-label="Show keys"
            className="absolute right-3 bottom-3 z-10 size-12 rounded-full border shadow-lg"
            onPointerDown={(e) => e.preventDefault()}
            onClick={onClick}
        >
            <Keyboard />
        </Button>
    );
}
