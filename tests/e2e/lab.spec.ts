import { expect, test } from "@playwright/test";

test("Lab reports source-backed replay coverage and blocks when its full window is unavailable", async ({ page }) => {
  await page.route("**/api/markets", (route) => route.fulfill({ json: { markets: [{ symbol: "AAPL", name: "Apple", currentMultiplier: "1.001" }] } }));
  await page.route("**/api/backtests/coverage?symbol=AAPL", (route) => route.fulfill({ json: {
    symbol: "AAPL", availableSamples: 0, requiredSamples: 1441, startAt: null, endAt: null, consecutiveHours: 0, ready: false,
    dataSource: "crius_robinhood_chain_candles", multiplierStatus: "unverified", fillApplied: false,
    reason: "Only 0 consecutive verified candles are available; 1441 are required for 720 decisions and RV30 warmup.",
  } }));
  await page.goto("/lab");

  await expect(page.getByRole("heading", { name: "Lab", exact: true })).toBeVisible();
  await expect(page.getByText("0 / 1441 verified hourly candles", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Backtest coverage" }).getByText("Only 0 consecutive verified candles are available; 1441 are required for 720 decisions and RV30 warmup.", { exact: true })).toBeVisible();
  await expect(page.getByText("Coverage pending", { exact: true })).toBeVisible();
  await expect(page.getByText("Total return", { exact: true })).toHaveCount(0);
});

