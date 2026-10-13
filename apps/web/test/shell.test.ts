import { expect, test } from "bun:test";
import { type TokenKind, tokenize } from "../src/shell";

const kinds = (src: string, kind: TokenKind) =>
    tokenize(src)
        .filter((t) => t.kind === kind)
        .map((t) => t.text);

const SCRIPT = `S=claude; D=/opt/x # setup
if tmux has-session -t "$S" 2>/dev/null; then
  tmux kill-session -t "$S" && echo "stopped '$S'"
else
  for i in $(seq 1 20); do
    URL=$(grep -oE 'https://[^[:space:]]+' | head -1)
    [ -n "\${URL}" ] && break
  done
fi`;

test("tokenize: texts join back into the script", () => {
    expect(
        tokenize(SCRIPT)
            .map((t) => t.text)
            .join(""),
    ).toBe(SCRIPT);
});

test("tokenize: commands only in command position", () => {
    expect(kinds(SCRIPT, "command")).toEqual([
        "tmux",
        "tmux",
        "echo",
        "seq",
        "grep",
        "head",
        "[",
        "break",
    ]);
});

test("tokenize: keywords, but not for's variable or command arguments", () => {
    expect(kinds(SCRIPT, "keyword")).toEqual([
        "if",
        "then",
        "else",
        "for",
        "in",
        "do",
        "done",
        "fi",
    ]);
    expect(kinds("echo done", "keyword")).toEqual([]);
});

test("tokenize: vars inside double quotes, not single", () => {
    expect(kinds(`echo "a $X \${Y}" '$Z' $?`, "var")).toEqual([
        "$X",
        `\${Y}`,
        "$?",
    ]);
    expect(kinds(`echo "a $X" '$Z'`, "string")).toEqual(['"a ', '"', "'$Z'"]);
});

test("tokenize: comments, operators, escapes", () => {
    expect(kinds("ls # list\necho a#b", "comment")).toEqual(["# list"]);
    expect(kinds("a 2>/dev/null && b | c; d", "op")).toEqual([
        "2>",
        "&&",
        "|",
        ";",
    ]);
    expect(kinds("echo \\$HOME", "var")).toEqual([]);
});

test("tokenize: unterminated quotes run to the end", () => {
    expect(kinds("echo 'oops", "string")).toEqual(["'oops"]);
    expect(kinds('echo "oops $X', "string")).toEqual(['"oops ']);
});
