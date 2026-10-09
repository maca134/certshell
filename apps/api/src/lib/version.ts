const TAGS_URL =
    "https://api.github.com/repos/maca134/certshell/tags?per_page=100";

const semver = (v: string) =>
    v
        .match(/^v?(\d+)\.(\d+)\.(\d+)$/)
        ?.slice(1)
        .map(Number);

export function isNewer(a: string, b: string) {
    const x = semver(a);
    const y = semver(b);
    if (!x || !y) return false;
    for (let i = 0; i < 3; i++)
        if (x[i] !== y[i]) return (x[i] ?? 0) > (y[i] ?? 0);
    return false;
}

/** Polls GitHub's tags; `latest()` is the newest version above `current`. Failures keep the last answer. */
export function updateChecker(
    current: string,
    fetchTags = () =>
        fetch(TAGS_URL, {
            headers: {
                accept: "application/vnd.github+json",
                "user-agent": `certshell/${current}`,
            },
            signal: AbortSignal.timeout(10_000),
        }),
) {
    let latest: string | undefined;
    const check = async () => {
        try {
            const res = await fetchTags();
            if (!res.ok) return;
            for (const { name } of (await res.json()) as { name: string }[])
                if (isNewer(name, latest ?? current))
                    latest = name.replace(/^v/, "");
        } catch {}
    };
    return { latest: () => latest, check };
}
