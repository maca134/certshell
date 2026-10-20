// Fake `shoutrrr send`: appends what it got to the log file in argv[2]. A URL with "fail" in it fails like shoutrrr does; "leak" fails quoting a webhook URL; "echo" fails quoting its SECRET… parts on their own, like telegram/gotify; with "pad", from char 490.
import { appendFileSync } from "node:fs";

const [, , log, ...args] = process.argv;
const url = process.env.SHOUTRRR_URL ?? "";
appendFileSync(
    log as string,
    `${JSON.stringify({ url, args, body: await Bun.stdin.text(), env: Object.keys(process.env).sort() })}\n`,
);
if (url.includes("leak")) {
    console.error(
        'Post "https://discord.com/api/webhooks/1/SECRETTOK": dial tcp: lookup failed',
    );
    process.exit(1);
}
if (url.includes("echo")) {
    console.error(
        `${url.includes("pad") ? "x".repeat(475) : ""}invalid token: ${decodeURIComponent(
            url,
        )
            .match(/SECRET[\w ]*/g)
            ?.join(" ")}`,
    );
    process.exit(1);
}
if (url.includes("fail")) {
    console.error(
        "Reading from STDIN...\nntfy: failed to send ntfy notification",
    );
    process.exit(69);
}
