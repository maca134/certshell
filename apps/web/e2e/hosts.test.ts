import { expect, type Page, test } from "@playwright/test";

const hosts = [
    { id: "h1", name: "docker-01", tags: ["docker", "prod"], logins: ["root"] },
    { id: "h2", name: "pve-01", tags: ["prod"], logins: ["root"] },
    { id: "h3", name: "build", tags: [], logins: ["ci"] },
];

async function openHosts(page: Page) {
    await page.route("/api/me", (r) =>
        r.fulfill({
            json: { iss: "i", sub: "s", email: null, groups: [], admin: false },
        }),
    );
    await page.route("/api/hosts", (r) => r.fulfill({ json: hosts }));
    await page.route("/api/hosts/status", (r) => r.fulfill({ json: {} }));
    await page.goto("/");
    await expect(page.getByText("docker-01")).toBeVisible();
}

const names = (page: Page) =>
    page.locator("main li span.truncate").allTextContents();

test("tag filter: hosts must have every selected tag; All clears", async ({
    page,
}) => {
    await openHosts(page);
    const bar = page.getByText("Tags", { exact: true }).locator("..");
    await bar.getByRole("button", { name: "prod" }).click();
    await expect.poll(() => names(page)).toEqual(["docker-01", "pve-01"]);
    await page
        .getByRole("listitem")
        .filter({ hasText: "docker-01" })
        .getByRole("button", { name: "docker" })
        .click();
    await expect.poll(() => names(page)).toEqual(["docker-01"]);
    await bar.getByRole("button", { name: "All" }).click();
    await expect
        .poll(() => names(page))
        .toEqual(["docker-01", "pve-01", "build"]);
});

test("group by tag: a host under each of its tags, untagged last", async ({
    page,
}) => {
    await openHosts(page);
    await page.getByRole("button", { name: "Group by tag" }).click();
    await expect
        .poll(() => page.locator("main li").allTextContents())
        .toEqual([
            "docker1",
            expect.stringContaining("docker-01"),
            "prod2",
            expect.stringContaining("docker-01"),
            expect.stringContaining("pve-01"),
            "Untagged1",
            expect.stringContaining("build"),
        ]);
});

test("tabbing back with an expired session goes to sign-in", async ({
    page,
}) => {
    await openHosts(page);
    await page.route("/api/me", (r) =>
        r.fulfill({ status: 401, json: { error: "unauthenticated" } }),
    );
    await page.route("/auth/login", (r) => r.fulfill({ body: "idp" }));
    await page.evaluate(() =>
        document.dispatchEvent(new Event("visibilitychange")),
    );
    await expect(page).toHaveURL(/\/auth\/login$/);
});
