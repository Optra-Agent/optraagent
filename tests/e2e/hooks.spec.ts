import { expect, test } from "@playwright/test";

test("hook library renders the PM catalog and keeps catalog-only rules labeled", async ({ page }) => {
  await page.goto("/hooks");

  await expect(page.getByRole("heading", { name: "Hook library", exact: true })).toBeVisible();
  await expect(page.getByText("36 definitions registered", { exact: true })).toBeVisible();
  await expect(page.getByText("36 expected in the PM brief", { exact: true })).toBeVisible();
  await expect(page.getByText("Volra", { exact: true })).toBeVisible();
  await expect(page.getByText("Calmo", { exact: true })).toBeVisible();
  await expect(page.getByText("volra", { exact: true })).toHaveCount(0);
});

test("hook stage filter and parameter details use the returned definitions", async ({ page }) => {
  await page.route("**/api/hooks", (route) => route.fulfill({ json: {
    coverage: {
      sourceStatus: "available", expectedCount: 2, registeredCount: 2,
      expectedByStage: { gate: 1, strike: 1, size: 0, pulse: 0, expiry: 0, breaker: 0 },
    },
    definitions: [
      { id: "test.gate", name: "Gate test", stage: "gate", availability: "implemented", summary: "A test definition.", parameters: { threshold: { type: "number" } } },
      { id: "test.strike", name: "Strike test", stage: "strike", availability: "catalog_only", summary: "A preview definition.", unavailableReason: "No evaluator.", parameters: {} },
    ],
  } }));
  await page.goto("/hooks");

  await expect(page.getByText("Gate test", { exact: true })).toBeVisible();
  await expect(page.getByText("Strike test", { exact: true })).toBeVisible();
  await page.getByLabel("Filter by stage").selectOption("gate");
  await expect(page.getByText("Gate test", { exact: true })).toBeVisible();
  await expect(page.getByText("Strike test", { exact: true })).toHaveCount(0);
  await page.getByText("Show parameters for Gate test (1)", { exact: true }).click();
  await expect(page.getByText(/threshold/)).toBeVisible();
});
