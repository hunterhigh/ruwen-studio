import { defineConfig } from "@playwright/test";
import { previewConfiguration } from "./config/preview.ts";

const preview = previewConfiguration();
export default defineConfig({
  testDir: "./apps/web/e2e",
  timeout: 120000,
  expect: { timeout: 30000 },
  workers: 1,
  use: {
    actionTimeout: 15000,
    baseURL: preview.baseUrl,
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {},
  },
  webServer: {
    command: "node scripts/preview.ts",
    url: `${preview.baseUrl}/api/health`,
    ignoreHTTPSErrors: true,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
