// Fixed-window counter per key, in memory (single process).
// Map order = insertion order = reset order, so expired keys are always at the front; past maxKeys the oldest go first.
export function rateLimiter(limit: number, windowMs: number, maxKeys = 10_000) {
    const hits = new Map<string, { count: number; reset: number }>();
    return (key: string) => {
        const now = Date.now();
        for (const [k, v] of hits) {
            if (v.reset > now && (hits.size < maxKeys || hits.has(key))) break;
            hits.delete(k);
        }
        let hit = hits.get(key);
        if (!hit) {
            hit = { count: 0, reset: now + windowMs };
            hits.set(key, hit);
        }
        return ++hit.count <= limit;
    };
}

// X-Forwarded-For is only believed when the direct peer is a trusted proxy; walk it right to left past our own proxies.
export function clientIp(
    peer: string | undefined,
    xff: string | undefined,
    trusted: Set<string>,
) {
    // Bun reports IPv4 peers on a dual-stack socket as ::ffff:a.b.c.d.
    peer = peer?.replace(/^::ffff:(?=\d+\.)/, "");
    if (!peer || !trusted.has(peer) || !xff) return peer ?? "unknown";
    const hops = xff.split(",").map((h) => h.trim());
    for (let i = hops.length - 1; i >= 0; i--) {
        const hop = hops[i];
        if (hop && !trusted.has(hop)) return hop;
    }
    return peer;
}

// Concurrent ssh processes per key: each holds a pid for up to 8h, and the container has pids_limit 256.
export function concurrencyLimit(max: number) {
    const active = new Map<string, number>();
    return {
        acquire(key: string, n = 1) {
            const count = (active.get(key) ?? 0) + n;
            if (count > max) return false;
            active.set(key, count);
            return true;
        },
        release(key: string) {
            const count = (active.get(key) ?? 1) - 1;
            if (count > 0) active.set(key, count);
            else active.delete(key);
        },
    };
}

export type ConcurrencyLimit = ReturnType<typeof concurrencyLimit>;
