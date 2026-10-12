import { cn } from "cn";
import { type LucideIcon, Server, X } from "lucide-react";
import type { ReactNode } from "react";
import { tagColour } from "../tags";

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

export function Logo() {
    return <img src="/favicon.svg" alt="" className="size-8 shrink-0" />;
}

export function Avatar({ name }: { name: string }) {
    return (
        <div
            aria-hidden
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-linear-to-b from-zinc-600 to-zinc-700 text-xs font-semibold text-white uppercase"
        >
            {name.slice(0, 1)}
        </div>
    );
}

export function HostIcon() {
    return (
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-linear-to-b from-white/8 to-white/2">
            <Server className="size-4 text-muted-foreground" />
        </div>
    );
}

/** A host tag. `onClick` makes it a toggle button (`pressed`); `muted` greys it out. `onRemove` adds an × button. */
export function Tag({
    name,
    muted,
    pressed,
    onClick,
    onRemove,
}: {
    name: string;
    muted?: boolean;
    pressed?: boolean;
    onClick?: () => void;
    onRemove?: () => void;
}) {
    const className = cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-2 text-xs font-medium whitespace-nowrap",
        muted
            ? "border-border text-muted-foreground hover:text-foreground"
            : tagColour(name),
        onClick && "cursor-pointer hover:brightness-125",
    );
    if (onClick)
        return (
            <button
                type="button"
                aria-pressed={!!pressed}
                className={className}
                onClick={onClick}
            >
                {name}
            </button>
        );
    return (
        <span className={className}>
            {name}
            {onRemove && (
                <button
                    type="button"
                    aria-label={`remove tag ${name}`}
                    className="-mr-1 cursor-pointer opacity-70 hover:opacity-100"
                    onClick={onRemove}
                >
                    <X className="size-3" />
                </button>
            )}
        </span>
    );
}

/** "All" plus a toggle per tag. */
export function TagFilter({
    tags,
    selected,
    onChange,
}: {
    tags: string[];
    selected: string[];
    onChange: (selected: string[]) => void;
}) {
    return (
        <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs text-muted-foreground">Tags</span>
            <button
                type="button"
                aria-pressed={selected.length === 0}
                className="h-5 cursor-pointer rounded-full border px-2 text-xs font-medium text-muted-foreground aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background"
                onClick={() => onChange([])}
            >
                All
            </button>
            {tags.map((t) => (
                <Tag
                    key={t}
                    name={t}
                    muted={!selected.includes(t)}
                    pressed={selected.includes(t)}
                    onClick={() =>
                        onChange(
                            selected.includes(t)
                                ? selected.filter((x) => x !== t)
                                : [...selected, t],
                        )
                    }
                />
            ))}
        </div>
    );
}
