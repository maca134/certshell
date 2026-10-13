import { expect, test } from "bun:test";
import { diffInput } from "../src/diff-input";

test("diffInput: typing sends only the new characters", () => {
    expect(diffInput("", "h")).toBe("h");
    expect(diffInput("hel", "hello")).toBe("lo");
    expect(diffInput("hello", "hello")).toBe("");
});

test("diffInput: a re-composed word is not sent twice", () => {
    expect(diffInput("hello", "hello123")).toBe("123");
});

test("diffInput: backspace and autocorrect send DELs then the replacement", () => {
    expect(diffInput("hello", "hell")).toBe("\x7f");
    expect(diffInput("teh", "the")).toBe("\x7f\x7fhe");
    expect(diffInput("ls -la", "")).toBe("\x7f".repeat(6));
});

test("diffInput: newline becomes \\r", () => {
    expect(diffInput("ls", "ls\n")).toBe("\r");
});

test("diffInput: counts emoji as one character", () => {
    expect(diffInput("a😀", "a")).toBe("\x7f");
    expect(diffInput("a😀", "a😀b")).toBe("b");
});
