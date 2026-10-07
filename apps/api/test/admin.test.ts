import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { AdminHost } from "@repo/shared";
import { renderSnippet } from "../src/admin";
import { run } from "../src/exec";
import { APP_URL, startApp } from "./helpers/app";

let ctx: Awaited<ReturnType<typeof startApp>>;
let tmp = "";
afterEach(async () => {
    await ctx.stop();
    if (tmp) await rm(tmp, { recursive: true, force: true });
});

const admin = async () => {
    ctx = await startApp({}, ["web-ssh-admins"]);
    return ctx;
};

const call = (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
) =>
    ctx.app.request(`${APP_URL}${path}`, {
        method,
        headers: {
            cookie: ctx.cookie,
            origin: APP_URL,
            "content-type": "application/json",
            ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });

const enroll = (token: string, key: string) =>
    ctx.app.request(`${APP_URL}/api/enroll`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: key,
    });

async function hostKey() {
    tmp = await mkdtemp(`${tmpdir()}/hk-`);
    await run([
        "ssh-keygen",
        "-q",
        "-t",
        "ed25519",
        "-N",
        "",
        "-C",
        "root@target",
        "-f",
        `${tmp}/k`,
    ]);
    return Bun.file(`${tmp}/k.pub`).text();
}

async function createHost(name = "web1", address = "web1.lan") {
    const res = await call("POST", "/api/admin/hosts", { name, address });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
        id: string;
        snippet: string;
        expiresAt: number;
    };
    return { ...body, token: tokenOf(body.snippet) };
}

const tokenOf = (snippet: string) =>
    snippet.match(/Bearer ([^']+)'/)?.[1] ?? "";

const script = (token: string) =>
    ctx.app.request(`${APP_URL}/api/enroll`, {
        headers: { authorization: `Bearer ${token}` },
    });

const hosts = async () =>
    (await (await call("GET", "/api/admin/hosts")).json()) as AdminHost[];

test("admin routes: 401 without session, 403 for non-admins", async () => {
    ctx = await startApp({}, ["users"]);
    expect((await call("GET", "/api/admin/hosts")).status).toBe(403);
    expect(
        (await call("GET", "/api/admin/hosts", undefined, { cookie: "" }))
            .status,
    ).toBe(401);
});

test("admin writes need Origin = APP_URL", async () => {
    await admin();
    const body = { name: "x", address: "x.lan" };
    expect(
        (
            await call("POST", "/api/admin/hosts", body, {
                origin: "https://id.test",
            })
        ).status,
    ).toBe(403);
    expect(
        (await call("POST", "/api/admin/hosts", body, { origin: "" })).status,
    ).toBe(403);
});

test("create host: validates name and address", async () => {
    await admin();
    for (const [name, address] of [
        ["", "a.lan"],
        [" pad", "a.lan"],
        ["new\nline", "a.lan"],
        ["ok", "-oProxyCommand=x"],
        ["ok", "a b"],
        ["ok", "a.lan\nevil"],
        ["ok", "a_b.lan"],
        ["ok", ""],
    ])
        expect(
            (await call("POST", "/api/admin/hosts", { name, address })).status,
        ).toBe(400);
    for (const address of [
        "10.0.0.5",
        "web-1.example.com",
        "fe80::1",
        "localhost",
    ])
        expect(
            (await call("POST", "/api/admin/hosts", { name: "ok", address }))
                .status,
        ).toBe(201);
});

test("create host → pending host + curl | sh one-liner", async () => {
    await admin();
    const { id, snippet, token, expiresAt } = await createHost();
    expect(id).toMatch(/^h[a-z0-9]{7}$/);
    expect(snippet).toBe(
        `curl -fsS -H 'Authorization: Bearer ${token}' '${APP_URL}/api/enroll' | sh`,
    );
    expect(token.length).toBeGreaterThan(40);
    expect(expiresAt - Date.now() / 1000).toBeGreaterThan(590);
    expect(await hosts()).toEqual([
        { id, name: "web1", address: "web1.lan", enrolled: false, access: [] },
    ]);
});

test("GET /api/enroll: serves script with id, CA key, token; does not burn token", async () => {
    await admin();
    const { id, token } = await createHost();
    const res = await script(token);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(`APP_URL='${APP_URL}'`);
    expect(body).toContain(`HOST_ID='${id}'`);
    expect(body).toMatch(/^CA_PUB='ssh-ed25519 \S+ test-ca'$/m);
    expect(body).toContain(`TOKEN='${token}'`);
    expect((await script(token)).status).toBe(200);

    expect((await enroll(token, await hostKey())).status).toBe(204);
    expect((await script(token)).status).toBe(401);
    expect((await script("nope")).status).toBe(401);
    expect((await ctx.app.request(`${APP_URL}/api/enroll`)).status).toBe(401);
});

test("GET /api/enroll: expired token → 401", async () => {
    await admin();
    const { token } = await createHost();
    ctx.db.run("UPDATE enroll_tokens SET expires_at = 0");
    expect((await script(token)).status).toBe(401);
});

test("snippet reloads sshd via systemd only when systemd is running", () => {
    const snippet = renderSnippet({
        appUrl: "https://x",
        hostId: "h1",
        caPub: "k",
        token: "t",
    });
    expect(snippet).toContain("if [ -d /run/systemd/system ]; then");
    expect(snippet).toContain('kill -HUP "$(cat /run/sshd.pid)"');
});

test("snippet values are shell-quoted", async () => {
    const snippet = renderSnippet({
        appUrl: "https://x",
        hostId: "h1",
        caPub: "it's $(id) `id`",
        token: "t",
    });
    const vars = snippet.split("\nCONF=")[0] ?? "";
    expect(await run(["sh", "-c", `${vars}\nprintf %s "$CA_PUB"`])).toBe(
        "it's $(id) `id`",
    );
    expect((await run(["sh", "-n", "-c", snippet])) === "").toBeTrue();
});

test("enroll: stores host key once; token is single-use", async () => {
    await admin();
    const { id, token } = await createHost();
    const key = await hostKey();
    expect((await enroll(token, key)).status).toBe(204);
    expect(
        ctx.db.query("SELECT host_key FROM hosts WHERE id = ?").get(id),
    ).toEqual({
        host_key: key.split(" ").slice(0, 2).join(" "),
    });
    expect((await hosts())[0]?.enrolled).toBeTrue();
    expect((await enroll(token, key)).status).toBe(401);
});

test("enroll: rejects bad keys without burning the token", async () => {
    await admin();
    const { token } = await createHost();
    for (const bad of [
        "",
        "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQ== root@x",
        "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIA== short",
        "ssh-ed25519 not-base64!",
        `${await hostKey()}\nssh-ed25519 AAAA second-line`,
    ])
        expect((await enroll(token, bad)).status).toBe(400);
    expect((await enroll(token, await hostKey())).status).toBe(204);
});

test("enroll: wrong, missing, expired, superseded tokens → 401; huge body → 413", async () => {
    await admin();
    const key = await hostKey();
    const first = await createHost();
    expect((await enroll("nope", key)).status).toBe(401);
    expect(
        (
            await ctx.app.request(`${APP_URL}/api/enroll`, {
                method: "POST",
                body: key,
            })
        ).status,
    ).toBe(401);
    expect((await enroll(first.token, "x".repeat(5000))).status).toBe(413);

    const second = (await (
        await call("POST", `/api/admin/hosts/${first.id}/snippet`)
    ).json()) as { snippet: string };
    const secondToken = tokenOf(second.snippet);
    expect((await enroll(first.token, key)).status).toBe(401);

    ctx.db.run("UPDATE enroll_tokens SET expires_at = 0");
    expect((await enroll(secondToken, key)).status).toBe(401);
});

test("edit host: name and address validated, id immutable", async () => {
    await admin();
    const { id } = await createHost();
    expect(
        (await call("PATCH", `/api/admin/hosts/${id}`, { name: "renamed" }))
            .status,
    ).toBe(204);
    expect(
        (await call("PATCH", `/api/admin/hosts/${id}`, { address: "10.1.1.1" }))
            .status,
    ).toBe(204);
    expect(
        (await call("PATCH", `/api/admin/hosts/${id}`, { address: "bad host" }))
            .status,
    ).toBe(400);
    expect(
        (await call("PATCH", "/api/admin/hosts/hmissing", { name: "x" }))
            .status,
    ).toBe(404);
    expect(await hosts()).toMatchObject([
        { id, name: "renamed", address: "10.1.1.1" },
    ]);
});

test("access map: validated, replaces rules, only enrolled hosts reach users", async () => {
    await admin();
    const { id, token } = await createHost();
    const put = (rules: unknown) =>
        call("PUT", `/api/admin/hosts/${id}/access`, rules);
    for (const bad of [
        [{ login: "root,alice", group: "g" }],
        [{ login: "Root", group: "g" }],
        [{ login: "root", group: "" }],
        [{ login: "root", group: "a\nb" }],
        { login: "root", group: "g" },
    ])
        expect((await put(bad)).status).toBe(400);

    const rules = [
        { login: "root", group: "web-ssh-admins" },
        { login: "deploy", group: "web-ssh-admins" },
        { login: "deploy", group: "web-ssh-admins" },
    ];
    expect((await put(rules)).status).toBe(204);
    expect((await hosts())[0]?.access).toEqual([
        { login: "deploy", group: "web-ssh-admins" },
        { login: "root", group: "web-ssh-admins" },
    ]);

    expect(await (await call("GET", "/api/hosts")).json()).toEqual([]);
    expect(
        (await call("GET", `/api/terminal?host=${id}&login=root`)).status,
    ).toBe(403);

    expect((await enroll(token, await hostKey())).status).toBe(204);
    expect(await (await call("GET", "/api/hosts")).json()).toEqual([
        { id, name: "web1", logins: ["deploy", "root"] },
    ]);

    expect(
        (await put([{ login: "root", group: "web-ssh-admins" }])).status,
    ).toBe(204);
    expect((await hosts())[0]?.access).toEqual([
        { login: "root", group: "web-ssh-admins" },
    ]);
});
