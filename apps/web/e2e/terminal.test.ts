/// <reference lib="dom" />
import { expect, type Page, test } from "@playwright/test";

// No backend: /api is faked with page.route and the terminal socket with routeWebSocket.
async function openTerminal(page: Page) {
    await page.route("/api/me", (r) =>
        r.fulfill({
            json: {
                iss: "i",
                sub: "s",
                email: "a@b.c",
                groups: [],
                admin: false,
            },
        }),
    );
    await page.route("/api/hosts", (r) =>
        r.fulfill({ json: [{ id: "h1", name: "web1", logins: ["root"] }] }),
    );
    const typed: string[] = [];
    let url = "";
    await page.routeWebSocket(/\/api\/terminal/, (ws) => {
        url = ws.url();
        ws.onMessage((m) => {
            const msg = JSON.parse(String(m));
            if (msg.t === "in") typed.push(msg.d);
        });
    });
    await page.goto("/");
    await page.getByRole("link", { name: "root" }).click();
    await expect(page.getByText("Connected", { exact: true })).toBeVisible();
    return { typed, url: () => new URL(url) };
}

test("host list → terminal: socket for that host/login carries keystrokes", async ({
    page,
}) => {
    const { typed, url } = await openTerminal(page);
    await expect(page).toHaveURL("/ssh/h1/root");
    await expect(page).toHaveTitle("root@web1");
    expect(url().searchParams.get("host")).toBe("h1");
    expect(url().searchParams.get("login")).toBe("root");
    await page.keyboard.type("ls");
    await expect.poll(() => typed.join("")).toBe("ls");
});

test("key bar: hidden without a touch screen", async ({ page, isMobile }) => {
    test.skip(isMobile);
    await openTerminal(page);
    await expect(page.getByRole("button", { name: "ESC" })).toBeHidden();
});

test("key bar: CTRL applies to the next key only; ESC and arrows send escapes", async ({
    page,
    isMobile,
}) => {
    test.skip(!isMobile);
    const { typed } = await openTerminal(page);
    const key = (name: string) =>
        page.getByRole("button", { name, exact: true }).tap();
    await key("CTRL");
    await page.keyboard.type("cc");
    await key("ESC");
    await key("↑");
    await expect.poll(() => typed).toEqual(["\x03", "c", "\x1b", "\x1b[A"]);
});

test("closed session shows the reason and reconnects on demand", async ({
    page,
}) => {
    await page.route("/api/me", (r) =>
        r.fulfill({
            json: { iss: "i", sub: "s", email: null, groups: [], admin: false },
        }),
    );
    await page.route("/api/hosts", (r) =>
        r.fulfill({ json: [{ id: "h1", name: "web1", logins: ["root"] }] }),
    );
    let sockets = 0;
    await page.routeWebSocket(/\/api\/terminal/, (ws) => {
        if (++sockets === 1) ws.close({ code: 4000, reason: "host down" });
    });
    await page.goto("/ssh/h1/root");
    await expect(page.getByText("Disconnected")).toBeVisible();
    await expect(page.getByText("Disconnected")).toHaveAttribute(
        "title",
        "host down",
    );
    await page.getByRole("button", { name: "Reconnect" }).click();
    await expect(page.getByText("Connected", { exact: true })).toBeVisible();
    expect(sockets).toBe(2);
});

test("host list preloads the terminal chunk before a host is picked", async ({
    page,
}) => {
    await page.route("/api/me", (r) =>
        r.fulfill({
            json: { iss: "i", sub: "s", email: null, groups: [], admin: false },
        }),
    );
    await page.route("/api/hosts", (r) =>
        r.fulfill({ json: [{ id: "h1", name: "web1", logins: ["root"] }] }),
    );
    const terminalChunk = page.waitForRequest(/TerminalView/);
    await page.goto("/");
    await expect(page.getByRole("link", { name: "root" })).toBeVisible();
    await terminalChunk;
});

test("host list: dot shows whether port 22 answers", async ({ page }) => {
    await page.route("/api/me", (r) =>
        r.fulfill({ json: { sub: "s", groups: [], admin: false } }),
    );
    await page.route("/api/hosts", (r) =>
        r.fulfill({
            json: [
                { id: "h1", name: "web1", logins: ["root"] },
                { id: "h2", name: "web2", logins: ["root"] },
                { id: "h3", name: "web3", logins: ["root"] },
            ],
        }),
    );
    await page.route("/api/hosts/status", (r) =>
        r.fulfill({ json: { h1: true, h2: false } }),
    );
    await page.goto("/");
    const row = (name: string) =>
        page.getByRole("listitem").filter({ hasText: name });
    await expect(
        row("web1").getByRole("img", { name: "online" }),
    ).toBeVisible();
    await expect(
        row("web2").getByRole("img", { name: "offline" }),
    ).toBeVisible();
    await expect(row("web3").getByRole("img")).toHaveCount(0);
});

const paste = (page: Page, text: string) =>
    page.evaluate((text) => {
        const data = new DataTransfer();
        data.setData("text/plain", text);
        document.querySelector(".xterm-helper-textarea")?.dispatchEvent(
            new ClipboardEvent("paste", {
                clipboardData: data,
                bubbles: true,
                cancelable: true,
            }),
        );
    }, text);

test("paste: lines that would run ask first, unless bracketed paste is on", async ({
    page,
}) => {
    const { typed } = await openTerminal(page);
    await paste(page, "one line");
    await expect.poll(() => typed.join("")).toBe("one line");

    let asked = "";
    page.once("dialog", (d) => {
        asked = d.message();
        d.dismiss();
    });
    await paste(page, "rm -rf x\nreboot\n");
    await expect.poll(() => asked).toContain("runs 2 commands");
    expect(typed.join("")).toBe("one line");

    page.once("dialog", (d) => d.accept());
    await paste(page, "ls\n");
    await expect.poll(() => typed.join("")).toBe("one linels\r");
});

test("paste: no prompt when the shell turned on bracketed paste", async ({
    page,
}) => {
    let server: { send: (m: Buffer) => void } | undefined;
    await page.route("/api/me", (r) =>
        r.fulfill({ json: { sub: "s", groups: [], admin: false } }),
    );
    await page.route("/api/hosts", (r) =>
        r.fulfill({ json: [{ id: "h1", name: "web1", logins: ["root"] }] }),
    );
    const typed: string[] = [];
    await page.routeWebSocket(/\/api\/terminal/, (ws) => {
        server = ws;
        ws.onMessage((m) => {
            const msg = JSON.parse(String(m));
            if (msg.t === "in") typed.push(msg.d);
        });
    });
    await page.goto("/ssh/h1/root");
    await expect(page.getByText("Connected", { exact: true })).toBeVisible();
    server?.send(Buffer.from("\x1b[?2004hready>"));
    await expect(page.getByText("ready>", { exact: true })).toBeVisible();
    let asked = false;
    page.once("dialog", (d) => {
        asked = true;
        d.dismiss();
    });
    await paste(page, "a\nb\n");
    await expect.poll(() => typed.join("")).toBe("\x1b[200~a\rb\r\x1b[201~");
    expect(asked).toBe(false);
});

test("search: finds text in scrollback, says when nothing matches", async ({
    page,
}) => {
    let server: { send: (m: Buffer) => void } | undefined;
    await page.route("/api/me", (r) =>
        r.fulfill({ json: { sub: "s", groups: [], admin: false } }),
    );
    await page.route("/api/hosts", (r) =>
        r.fulfill({ json: [{ id: "h1", name: "web1", logins: ["root"] }] }),
    );
    const typed: string[] = [];
    await page.routeWebSocket(/\/api\/terminal/, (ws) => {
        server = ws;
        ws.onMessage((m) => typed.push(JSON.parse(String(m)).d));
    });
    await page.goto("/ssh/h1/root");
    await expect(page.getByText("Connected", { exact: true })).toBeVisible();
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i}`);
    server?.send(Buffer.from(`needle\r\n${lines.join("\r\n")}\r\nend>`));
    await expect(page.getByText("end>", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Search scrollback" }).click();
    const box = page.getByRole("textbox", { name: "Search" });
    await box.fill("needle");
    await expect(page.getByText("needle", { exact: true })).toBeVisible();
    await expect(page.getByText("No match")).toBeHidden();
    await box.fill("haystack");
    await expect(page.getByText("No match")).toBeVisible();

    await box.press("Escape");
    await expect(box).toBeHidden();
    await page.keyboard.type("x");
    await expect.poll(() => typed.join("")).toContain("x");
});
