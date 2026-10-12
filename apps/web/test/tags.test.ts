import { expect, test } from "bun:test";
import {
    cleanTag,
    groupByTag,
    TAG_COLOURS,
    tagColour,
    withTags,
} from "../src/tags";

test("tagColour: same name, same palette colour; names spread over the palette", () => {
    expect(tagColour("prod")).toBe(tagColour("prod"));
    const names = ["prod", "staging", "docker", "network", "backup", "homelab"];
    for (const n of names) expect(TAG_COLOURS).toContain(tagColour(n) as never);
    expect(new Set(names.map(tagColour)).size).toBeGreaterThan(2);
});

test("cleanTag: lowercases, spaces to -, drops the rest, max 32", () => {
    expect(cleanTag("  Web Prod ")).toBe("web-prod");
    expect(cleanTag("a_b.c!")).toBe("abc");
    expect(cleanTag("x".repeat(40))).toBe("x".repeat(32));
    expect(cleanTag("!!")).toBe("");
});

const a = { id: "a", tags: ["docker", "prod"] };
const b = { id: "b", tags: ["prod"] };
const c = { id: "c", tags: [] };

test("withTags: host must have every selected tag", () => {
    expect(withTags([a, b, c], [])).toEqual([a, b, c]);
    expect(withTags([a, b, c], ["prod"])).toEqual([a, b]);
    expect(withTags([a, b, c], ["prod", "docker"])).toEqual([a]);
    expect(withTags([a, b, c], ["nope"])).toEqual([]);
});

test("groupByTag: sorted tags, host under each tag, untagged last", () => {
    expect(groupByTag([a, b, c])).toEqual([
        { tag: "docker", hosts: [a] },
        { tag: "prod", hosts: [a, b] },
        { tag: null, hosts: [c] },
    ]);
    expect(groupByTag([b])).toEqual([{ tag: "prod", hosts: [b] }]);
});
