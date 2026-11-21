import { expect, test } from "@playwright/test";

test("Tape exposes close and settlement preparation without enabling wallet signing", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tape");

  await expect(page.getByRole("heading", { name: "CallPut options order", exact: true })).toBeVisible();
  await expect(page.getByText("Preview only", { exact: true })).toBeVisible();
  await page.getByText("Close or settle a position", { exact: true }).click();
  await expect(page.getByLabel("Option token ID (decimal)")).toBeVisible();
  await expect(page.getByRole("button", { name: "Prepare close" })).toBeDisabled();
  await expect(page.getByText(/CallPut Account sessions and autonomous execution are not enabled/)).toBeVisible();

  await page.getByLabel("Action", { exact: true }).selectOption("settle");
  await expect(page.getByRole("button", { name: "Prepare settlement" })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});
