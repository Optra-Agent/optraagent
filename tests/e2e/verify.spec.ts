import { expect, test } from "@playwright/test";

test("Verify renders server claims with evidence links and keeps unshipped features labeled", async ({ page }) => {
  await page.goto("/verify");

  await expect(page.getByRole("heading", { level: 1, name: "Verify", exact: true })).toBeVisible();
  await expect(page.getByLabel("Safety switches").getByText("Disabled", { exact: true })).toBeVisible();
  const claims = page.getByRole("region", { name: "Verified claims" });
  await expect(claims.getByRole("heading", { name: "Historical backtest" })).toBeVisible();
  await expect(claims.getByRole("link", { name: /Evidence: \/api\/public\/v1\/hooks/ })).toBeVisible();

  const available = page.getByRole("region", { name: "Available now" });
  await expect(available.getByText("Manual CallPut trading", { exact: true })).toBeVisible();
  const built = page.getByRole("region", { name: "Built and under acceptance" });
  await expect(built.getByText("Autonomous Agent Engine", { exact: true })).toBeVisible();
  await expect(built.getByText("Engine built · Live activation required", { exact: true })).toBeVisible();
  await expect(built.getByText(/uninitialized with no pool, holds no funds and is not part of options execution/)).toBeVisible();
  await expect(built.getByText(/claim level is L0/)).toBeVisible();
  const planned = page.getByRole("region", { name: "Roadmap" });
  await expect(planned.getByText("AI strategy composition", { exact: true })).toBeVisible();
  await expect(planned.getByText("Planned", { exact: true }).first()).toBeVisible();
  await expect(planned.getByText("Autonomous Agent Engine")).toHaveCount(0);
});

test("Verify shows an error state when claims cannot be loaded", async ({ page }) => {
  await page.route("**/api/public/v1/verify", (route) => route.fulfill({ status: 503, json: { error: { code: "INTERNAL_ERROR", message: "Claims are offline.", retryable: true } } }));
  await page.goto("/verify");

  await expect(page.getByRole("main").getByRole("alert")).toContainText("Claims are offline.");
  await expect(page.getByRole("region", { name: "Roadmap" })).toBeVisible();
});
