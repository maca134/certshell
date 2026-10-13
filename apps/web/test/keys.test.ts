import { expect, test } from "bun:test";
import { keyBytes, withMods } from "../src/keys";

const none = { ctrl: false, alt: false };
const ctrl = { ctrl: true, alt: false };
const alt = { ctrl: false, alt: true };

test("withMods: Ctrl maps to control codes, Alt prefixes ESC", () => {
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
    expect(keyBytes("up", none, false)).toBe("\x1b[A");
    expect(keyBytes("up", none, true)).toBe("\x1bOA");
    expect(keyBytes("home", none, false)).toBe("\x1b[H");
    expect(keyBytes("end", none, true)).toBe("\x1bOF");
    expect(keyBytes("right", ctrl, true)).toBe("\x1b[1;5C");
    expect(keyBytes("left", alt, false)).toBe("\x1b[1;3D");
    expect(keyBytes("pgup", none, false)).toBe("\x1b[5~");
    expect(keyBytes("pgdn", ctrl, false)).toBe("\x1b[6;5~");
});

test("keyBytes: Esc, Tab, ^C and ^D", () => {
    expect(keyBytes("esc", none, false)).toBe("\x1b");
    expect(keyBytes("tab", none, false)).toBe("\t");
    expect(keyBytes("tab", alt, false)).toBe("\x1b\t");
    expect(keyBytes("cc", none, false)).toBe("\x03");
    expect(keyBytes("cd", none, false)).toBe("\x04");
});
