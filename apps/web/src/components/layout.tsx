import { cn } from "cn";
import { type LucideIcon, SquareTerminal } from "lucide-react";
import type { ReactNode } from "react";

export function Page({
    title,
    description,
    actions,
    children,
}: {
    title: string;
    description?: ReactNode;
    actions?: ReactNode;
    children: ReactNode;
}) {
    return (
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-8 sm:py-10">
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div className="flex flex-col gap-1">
                    <h1 className="text-2xl font-semibold tracking-tight">
                        {title}
                    </h1>
                    {description && (
                        <p className="text-sm text-muted-foreground">
                            {description}
                        </p>
                    )}
                </div>
                {actions}
            </div>
            {children}
        </div>
    );
}

export function EmptyState({
    icon: Icon,
    title,
    children,
}: {
    icon: LucideIcon;
    title: string;
    children?: ReactNode;
}) {
    return (
        <div className="flex flex-col items-center gap-1 px-6 py-14 text-center">
            <div className="mb-3 flex size-11 items-center justify-center rounded-xl border bg-muted">
                <Icon className="size-5 text-muted-foreground" />
            </div>
            <p className="font-medium">{title}</p>
            {children && (
                <p className="max-w-sm text-sm text-muted-foreground">
                    {children}
                </p>
            )}
        </div>
    );
}

export function Logo({ className }: { className?: string }) {
    return (
        <div
            className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-lg bg-linear-to-b from-[oklch(0.68_0.17_256)] to-[oklch(0.52_0.21_262)] text-white shadow-[inset_0_1px_0_oklch(1_0_0/25%),0_1px_2px_oklch(0_0_0/40%)]",
                className,
            )}
        >
            <SquareTerminal className="size-[55%]" strokeWidth={2.25} />
        </div>
    );
}

export function Avatar({
    name,
    className,
}: {
    name: string;
    className?: string;
}) {
    return (
        <div
            aria-hidden
            className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-full bg-linear-to-b from-zinc-600 to-zinc-700 text-xs font-semibold text-white uppercase",
                className,
            )}
        >
            {name.slice(0, 1)}
        </div>
    );
}

export function HostIcon({ icon: Icon }: { icon: LucideIcon }) {
    return (
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-linear-to-b from-white/8 to-white/2">
            <Icon className="size-4 text-muted-foreground" />
        </div>
    );
}
