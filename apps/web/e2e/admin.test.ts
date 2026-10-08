import { expect, type Page, test } from "@playwright/test";

const host = {
    id: "h1",
    name: "web1",
    address: "10.0.0.1",
    enrolled: true,
    access: [{ login: "root", group: "ops" }],
};

async function openAdmin(page: Page) {
    const calls: { method: string; path: string; body: unknown }[] = [];
    const hosts = [host];
    await page.route("/api/me", (r) =>
        r.fulfill({
            json: {
                iss: "i",
                sub: "s",
                email: "a@b.c",
                groups: [],
                admin: true,
            },
        }),
    );
    await page.route("/api/admin/users", (r) =>
        r.fulfill({
            json: [
                {
                    iss: "i",
                    sub: "s",
                    email: "a@b.c",
                    groups: ["ops"],
                    lastLogin: 0,
                },
            ],
        }),
    );
    await page.route("/api/admin/audit?limit=200", (r) =>
        r.fulfill({
            json: [{ id: 1, ts: 0, event: "login", sub: "s", email: "a@b.c" }],
        }),
    );
    await page.route("/api/admin/hosts**", (r) => {
        const req = r.request();
        calls.push({
            method: req.method(),
            path: new URL(req.url()).pathname,
            body: req.postDataJSON(),
        });
        if (req.method() === "POST") {
            hosts.push({ ...host, id: "h2", enrolled: false, access: [] });
            return r.fulfill({
                json: { id: "h2", snippet: "curl enroll", expiresAt: 0 },
            });
        }
        if (req.method() === "PUT") return r.fulfill({ status: 204 });
        return r.fulfill({ json: hosts });
    });
    await page.goto("/admin/hosts");
    await page.getByRole("button", { name: /web1/ }).click();
    await expect(page.getByLabel("name")).toHaveValue("web1");
    return calls;
}

test("add host shows the enroll snippet", async ({ page }) => {
    const calls = await openAdmin(page);
    await page.getByRole("button", { name: "Add host" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill("db1");
    await dialog.getByLabel("Address").fill("10.0.0.2");
    await dialog.getByRole("button", { name: "Next" }).click();
    await expect(dialog.getByText("curl enroll")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Copy" })).toBeVisible();
    await expect(page.getByText("2 hosts")).toBeVisible();
    await dialog.getByRole("button", { name: "Close" }).first().click();
    await expect(dialog).toBeHidden();
    expect(calls).toContainEqual({
        method: "POST",
        path: "/api/admin/hosts",
        body: { name: "db1", address: "10.0.0.2" },
    });
});

test("removing an access rule asks first, then PUTs the remaining rules", async ({
    page,
}) => {
    const calls = await openAdmin(page);
    page.once("dialog", (d) => d.dismiss());
    await page.getByRole("button", { name: "remove ops → root" }).click();
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "remove ops → root" }).click();
    await expect
        .poll(() => calls.find((c) => c.method === "PUT"))
        .toEqual({
            method: "PUT",
            path: "/api/admin/hosts/h1/access",
            body: [],
        });
});

// On mobile the sidebar is a sheet behind the trigger.
async function sidebar(page: Page, isMobile: boolean) {
    if (isMobile)
        await page.getByRole("button", { name: "Toggle Sidebar" }).click();
    return page.locator("[data-sidebar=sidebar]");
}

test("sidebar switches to users and audit", async ({ page, isMobile }) => {
    await openAdmin(page);
    await (await sidebar(page, isMobile))
        .getByRole("link", { name: "Users" })
        .click();
    await expect(page).toHaveURL("/admin/users");
    await expect(page.getByRole("cell", { name: "ops" })).toBeVisible();
    await (await sidebar(page, isMobile))
        .getByRole("link", { name: "Audit" })
        .click();
    await expect(page).toHaveURL("/admin/audit");
    await expect(page.getByText("login", { exact: true })).toBeVisible();
});

test("sign out POSTs to /auth/logout", async ({ page, isMobile }) => {
    await openAdmin(page);
    const posted = page.waitForRequest(
        (r) => r.method() === "POST" && r.url().endsWith("/auth/logout"),
    );
    await page.route("/auth/logout", (r) => r.fulfill({ body: "bye" }));
    await (await sidebar(page, isMobile))
        .getByRole("button", { name: "Sign out" })
        .click();
    await posted;
});
