import { expect, test } from "bun:test";
import type { RunHost } from "@repo/shared";
import { diffLines, groupOutputs, withContext } from "../src/outputs";

const host = (
    hostName: string,
    exitCode: number | null,
    output: string,
    status: RunHost["status"] = exitCode === 0 ? "ok" : "failed",
): RunHost => ({
    hostId: hostName,
    hostName,
    login: "root",
    status,
    exitCode,
    output,
});

test("groupOutputs: same exit code + output together, biggest first, running left out", () => {
    const a = host("a", 1, "boom\n");
    const b = host("b", 0, "done\n");
    const c = host("c", 0, "done\n");
    const d = host("d", 1, "done\n");
    const e = host("e", null, "", "running");
    expect(groupOutputs([a, b, c, d, e])).toEqual([
        { status: "ok", exitCode: 0, output: "done\n", hosts: [b, c] },
        { status: "failed", exitCode: 1, output: "boom\n", hosts: [a] },
        { status: "failed", exitCode: 1, output: "done\n", hosts: [d] },
    ]);
    expect(groupOutputs([e])).toEqual([]);
});

test("diffLines: unchanged, removed and added lines in order", () => {
    expect(diffLines("a\nb\nc\n", "a\nx\nc\n")).toEqual([
        { op: " ", text: "a" },
        { op: "-", text: "b" },
        { op: "+", text: "x" },
        { op: " ", text: "c" },
    ]);
    expect(diffLines("", "a\n")).toEqual([{ op: "+", text: "a" }]);
    expect(diffLines("a\n", "a\n")).toEqual([{ op: " ", text: "a" }]);
    expect(diffLines("a\nb\nc\nd", "b\nd\ne")).toEqual([
        { op: "-", text: "a" },
        { op: " ", text: "b" },
        { op: "-", text: "c" },
        { op: " ", text: "d" },
        { op: "+", text: "e" },
    ]);
});

test("diffLines: huge middles fall back to all removed, then all added", () => {
    const a = Array.from({ length: 2100 }, (_, i) => `a${i}`).join("\n");
    const b = Array.from({ length: 2100 }, (_, i) => `b${i}`).join("\n");
    const d = diffLines(`top\n${a}`, `top\n${b}`);
    expect(d).toHaveLength(4201);
    expect(d[0]).toEqual({ op: " ", text: "top" });
    expect(d[1]).toEqual({ op: "-", text: "a0" });
    expect(d[2101]).toEqual({ op: "+", text: "b0" });
});

test("withContext: keeps lines near changes, folds the rest", () => {
    const a = "1\n2\n3\n4\n5\n6\n7\n8\n9\n";
    const b = "1\n2\n3\n4\nX\n6\n7\n8\n9\n";
    expect(withContext(diffLines(a, b), 1)).toEqual([
        { skipped: 3 },
        { op: " ", text: "4" },
        { op: "-", text: "5" },
        { op: "+", text: "X" },
        { op: " ", text: "6" },
        { skipped: 3 },
    ]);
    expect(withContext(diffLines(a, a), 1)).toEqual([{ skipped: 9 }]);
});
