import type { HostSummary, Me } from "@repo/shared";
import { useEffect, useState } from "react";
import { Route, Switch, useLocation } from "wouter";
import { Admin } from "./Admin";
import { api } from "./api";
import { TerminalView } from "./TerminalView";

export function App() {
    const [me, setMe] = useState<Me>();
    const [hosts, setHosts] = useState<HostSummary[]>();
    const [location, navigate] = useLocation();
    const onAdmin = location.startsWith("/admin");

    useEffect(() => {
        api<Me>("/api/me").then(setMe);
    }, []);
    useEffect(() => {
        if (!onAdmin) api<HostSummary[]>("/api/hosts").then(setHosts);
    }, [onAdmin]);

    return (
        <Switch>
            <Route path="/ssh/:hostId/:login">
                {({ hostId, login }) => {
                    if (!hosts) return null;
                    const host = hosts.find((h) => h.id === hostId);
                    if (!host) return <p className="muted">Unknown host.</p>;
                    return (
                        <TerminalView
                            host={host}
                            login={login}
                            onBack={() => navigate("/")}
                        />
                    );
                }}
            </Route>
            <Route>
                <header>
                    <strong>web-ssh</strong>
                    <nav>
                        <button
                            type="button"
                            className={onAdmin ? "link" : ""}
                            onClick={() => navigate("/")}
                        >
                            Hosts
                        </button>
                        {me?.admin && (
                            <button
                                type="button"
                                className={onAdmin ? "" : "link"}
                                onClick={() => navigate("/admin/hosts")}
                            >
                                Admin
                            </button>
                        )}
                    </nav>
                    <span className="muted">{me?.email ?? me?.sub}</span>
                </header>
                <main>
                    <Switch>
                        <Route path="/admin" nest>
                            <Admin />
                        </Route>
                        <Route>
                            {hosts?.length === 0 && (
                                <p className="muted">
                                    No hosts available to you.
                                </p>
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
                                                    navigate(
                                                        `/ssh/${host.id}/${login}`,
                                                    )
                                                }
                                            >
                                                {login}
                                            </button>
                                        ))}
                                    </li>
                                ))}
                            </ul>
                        </Route>
                    </Switch>
                </main>
            </Route>
        </Switch>
    );
}
