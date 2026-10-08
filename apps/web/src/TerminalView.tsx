import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import type { ClientMessage, HostSummary } from "@repo/shared";
import { useEffect, useRef, useState } from "react";
import { KEY_ROWS, type Key, keyBytes, type Mods, withMods } from "./keys";

type Target = { host: HostSummary; login: string };

const NO_MODS: Mods = { ctrl: false, alt: false };

export function TerminalView({
    host,
    login,
    onBack,
}: Target & { onBack: () => void }) {
    const ref = useRef<HTMLDivElement>(null);
    const [status, setStatus] = useState("connecting…");
    const [mods, setMods] = useState(NO_MODS);
    const modsRef = useRef(NO_MODS);
    const pressRef = useRef<(key: Key) => void>(() => {});

    useEffect(() => {
        if (!ref.current) return;
        const term = new Terminal({ cursorBlink: true });
        const fit = new FitAddon();
        term.loadAddon(fit);
        term.open(ref.current);
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
        ws.onopen = () => setStatus("connected");
        ws.onmessage = (e) => term.write(new Uint8Array(e.data));
        ws.onclose = (e) =>
            setStatus(`closed: ${e.reason || "connection lost"}`);

        const send = (msg: ClientMessage) => {
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
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
        term.onResize(({ cols, rows }) => send({ t: "resize", cols, rows }));
        const onWindowResize = () => fit.fit();
        window.addEventListener("resize", onWindowResize);
        term.focus();

        return () => {
            window.removeEventListener("resize", onWindowResize);
            ws.close();
            term.dispose();
        };
    }, [host.id, login]);

    return (
        <div className="term-page">
            <header>
                <button type="button" onClick={onBack}>
                    ← hosts
                </button>
                <span>
                    {login}@{host.name}
                </span>
                <span className="muted">{status}</span>
            </header>
            <div ref={ref} className="term" />
            <div className="keybar">
                {KEY_ROWS.flat().map((key) => (
                    <button
                        type="button"
                        key={key}
                        className={
                            (key === "CTRL" && mods.ctrl) ||
                            (key === "ALT" && mods.alt)
                                ? "on"
                                : ""
                        }
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
