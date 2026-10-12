import type { RunHost } from "@repo/shared";

export type OutputGroup = {
    status: RunHost["status"];
    exitCode: number | null;
    output: string;
    hosts: RunHost[];
};

/** Finished hosts grouped by exit code + output, biggest group first. Running hosts are left out. */
export function groupOutputs(hosts: RunHost[]): OutputGroup[] {
    const groups = new Map<string, OutputGroup>();
    for (const h of hosts) {
        if (h.status === "running") continue;
        const key = `${h.exitCode}\n${h.output}`;
        const g = groups.get(key);
        if (g) g.hosts.push(h);
        else
            groups.set(key, {
                status: h.status,
                exitCode: h.exitCode,
                output: h.output,
                hosts: [h],
            });
    }
    return [...groups.values()].sort((a, b) => b.hosts.length - a.hosts.length);
}

export type DiffLine = { op: " " | "-" | "+"; text: string };

const lines = (s: string) => (s === "" ? [] : s.replace(/\n$/, "").split("\n"));

/** Above this many cells the LCS table is skipped and the middle shows as all removed, then all added. */
const MAX_CELLS = 4_000_000;

/** Line diff of `a` → `b`. */
export function diffLines(a: string, b: string): DiffLine[] {
    const x = lines(a);
    const y = lines(b);
    let pre = 0;
    while (pre < x.length && pre < y.length && x[pre] === y[pre]) pre++;
    let suf = 0;
    while (
        suf < x.length - pre &&
        suf < y.length - pre &&
        x[x.length - 1 - suf] === y[y.length - 1 - suf]
    )
        suf++;
    const xs = x.slice(pre, x.length - suf);
    const ys = y.slice(pre, y.length - suf);
    const same = (t: string): DiffLine => ({ op: " ", text: t });
    const del = (t: string): DiffLine => ({ op: "-", text: t });
    const add = (t: string): DiffLine => ({ op: "+", text: t });

    const mid: DiffLine[] = [];
    const n = xs.length;
    const m = ys.length;
    if (n * m > MAX_CELLS) mid.push(...xs.map(del), ...ys.map(add));
    else {
        // lcs[i * (m + 1) + j]: LCS length of xs[i:] and ys[j:].
        const lcs = new Uint32Array((n + 1) * (m + 1));
        for (let i = n - 1; i >= 0; i--)
            for (let j = m - 1; j >= 0; j--)
                lcs[i * (m + 1) + j] =
                    xs[i] === ys[j]
                        ? (lcs[(i + 1) * (m + 1) + j + 1] as number) + 1
                        : Math.max(
                              lcs[(i + 1) * (m + 1) + j] as number,
                              lcs[i * (m + 1) + j + 1] as number,
                          );
        let i = 0;
        let j = 0;
        while (i < n && j < m) {
            if (xs[i] === ys[j]) {
                mid.push(same(xs[i++] as string));
                j++;
            } else if (
                (lcs[(i + 1) * (m + 1) + j] as number) >=
                (lcs[i * (m + 1) + j + 1] as number)
            )
                mid.push(del(xs[i++] as string));
            else mid.push(add(ys[j++] as string));
        }
        mid.push(...xs.slice(i).map(del), ...ys.slice(j).map(add));
    }
    return [
        ...x.slice(0, pre).map(same),
        ...mid,
        ...y.slice(y.length - suf).map(same),
    ];
}

/** Keeps `context` unchanged lines around each change; longer unchanged runs become `{ skipped }`. */
export function withContext(
    diff: DiffLine[],
    context = 3,
): (DiffLine | { skipped: number })[] {
    const near = diff.map(() => false);
    diff.forEach((d, i) => {
        if (d.op === " ") return;
        for (
            let k = Math.max(0, i - context);
            k <= Math.min(diff.length - 1, i + context);
            k++
        )
            near[k] = true;
    });
    const out: (DiffLine | { skipped: number })[] = [];
    let skipped = 0;
    diff.forEach((d, i) => {
        if (near[i]) {
            if (skipped) out.push({ skipped });
            skipped = 0;
            out.push(d);
        } else skipped++;
    });
    if (skipped) out.push({ skipped });
    return out;
}
