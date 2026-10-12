import { expect, type Page, test } from "@playwright/test";

const row = (hostId: string, facts: object | null, over: object = {}) => ({
    hostId,
    hostName: hostId,
    tags: [],
    login: "root",
    collectedAt: Date.now() - 60_000,
    facts,
    error: null,
    collecting: false,
    ...over,
});

const rows = [
    row("web1", {
        os: "Debian GNU/Linux 13 (trixie)",
        kernel: "6.12.48",
        uptime: 3 * 86400 + 4 * 3600,
        reboot: true,
        updates: 12,
        security: 3,
        disk: 41,
    }),
    row("web2", { os: "Debian GNU/Linux 13 (trixie)", updates: 0, disk: 95 }),
    row("db1", null, { login: null, collectedAt: null }),
    row(
        "fw1",
        { os: "OPNsense 25.7" },
        { error: "ssh: connect to host fw1 port 22: Connection refused" },
    ),
];

async function fakeApi(page: Page) {
    const posts: string[] = [];
    await page.route("/api/me", (r) =>
        r.fulfill({
            json: {
                iss: "i",
                sub: "s",
                email: "a@b.c",
                groups: [],
                admin: true,
                version: "1.1.1",
            },
        }),
    );
    await page.route("/api/admin/users", (r) => r.fulfill({ json: [] }));
    await page.route("/api/admin/facts**", (r) => {
        const req = r.request();
        if (req.method() === "GET") return r.fulfill({ json: rows });
        posts.push(new URL(req.url()).pathname);
        return r.fulfill({
            status: req.url().endsWith("/facts/refresh") ? 202 : 204,
        });
    });
    await page.route("/api/hosts", (r) =>
        r.fulfill({
            json: ["web1", "web2", "db1"].map((id) => ({
                id,
                name: id,
                tags: [],
                logins: ["root"],
            })),
        }),
    );
    await page.route("/api/tasks", (r) => r.fulfill({ json: [] }));
    await page.goto("/admin/fleet");
    return posts;
}

const tile = (page: Page, label: string) =>
    page.getByRole("button", { name: new RegExp(`^${label}`) });

test("fleet: tiles count hosts; a tile filters the table", async ({ page }) => {
    await fakeApi(page);
    await expect(tile(page, "Need a reboot")).toContainText("1");
    await expect(tile(page, "Have updates")).toContainText("1");
    await expect(tile(page, "Have updates")).toContainText(
        "3 security updates",
    );
    await expect(tile(page, "Disk ≥ 90%")).toContainText("1");
    await expect(tile(page, "Not collected")).toContainText("2");
    await expect(page.getByRole("row")).toHaveCount(5);

    await tile(page, "Not collected").click();
    await expect(page.getByRole("row")).toHaveCount(3);
    await expect(page.getByRole("row", { name: /^db1/ })).toBeVisible();
    await expect(page.getByRole("row", { name: /^fw1/ })).toBeVisible();
    await tile(page, "Not collected").click();
    await expect(page.getByRole("row")).toHaveCount(5);
});

test("fleet: filtered hosts → new task with them ticked", async ({ page }) => {
    await fakeApi(page);
    await tile(page, "Need a reboot").click();
    await page.getByRole("link", { name: "New task on these hosts" }).click();
    await expect(page).toHaveURL("/tasks/new?hosts=web1");
    await expect(page.getByRole("checkbox", { name: "web1" })).toBeChecked();
    await expect(
        page.getByRole("checkbox", { name: "web2" }),
    ).not.toBeChecked();
});

test("fleet: refresh one host or all", async ({ page }) => {
    const posts = await fakeApi(page);
    await page.getByRole("button", { name: "Refresh web1" }).click();
    await page.getByRole("button", { name: "Refresh all" }).click();
    await expect
        .poll(() => posts)
        .toEqual(["/api/admin/facts/web1/refresh", "/api/admin/facts/refresh"]);
    await expect(page.getByRole("button", { name: "Refresh db1" })).toHaveCount(
        0,
    );
});
