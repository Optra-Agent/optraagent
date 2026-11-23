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
  requested: 500, receivedAt: "2026-11-12T03:31:00.000Z",
  candles: Array.from({ length: count }, (_, index) => {
    const base = 300 + Math.sin(index / 5) * 6; const open = base; const close = base + (index % 2 ? 1.5 : -1.2);
    return { t: 1_794_000_000_000 + index * 3_600_000, o: open, h: Math.max(open, close) + 1, l: Math.min(open, close) - 1, c: close, v: 1000 + index * 10, n: 4, forming: false };
  }),
});
const expiry = Math.floor(Date.now() / 1000) + 3 * 86_400;
const mark = (strike: number, side: "call" | "put") => ({
  underlyingSymbol: "AAPL", side, instrument: `AAPL-27NOV26-${strike}-${side === "call" ? "C" : "P"}`, optionId: `0x${(strike * 2 + (side === "call" ? 1 : 2)).toString(16).padStart(64, "0")}`,
  expiryTimestamp: expiry, strikePriceRaw: strike, markPriceRaw: side === "call" ? 12.5 : 9.25, markIvRaw: 0.45, riskPremiumRateForBuy: 0, riskPremiumRateForSell: 0,
  delta: side === "call" ? 0.52 : -0.48, gamma: 0.01, vega: 0.2, theta: -0.1, marketAvailable: true, quoteType: "indicative",
});
const chain = () => ({
  venue: "callput", network: "robinhood", chainId: 4663, sourceUrl: "https://example.test", timestampMs: Date.now(), lastUpdatedAt: new Date().toISOString(), feedVersion: 1,
  spotIndexRaw: { AAPL: 300 }, futuresIndexRaw: {}, options: [315, 300, 285].flatMap((strike) => [mark(strike, "call"), mark(strike, "put")]),
});

type Live = { extra: number; lastClose: number; fail: boolean; hits: number };
async function mock(page: Page, options: { candles?: "ok" | "empty" | "fail"; count?: number; live?: Live } = {}) {
  await page.route("**/api/markets", (route) => route.fulfill({ json: { markets: [adobe, apple] } }));
  await page.route(/\/api\/markets\/(AAPL|ADBE)$/, (route) => route.fulfill({ json: quote(route.request().url().endsWith("AAPL") ? "AAPL" : "ADBE") }));
  await page.route(/\/api\/markets\/(AAPL|ADBE)\/candles/, (route) => {
    const url = new URL(route.request().url());
    if (options.candles === "fail") return route.fulfill({ status: 503, json: { error: { code: "UPSTREAM_UNAVAILABLE", message: "Candle provider is down.", retryable: true } } });
    const interval = url.searchParams.get("interval") ?? "1h";
    const live = options.live;
    if (live) {
      live.hits += 1;
      if (live.fail) return route.fulfill({ status: 503, json: { error: { code: "UPSTREAM_UNAVAILABLE", message: "Candle provider is down.", retryable: true } } });
    }
    const body = series(url.pathname.includes("AAPL") ? "AAPL" : "ADBE", interval, (options.candles === "empty" ? 0 : options.count ?? 200) + (live?.extra ?? 0));
    if (live && live.lastClose) body.candles[body.candles.length - 1]!.c = live.lastClose;
    return route.fulfill({ json: body });
  });
  await page.route("**/api/venue/callput/market?underlying=AAPL", (route) => route.fulfill({ json: chain() }));
}

test("Markets opens a stock's market page from the list", async ({ page }) => {
  await mock(page);
  await page.goto("/market");
  // Only a stock CallPut actually lists carries the Options badge.
  await expect(page.locator(".mk-row", { hasText: "AAPL" }).locator(".mk-opt")).toHaveText("Options");
  await expect(page.locator(".mk-row", { hasText: "ADBE" }).locator(".mk-opt")).toHaveCount(0);
  await page.getByRole("button", { name: /AAPL, Apple/ }).click();
  await page.getByRole("complementary", { name: "AAPL details" }).getByRole("link", { name: /Open chart & options/ }).click();
  await expect(page).toHaveURL(/\/market\/AAPL$/);
  await expect(page.getByRole("heading", { name: "Apple", level: 1 })).toBeVisible();
  await expect(page.getByText("Tokenized stock · Robinhood Chain")).toBeVisible();
});

test("a CallPut-listed stock opens on candles and volume, and indicators are opt-in", async ({ page }) => {
  await mock(page);
  const requests: string[] = [];
  page.on("request", (request) => { const url = new URL(request.url()); if (url.pathname.endsWith("/candles")) requests.push(`${url.searchParams.get("interval")}:${url.searchParams.get("limit")}`); });
  await page.goto("/market/AAPL");
  const chart = page.getByRole("img", { name: /AAPL candlestick and volume chart, 1 hour candles, 200 candles/ });
  await expect(chart).toBeVisible();
  // Candles are the default mode, with volume on and the moving averages off. The newest 90 of the 200 genuine candles are in view.
  await expect(page.getByRole("group", { name: "Chart type" }).getByRole("button", { name: "Candles" })).toHaveAttribute("aria-pressed", "true");
  await expect(chart.locator(".mc-candle")).toHaveCount(90);
  await expect(chart.locator(".mc-vol")).toHaveCount(90);
  await expect(page.getByLabel("Last traded price")).toHaveText(/^\$\d+\.\d+/);
  await expect(page.getByText(/Source Crius · Robinhood Chain token trades · 200 candles \(1 hour\) with trades/)).toBeVisible();
  expect(requests).toContain("1h:500");

  await chart.hover({ position: { x: 300, y: 120 } });
  await expect(page.locator(".cc-readout")).toContainText(/UTC/);
  await expect(page.locator(".cc-readout")).toContainText(/Vol \$/);

  await page.getByRole("button", { name: /^Indicators/ }).click();
  await expect(page.getByRole("button", { name: "Volume" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "SMA 20/50" })).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "RSI 14" }).click();
  await page.getByRole("button", { name: "MACD" }).click();
  await page.getByRole("button", { name: "SMA 20/50" }).click();
  await expect(chart).toContainText("RSI 14");
  await expect(chart).toContainText("MACD 12/26/9");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("group", { name: "Indicators" })).toHaveCount(0);
  await page.getByRole("button", { name: "Zoom in" }).click();
  expect(await chart.locator(".mc-candle").count()).toBeLessThan(90);
  await page.getByRole("button", { name: "Latest" }).click();
  await expect(chart.locator(".mc-candle")).toHaveCount(90);
  await page.getByRole("group", { name: "Chart type" }).getByRole("button", { name: "Line" }).click();
  await expect(chart.locator(".mc-candle")).toHaveCount(0);

  await page.getByRole("button", { name: "4 hour" }).click();
  await expect(page.getByRole("img", { name: /4 hour candles/ })).toBeVisible();
  expect(requests).toContain("4h:500");
});

test("the chart refreshes with real provider data, keeps the user's view and never polls a hidden tab", async ({ page }) => {
  const live: Live = { extra: 0, lastClose: 0, fail: false, hits: 0 };
  await page.clock.install();
  await mock(page, { live });
  await page.goto("/market/AAPL");
  await expect(page.getByRole("img", { name: /200 candles/ })).toBeVisible();
  const chart = page.locator(".mc-svg"); // its accessible name carries the candle count, which changes on refresh
  await expect(chart.locator(".mc-candle")).toHaveCount(90);
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
  const before = await page.getByLabel("Last traded price").innerText();
  const baseline = live.hits; // dev mode may run the first effect twice; only relative counts matter

  // A new real bucket arrives and the forming candle's close moves: the headline, the candle count and the chip follow.
  live.extra = 1; live.lastClose = 123.45;
  await page.clock.runFor(31_000);
  await expect(page.getByRole("img", { name: /201 candles/ })).toBeVisible();
  await expect(page.getByLabel("Last traded price")).toHaveText("$123.45");
  expect(await page.getByLabel("Last traded price").innerText()).not.toBe(before);
  await expect(chart.locator(".mc-candle")).toHaveCount(90);
  expect(live.hits).toBe(baseline + 1);

  // Zoom in, then another refresh: the zoom survives and no second request overlaps.
  await page.getByRole("button", { name: "Zoom in" }).click();
  const zoomed = await chart.locator(".mc-candle").count();
  live.extra = 2;
  await page.clock.runFor(31_000);
  await expect(page.getByRole("img", { name: /202 candles/ })).toBeVisible();
  expect(await chart.locator(".mc-candle").count()).toBe(zoomed);

  // A hidden tab makes no requests.
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); });
  const hitsBeforeHidden = live.hits;
  await page.clock.runFor(95_000);
  expect(live.hits).toBe(hitsBeforeHidden);
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => false }); document.dispatchEvent(new Event("visibilitychange")); });
  await expect.poll(() => live.hits).toBeGreaterThan(hitsBeforeHidden);

  // A failed refresh keeps the last real data and says it is delayed instead of inventing anything.
  live.fail = true;
  await page.clock.runFor(31_000);
  await expect(page.getByText("Delayed", { exact: true })).toBeVisible();
  await expect(page.getByText(/Refresh failed · showing data from/)).toBeVisible();
  await expect(page.getByRole("img", { name: /202 candles/ })).toBeVisible();
  await expect(page.getByLabel("Last traded price")).toHaveText("$123.45");
});

test("the live option chain feeds the real order form, which stays unsigned", async ({ page }) => {
  await mock(page);
  await page.goto("/market/AAPL");
  await expect(page.getByRole("table", { name: /AAPL CallPut options expiring/ })).toBeVisible();
  await expect(page.getByText("Source CallPut venue feed")).toBeVisible();
  await page.getByRole("button", { name: /Pick as long leg: AAPL-27NOV26-300-P/ }).click();
  await page.getByRole("button", { name: /Pick as short leg: AAPL-27NOV26-285-P/ }).click();
  await expect(page.getByLabel("Selected legs")).toContainText("Long AAPL-27NOV26-300-P");
  await expect(page.getByLabel("Selected legs")).toContainText("Short AAPL-27NOV26-285-P");
  await page.getByLabel("Selected legs").getByRole("link", { name: "Go to the order form" }).click();
  const trade = page.getByRole("region", { name: "Trade AAPL options" });
  await expect(trade.locator("#cp-underlying")).toHaveValue("AAPL");
  await expect(trade.locator("#cp-underlying")).toBeDisabled();
  await expect(trade.locator("#cp-strategy")).toHaveValue("BuyPutSpread");
  await expect(trade.locator("#cp-long-leg option:checked")).toContainText("AAPL-27NOV26-300-P");
  await expect(trade.locator("#cp-short-leg option:checked")).toContainText("AAPL-27NOV26-285-P");
  // Nothing is prepared, approved or sent until the owner connects a wallet and uses the buttons.
  await expect(trade.getByText("Connect a wallet to prepare an order.")).toBeVisible();
  await expect(trade.getByRole("heading", { name: "Order review" })).toHaveCount(0);
  await expect(trade.getByText(/transaction hash is not a fill|not a fill/i).first()).toBeVisible();
});

test("a stock without a CallPut market shows real data only and no options or order controls", async ({ page }) => {
  await mock(page);
  await page.goto("/market/ADBE");
  await expect(page.getByText("CallPut has no live options market for ADBE.")).toBeVisible();
  await expect(page.getByText("No CallPut options market", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "AAPL", exact: true })).toHaveAttribute("href", "/market/AAPL");
  for (const absent of [page.getByRole("table"), page.getByRole("region", { name: /Trade ADBE options/ }), page.getByRole("heading", { name: "CallPut options order" }), page.getByRole("link", { name: /Trade options/ }), page.getByRole("button", { name: /ticket/i })]) await expect(absent).toHaveCount(0);
  await expect(page.getByRole("img", { name: /ADBE candlestick and volume chart/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Build a Protective Put paper agent/ })).toBeVisible();
});

test("no page offers demo, simulated or modeled trading", async ({ page }) => {
  await mock(page);
  for (const path of ["/market/AAPL", "/market/ADBE"]) {
    await page.goto(path);
    await expect(page.getByRole("img", { name: /candlestick and volume chart/ })).toBeVisible();
    const text = await page.locator("main").innerText();
    expect(text).not.toMatch(/demo|simulated|\bmodeled\b|add .*ticket/i);
  }
});

test("chart failure offers retry only, and never draws substitute candles", async ({ page }) => {
  await mock(page, { candles: "fail" });
  await page.goto("/market/AAPL");
  await expect(page.getByText("Candle provider is down.")).toBeVisible();
  await expect(page.locator(".mc-candle")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /demo/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry" }).first()).toBeVisible();
});

test("a thin provider response draws exactly the genuine candles, and an empty one says so", async ({ page }) => {
  await mock(page, { count: 30 });
  await page.goto("/market/AAPL");
  await expect(page.getByRole("img", { name: /30 candles/ })).toBeVisible();
  await expect(page.locator(".mc-candle")).toHaveCount(30);
  await page.unroute("**/api/markets");
  await mock(page, { candles: "empty" });
  await page.reload();
  await expect(page.getByText(/No AAPL token trades were recorded in the provider's 1 hour window/)).toBeVisible();
  await expect(page.locator(".mc-candle")).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Chart timeframe" }).getByRole("button", { name: "1 day" })).toBeVisible();
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
      await expect(page.locator(".mc-candle").first()).toBeVisible();
      await page.getByRole("button", { name: /^Indicators/ }).click();
      await page.getByRole("button", { name: "RSI 14" }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    }
  });
}
