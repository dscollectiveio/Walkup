import { defineConfig } from "@playwright/test";

/**
 * Browser e2e + visual checks. Reuses the dev server already running on
 * :3100 (npm run dev); it is deliberately NOT started from here.
 * Projects: setup (sign in once, save state) -> app (signed in); public is
 * independent. Run: npm run test:e2e | test:e2e:public | test:e2e:screens
 */
export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./test-results/artifacts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100",
    channel: "chrome",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    { name: "public", testMatch: /public\.spec\.ts/ },
    {
      name: "app",
      testMatch: /app\.spec\.ts/,
      dependencies: ["setup"],
      use: { storageState: "tests/e2e/.auth/state.json" },
    },
    // Owner portal (owner-portal-spec 10): read-only pages as the dev account.
    {
      name: "owner",
      testMatch: /owner\.spec\.ts/,
      dependencies: ["setup"],
      use: { storageState: "tests/e2e/.auth/state.json" },
    },
  ],
});
