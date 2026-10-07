import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
    plugins: [react(), babel({ presets: [reactCompilerPreset()] })],
    server: {
        proxy: {
            "/api": { target: "http://localhost:3000", ws: true },
            "/auth": "http://localhost:3000",
        },
    },
});
