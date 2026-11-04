import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  globalTeardown: "./tests/e2e/teardown.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: { baseURL: "http://127.0.0.1:5174", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "uv run --project ../api --locked python -m tests.browser_server",
      cwd: "../api",
      url: "http://127.0.0.1:8001/api/ready",
      timeout: 60_000,
      reuseExistingServer: false,
    },
    {
      command: "node tests/dev-server.mjs",
      url: "http://127.0.0.1:5174",
      env: { VOTING_API_TARGET: "http://127.0.0.1:8001" },
      reuseExistingServer: false,
    },
  ],
});
