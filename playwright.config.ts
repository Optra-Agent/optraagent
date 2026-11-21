import { defineConfig, devices } from "@playwright/test";

const hostname = "127.0.0.1";
const port = Number(process.env.OPTRA_E2E_PORT ?? "3100");
if (!Number.isInteger(port) || port < 1024 || port > 65535 || [3000, 3001, 3002].includes(port)) {
  throw new Error("OPTRA_E2E_PORT must be an unused, non-SENTERA port between 1024 and 65535.");
}
const baseURL = `http://${hostname}:${port}`;
// The House Agent journeys use their own isolated app and the archived NVDA/TSLA/MSFT capture. Opt in with OPTRA_E2E_HOUSE=1.
const houseEnabled = process.env.OPTRA_E2E_HOUSE === "1";
const housePort = port + 1;
const houseURL = `http://${hostname}:${housePort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  // GitHub's shared runners render WebGL in software, which starves requestAnimationFrame-driven UI.
  // One CI-only retry absorbs that; a real regression still fails twice.
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  outputDir: ".local/optra-e2e-results",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", testIgnore: /house-agents-flow\.spec\.ts/, use: { ...devices["Desktop Chrome"] } },
    ...(houseEnabled ? [{ name: "house", testMatch: /house-agents-flow\.spec\.ts/, use: { ...devices["Desktop Chrome"], baseURL: houseURL } }] : []),
  ],
  webServer: [
    {
      command: "bun scripts/optra-e2e-isolated-server.ts",
      url: `${baseURL}/api/health/ready`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: { OPTRA_E2E_PORT: String(port) },
    },
    ...(houseEnabled ? [{
      command: "bun scripts/optra-e2e-isolated-server.ts",
      url: `${houseURL}/api/health/ready`,
      reuseExistingServer: false,
      timeout: 240_000,
      env: { OPTRA_E2E_PORT: String(housePort), OPTRA_E2E_FIXTURE: "house", CRON_SECRET: "e2e-house-cron-secret-0123456789abcdef" },
    }] : []),
  ],
});
