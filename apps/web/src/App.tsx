import type { HostSummary, Me } from "@repo/shared";
import {
    ChevronRight,
    Globe,
    LogOut,
    type LucideIcon,
    ScrollText,
    Server,
    Terminal,
    Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, Route, Switch, useLocation } from "wouter";
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
                        <TerminalView
                            host={host}
                            login={login}
                            onBack={() => navigate("/")}
                        />
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
                            </header>
                            <Switch>
                                <Route path="/admin" nest>
                                    <Admin />
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

const ADMIN_NAV = [
    { href: "/admin/hosts", label: "Hosts", icon: Server },
    { href: "/admin/users", label: "Users", icon: Users },
    { href: "/admin/audit", label: "Audit", icon: ScrollText },
];

const title = (location: string) =>
    location === "/"
        ? "Hosts"
        : (ADMIN_NAV.find((n) => n.href === location)?.label ?? "");

function Hosts({ hosts }: { hosts?: HostSummary[] }) {
    return (
        <Page
            title="Hosts"
            description="Choose a server and an account to open a secure shell."
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
                                {host.logins.map((login) => (
                                    <Button
                                        key={login}
                                        asChild
                                        variant="secondary"
                                        size="sm"
                                        className="font-mono hover:bg-primary hover:text-primary-foreground"
                                    >
                                        <Link href={`/ssh/${host.id}/${login}`}>
                                            <Terminal />
                                            {login}
                                        </Link>
                                    </Button>
                                ))}
                            </div>
                        </li>
                    ))}
                </ul>
            </Card>
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
                isActive={location === href}
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
                        <SidebarMenuButton
                            asChild
                            tooltip="CertShell website"
                            className="text-muted-foreground"
                        >
                            <a
                                href="https://certshell.dev"
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                <Globe />
                                <span>certshell.dev</span>
                            </a>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
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
            </SidebarFooter>
            <SidebarRail />
        </Sidebar>
    );
}
