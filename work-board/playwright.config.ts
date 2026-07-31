import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:8791",
    browserName: "chromium"
  },
  webServer: {
    command: "pnpm exec wrangler dev --local --port 8791",
    url: "http://127.0.0.1:8791/health",
    reuseExistingServer: false,
    timeout: 30_000
  }
});
