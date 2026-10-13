/**
 * Bytes to send when the touch input box changes from `prev` to `next`: a DEL for each
 * character after the common prefix, then the new text. Gboard re-composes words it
 * remembers ("hello" → "hello123"); sending only the change stops them arriving twice.
 */
export function diffInput(prev: string, next: string) {
    const a = [...prev];
    const b = [...next];
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return (
        "\x7f".repeat(a.length - i) + b.slice(i).join("").replace(/\n/g, "\r")
    );
}
