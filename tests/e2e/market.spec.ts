import { expect, test } from "@playwright/test";

const market = { symbol: "AAPL", name: "Apple • Robinhood Token", currentMultiplier: "1.001092264102650688" };
const snapshot = {
  symbol: "AAPL",
  source: "robinhood_stock_token_api",
  observedAt: "2026-11-12T03:30:00.000Z",
  receivedAt: "2026-11-12T03:31:00.000Z",
  underlyingBidUsd: "355.78",
  underlyingAskUsd: "356",
  currentMultiplier: market.currentMultiplier,
  tokenBidUsd: "356.168019703945977455",
  tokenAskUsd: "356.388259639678362960",
  currency: "USD",
  stale: false,
  tradingHalt: false,
  pricingMethod: "recorded",
};

test("market screen renders provenance and separately labeled price units", async ({ page }) => {
  await page.route("**/api/markets", (route) => route.fulfill({ json: { markets: [market] } }));
  await page.route("**/api/markets/AAPL", (route) => route.fulfill({ json: snapshot }));
  await page.goto("/market");

  await expect(page.getByRole("heading", { name: "Market data", exact: true })).toBeVisible();
  await expect(page.getByText("Underlying bid", { exact: true })).toBeVisible();
  await expect(page.getByText("355.78 USD", { exact: true })).toBeVisible();
  await expect(page.getByText("Robinhood quote · recorded", { exact: true })).toBeVisible();
});

test("market screen marks stale data and blocks paper entry", async ({ page }) => {
  await page.route("**/api/markets", (route) => route.fulfill({ json: { markets: [market] } }));
  await page.route("**/api/markets/AAPL", (route) => route.fulfill({ json: { ...snapshot, stale: true } }));
  await page.goto("/market");

  await expect(page.getByText("Quote stale", { exact: true })).toBeVisible();
  await expect(page.getByText("Paper entries are blocked until a fresh quote is available.", { exact: true })).toBeVisible();
});
