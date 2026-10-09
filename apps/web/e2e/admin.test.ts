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
                version: "1.1.1",
                update: "1.2.0",
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
        if (req.url().endsWith("/snippet"))
            return r.fulfill({
                json: { snippet: "curl reenroll", expiresAt: 0 },
            });
        if (req.method() === "POST") {
            hosts.push({ ...host, id: "h2", enrolled: false, access: [] });
            return r.fulfill({
                json: { id: "h2", snippet: "curl enroll", expiresAt: 0 },
            });
        }
        if (req.method() === "PUT" || req.method() === "PATCH")
            return r.fulfill({ status: 204 });
        if (req.method() === "DELETE") {
            hosts.splice(0);
            return r.fulfill({ status: 204 });
        }
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

test("editing details PATCHes; re-enroll shows a fresh snippet", async ({
    page,
}) => {
    const calls = await openAdmin(page);
    await page.getByLabel("name").fill("web2");
    await page.getByRole("button", { name: "Save" }).click();
    await expect
        .poll(() => calls.find((c) => c.method === "PATCH"))
        .toEqual({
            method: "PATCH",
            path: "/api/admin/hosts/h1",
            body: { name: "web2", address: "10.0.0.1" },
        });
    await page.getByRole("button", { name: "Re-enroll" }).click();
    await expect(page.getByText("curl reenroll")).toBeVisible();
    expect(calls).toContainEqual({
        method: "POST",
        path: "/api/admin/hosts/h1/snippet",
        body: null,
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

test("remove host shows the removal snippet, then DELETEs", async ({
    page,
}) => {
    const calls = await openAdmin(page);
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(/rm -f .*50-certshell\.conf/)).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);

    await page.getByRole("button", { name: "Remove", exact: true }).click();
    await dialog.getByRole("button", { name: "Remove host" }).click();
    await expect(page.getByText("No hosts yet")).toBeVisible();
    expect(calls).toContainEqual({
        method: "DELETE",
        path: "/api/admin/hosts/h1",
        body: null,
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

test("sessions: lists open terminals, ends one at a time", async ({
    page,
    isMobile,
}) => {
    await openAdmin(page);
    const session = {
        sub: "s",
        email: "a@b.c",
        hostId: "h1",
        hostName: "web1",
        login: "root",
        startedAt: Date.now(),
    };
    let sessions = [
        { ...session, id: "t1" },
        { ...session, id: "t2" },
    ];
    const deletes: string[] = [];
    await page.route("/api/admin/sessions**", (r) => {
        const url = new URL(r.request().url());
        if (r.request().method() !== "DELETE")
            return r.fulfill({ json: sessions });
        deletes.push(url.pathname + url.search);
        sessions = sessions.slice(1);
        return r.fulfill({ status: 204 });
    });
    await (await sidebar(page, isMobile))
        .getByRole("link", { name: "Sessions" })
        .click();
    await expect(page).toHaveURL("/admin/sessions");
    await expect(page.getByRole("cell", { name: "web1 root" })).toHaveCount(2);

    page.once("dialog", (d) => d.accept());
    await page
        .getByRole("button", { name: "End", exact: true })
        .first()
        .click();
    await expect(page.getByRole("cell", { name: "web1 root" })).toHaveCount(1);
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "End", exact: true }).click();
    await expect(page.getByText("No open terminals")).toBeVisible();
    expect(deletes).toEqual([
        "/api/admin/sessions/t1",
        "/api/admin/sessions/t2",
    ]);
});

test("users: Sign out & end sessions asks, then DELETEs by sub", async ({
    page,
}) => {
    await page.route("/api/me", (r) =>
        r.fulfill({
            json: { sub: "s", groups: [], admin: true, version: "1" },
        }),
    );
    await page.route("/api/admin/users", (r) =>
        r.fulfill({
            json: [
                { iss: "i", sub: "u 1", email: null, groups: [], lastLogin: 0 },
            ],
        }),
    );
    const deletes: string[] = [];
    await page.route("/api/admin/sessions**", (r) => {
        const url = new URL(r.request().url());
        deletes.push(`${r.request().method()} ${url.pathname}${url.search}`);
        return r.fulfill({ status: 204 });
    });
    await page.goto("/admin/users");
    let asked = "";
    page.once("dialog", (d) => {
        asked = d.message();
        d.dismiss();
    });
    await page.getByRole("button", { name: "Sign out & end sessions" }).click();
    await expect.poll(() => asked).toContain("closes their terminals");
    expect(deletes).toEqual([]);
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Sign out & end sessions" }).click();
    await expect
        .poll(() => deletes)
        .toEqual(["DELETE /api/admin/sessions?sub=u%201"]);
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

test("top bar links to the website and GitHub", async ({ page }) => {
    await openAdmin(page);
    const header = page.locator("header");
    await expect(
        header.getByRole("link", { name: "certshell.dev" }),
    ).toHaveAttribute("href", "https://certshell.dev");
    await expect(header.getByRole("link", { name: "GitHub" })).toHaveAttribute(
        "href",
        "https://github.com/maca134/certshell",
    );
    await page.screenshot({
        fullPage: true,
    });
});

test("sidebar shows the version and a newer release", async ({
    page,
    isMobile,
}) => {
    await openAdmin(page);
    const bar = await sidebar(page, isMobile);
    await expect(bar.getByText("v1.1.1", { exact: true })).toBeVisible();
    await expect(
        bar.getByRole("link", { name: "v1.2.0 available" }),
    ).toHaveAttribute("href", "https://github.com/maca134/certshell/tags");
});
