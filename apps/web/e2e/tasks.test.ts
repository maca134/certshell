import { expect, type Page, test } from "@playwright/test";

const hosts = [
    { id: "h1", name: "web1", logins: ["root"] },
    { id: "h2", name: "web2", logins: ["root", "deploy"] },
];

const task = {
    id: 5,
    name: "Upgrade",
    script: "apt-get upgrade -y",
    targets: [
        { host: "h1", login: "root" },
        { host: "h2", login: "root" },
    ],
};

async function fakeApi(page: Page, tasks: object[] = [task]) {
    const calls: { method: string; path: string; body: unknown }[] = [];
    const record = (r: Parameters<Parameters<Page["route"]>[1]>[0]) => {
        const req = r.request();
        if (req.method() !== "GET")
            calls.push({
                method: req.method(),
                path: new URL(req.url()).pathname,
                body: req.postData() ? req.postDataJSON() : undefined,
            });
        return req.method();
    };
    await page.route("/api/me", (r) =>
        r.fulfill({
            json: { iss: "i", sub: "s", email: null, groups: [], admin: false },
        }),
    );
    await page.route("/api/hosts", (r) => r.fulfill({ json: hosts }));
    await page.route("/api/tasks", (r) =>
        record(r) === "POST"
            ? r.fulfill({ status: 201, json: { id: 6 } })
            : r.fulfill({ json: tasks }),
    );
    await page.route("/api/tasks/5", (r) => {
        record(r);
        return r.fulfill({ status: 204 });
    });
    await page.route("/api/tasks/5/run", (r) => {
        record(r);
        return r.fulfill({ status: 201, json: { id: "r1" } });
    });
    await page.route("/api/tasks/runs", (r) => r.fulfill({ json: [] }));
    let polls = 0;
    await page.route("/api/tasks/runs/r1", (r) => {
        const done = ++polls > 1;
        r.fulfill({
            json: {
                id: "r1",
                taskId: 5,
                name: "Upgrade",
                script: "apt-get upgrade -y",
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
    return calls;
}

test("new task: name, script and hosts picked on the tasks page", async ({
    page,
}) => {
    const calls = await fakeApi(page, []);
    await page.goto("/tasks");
    await expect(page.getByText("No tasks yet")).toBeVisible();
    await page.getByRole("link", { name: "New task" }).click();
    await expect(page).toHaveURL("/tasks/new");

    await page.getByLabel("Name").fill("Disk");
    await page.getByLabel("Script").fill("df -h");
    const save = page.getByRole("button", { name: "Save" });
    await expect(save).toBeDisabled();
    await page.getByRole("checkbox", { name: "web1" }).check();
    await page.getByRole("checkbox", { name: "web1" }).uncheck();
    // Picking a login ticks the host.
    await page.getByLabel("Login on web2").selectOption("deploy");
    await expect(page.getByRole("checkbox", { name: "web2" })).toBeChecked();
    await expect(page.getByText("1 selected")).toBeVisible();
    await save.click();

    await expect(page).toHaveURL("/tasks");
    expect(calls).toEqual([
        {
            method: "POST",
            path: "/api/tasks",
            body: {
                name: "Disk",
                script: "df -h",
                targets: [{ host: "h2", login: "deploy" }],
            },
        },
    ]);
});

test("run a task from the list → per-host results update live; run again", async ({
    page,
}) => {
    const calls = await fakeApi(page);
    await page.goto("/tasks");
    await expect(page.getByText("2 hosts")).toBeVisible();
    await page.getByRole("button", { name: "Run", exact: true }).click();

    await expect(page).toHaveURL("/tasks/runs/r1");
    await expect(page.getByRole("heading", { name: "Upgrade" })).toBeVisible();
    await expect(page.getByText("running", { exact: true })).toHaveCount(2);
    await expect(page.getByText("exit 100")).toBeVisible();
    await expect(page.getByText("ok", { exact: true })).toBeVisible();
    await page.getByText("web2").click();
    await expect(page.getByText("E: dpkg was interrupted")).toBeVisible();

    await page.getByRole("button", { name: "Run again" }).click();
    await expect
        .poll(() => calls.map((c) => `${c.method} ${c.path}`))
        .toEqual(["POST /api/tasks/5/run", "POST /api/tasks/5/run"]);
});

test("edit a task: prefilled, change hosts, save; delete", async ({ page }) => {
    const calls = await fakeApi(page);
    await page.goto("/tasks");
    await page.getByRole("link", { name: "Edit" }).click();
    await expect(page).toHaveURL("/tasks/5/edit");
    await expect(page.getByLabel("Name")).toHaveValue("Upgrade");
    await expect(page.getByLabel("Script")).toHaveValue("apt-get upgrade -y");
    await expect(page.getByText("2 selected")).toBeVisible();
    await expect(page.getByLabel("Login on web2")).toHaveValue("root");

    await page.getByRole("checkbox", { name: "web1" }).uncheck();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL("/tasks");

    await page.getByRole("link", { name: "Edit" }).click();
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Delete" }).click();
    await expect(page).toHaveURL("/tasks");
    expect(calls).toEqual([
        {
            method: "PUT",
            path: "/api/tasks/5",
            body: {
                name: "Upgrade",
                script: "apt-get upgrade -y",
                targets: [{ host: "h2", login: "root" }],
            },
        },
        { method: "DELETE", path: "/api/tasks/5", body: undefined },
    ]);
});

test("task list shows an error when it fails to load", async ({ page }) => {
    await fakeApi(page);
    await page.route("/api/tasks", (r) =>
        r.fulfill({ status: 500, json: { error: "Internal Server Error" } }),
    );
    await page.goto("/tasks");
    await expect(page.getByText("Internal Server Error")).toBeVisible();
});
