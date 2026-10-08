export type Mods = { ctrl: boolean; alt: boolean };

const CURSOR = { "↑": "A", "↓": "B", "→": "C", "←": "D", HOME: "H", END: "F" };
const TILDE = { PGUP: "5", PGDN: "6" };

export const KEYS = [
    ...["ESC", "/", "-", "HOME", "↑", "END", "PGUP"],
    ...["TAB", "CTRL", "ALT", "←", "↓", "→", "PGDN"],
] as const;

export type Key = (typeof KEYS)[number];

/** Applies held modifiers to typed text: CTRL+c → \x03, ALT+x → ESC x. */
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

/** Bytes for a key-bar key. `appCursor` = DECCKM, set by full-screen apps like vim/less. */
export function keyBytes(key: Key, mods: Mods, appCursor: boolean) {
    const m = 1 + (mods.alt ? 2 : 0) + (mods.ctrl ? 4 : 0);
    if (key in CURSOR) {
        const f = CURSOR[key as keyof typeof CURSOR];
        if (m > 1) return `\x1b[1;${m}${f}`;
        return appCursor ? `\x1bO${f}` : `\x1b[${f}`;
    }
    if (key in TILDE)
        return `\x1b[${TILDE[key as keyof typeof TILDE]}${m > 1 ? `;${m}` : ""}~`;
    if (key === "ESC") return "\x1b";
    if (key === "TAB") return withMods("\t", { ...mods, ctrl: false });
    return withMods(key, mods);
}
