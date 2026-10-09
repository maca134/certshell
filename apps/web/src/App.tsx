import type { HostSummary, Me } from "@repo/shared";
import {
    ChevronRight,
    CircleArrowUp,
    Globe,
    ListChecks,
    ListTodo,
    LogOut,
    type LucideIcon,
    ScrollText,
    Server,
    Terminal,
    Users,
} from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { Link, Route, Switch, useLocation, useSearch } from "wouter";
import { Admin } from "./Admin";
import { api } from "./api";
import { Avatar, EmptyState, HostIcon, Logo, Page } from "./components/layout";
import { Button } from "./components/ui/button";
import { Card } from "./components/ui/card";
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarInset,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarProvider,
    SidebarRail,
    SidebarTrigger,
    useSidebar,
} from "./components/ui/sidebar";
import { Skeleton } from "./components/ui/skeleton";
import { TooltipProvider } from "./components/ui/tooltip";
import { MAX_TARGETS, parseTargets, Tasks } from "./Tasks";

// xterm is half the bundle: load it after the host list renders, before the user picks a host.
const loadTerminal = () => import("./TerminalView");
const TerminalView = lazy(() =>
    loadTerminal().then((m) => ({ default: m.TerminalView })),
);
const BroadcastView = lazy(() =>
    loadTerminal().then((m) => ({ default: m.BroadcastView })),
);

// Each pane signs a cert, and signing is rate limited to 10 a minute per user.
const MAX_PANES = 8;

export function App() {
    const [me, setMe] = useState<Me>();
    const [hosts, setHosts] = useState<HostSummary[]>();
    const [location, navigate] = useLocation();
    const search = useSearch();
    const onAdmin = location.startsWith("/admin");

    useEffect(() => {
        api<Me>("/api/me").then(setMe);
    }, []);
    useEffect(() => {
        if (onAdmin) return;
        api<HostSummary[]>("/api/hosts").then(setHosts);
        loadTerminal();
    }, [onAdmin]);

    return (
        <Switch>
            <Route path="/ssh/:hostId/:login">
                {({ hostId, login }) => {
                    if (!hosts) return null;
                    const host = hosts.find((h) => h.id === hostId);
                    if (!host)
                        return (
                            <div className="grid h-full place-items-center">
                                <EmptyState icon={Server} title="Unknown host">
                                    It may have been removed, or you no longer
                                    have access.{" "}
                                    <Link href="/" className="text-primary">
                                        Back to hosts
                                    </Link>
                                </EmptyState>
                            </div>
                        );
                    return (
                        <Suspense>
                            <TerminalView
                                host={host}
                                login={login}
                                onBack={() => navigate("/")}
                            />
                        </Suspense>
                    );
                }}
            </Route>
            <Route path="/broadcast">
                {() => {
                    if (!hosts) return null;
                    const targets = parseTargets(search, hosts).slice(
                        0,
                        MAX_PANES,
                    );
                    if (!targets.length)
                        return (
                            <div className="grid h-full place-items-center">
                                <EmptyState icon={Server} title="No hosts">
                                    None of the selected hosts are available.{" "}
                                    <Link href="/" className="text-primary">
                                        Back to hosts
                                    </Link>
                                </EmptyState>
                            </div>
                        );
                    return (
                        <Suspense>
                            <BroadcastView
                                targets={targets}
                                onBack={() => navigate("/")}
                            />
                        </Suspense>
                    );
                }}
            </Route>
            <Route>
                <TooltipProvider>
                    <SidebarProvider>
                        <AppSidebar me={me} />
                        <SidebarInset>
                            <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-3 border-b bg-background/75 px-4 backdrop-blur-xl backdrop-saturate-150">
                                <SidebarTrigger className="-ml-1 text-muted-foreground" />
                                <div className="h-4 w-px bg-border" />
                                <nav className="flex items-center gap-1.5 text-sm">
                                    {onAdmin && (
                                        <>
                                            <span className="text-muted-foreground">
                                                Admin
                                            </span>
                                            <ChevronRight className="size-3.5 text-muted-foreground/60" />
                                        </>
                                    )}
                                    <span className="font-medium">
                                        {title(location)}
                                    </span>
                                </nav>
                                <div className="ml-auto flex items-center gap-1 text-muted-foreground">
                                    <Button
                                        asChild
                                        variant="ghost"
                                        size="icon-sm"
                                    >
                                        <a
                                            href="https://certshell.dev"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            aria-label="certshell.dev"
                                            title="certshell.dev"
                                        >
                                            <Globe />
                                        </a>
                                    </Button>
                                    <Button
                                        asChild
                                        variant="ghost"
                                        size="icon-sm"
                                    >
                                        <a
                                            href="https://github.com/maca134/certshell"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            aria-label="GitHub"
                                            title="GitHub"
                                        >
                                            <GitHubIcon />
                                        </a>
                                    </Button>
                                </div>
                            </header>
                            <Switch>
                                <Route path="/admin" nest>
                                    <Admin />
                                </Route>
                                <Route path="/tasks" nest>
                                    <Tasks hosts={hosts} />
                                </Route>
                                <Route>
                                    <Hosts hosts={hosts} />
                                </Route>
                            </Switch>
                        </SidebarInset>
                    </SidebarProvider>
                </TooltipProvider>
            </Route>
        </Switch>
    );
}

function GitHubIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
        </svg>
    );
}

const ADMIN_NAV = [
    { href: "/admin/hosts", label: "Hosts", icon: Server },
    { href: "/admin/users", label: "Users", icon: Users },
    { href: "/admin/audit", label: "Audit", icon: ScrollText },
];

const title = (location: string) =>
    location === "/"
        ? "Hosts"
        : location.startsWith("/tasks")
          ? "Tasks"
          : (ADMIN_NAV.find((n) => n.href === location)?.label ?? "");

function Hosts({ hosts }: { hosts?: HostSummary[] }) {
    // undefined: not selecting. Entries are `hostId:login`.
    const [selected, setSelected] = useState<string[]>();
    const [, navigate] = useLocation();
    const toggle = (key: string) =>
        setSelected((s = []) =>
            s.includes(key) ? s.filter((k) => k !== key) : [...s, key],
        );
    return (
        <Page
            title="Hosts"
            description="Choose a server and an account to open a secure shell."
            actions={
                !!hosts?.length && (
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setSelected((s) => (s ? undefined : []))}
                    >
                        {selected ? (
                            "Cancel"
                        ) : (
                            <>
                                <ListChecks />
                                Select
                            </>
                        )}
                    </Button>
                )
            }
        >
            <Card className="gap-0 py-0">
                {!hosts &&
                    [0, 1, 2].map((i) => (
                        <div
                            key={i}
                            className="flex items-center gap-3 border-b px-4 py-3.5 last:border-b-0"
                        >
                            <Skeleton className="size-9 rounded-lg" />
                            <div className="flex flex-1 flex-col gap-1.5">
                                <Skeleton className="h-3.5 w-32" />
                                <Skeleton className="h-3 w-20" />
                            </div>
                            <Skeleton className="h-7 w-20" />
                        </div>
                    ))}
                {hosts?.length === 0 && (
                    <EmptyState icon={Server} title="No hosts yet">
                        Ask an administrator to give your group access to a
                        server.
                    </EmptyState>
                )}
                <ul className="divide-y">
                    {hosts?.map((host) => (
                        <li
                            key={host.id}
                            className="flex flex-wrap items-center gap-3 px-4 py-3.5 transition-colors hover:bg-muted/60"
                        >
                            <HostIcon icon={Server} />
                            <div className="flex min-w-0 flex-1 flex-col">
                                <span
                                    className="truncate font-medium"
                                    title={host.name}
                                >
                                    {host.name}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                    {host.logins.length} account
                                    {host.logins.length === 1 ? "" : "s"}
                                </span>
                            </div>
                            <div className="flex flex-wrap justify-end gap-2">
                                {host.logins.map((login) => {
                                    const key = `${host.id}:${login}`;
                                    const on = selected?.includes(key);
                                    return selected ? (
                                        <Button
                                            key={login}
                                            variant={on ? "default" : "outline"}
                                            size="sm"
                                            className="font-mono"
                                            aria-pressed={on}
                                            onClick={() => toggle(key)}
                                        >
                                            <Terminal />
                                            {login}
                                        </Button>
                                    ) : (
                                        <Button
                                            key={login}
                                            asChild
                                            variant="secondary"
                                            size="sm"
                                            className="font-mono hover:bg-primary hover:text-primary-foreground"
                                        >
                                            <Link
                                                href={`/ssh/${host.id}/${login}`}
                                            >
                                                <Terminal />
                                                {login}
                                            </Link>
                                        </Button>
                                    );
                                })}
                            </div>
                        </li>
                    ))}
                </ul>
            </Card>
            {selected && (
                <div className="sticky bottom-4 flex flex-wrap items-center gap-2 rounded-xl border bg-popover/90 p-2 pl-4 shadow-lg backdrop-blur-xl">
                    <span className="mr-auto text-sm text-muted-foreground">
                        {selected.length} selected
                        {selected.length > MAX_PANES &&
                            ` · terminals open ${MAX_PANES} at most`}
                    </span>
                    <Button
                        size="sm"
                        disabled={
                            !selected.length || selected.length > MAX_PANES
                        }
                        onClick={() =>
                            navigate(`/broadcast?t=${selected.join(",")}`)
                        }
                    >
                        <Terminal />
                        Open terminals
                    </Button>
                    <Button
                        size="sm"
                        disabled={
                            !selected.length || selected.length > MAX_TARGETS
                        }
                        onClick={() =>
                            navigate(`/tasks?t=${selected.join(",")}`)
                        }
                    >
                        <ListTodo />
                        Run command
                    </Button>
                </div>
            )}
        </Page>
    );
}

function NavItem({
    href,
    label,
    icon: Icon,
}: {
    href: string;
    label: string;
    icon: LucideIcon;
}) {
    const [location] = useLocation();
    const { setOpenMobile } = useSidebar();
    return (
        <SidebarMenuItem>
            <SidebarMenuButton
                asChild
                isActive={
                    location === href ||
                    (href !== "/" && location.startsWith(`${href}/`))
                }
                tooltip={label}
            >
                <Link href={href} onClick={() => setOpenMobile(false)}>
                    <Icon />
                    <span>{label}</span>
                </Link>
            </SidebarMenuButton>
        </SidebarMenuItem>
    );
}

function AppSidebar({ me }: { me?: Me }) {
    return (
        <Sidebar collapsible="icon">
            <SidebarHeader>
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton
                            size="lg"
                            asChild
                            className="hover:bg-transparent active:bg-transparent"
                        >
                            <Link href="/">
                                <Logo />
                                <div className="flex flex-col leading-tight">
                                    <span className="font-semibold tracking-tight">
                                        CertShell
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                        Secure shell
                                    </span>
                                </div>
                            </Link>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarHeader>
            <SidebarContent>
                <SidebarGroup>
                    <SidebarGroupContent>
                        <SidebarMenu className="gap-1">
                            <NavItem href="/" label="Hosts" icon={Terminal} />
                            <NavItem
                                href="/tasks"
                                label="Tasks"
                                icon={ListTodo}
                            />
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>
                {me?.admin && (
                    <SidebarGroup>
                        <SidebarGroupLabel>Admin</SidebarGroupLabel>
                        <SidebarGroupContent>
                            <SidebarMenu className="gap-1">
                                {ADMIN_NAV.map((n) => (
                                    <NavItem key={n.href} {...n} />
                                ))}
                            </SidebarMenu>
                        </SidebarGroupContent>
                    </SidebarGroup>
                )}
            </SidebarContent>
            <SidebarFooter>
                <SidebarMenu>
                    {me && (
                        <SidebarMenuItem className="flex items-center gap-2.5 px-1 py-1.5 group-data-[collapsible=icon]:hidden">
                            <Avatar name={me.email ?? me.sub} />
                            <div className="flex min-w-0 flex-col leading-tight">
                                <span
                                    className="truncate text-sm font-medium"
                                    title={me.email ?? me.sub}
                                >
                                    {me.email ?? me.sub}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                    {me.admin ? "Administrator" : "Member"}
                                </span>
                            </div>
                        </SidebarMenuItem>
                    )}
                    <SidebarMenuItem>
                        <form method="post" action="/auth/logout">
                            <SidebarMenuButton
                                type="submit"
                                tooltip="Sign out"
                                className="text-muted-foreground"
                            >
                                <LogOut />
                                <span>Sign out</span>
                            </SidebarMenuButton>
                        </form>
                    </SidebarMenuItem>
                </SidebarMenu>
                {me && (
                    <div className="flex items-center gap-2 px-2 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
                        <span>
                            {me.version === "dev" ? "dev" : `v${me.version}`}
                        </span>
                        {me.update && (
                            <a
                                href="https://github.com/maca134/certshell/tags"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 text-primary hover:underline"
                            >
                                <CircleArrowUp className="size-3.5" />v
                                {me.update} available
                            </a>
                        )}
                    </div>
                )}
            </SidebarFooter>
            <SidebarRail />
        </Sidebar>
    );
}
