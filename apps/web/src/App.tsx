import type { HostSummary, Me } from "@repo/shared";
import {
    LogOut,
    type LucideIcon,
    ScrollText,
    Server,
    SquareTerminal,
    Terminal,
    Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, Route, Switch, useLocation } from "wouter";
import { Admin } from "./Admin";
import { api } from "./api";
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
                <TooltipProvider>
                    <SidebarProvider>
                        <AppSidebar me={me} />
                        <SidebarInset>
                            <header className="sticky top-0 z-10 flex h-12 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur">
                                <SidebarTrigger className="-ml-1" />
                                <h1 className="text-sm font-medium">
                                    {title(location)}
                                </h1>
                            </header>
                            <Switch>
                                <Route path="/admin" nest>
                                    <Admin />
                                </Route>
                                <Route>
                                    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 sm:p-6">
                                        {hosts && (
                                            <span className="text-sm text-muted-foreground">
                                                {hosts.length} host
                                                {hosts.length === 1 ? "" : "s"}
                                            </span>
                                        )}
                                        <Card className="py-0">
                                            {hosts?.length === 0 && (
                                                <p className="py-10 text-center text-sm text-muted-foreground">
                                                    No hosts available to you.
                                                </p>
                                            )}
                                            <ul className="divide-y">
                                                {hosts?.map((host) => (
                                                    <li
                                                        key={host.id}
                                                        className="flex flex-wrap items-center gap-3 px-4 py-3"
                                                    >
                                                        <div className="flex size-8 items-center justify-center rounded-md bg-muted">
                                                            <Server className="size-4 text-muted-foreground" />
                                                        </div>
                                                        <span
                                                            className="min-w-0 flex-1 truncate font-medium"
                                                            title={host.name}
                                                        >
                                                            {host.name}
                                                        </span>
                                                        <div className="flex flex-wrap justify-end gap-2">
                                                            {host.logins.map(
                                                                (login) => (
                                                                    <Button
                                                                        key={
                                                                            login
                                                                        }
                                                                        asChild
                                                                        variant="outline"
                                                                        size="sm"
                                                                    >
                                                                        <Link
                                                                            href={`/ssh/${host.id}/${login}`}
                                                                        >
                                                                            <Terminal />
                                                                            {
                                                                                login
                                                                            }
                                                                        </Link>
                                                                    </Button>
                                                                ),
                                                            )}
                                                        </div>
                                                    </li>
                                                ))}
                                            </ul>
                                        </Card>
                                    </div>
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
        : `Admin · ${ADMIN_NAV.find((n) => n.href === location)?.label ?? ""}`;

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
                        <SidebarMenuButton size="lg" asChild>
                            <Link href="/">
                                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                                    <SquareTerminal className="size-4" />
                                </div>
                                <span className="font-semibold">web-ssh</span>
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
                    <SidebarMenuItem>
                        <div className="truncate px-2 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
                            {me?.email ?? me?.sub}
                        </div>
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                        <form method="post" action="/auth/logout">
                            <SidebarMenuButton type="submit" tooltip="Sign out">
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
