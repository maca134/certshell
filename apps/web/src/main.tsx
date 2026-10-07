import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import "./style.css";
import type { ClientMessage, HostSummary, Me } from "@repo/shared";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

type Target = { host: HostSummary; login: string };

function App() {
    const [me, setMe] = useState<Me>();
    const [hosts, setHosts] = useState<HostSummary[]>();
    const [target, setTarget] = useState<Target>();

    useEffect(() => {
        fetch("/api/me")
            .then((r) => r.json())
            .then(setMe);
        fetch("/api/hosts")
            .then((r) => r.json())
            .then(setHosts);
    }, []);

    if (target)
        return <TerminalView {...target} onBack={() => setTarget(undefined)} />;

    return (
        <>
            <header>
                <strong>web-ssh</strong>
                <span className="muted">{me?.email ?? me?.sub}</span>
            </header>
            <main>
                {hosts?.length === 0 && <p>No hosts available to you.</p>}
                <ul>
                    {hosts?.map((host) => (
                        <li key={host.id}>
                            <strong>{host.name}</strong>
                            {host.logins.map((login) => (
                                <button
                                    type="button"
                                    key={login}
                                    onClick={() => setTarget({ host, login })}
                                >
                                    {login}
                                </button>
                            ))}
                        </li>
                    ))}
                </ul>
            </main>
        </>
    );
}

function TerminalView({
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

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
