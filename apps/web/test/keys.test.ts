import { expect, test } from "bun:test";
import { keyBytes, withMods } from "../src/keys";

const none = { ctrl: false, alt: false };
const ctrl = { ctrl: true, alt: false };
const alt = { ctrl: false, alt: true };

test("withMods: CTRL maps to control codes, ALT prefixes ESC", () => {
    expect(withMods("c", none)).toBe("c");
    expect(withMods("c", ctrl)).toBe("\x03");
    expect(withMods("C", ctrl)).toBe("\x03");
    expect(withMods("[", ctrl)).toBe("\x1b");
    expect(withMods(" ", ctrl)).toBe("\0");
    expect(withMods("?", ctrl)).toBe("\x7f");
    expect(withMods("x", alt)).toBe("\x1bx");
    expect(withMods("c", { ctrl: true, alt: true })).toBe("\x1b\x03");
    expect(withMods("ab", ctrl)).toBe("ab");
});

test("keyBytes: cursor keys follow DECCKM, modifiers use xterm params", () => {
    expect(keyBytes("↑", none, false)).toBe("\x1b[A");
    expect(keyBytes("↑", none, true)).toBe("\x1bOA");
    expect(keyBytes("HOME", none, false)).toBe("\x1b[H");
    expect(keyBytes("END", none, true)).toBe("\x1bOF");
    expect(keyBytes("→", ctrl, true)).toBe("\x1b[1;5C");
    expect(keyBytes("←", alt, false)).toBe("\x1b[1;3D");
    expect(keyBytes("PGUP", none, false)).toBe("\x1b[5~");
    expect(keyBytes("PGDN", ctrl, false)).toBe("\x1b[6;5~");
});

test("keyBytes: ESC, TAB and literal keys", () => {
    expect(keyBytes("ESC", none, false)).toBe("\x1b");
    expect(keyBytes("TAB", none, false)).toBe("\t");
    expect(keyBytes("TAB", alt, false)).toBe("\x1b\t");
    expect(keyBytes("/", none, false)).toBe("/");
    expect(keyBytes("-", alt, false)).toBe("\x1b-");
});
