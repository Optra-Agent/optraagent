import { expect, test } from "@playwright/test";

test("Forge reads the PM catalog and blocks unsupported generic recipes without AI claims", async ({ page }) => {
  await page.route("**/api/me", (route) => route.fulfill({ json: {
    user: { id: "owner-1", address: "0xfcad0b19bb29d4674531d6f115237e16afce377c" }, expiresAt: "2026-11-19T03:31:00.000Z",
  } }));
  await page.route("**/api/markets", (route) => route.fulfill({ json: { markets: [{ symbol: "AAPL", name: "Apple Inc.", currentMultiplier: "1.001" }] } }));

  await page.goto("/forge");

  await expect(page.getByRole("heading", { name: "Forge", exact: true })).toBeVisible();
  await expect(page.getByText("AI composition is planned", { exact: true })).toBeVisible();
  await expect(page.getByText("Registered hooks: 36 / 36", { exact: true })).toBeVisible();
  await expect(page.getByText("Calmo", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Strategy template" }).click();
  await page.getByRole("option", { name: "Covered Call" }).click();
  const validate = page.getByRole("button", { name: "Validate recipe", exact: true });
  await validate.click();
  await expect(page.locator(".forge-validation")).toContainText("Recipe blocked");
  await expect(page.locator(".forge-validation")).toContainText("Covered Call is a closed House Agent specification");
  await expect(page.getByRole("button", { name: "Save draft", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: /compose|generate with ai/i })).toHaveCount(0);
});
