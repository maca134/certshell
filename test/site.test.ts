import { describe, expect, test } from "bun:test";
import { generate } from "../site/generate.js";

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
