import { describe, expect, test } from "bun:test";
import { generate } from "../site/generate.js";
import { highlight } from "../site/highlight.js";

const root = `${import.meta.dir}/..`;
const read = (p: string) => Bun.file(`${root}/${p}`).text();

describe("site config generator", () => {
    for (const proxy of ["caddy", "traefik"]) {
        test(`${proxy} + Pocket ID defaults match examples/${proxy}`, async () => {
            const { files } = generate({ proxy });
            expect(files["compose.yaml"]).toBe(
                await read(`examples/${proxy}/compose.yaml`),
            );
            expect(files[".env"]).toBe(
                await read(`examples/${proxy}/.env.example`),
            );
            const extra = proxy === "caddy" ? "Caddyfile" : "routes.yml";
            expect(files[extra]).toBe(await read(`examples/${proxy}/${extra}`));
        });
    }

    test("external IdP drops Pocket ID", () => {
        const { files } = generate({
            idp: "external",
            issuer: "https://auth.example.com",
        });
        expect(files["compose.yaml"]).not.toContain("pocket-id");
        expect(files["compose.yaml"]).toContain(`OIDC_ISSUER: \${OIDC_ISSUER}`);
        expect(files[".env"]).toContain("OIDC_ISSUER=https://auth.example.com");
        expect(files.Caddyfile).not.toContain("ID_DOMAIN");
    });

    test("own proxy publishes on localhost, no proxy files", () => {
        const { files } = generate({
            proxy: "none",
            trustedProxies: "10.0.0.5",
        });
        expect(Object.keys(files).sort()).toEqual([".env", "compose.yaml"]);
        expect(files["compose.yaml"]).toContain(
            `ports: ["127.0.0.1:3000:3000"]`,
        );
        expect(files["compose.yaml"]).toContain("TRUSTED_PROXIES: 10.0.0.5");
    });

    test("no CA password drops secrets", () => {
        const { files, steps } = generate({ caPassword: false });
        expect(files["compose.yaml"]).not.toContain("secret");
        expect(steps).not.toContain("ca_password");
    });
});

describe("site highlighter", () => {
    test("tokenizes yaml, env and shell", () => {
        expect(highlight(`  image: "a<b" # x`, "yaml")).toBe(
            `  <span class="tok-k">image</span>: <span class="tok-s">"a&lt;b"</span> <span class="tok-c"># x</span>`,
        );
        expect(highlight("      - ./Caddyfile:/etc/caddy", "yaml")).toBe(
            "      - ./Caddyfile:/etc/caddy",
        );
        expect(highlight(`SSH_DOMAIN=\${X}`, "env")).toBe(
            `<span class="tok-k">SSH_DOMAIN</span>=<span class="tok-v">\${X}</span>`,
        );
        expect(highlight("docker compose up", "sh")).toBe(
            `<span class="tok-cmd">docker</span> compose up`,
        );
        expect(highlight("docker compose up", "yaml")).toBe(
            "docker compose up",
        );
    });
});
