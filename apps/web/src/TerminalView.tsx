import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import type { ClientMessage, HostSummary } from "@repo/shared";
import { useEffect, useRef, useState } from "react";

type Target = { host: HostSummary; login: string };

export function TerminalView({
    host,
    login,
    onBack,
}: Target & { onBack: () => void }) {
    const ref = useRef<HTMLDivElement>(null);
    const [status, setStatus] = useState("connecting…");

    useEffect(() => {
        if (!ref.current) return;
        const term = new Terminal({ cursorBlink: true });
        const fit = new FitAddon();
        term.loadAddon(fit);
        term.open(ref.current);
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
        term.onData((d) => send({ t: "in", d }));
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
        </div>
    );
}
