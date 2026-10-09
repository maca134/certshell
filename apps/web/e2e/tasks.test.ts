import { expect, type Page, test } from "@playwright/test";

const hosts = [
    { id: "h1", name: "web1", logins: ["root"] },
    { id: "h2", name: "web2", logins: ["root"] },
];

async function fakeApi(page: Page) {
    const posts: { path: string; body: unknown }[] = [];
    await page.route("/api/me", (r) =>
        r.fulfill({
            json: { iss: "i", sub: "s", email: null, groups: [], admin: false },
        }),
    );
    await page.route("/api/hosts", (r) => r.fulfill({ json: hosts }));
    await page.route("/api/tasks/commands", (r) => {
        if (r.request().method() === "POST") {
            posts.push({
                path: "commands",
                body: r.request().postDataJSON(),
            });
            return r.fulfill({ status: 201, json: { id: 2 } });
        }
        return r.fulfill({
            json: [{ id: 1, name: "Upgrade", command: "apt-get upgrade -y" }],
        });
    });
    await page.route("/api/tasks/runs", (r) => {
        if (r.request().method() === "POST") {
            posts.push({ path: "runs", body: r.request().postDataJSON() });
            return r.fulfill({ status: 201, json: { id: "r1" } });
        }
        return r.fulfill({ json: [] });
    });
    let polls = 0;
    await page.route("/api/tasks/runs/r1", (r) => {
        const done = ++polls > 1;
        r.fulfill({
            json: {
                id: "r1",
                command: "apt-get upgrade -y",
                createdAt: Date.now(),
                hosts: [
                    {
                        hostId: "h1",
                        hostName: "web1",
                        login: "root",
                        status: done ? "ok" : "running",
                        exitCode: done ? 0 : null,
                        output: done ? "0 upgraded\n" : "",
                    },
                    {
                        hostId: "h2",
                        hostName: "web2",
                        login: "root",
                        status: done ? "failed" : "running",
                        exitCode: done ? 100 : null,
                        output: done ? "E: dpkg was interrupted\n" : "",
                    },
                ],
            },
        });
    });
    return posts;
}

test("select hosts → run a saved command → per-host results update live", async ({
    page,
}) => {
    const posts = await fakeApi(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Select" }).click();
    for (const name of ["web1", "web2"])
        await page
            .getByRole("listitem")
            .filter({ hasText: name })
            .getByRole("button", { name: "root" })
            .click();
    await page.getByRole("button", { name: "Run command" }).click();

    await expect(page).toHaveURL("/tasks?t=h1:root,h2:root");
    await page.getByRole("button", { name: "Use" }).click();
    await expect(page.getByLabel("Command")).toHaveValue("apt-get upgrade -y");
    await page.getByRole("button", { name: "Run on 2 hosts" }).click();

    await expect(page).toHaveURL("/tasks/r1");
    expect(posts).toEqual([
        {
            path: "runs",
            body: {
                command: "apt-get upgrade -y",
                targets: [
                    { host: "h1", login: "root" },
                    { host: "h2", login: "root" },
                ],
            },
        },
    ]);
    await expect(page.getByText("running")).toHaveCount(2);
    await expect(page.getByText("exit 100")).toBeVisible();
    await expect(page.getByText("ok", { exact: true })).toBeVisible();
    await page.getByText("web2").click();
    await expect(page.getByText("E: dpkg was interrupted")).toBeVisible();
});

test("save a command from the form", async ({ page }) => {
    const posts = await fakeApi(page);
    await page.goto("/tasks?t=h1:root");
    await page.getByLabel("Command").fill("df -h");
    await page.getByLabel("Name").fill("Disk");
    await page.getByRole("button", { name: "Save" }).click();
    await expect
        .poll(() => posts)
        .toEqual([
            { path: "commands", body: { name: "Disk", command: "df -h" } },
        ]);
});

test("tasks without targets points to the host picker", async ({ page }) => {
    await fakeApi(page);
    await page.goto("/tasks");
    await expect(page.getByText("Pick hosts first")).toBeVisible();
    await expect(page.getByRole("button", { name: /Run on/ })).toHaveCount(0);
});
