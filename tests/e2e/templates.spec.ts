import { expect, test } from "@playwright/test";

test("House Agent cards are all paper ready once their Paper implementation passes acceptance", async ({ page }) => {
  await page.route("**/api/me", (route) => route.fulfill({ status: 401, json: { error: { code: "UNAUTHORIZED", message: "Sign in required.", retryable: false } } }));
  await page.goto("/agents");

  const templates = page.getByRole("region", { name: "House Agent templates" });
  await expect(templates.getByText("Covered Call", { exact: true })).toBeVisible();
  await expect(templates.getByText("Cash-Secured Put", { exact: true })).toBeVisible();
  await expect(templates.getByText("Protective Put", { exact: true })).toBeVisible();
  await expect(templates.getByText("Earnings Straddle", { exact: true })).toBeVisible();
  await expect(templates.getByText("Preview", { exact: true })).toHaveCount(0);
  await expect(templates.getByText("Paper ready", { exact: true })).toHaveCount(4);
  await expect(templates.getByRole("button", { name: /launch/i })).toHaveCount(0);
});
