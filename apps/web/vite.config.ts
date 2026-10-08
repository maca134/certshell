import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const api = process.env.API_URL ?? "http://localhost:3000";
// Set by compose.dev.yaml when the dev server sits behind TLS on a real hostname.
const publicHost = process.env.DEV_PUBLIC_HOST;

export default defineConfig({
    plugins: [react()],
    server: {
        host: "0.0.0.0",
        // The dev container mounts the whole repo, including data/ca and secrets/; Vite's default allows all of it via /@fs/.
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
