import { expect, type Page, test } from "@playwright/test";

const channel = {
    id: 1,
    name: "ops",
    service: "ntfy",
    events: ["security", "terminal"],
    tags: ["prod"],
    logins: [],
    lastSentAt: null,
    lastError: null,
};

async function fakeApi(page: Page) {
    const calls: { method: string; path: string; body: unknown }[] = [];
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
    await page.route("/api/admin/hosts", (r) =>
        r.fulfill({
            json: [
                {
                    id: "h1",
                    name: "web1",
                    address: "10.0.0.1",
                    enrolled: true,
                    tags: ["prod", "web"],
                    access: [],
                },
            ],
        }),
    );
    await page.route("/api/admin/alerts**", (r) => {
        const req = r.request();
        const path = new URL(req.url()).pathname;
        if (req.method() === "GET") return r.fulfill({ json: [channel] });
        calls.push({
            method: req.method(),
            path,
            body: req.postData() ? req.postDataJSON() : undefined,
        });
        if (path.endsWith("/test"))
            return r.fulfill({
                status: 502,
                json: { error: "ntfy: failed to send ntfy notification" },
            });
        return req.method() === "POST"
            ? r.fulfill({ status: 201, json: { id: 2 } })
            : r.fulfill({ status: 204 });
    });
    await page.goto("/admin/alerts");
    return calls;
}

test("alerts: list, add a channel with a terminal filter", async ({ page }) => {
    const calls = await fakeApi(page);
    await expect(page.getByRole("heading", { name: "Alerts" })).toBeVisible();
    await expect(page.getByText("ops", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Add channel" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill("Phone");
    await dialog.getByLabel("Shoutrrr URL").fill("ntfy://ntfy.sh/t0k3n");
    await dialog.getByRole("checkbox", { name: /Task failed/ }).check();
    await expect(dialog.getByLabel("Logins")).toHaveCount(0);
    await dialog.getByRole("checkbox", { name: /Terminal opened/ }).check();
    await dialog.getByLabel("Host tags").fill("prod");
    await dialog.getByLabel("Host tags").press("Enter");
    await dialog.getByLabel("Logins").fill("root, admin");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toHaveCount(0);
    expect(calls).toEqual([
        {
            method: "POST",
            path: "/api/admin/alerts",
            body: {
                name: "Phone",
                events: ["security", "task_failed", "terminal"],
                tags: ["prod"],
                logins: ["root", "admin"],
                url: "ntfy://ntfy.sh/t0k3n",
            },
        },
    ]);
});

test("alerts: edit keeps the URL when left blank; test shows the error", async ({
    page,
}) => {
    const calls = await fakeApi(page);
    await page.getByRole("button", { name: "Edit ops" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Shoutrrr URL")).toHaveValue("");
    await dialog.getByRole("checkbox", { name: /Terminal opened/ }).uncheck();
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toHaveCount(0);

    await page
        .getByRole("button", { name: "Send a test alert to ops" })
        .click();
    await expect(
        page.getByText("ops: ntfy: failed to send ntfy notification"),
    ).toBeVisible();
    expect(calls).toEqual([
        {
            method: "PUT",
            path: "/api/admin/alerts/1",
            body: { name: "ops", events: ["security"], tags: [], logins: [] },
        },
        { method: "POST", path: "/api/admin/alerts/1/test", body: undefined },
    ]);
});
