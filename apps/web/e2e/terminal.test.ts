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
