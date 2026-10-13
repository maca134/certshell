export type Mods = { ctrl: boolean; alt: boolean };

const CURSOR = {
    up: "A",
    down: "B",
    right: "C",
    left: "D",
    home: "H",
    end: "F",
} as const;
const TILDE = { pgup: "5", pgdn: "6" } as const;
const FIXED = { esc: "\x1b", cc: "\x03", cd: "\x04" } as const;

export type Key =
    | keyof typeof CURSOR
    | keyof typeof TILDE
    | keyof typeof FIXED
    | "tab";

/** Applies modifiers to typed text: Ctrl+c → \x03, Alt+x → ESC x. */
export function withMods(data: string, { ctrl, alt }: Mods) {
    let d = data;
    if (ctrl && d.length === 1) {
        const c = d.toUpperCase().charCodeAt(0);
        if (c >= 0x40 && c <= 0x5f) d = String.fromCharCode(c & 0x1f);
        else if (d === " ") d = "\0";
        else if (d === "?") d = "\x7f";
    }
    return alt ? `\x1b${d}` : d;
}

/** Bytes for a key-tray key. `appCursor` = DECCKM, set by full-screen apps like vim/less. */
export function keyBytes(key: Key, mods: Mods, appCursor: boolean) {
    const m = 1 + (mods.alt ? 2 : 0) + (mods.ctrl ? 4 : 0);
    if (key in CURSOR) {
        const f = CURSOR[key as keyof typeof CURSOR];
        if (m > 1) return `\x1b[1;${m}${f}`;
        return appCursor ? `\x1bO${f}` : `\x1b[${f}`;
    }
    if (key in TILDE)
        return `\x1b[${TILDE[key as keyof typeof TILDE]}${m > 1 ? `;${m}` : ""}~`;
    if (key === "tab") return mods.alt ? "\x1b\t" : "\t";
    return FIXED[key as keyof typeof FIXED];
}
