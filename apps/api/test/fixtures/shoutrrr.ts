// Fake `shoutrrr send`: appends what it got to the log file in argv[2]. A URL with "fail" in it fails like shoutrrr does.
import { appendFileSync } from "node:fs";

const [, , log, ...args] = process.argv;
const url = process.env.SHOUTRRR_URL ?? "";
appendFileSync(
    log as string,
    `${JSON.stringify({ url, args, body: await Bun.stdin.text(), env: Object.keys(process.env).sort() })}\n`,
);
if (url.includes("fail")) {
    console.error(
        "Reading from STDIN...\nntfy: failed to send ntfy notification",
    );
    process.exit(69);
}
