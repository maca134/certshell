// Regenerates docs/media: UI screenshots and the demo GIF/MP4, from the dev UI with a mocked API (media/fixtures.ts).
// Needs ffmpeg and Playwright's Chromium (bunx playwright install chromium).
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
    type Browser,
    chromium,
    devices,
    type Locator,
    type Page,
} from "@playwright/test";
import { mockApi } from "./fixtures.ts";

const root = join(import.meta.dirname, "../../..");
const out = join(root, "docs/media");
const port = 5175;
const base = `http://127.0.0.1:${port}`;
const viewport = { width: 1280, height: 760 };

const version =
    readFileSync(join(root, "CHANGELOG.md"), "utf8").match(
        /^## (\d+\.\d+\.\d+)/m,
    )?.[1] ?? "dev";

/** A dot that follows the mouse: headless video has no cursor, so clicks would look like nothing caused them. */
const CURSOR = `addEventListener("DOMContentLoaded", () => {
    const c = document.createElement("div");
    c.style.cssText = "position:fixed;z-index:2147483647;left:0;top:0;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:rgba(255,255,255,.35);border:2px solid rgba(255,255,255,.85);pointer-events:none;transition:transform .12s;transform:translate(-40px,-40px)";
    document.body.append(c);
    let x = -40, y = -40;
    addEventListener("mousemove", (e) => { x = e.clientX; y = e.clientY; c.style.transform = "translate(" + x + "px," + y + "px)"; }, true);
    addEventListener("mousedown", () => { c.style.transform = "translate(" + x + "px," + y + "px) scale(.7)"; }, true);
    addEventListener("mouseup", () => { c.style.transform = "translate(" + x + "px," + y + "px)"; }, true);
});`;

const vite = spawn(
    "bunx",
    ["vite", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    {
        cwd: join(import.meta.dirname, ".."),
        stdio: ["ignore", "ignore", "inherit"],
    },
);
const browser = await chromium.launch();
try {
    await waitForServer();
    await screenshots(browser);
    await demo(browser);
} finally {
    await browser.close();
    vite.kill();
}

async function waitForServer() {
    for (let i = 0; i < 100; i++) {
        const up = await fetch(base).then(
            (r) => r.ok,
            () => false,
        );
        if (up) return;
        await sleep(100);
    }
    throw new Error(`vite didn't start on ${base}`);
}

async function open(browser: Browser, path: string, video?: string) {
    const context = await browser.newContext({
        viewport,
        deviceScaleFactor: video ? 1 : 2,
        baseURL: base,
        recordVideo: video ? { dir: video, size: viewport } : undefined,
    });
    const page = await context.newPage();
    await mockApi(page, version);
    await page.goto(path);
    return page;
}

async function shot(page: Page, name: string) {
    // Let fonts, chips and relative times settle.
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(out, `${name}.png`) });
    console.log(`docs/media/${name}.png`);
}

/** A part of the page for the README, with a little room around it; `below` takes in that much more under it. */
async function crop(page: Page, target: Locator, name: string, below = 0) {
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(300);
    const box = await target.boundingBox();
    if (!box) throw new Error(`not visible: ${target}`);
    const pad = 12;
    const x = Math.max(0, box.x - pad);
    const y = Math.max(0, box.y - pad);
    await page.screenshot({
        path: join(out, `${name}.png`),
        clip: {
            x,
            y,
            width: Math.min(viewport.width - x, box.width + 2 * pad),
            height: Math.min(viewport.height - y, box.height + 2 * pad + below),
        },
    });
    console.log(`docs/media/${name}.png`);
}

async function mobile(browser: Browser) {
    const context = await browser.newContext({
        ...devices["Pixel 7"],
        baseURL: base,
    });
    const page = await context.newPage();
    await mockApi(page, version);
    await page.goto("/ssh/h1/root");
    await page.getByText("Connected", { exact: true }).waitFor();
    await page.keyboard.type("uptime\r");
    await shot(page, "mobile-terminal");
    await context.close();
}

async function screenshots(browser: Browser) {
    await mobile(browser);
    const page = await open(browser, "/");
    await page.getByText("web1").first().waitFor();
    await shot(page, "hosts");
    await page.getByRole("button", { name: "Group by tag" }).click();
    await shot(page, "hosts-grouped");

    await page.goto("/ssh/h1/root");
    await page.getByText("Connected", { exact: true }).waitFor();
    await page.keyboard.type("uptime\r");
    await page.keyboard.type("journalctl -u ssh -n 2 --no-pager\r");
    await shot(page, "terminal");
    await page.keyboard.press("Control+Shift+F");
    await page.getByRole("textbox", { name: "Search" }).fill("Accepted");
    await crop(page, page.locator("header"), "crop-terminal-search", 144);

    await page.goto("/tasks");
    await page.getByText("Upgrade packages").first().waitFor();
    await shot(page, "tasks");
    await page.goto("/tasks/runs/r1");
    await page.getByText("postgres@").click();
    await shot(page, "task-run");
    await page.goto("/tasks/runs/r0");
    await page.getByText("differs from the most common output").click();
    await shot(page, "task-run-grouped");
    await crop(
        page,
        page.locator("li", { hasText: "differs from" }),
        "crop-task-diff",
    );

    await page.goto("/admin/hosts");
    await page.getByRole("button", { name: "Edit web2" }).waitFor();
    await shot(page, "admin-hosts");
    await page.getByRole("button", { name: "Enroll monitor1" }).click();
    await page.getByRole("dialog").getByText("One-time use").waitFor();
    await crop(page, page.getByRole("dialog"), "crop-enroll");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Edit web2" }).click();
    await page.getByRole("dialog").getByPlaceholder("Add a tag…").click();
    await shot(page, "admin-host-tags");
    await page.keyboard.type("ed");
    await crop(page, page.getByRole("dialog"), "crop-host-tags");
    await page.goto("/admin/fleet");
    await page.getByText("ci-runner").first().waitFor();
    await shot(page, "admin-fleet");
    await crop(
        page,
        page.getByRole("button", { name: /^Need a reboot/ }).locator(".."),
        "crop-fleet-counts",
    );
    await page.goto("/admin/alerts");
    await page.getByText("Ops phone").first().waitFor();
    await shot(page, "admin-alerts");
    await page.getByRole("button", { name: "Edit Ops phone" }).click();
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await crop(page, page.getByRole("dialog"), "alerts-edit");
    await page.goto("/admin/users");
    await page.getByText("carol@example.com").first().waitFor();
    await shot(page, "admin-users");
    await page.goto("/admin/sessions");
    await page.getByText("bob@example.com").first().waitFor();
    await shot(page, "admin-sessions");
    await page.goto("/admin/audit");
    await page.getByText("host_update").first().waitFor();
    await shot(page, "admin-audit");
    await page.context().close();
}

async function demo(browser: Browser) {
    const dir = mkdtempSync(join(tmpdir(), "certshell-media-"));
    try {
        const t0 = Date.now();
        const page = await open(browser, "about:blank", dir);
        await page.addInitScript(CURSOR);
        await page.goto("/");
        await page.getByText("web1").first().waitFor();
        await page.waitForLoadState("networkidle");
        await page.mouse.move(640, 500);
        const start = (Date.now() - t0) / 1000 + 0.3;
        await walkthrough(page);
        const video = page.video();
        await page.context().close();
        const webm = (await video?.path()) ?? "";
        const mp4 = join(out, "demo.mp4");
        const gif = join(out, "demo.gif");
        const ffmpeg = (...args: string[]) =>
            execFileSync("ffmpeg", ["-v", "error", "-y", ...args], {
                stdio: "inherit",
            });
        ffmpeg(
            ...["-ss", String(start), "-i", webm, "-an", "-c:v", "libx264"],
            ...["-pix_fmt", "yuv420p", "-crf", "20", "-preset", "slow"],
            ...["-movflags", "+faststart", mp4],
        );
        ffmpeg(
            ...["-i", mp4, "-vf"],
            "fps=10,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle",
            gif,
        );
        console.log("docs/media/demo.mp4\ndocs/media/demo.gif");
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

async function click(page: Page, target: Locator) {
    const box = await target.boundingBox();
    if (!box) throw new Error(`not visible: ${target}`);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
        steps: 15,
    });
    await page.waitForTimeout(150);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(150);
}

async function walkthrough(page: Page) {
    const pause = (ms: number) => page.waitForTimeout(ms);
    const tagBar = page.getByText("Tags", { exact: true }).locator("..");
    await pause(900);

    // Tags: filter, then group.
    await click(page, tagBar.getByRole("button", { name: "prod" }));
    await pause(750);
    await click(page, tagBar.getByRole("button", { name: "All" }));
    await pause(450);
    await click(page, page.getByRole("button", { name: "Group by tag" }));
    await pause(1200);
    await click(page, page.getByRole("button", { name: "List" }));
    await pause(500);

    // Terminal.
    await click(
        page,
        page
            .getByRole("listitem")
            .filter({ hasText: "web1" })
            .getByRole("link", { name: "root" }),
    );
    await page.getByText("Connected", { exact: true }).waitFor();
    await pause(500);
    await page.keyboard.type("uptime", { delay: 70 });
    await page.keyboard.press("Enter");
    await pause(600);
    await page.keyboard.type("journalctl -u ssh -n 2 --no-pager", {
        delay: 45,
    });
    await page.keyboard.press("Enter");
    await pause(900);
    await click(page, page.getByRole("button", { name: "Search scrollback" }));
    await page.keyboard.type("Accepted", { delay: 70 });
    await pause(1200);
    await click(page, page.getByRole("button", { name: "Hosts" }));
    await pause(350);

    // Tasks: run one on four hosts, open the one whose output differs.
    await click(page, page.getByRole("link", { name: "Tasks" }));
    await pause(750);
    await click(
        page,
        page
            .getByRole("listitem")
            .filter({ hasText: "Upgrade packages" })
            .getByRole("button", { name: "Run" }),
    );
    await page.getByText("exit 0").first().waitFor();
    await pause(600);
    await click(page, page.getByText("differs from the most common output"));
    await pause(1500);

    // Fleet: hosts that need a reboot.
    await click(page, page.getByRole("link", { name: "Fleet" }));
    await page.getByText("ci-runner").first().waitFor();
    await pause(900);
    await click(page, page.getByRole("button", { name: /^Need a reboot/ }));
    await pause(1300);

    // Alerts: what a channel is sent.
    await click(page, page.getByRole("link", { name: "Alerts" }));
    await page.getByText("Ops phone").first().waitFor();
    await pause(600);
    await click(page, page.getByRole("button", { name: "Edit Ops phone" }));
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await pause(500);
    await click(page, page.getByRole("dialog").getByText("Task failed"));
    await pause(700);
    const save = page.getByRole("dialog").getByRole("button", { name: "Save" });
    await save.scrollIntoViewIfNeeded();
    await pause(400);
    await click(page, save);
    await page.mouse.move(640, 720, { steps: 10 });
    await page.keyboard.press("Escape");
    // The closed dialog hands focus back to its Edit button; don't end on a focus ring.
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await pause(1500);
}
