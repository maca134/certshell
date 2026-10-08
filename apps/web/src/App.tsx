import type { HostSummary, Me } from "@repo/shared";
import { Server, SquareTerminal, Terminal } from "lucide-react";
import { useEffect, useState } from "react";
import { Route, Switch, useLocation } from "wouter";
import { Admin } from "./Admin";
import { api } from "./api";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
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
                    if (!host)
                        return (
                            <p className="p-4 text-muted-foreground">
                                Unknown host.
                            </p>
                        );
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
                <header className="sticky top-0 z-10 flex h-14 items-center gap-4 border-b bg-background/80 px-4 backdrop-blur">
                    <span className="flex items-center gap-2 font-semibold">
                        <SquareTerminal className="size-5" />
                        web-ssh
                    </span>
                    <nav className="flex gap-1">
                        <Button
                            variant={onAdmin ? "ghost" : "secondary"}
                            size="sm"
                            onClick={() => navigate("/")}
                        >
                            Hosts
                        </Button>
                        {me?.admin && (
                            <Button
                                variant={onAdmin ? "secondary" : "ghost"}
                                size="sm"
                                onClick={() => navigate("/admin/hosts")}
                            >
                                Admin
                            </Button>
                        )}
                    </nav>
                    <span className="ml-auto truncate text-sm text-muted-foreground">
                        {me?.email ?? me?.sub}
                    </span>
                </header>
                <main>
                    <Switch>
                        <Route path="/admin" nest>
                            <Admin />
                        </Route>
                        <Route>
                            <div className="mx-auto max-w-5xl p-4 sm:p-6">
                                {hosts?.length === 0 && (
                                    <p className="py-16 text-center text-muted-foreground">
                                        No hosts available to you.
                                    </p>
                                )}
                                <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                    {hosts?.map((host) => (
                                        <li key={host.id}>
                                            <Card className="h-full">
                                                <CardHeader>
                                                    <CardTitle className="flex items-center gap-2">
                                                        <Server className="size-4 text-muted-foreground" />
                                                        {host.name}
                                                    </CardTitle>
                                                </CardHeader>
                                                <CardContent className="flex flex-wrap gap-2">
                                                    {host.logins.map(
                                                        (login) => (
                                                            <Button
                                                                key={login}
                                                                variant="outline"
                                                                size="sm"
                                                                onClick={() =>
                                                                    navigate(
                                                                        `/ssh/${host.id}/${login}`,
                                                                    )
                                                                }
                                                            >
                                                                <Terminal />
                                                                {login}
                                                            </Button>
                                                        ),
                                                    )}
                                                </CardContent>
                                            </Card>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </Route>
                    </Switch>
                </main>
            </Route>
        </Switch>
    );
}
