import type { HostSummary, Me } from "@repo/shared";
import { useEffect, useState } from "react";
import { Admin } from "./Admin";
import { api } from "./api";
import { type Target, TerminalView } from "./TerminalView";

export function App() {
    const [me, setMe] = useState<Me>();
    const [hosts, setHosts] = useState<HostSummary[]>();
    const [target, setTarget] = useState<Target>();
    const [tab, setTab] = useState<"hosts" | "admin">("hosts");

    useEffect(() => {
        if (tab !== "hosts") return;
        api<Me>("/api/me").then(setMe);
        api<HostSummary[]>("/api/hosts").then(setHosts);
    }, [tab]);

    if (target)
        return <TerminalView {...target} onBack={() => setTarget(undefined)} />;

    return (
        <>
            <header>
                <strong>web-ssh</strong>
                <nav>
                    <button
                        type="button"
                        className={tab === "hosts" ? "" : "link"}
                        onClick={() => setTab("hosts")}
                    >
                        Hosts
                    </button>
                    {me?.admin && (
                        <button
                            type="button"
                            className={tab === "admin" ? "" : "link"}
                            onClick={() => setTab("admin")}
                        >
                            Admin
                        </button>
                    )}
                </nav>
                <span className="muted">{me?.email ?? me?.sub}</span>
            </header>
            <main>
                {tab === "admin" ? (
                    <Admin />
                ) : (
                    <>
                        {hosts?.length === 0 && (
                            <p className="muted">No hosts available to you.</p>
                        )}
                        <ul className="cards">
                            {hosts?.map((host) => (
                                <li key={host.id}>
                                    <strong>{host.name}</strong>
                                    {host.logins.map((login) => (
                                        <button
                                            type="button"
                                            key={login}
                                            onClick={() =>
                                                setTarget({ host, login })
                                            }
                                        >
                                            {login}
                                        </button>
                                    ))}
                                </li>
                            ))}
                        </ul>
                    </>
                )}
            </main>
        </>
    );
}
