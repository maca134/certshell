// Full class strings so Tailwind's scanner sees them.
export const TAG_COLOURS = [
    "border-red-400/25 bg-red-400/15 text-red-300",
    "border-orange-400/25 bg-orange-400/15 text-orange-300",
    "border-amber-400/25 bg-amber-400/15 text-amber-300",
    "border-lime-400/25 bg-lime-400/15 text-lime-300",
    "border-emerald-400/25 bg-emerald-400/15 text-emerald-300",
    "border-teal-400/25 bg-teal-400/15 text-teal-300",
    "border-sky-400/25 bg-sky-400/15 text-sky-300",
    "border-indigo-400/25 bg-indigo-400/15 text-indigo-300",
    "border-violet-400/25 bg-violet-400/15 text-violet-300",
    "border-pink-400/25 bg-pink-400/15 text-pink-300",
] as const;

/** FNV-1a of the name, so a tag keeps its colour everywhere without storing one. */
export function tagColour(name: string) {
    let h = 0x811c9dc5;
    for (const c of name) {
        h ^= c.codePointAt(0) ?? 0;
        h = Math.imul(h, 0x01000193);
    }
    return TAG_COLOURS[(h >>> 0) % TAG_COLOURS.length] as string;
}

/** Same rule as the API: lowercase letters, digits and -, 1–32 chars. */
export const cleanTag = (s: string) =>
    s
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, "")
        .slice(0, 32);

/** Hosts with every tag in `selected`. */
export const withTags = <T extends { tags: string[] }>(
    hosts: T[],
    selected: string[],
) => hosts.filter((h) => selected.every((t) => h.tags.includes(t)));

/** One group per tag in use (sorted), then untagged (`tag: null`). A host is listed under each of its tags. */
export function groupByTag<T extends { tags: string[] }>(hosts: T[]) {
    const tags = [...new Set(hosts.flatMap((h) => h.tags))].sort();
    return [
        ...tags.map((tag) => ({
            tag,
            hosts: hosts.filter((h) => h.tags.includes(tag)),
        })),
        { tag: null, hosts: hosts.filter((h) => h.tags.length === 0) },
    ].filter((g) => g.hosts.length > 0);
}
