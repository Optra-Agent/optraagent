import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const asset = (symbol: string, name: string, address: string) => ({ symbol, name: `${name} • Robinhood Token`, currentMultiplier: "1.001000000000000000", tokenAddress: address });
const apple = asset("AAPL", "Apple", "0xaf3d76f1834a1d425780943c99ea8a608f8a93f9");
const adobe = asset("ADBE", "Adobe", "0x232b8ed6377be97813853b0ac104c4cda8378d1b");
const quote = (symbol: string) => ({
  symbol, source: "robinhood_stock_token_api", observedAt: "2026-11-12T03:30:00.000Z", receivedAt: "2026-11-12T03:31:00.000Z",
  underlyingBidUsd: "300", underlyingAskUsd: "301", currentMultiplier: "1.001000000000000000",
  tokenBidUsd: "300.3", tokenAskUsd: "301.3", currency: "USD", stale: false, tradingHalt: false, pricingMethod: "recorded",
});
const series = (symbol: string, interval: string, count: number) => ({
  symbol, interval, source: "crius_robinhood_chain_candles", tokenAddress: apple.tokenAddress, priceBasis: "share_equivalent", multiplier: 1.001, multiplierPending: false,
  requested: 120, receivedAt: "2026-11-12T03:31:00.000Z",
  candles: Array.from({ length: count }, (_, index) => {
    const base = 300 + Math.sin(index / 5) * 6; const open = base; const close = base + (index % 2 ? 1.5 : -1.2);
    return { t: 1_794_000_000_000 + index * 3_600_000, o: open, h: Math.max(open, close) + 1, l: Math.min(open, close) - 1, c: close, v: 1000 + index, n: 4, forming: false };
  }),
});
const chain = {
  venue: "callput", network: "robinhood", chainId: 4663, sourceUrl: "https://example.test", timestampMs: Date.now(), lastUpdatedAt: new Date().toISOString(), feedVersion: 1,
  spotIndexRaw: { AAPL: 300 }, futuresIndexRaw: {},
  options: [315, 300, 285].flatMap((strike) => (["call", "put"] as const).map((side) => ({
    underlyingSymbol: "AAPL", side, instrument: `AAPL-27NOV26-${strike}-${side === "call" ? "C" : "P"}`, optionId: `0x${"1".repeat(63)}${side === "call" ? "1" : "2"}`,
    expiryTimestamp: 1_795_900_000 + 0, strikePriceRaw: strike, markPriceRaw: side === "call" ? 12.5 : 9.25, markIvRaw: 0.45, riskPremiumRateForBuy: 0, riskPremiumRateForSell: 0,
    delta: side === "call" ? 0.52 : -0.48, gamma: 0.01, vega: 0.2, theta: -0.1, marketAvailable: true, quoteType: "indicative",
  }))),
};

async function mock(page: Page, options: { candles?: "ok" | "empty" | "fail"; count?: number } = {}) {
  await page.route("**/api/markets", (route) => route.fulfill({ json: { markets: [adobe, apple] } }));
  await page.route(/\/api\/markets\/(AAPL|ADBE)$/, (route) => route.fulfill({ json: quote(route.request().url().endsWith("AAPL") ? "AAPL" : "ADBE") }));
  await page.route(/\/api\/markets\/(AAPL|ADBE)\/candles/, (route) => {
    const url = new URL(route.request().url());
    if (options.candles === "fail") return route.fulfill({ status: 503, json: { error: { code: "UPSTREAM_UNAVAILABLE", message: "Candle provider is down.", retryable: true } } });
    const interval = url.searchParams.get("interval") ?? "1h";
    return route.fulfill({ json: series(url.pathname.includes("AAPL") ? "AAPL" : "ADBE", interval, options.candles === "empty" ? 0 : options.count ?? 120) });
  });
  await page.route("**/api/venue/callput/market?underlying=AAPL", (route) => route.fulfill({ json: chain }));
}

test("Markets opens a stock's market page from the list", async ({ page }) => {
  await mock(page);
  await page.goto("/market");
  await page.getByRole("button", { name: /AAPL, Apple/ }).click();
  await page.getByRole("complementary", { name: "AAPL details" }).getByRole("link", { name: /Open chart & options/ }).click();
  await expect(page).toHaveURL(/\/market\/AAPL$/);
  await expect(page.getByRole("heading", { name: "Apple", level: 1 })).toBeVisible();
  await expect(page.getByText("Tokenized stock · Robinhood Chain")).toBeVisible();
});

test("a CallPut-listed stock draws real candles, switches timeframe and leads to the signed order flow", async ({ page }) => {
  await mock(page);
  const intervals: string[] = [];
  page.on("request", (request) => { const url = new URL(request.url()); if (url.pathname.endsWith("/candles")) intervals.push(url.searchParams.get("interval") ?? ""); });
  await page.goto("/market/AAPL");
  const chart = page.getByRole("img", { name: /AAPL candlestick chart, 1 hour candles, 120 candles/ });
  await expect(chart).toBeVisible();
  await expect(chart.locator(".cc-candle")).toHaveCount(120);
  await expect(page.getByText(/Source Crius · Robinhood Chain candles · 120 of 120 requested/)).toBeVisible();
  await page.getByRole("button", { name: "4 hour" }).click();
  await expect(page.getByRole("img", { name: /4 hour candles/ })).toBeVisible();
  expect(intervals).toContain("4h");

  await expect(page.getByText("CallPut options · real Mainnet")).toBeVisible();
  await expect(page.getByRole("table", { name: /AAPL CallPut options expiring/ })).toBeVisible();
  await expect(page.getByText(/A transaction hash is not a fill/).first()).toBeVisible();
  await page.getByRole("link", { name: /Trade options/ }).click();
  const trade = page.getByRole("region", { name: "Trade AAPL options" });
  await expect(trade.getByRole("heading", { name: "CallPut options order" })).toBeVisible();
  await expect(trade.locator("#cp-underlying")).toHaveValue("AAPL");
  await expect(trade.locator("#cp-underlying")).toBeDisabled();
  await expect(page.getByText(/Demo mode/)).toHaveCount(0);
});

test("a stock CallPut does not list gets a labeled demo with no transaction path", async ({ page }) => {
  await mock(page);
  await page.goto("/market/ADBE");
  await expect(page.getByText("Options: demo only")).toBeVisible();
  await expect(page.getByText("Demo mode · simulated")).toBeVisible();
  await expect(page.getByRole("region", { name: /Trade ADBE options/ })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "CallPut options order" })).toHaveCount(0);
  await page.getByRole("button", { name: /Select ADBE .* call/ }).first().click();
  await page.locator("#dm-units").fill("3");
  await expect(page.getByText("Modeled cost")).toBeVisible();
  await page.getByRole("button", { name: "Add demo ticket" }).click();
  const list = page.getByRole("list", { name: "Demo tickets" });
  await expect(list.getByText("Simulated")).toBeVisible();
  await expect(list).not.toContainText(/0x[0-9a-f]{6}/i);
  await page.locator("#dm-units").fill("0");
  await expect(page.getByRole("button", { name: "Add demo ticket" })).toBeDisabled();
});

test("chart failure offers retry and a clearly labeled demo chart, never silent fake candles", async ({ page }) => {
  await mock(page, { candles: "fail" });
  await page.goto("/market/AAPL");
  await expect(page.getByText("Candle provider is down.")).toBeVisible();
  await expect(page.locator(".cc-candle")).toHaveCount(0);
  await page.getByRole("button", { name: "Show demo chart" }).click();
  await expect(page.getByText("Demo data · simulated")).toBeVisible();
  await expect(page.getByRole("img", { name: /Simulated AAPL candlestick chart.*Demo data/ })).toBeVisible();
  await page.getByRole("button", { name: "Back to market data" }).click();
  await expect(page.getByText("Candle provider is down.")).toBeVisible();
});

test("a provider with fewer candles than requested says so, and an empty series draws nothing", async ({ page }) => {
  await mock(page, { count: 40 });
  await page.goto("/market/AAPL");
  await expect(page.getByText(/40 of 120 requested 1 hour candles \(all the provider has\)/)).toBeVisible();
  await page.unroute("**/api/markets");
  await mock(page, { candles: "empty" });
  await page.reload();
  await expect(page.getByText(/no 1 hour candles for AAPL/)).toBeVisible();
  await expect(page.locator(".cc-candle")).toHaveCount(0);
});

test("an unlisted symbol shows a clear empty state with a way back", async ({ page }) => {
  await mock(page);
  await page.goto("/market/ZZZZ");
  await expect(page.getByText("ZZZZ is not listed")).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to Markets" })).toHaveAttribute("href", "/market");
});

for (const width of [320, 390, 768, 1280, 1440]) {
  test(`market page has no horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mock(page);
    for (const symbol of ["AAPL", "ADBE"]) {
      await page.goto(`/market/${symbol}`);
      await expect(page.locator(".cc-candle").first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    }
  });
}
