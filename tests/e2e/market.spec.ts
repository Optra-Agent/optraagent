import { expect, test } from "@playwright/test";

const apple = { symbol: "AAPL", name: "Apple • Robinhood Token", currentMultiplier: "1.001092264102650688", tokenAddress: "0xaf3d76f1834a1d425780943c99ea8a608f8a93f9" };
const adobe = { symbol: "ADBE", name: "Adobe • Robinhood Token", currentMultiplier: "1.000000000000000000", tokenAddress: "0x232b8ed6377be97813853b0ac104c4cda8378d1b" };
const micron = { symbol: "MU", name: "Micron Technology • Robinhood Token", currentMultiplier: "1.000200000000000000", tokenAddress: "0xff08000000000000000000000000000000004afd" };
const snapshot = {
  symbol: "AAPL", source: "robinhood_stock_token_api", observedAt: "2026-11-12T03:30:00.000Z", receivedAt: "2026-11-12T03:31:00.000Z",
  underlyingBidUsd: "355.78", underlyingAskUsd: "356", currentMultiplier: apple.currentMultiplier,
  tokenBidUsd: "356.168019703945977455", tokenAskUsd: "356.388259639678362960", currency: "USD", stale: false, tradingHalt: false, pricingMethod: "recorded",
};
const coverage = (ready: boolean) => ({
  symbol: "AAPL", availableSamples: ready ? 1499 : 12, requiredSamples: 1441, startAt: null, endAt: null, consecutiveHours: ready ? 1499 : 12, ready,
  dataSource: "crius_robinhood_chain_candles", multiplierStatus: "stable_verified", fillApplied: false, reason: ready ? "Coverage ready." : "Only 12 consecutive verified candles are available.",
});

async function mock(page: import("@playwright/test").Page, options: { stale?: boolean; ready?: boolean } = {}) {
  await page.route("**/api/markets", (route) => route.fulfill({ json: { markets: [adobe, apple, micron] } }));
  await page.route("**/api/markets/AAPL", (route) => route.fulfill({ json: { ...snapshot, stale: options.stale ?? false } }));
  await page.route("**/api/backtests/coverage?symbol=AAPL", (route) => route.fulfill({ json: coverage(options.ready ?? true) }));
}

test("Markets lists every asset, opens AAPL with provenance, and labels price units separately", async ({ page }) => {
  await mock(page);
  await page.goto("/market");

  await expect(page.getByRole("heading", { name: "Markets", exact: true })).toBeVisible();
  await expect(page.locator(".mk-row")).toHaveCount(3);
  const detail = page.getByRole("complementary", { name: "AAPL details" });
  await expect(detail.getByText("Underlying reference")).toBeVisible();
  await expect(detail.getByText("355.78 USD", { exact: true })).toBeVisible();
  await expect(detail.getByText("Robinhood quote · recorded", { exact: true })).toBeVisible();
  await expect(detail.getByText("Coverage ready", { exact: true })).toBeVisible();
  await expect(detail.getByRole("link", { name: /Build a Protective Put on AAPL/ })).toHaveAttribute("href", "/agents?symbol=AAPL#configure");
  // The list draws no change columns or sparklines; candles live on the market page.
  await expect(detail.getByRole("link", { name: /Open chart & options/ })).toHaveAttribute("href", "/market/AAPL");
  await expect(page.getByText("7d", { exact: true })).toHaveCount(0);
});

test("Markets search, filter and sort work on the real list", async ({ page }) => {
  await mock(page);
  await page.goto("/market");
  await page.getByLabel("Search markets").fill("micron");
  await expect(page.locator(".mk-row")).toHaveCount(1);
  await expect(page.locator(".mk-row").first()).toContainText("MU");
  await page.getByLabel("Search markets").fill("");
  await page.getByRole("button", { name: /Multiplier ≠ 1/ }).click();
  await expect(page.locator(".mk-row")).toHaveCount(2);
  await page.getByRole("button", { name: /Standard/ }).click();
  await expect(page.locator(".mk-row")).toHaveCount(1);
  await expect(page.locator(".mk-row").first()).toContainText("ADBE");
  await page.getByRole("button", { name: /^All/ }).click();
  await page.getByRole("combobox", { name: "Sort" }).click();
  await page.getByRole("option", { name: "Symbol Z to A" }).click();
  await expect(page.locator(".mk-row").first()).toContainText("MU");
});

test("Markets marks a stale quote and disables the agent action", async ({ page }) => {
  await mock(page, { stale: true });
  await page.goto("/market");
  await expect(page.getByText("Quote stale", { exact: true })).toBeVisible();
  await expect(page.getByText("Paper entries are blocked until a fresh quote is available.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Build a Protective Put on AAPL/ })).toBeDisabled();
  await expect(page.getByRole("link", { name: /Build a Protective Put/ })).toHaveCount(0);
});

test("Markets disables the agent action when backtest coverage is not ready", async ({ page }) => {
  await mock(page, { ready: false });
  await page.goto("/market");
  await expect(page.getByText("Backtest blocked", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Build a Protective Put on AAPL/ })).toBeDisabled();
  await expect(page.getByText("Backtest coverage is not ready for this market.")).toBeVisible();
});

test("Markets shows an error state with retry when the list fails", async ({ page }) => {
  await page.route("**/api/markets", (route) => route.fulfill({ status: 503, json: { error: { code: "UPSTREAM_UNAVAILABLE", message: "Robinhood feed is down.", retryable: true } } }));
  await page.goto("/market");
  await expect(page.getByText("Markets unavailable")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
});

test("Markets shows each company's bundled logo and a monogram where none is verified", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (request) => { const url = new URL(request.url()); if (!["localhost", "127.0.0.1"].includes(url.hostname) && /\.(png|svg|ico|webp)(\?|$)/.test(url.pathname)) external.push(request.url()); });
  const spy = { symbol: "SPY", name: "SPDR S&P 500 ETF • Robinhood Token", currentMultiplier: "1.000000000000000000", tokenAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" };
  await page.route("**/api/markets", (route) => route.fulfill({ json: { markets: [
    { ...apple, logoUrl: `https://cdn.robinhood.com/ncw_assets/logos/${apple.tokenAddress}.png` },
    { ...adobe }, { ...micron, logoUrl: "https://evil.example/logo.png" }, spy,
  ] } }));
  await page.route("**/api/markets/AAPL", (route) => route.fulfill({ json: snapshot }));
  await page.route("**/api/backtests/coverage?symbol=AAPL", (route) => route.fulfill({ json: coverage(true) }));
  await page.goto("/market");

  const rows = page.locator(".mk-row");
  await expect(rows).toHaveCount(4);
  for (const [ticker, file] of [["AAPL", "AAPL.png"], ["ADBE", "ADBE.png"], ["MU", "MU.png"]] as const) {
    const logo = rows.filter({ hasText: ticker }).locator(".asset-logo");
    await expect(logo).toHaveAttribute("data-fallback", "0");
    await expect(logo.locator("img")).toHaveAttribute("src", `/logos/${file}`);
    await expect.poll(() => logo.locator("img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  }
  // SPY has no verified mark of its own, so it shows a monogram rather than a wrong or generic image.
  const spyLogo = rows.filter({ hasText: "SPY" }).locator(".asset-logo");
  await expect(spyLogo).toHaveAttribute("data-fallback", "1");
  await expect(spyLogo.locator(".asset-initials")).toHaveText("SPY");
  await expect(spyLogo.locator("img")).toHaveCount(0);
  // The registry's logoUrl field is never trusted or requested.
  expect(external).toEqual([]);
  await expect(page.getByRole("complementary", { name: "AAPL details" }).locator("img")).toHaveAttribute("src", "/logos/AAPL.png");
});

test("Markets falls back to a monogram when a bundled logo fails to load", async ({ page }) => {
  await page.route("**/api/markets", (route) => route.fulfill({ json: { markets: [apple] } }));
  await page.route("**/api/markets/AAPL", (route) => route.fulfill({ json: snapshot }));
  await page.route("**/api/backtests/coverage?symbol=AAPL", (route) => route.fulfill({ json: coverage(true) }));
  await page.route("**/logos/**", (route) => route.abort());
  await page.goto("/market");
  const row = page.locator(".mk-row").first();
  await expect(row.locator(".asset-logo")).toHaveAttribute("data-fallback", "1");
  await expect(row.locator(".asset-initials")).toHaveText("AAP");
  await expect(row.locator("img")).toHaveCount(0);
});
