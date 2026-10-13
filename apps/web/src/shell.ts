export type TokenKind =
    | "plain"
    | "comment"
    | "string"
    | "var"
    | "keyword"
    | "command"
    | "op";
export type Token = { kind: TokenKind; text: string };

const KEYWORDS = new Set(
    "if then else elif fi for in do done while until case esac function select".split(
        " ",
    ),
);
/** Keywords followed by a name or word list, not a command. */
const NO_COMMAND_AFTER = new Set(["for", "case", "select", "in", "function"]);
const VAR = /^\$(?:\{[^}\n]*\}|[A-Za-z_]\w*|[0-9?#@*$!-])/;
const OP = /^(?:\$\(|&&|\|\||;;|[|&;()`]|[0-9]*[<>]+&?-?)/;
const WORD = /^[^\s|&;()<>'"$`\\]+/;

/** Splits a shell script into tokens for highlighting; joining the texts gives back the script. */
export function tokenize(src: string): Token[] {
    const out: Token[] = [];
    const push = (kind: TokenKind, text: string) => {
        const last = out.at(-1);
        if (last?.kind === kind) last.text += text;
        else out.push({ kind, text });
    };
    let cmd = true;
    let i = 0;
    while (i < src.length) {
        const rest = src.slice(i);
        const c = src[i];
        if (/\s/.test(c)) {
            if (c === "\n") cmd = true;
            push("plain", c);
            i++;
        } else if (c === "#") {
            const end = src.indexOf("\n", i);
            const text = end < 0 ? rest : src.slice(i, end);
            push("comment", text);
            i += text.length;
        } else if (c === "'") {
            const end = src.indexOf("'", i + 1);
            const text = end < 0 ? rest : src.slice(i, end + 1);
            push("string", text);
            i += text.length;
            cmd = false;
        } else if (c === '"') {
            i = doubleQuoted(src, i, push);
            cmd = false;
        } else if (c === "\\") {
            push("plain", src.slice(i, i + 2));
            i += 2;
        } else {
            const v = rest.match(VAR)?.[0];
            const op = v ? undefined : rest.match(OP)?.[0];
            const w = v || op ? undefined : rest.match(WORD)?.[0];
            if (v) {
                push("var", v);
                cmd = false;
            } else if (op) {
                push("op", op);
                cmd = !/[<>)]/.test(op);
            } else if (w) {
                if (KEYWORDS.has(w) && (cmd || w === "in")) {
                    push("keyword", w);
                    cmd = !NO_COMMAND_AFTER.has(w);
                } else if (cmd && /^[A-Za-z_]\w*=/.test(w)) {
                    push("plain", w);
                } else {
                    push(cmd ? "command" : "plain", w);
                    cmd = false;
                }
            } else {
                push("plain", c);
            }
            i += (v ?? op ?? w ?? c).length;
        }
    }
    return out;
}

/** Consumes a "..." string from `start`, highlighting $vars inside; returns the index after it. */
function doubleQuoted(
    src: string,
    start: number,
    push: (kind: TokenKind, text: string) => void,
): number {
    push("string", '"');
    let i = start + 1;
    while (i < src.length) {
        const c = src[i];
        if (c === '"') {
            push("string", c);
            return i + 1;
        }
        if (c === "\\") {
            push("string", src.slice(i, i + 2));
            i += 2;
            continue;
        }
        const m = c === "$" ? src.slice(i).match(VAR) : null;
        if (m) {
            push("var", m[0]);
            i += m[0].length;
        } else {
            push("string", c);
            i++;
        }
    }
    return i;
}
