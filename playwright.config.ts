import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const executablePath = process.env.CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "off", screenshot: "off", launchOptions: { executablePath, args: ["--no-sandbox"] } },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    // Chromium with iPhone metrics. Real iOS Safari/WebKit is NOT exercised here — see README.
    { name: "mobile", use: { ...devices["iPhone 14"], defaultBrowserType: "chromium", browserName: "chromium" } },
  ],
  webServer: [
    { command: "node tests/e2e/mock-gemini-server.mjs", port: 4010, reuseExistingServer: true },
    {
      command: `npx next start -p ${PORT}`,
      port: PORT,
      reuseExistingServer: true,
      env: { GEMINI_API_KEY: "e2e-dummy", GEMINI_BASE_URL: "http://127.0.0.1:4010", PUBLIC_ACCESS: "true", RATE_LIMIT_MODE: "off" },
    },
  ],
});
