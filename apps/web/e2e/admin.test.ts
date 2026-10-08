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
    await expect(page.getByLabel("name")).toHaveValue("web1");
    return calls;
}

test("add host shows the enroll snippet", async ({ page }) => {
    const calls = await openAdmin(page);
    await page.getByPlaceholder("name", { exact: true }).fill("db1");
    await page.getByPlaceholder("address (hostname or IP)").fill("10.0.0.2");
    await page.getByRole("button", { name: "Add host" }).click();
    await expect(page.getByText("curl enroll")).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy" })).toBeVisible();
    expect(calls).toContainEqual({
        method: "POST",
        path: "/api/admin/hosts",
        body: { name: "db1", address: "10.0.0.2" },
    });
});

test("removing an access rule PUTs the remaining rules", async ({ page }) => {
    const calls = await openAdmin(page);
    await page.getByRole("button", { name: "remove ops → root" }).click();
    await expect
        .poll(() => calls.find((c) => c.method === "PUT"))
        .toEqual({
            method: "PUT",
            path: "/api/admin/hosts/h1/access",
            body: [],
        });
});

test("tabs switch to users and audit", async ({ page }) => {
    await openAdmin(page);
    await page.getByRole("tab", { name: "Users" }).click();
    await expect(page).toHaveURL("/admin/users");
    await expect(page.getByRole("cell", { name: "ops" })).toBeVisible();
    await page.getByRole("tab", { name: "Audit" }).click();
    await expect(page).toHaveURL("/admin/audit");
    await expect(page.getByText("login", { exact: true })).toBeVisible();
});
