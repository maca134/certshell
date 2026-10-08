import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const api = process.env.API_URL ?? "http://localhost:3000";
// Set by compose.dev.yaml when the dev server sits behind TLS on a real hostname.
const publicHost = process.env.DEV_PUBLIC_HOST;

export default defineConfig({
    plugins: [react(), tailwindcss()],
    resolve: {
        alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    server: {
        host: "0.0.0.0",
        // Vite's default /@fs/ root is the workspace root, which holds data/ca and secrets/.
        fs: {
            allow: ["./", "../../packages", "../../node_modules"].map((p) =>
                fileURLToPath(new URL(p, import.meta.url)),
            ),
        },
        allowedHosts: publicHost ? [publicHost] : undefined,
        hmr: publicHost
            ? { host: publicHost, protocol: "wss", clientPort: 443 }
            : undefined,
        proxy: {
            "/api": { target: api, ws: true, xfwd: true },
            "/auth": { target: api, xfwd: true },
        },
    },
});
