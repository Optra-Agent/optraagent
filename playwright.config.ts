import { defineConfig, devices } from "@playwright/test";

const hostname = "127.0.0.1";
const port = Number(process.env.OPTRA_E2E_PORT ?? "3100");
if (!Number.isInteger(port) || port < 1024 || port > 65535 || [3000, 3001, 3002].includes(port)) {
  throw new Error("OPTRA_E2E_PORT must be an unused, non-SENTERA port between 1024 and 65535.");
}
const baseURL = `http://${hostname}:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  outputDir: ".local/optra-e2e-results",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "bun scripts/optra-e2e-isolated-server.ts",
    url: `${baseURL}/api/health/ready`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: { OPTRA_E2E_PORT: String(port) },
  },
});
