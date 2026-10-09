const esc = (s) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// groups: comment, string, variable, yaml key, env key, shell command
const RE =
    /((?<=^|\s)#.*)|("[^"\n]*")|(\$\{\w+\}|\{\$\w+\}|\{\{[^}\n]*\}\})|((?<=^ *(?:- )?)[\w.-]+(?=:(?: |$)))|(^[A-Z_]+(?==))|(^[a-z]+(?= ))/gm;
const CLASSES = ["tok-c", "tok-s", "tok-v", "tok-k", "tok-k", "tok-cmd"];

export function highlight(text, lang) {
    let html = "";
    let last = 0;
    for (const m of text.matchAll(RE)) {
        const group = m.slice(1).findIndex((g) => g !== undefined);
        if (CLASSES[group] === "tok-cmd" && lang !== "sh") continue;
        html += `${esc(text.slice(last, m.index))}<span class="${CLASSES[group]}">${esc(m[0])}</span>`;
        last = m.index + m[0].length;
    }
    return html + esc(text.slice(last));
}
