import { expect, type Page, test } from "@playwright/test";

const hosts = [
    { id: "h1", name: "web1", logins: ["root"] },
    { id: "h2", name: "web2", logins: ["root", "deploy"] },
];

async function fakeApi(page: Page) {
    await page.route("/api/me", (r) =>
        r.fulfill({
            json: { iss: "i", sub: "s", email: null, groups: [], admin: false },
        }),
    );
    await page.route("/api/hosts", (r) => r.fulfill({ json: hosts }));
    const typed: Record<string, string> = {};
    await page.routeWebSocket(/\/api\/terminal/, (ws) => {
        const q = new URL(ws.url()).searchParams;
        const key = `${q.get("host")}:${q.get("login")}`;
        typed[key] = "";
        ws.onMessage((m) => {
            const msg = JSON.parse(String(m));
            if (msg.t === "in") typed[key] += msg.d;
        });
    });
    return typed;
}

test("select hosts → broadcast: typing goes to every pane, or one when sync is off", async ({
    page,
}) => {
    const typed = await fakeApi(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Select" }).click();
    await page
        .getByRole("listitem")
        .filter({ hasText: "web1" })
        .getByRole("button", { name: "root" })
        .click();
    await page
        .getByRole("listitem")
        .filter({ hasText: "web2" })
        .getByRole("button", { name: "deploy" })
        .click();
    await expect(page.getByText("2 selected")).toBeVisible();
    await page.getByRole("button", { name: "Open terminals" }).click();

    await expect(page).toHaveURL("/broadcast?t=h1:root,h2:deploy");
    await expect(page.getByText("2/2 connected")).toBeVisible();
    await expect(page).toHaveTitle("Broadcast (2)");
    await page.keyboard.type("ls");
    await expect
        .poll(() => typed)
        .toEqual({ "h1:root": "ls", "h2:deploy": "ls" });

    await page.getByRole("button", { name: "Typing to all" }).click();
    await page.getByRole("region", { name: "deploy@web2" }).click();
    await page.keyboard.type("x");
    await expect
        .poll(() => typed)
        .toEqual({ "h1:root": "ls", "h2:deploy": "lsx" });
});

test("broadcast drops targets the user can't reach", async ({ page }) => {
    const typed = await fakeApi(page);
    await page.goto("/broadcast?t=h1:root,h1:alice,h9:root");
    await expect(page.getByText("1/1 connected")).toBeVisible();
    expect(Object.keys(typed)).toEqual(["h1:root"]);

    await page.goto("/broadcast?t=h9:root");
    await expect(page.getByText("No hosts", { exact: true })).toBeVisible();
});
