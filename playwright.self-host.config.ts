import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for self-host compose verification.
 *
 * Expects the Docker Compose stack to be running externally:
 *   docker compose up --build -d
 *
 * No webServer entries — compose manages all services.
 * The web container serves at http://localhost:80 and proxies /api to api:3000.
 */
export default defineConfig({
  testDir: "./apps/web/e2e",
  testMatch: "self-host-runtime.spec.ts",
  fullyParallel: false,
  forbidOnly: true,
  retries: 1,
  reporter: [["list"]],
  outputDir: "test-results/self-host-runtime",
  timeout: 30_000,
  use: {
    baseURL: "http://localhost",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
