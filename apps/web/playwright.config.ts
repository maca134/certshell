import { defineConfig, devices } from "@playwright/test";

const port = 5174;

export default defineConfig({
    testDir: "e2e",
    use: { baseURL: `http://127.0.0.1:${port}` },
    projects: [
        { name: "desktop", use: devices["Desktop Chrome"] },
        { name: "mobile", use: devices["Pixel 7"] },
    ],
    webServer: {
        command: `bunx vite --host 127.0.0.1 --port ${port} --strictPort`,
        url: `http://127.0.0.1:${port}`,
        reuseExistingServer: true,
    },
});
