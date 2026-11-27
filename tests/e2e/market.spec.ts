import { expect, test } from "@playwright/test";

const apple = { symbol: "AAPL", name: "Apple • Robinhood Token", currentMultiplier: "1.001092264102650688", tokenAddress: "0xaf3d76f1834a1d425780943c99ea8a608f8a93f9" };
const adobe = { symbol: "ADBE", name: "Adobe • Robinhood Token", currentMultiplier: "1.000000000000000000", tokenAddress: "0x232b8ed6377be97813853b0ac104c4cda8378d1b" };
const micron = { symbol: "MU", name: "Micron Technology • Robinhood Token", currentMultiplier: "1.000200000000000000", tokenAddress: "0xff08000000000000000000000000000000004afd" };
const marketFixture = (symbol: string, name: string, addressDigit: string) => ({ ...apple, symbol, name: `${name} • Robinhood Token`, currentMultiplier: "1.000000000000000000", tokenAddress: `0x${addressDigit.repeat(40)}` });
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

test("Markets ranks verified completed backtests ahead of uncovered markets", async ({ page }) => {
  test.setTimeout(120_000);
  let releaseAgents!: () => void;
  let reportAgentsRequest!: () => void;
  const agentsRequested = new Promise<void>((resolve) => { reportAgentsRequest = resolve; });
  const agentsGate = new Promise<void>((resolve) => { releaseAgents = resolve; });
  const liveAgents = ["protective_put", "covered_call", "cash_secured_put", "earnings_straddle"].map((templateId, index) => ({
    id: `house-layout-${index}`,
    name: `House Agent ${index + 1}`,
    templateId,
    underlyingSymbol: ["NVDA", "TSLA", "AMD", "AMZN"][index],
    status: "running",
    recipeHash: `sha256:${"a".repeat(64)}`,
    by: "Optra",
    executionMode: "PAPER",
    launchedAt: "2026-11-26T20:00:00.000Z",
    latestDecision: { id: `decision-${index}`, action: "hold", reason: "The modeled position remains inside its exit rules.", createdAt: "2026-11-26T20:00:00.000Z" },
    decisionCount: 18,
    openPositions: 1,
    account: { initialCapitalUsd: "10000", cashUsd: "8000", realizedPnlUsd: "250.00", equityUsd: "10250.00", lockedCollateralUsd: "2000" },
    backtest: { id: `backtest-${index}`, totalReturnPct: "1.25", vsHoldingPct: "4.55", vsCashPct: "1.00", maxDrawdownPct: "3.50", premiumSource: "modeled", startAt: "2026-10-27T20:00:00.000Z", endAt: "2026-11-26T20:00:00.000Z" },
  }));
  await page.route("**/api/public/v1/agents", async (route) => {
    reportAgentsRequest();
    await agentsGate;
    await route.fulfill({ json: { agents: liveAgents, executionMode: "PAPER" } });
  });
  const markets = [apple, marketFixture("NVDA", "NVIDIA", "1"), marketFixture("GLD", "SPDR Gold Shares", "2"), marketFixture("AMD", "Advanced Micro Devices", "3"), marketFixture("AMZN", "Amazon", "4")];
  await page.route("**/api/markets", (route) => route.fulfill({ json: { markets } }));
  await page.route("**/api/markets/*", (route) => {
    const symbol = new URL(route.request().url()).pathname.split("/").at(-1) ?? "AAPL";
    return route.fulfill({ json: { ...snapshot, symbol } });
  });
  await page.route(/\/api\/backtests\/coverage\?symbol=/, (route) => {
    const symbol = new URL(route.request().url()).searchParams.get("symbol") ?? "AAPL";
    return route.fulfill({ json: { ...coverage(true), symbol } });
  });
  await page.goto("/market");

  const rows = page.locator(".mk-row");
  await expect(rows).toHaveCount(5);
  await expect(rows.nth(0)).toContainText("6 completed backtests");
  const symbols = await rows.evaluateAll((items) => items.map((item) => item.querySelector(".mk-asset-text b")?.textContent?.trim().replace("Options", "") ?? ""));
  expect(symbols).toEqual(["AMZN", "NVDA", "AMD", "GLD", "AAPL"]);
  await expect(rows.nth(0)).toContainText("2 valid no-entry outcomes");
  await expect(rows.nth(2)).toContainText("4 completed backtests");
  await expect(rows.nth(2)).toContainText("4 valid no-entry outcomes");
  await expect(rows.nth(3)).toContainText("4 valid no-entry outcomes");
  await expect(rows.nth(4)).toContainText("0 completed backtests · no verified history");
  const historyLink = page.getByRole("complementary", { name: "AAPL details" }).getByRole("link", { name: "View historical backtest results" });
  await expect(historyLink).toHaveAttribute("href", "/agents#house-backtests");
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(documentWidth).toBeLessThanOrEqual(width);
  }
  await historyLink.click();
  await expect(page).toHaveURL(/\/agents#house-backtests$/, { timeout: 45_000 });
  await agentsRequested;
  await expect(page.getByRole("region", { name: "Historical House Agent backtests" })).toBeVisible({ timeout: 45_000 });
  const historyHeading = page.getByRole("heading", { name: "Historical House Agent backtests", exact: true });
  await expect(historyHeading).toBeVisible({ timeout: 45_000 });
  const agentsResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/public/v1/agents");
  releaseAgents();
  expect((await agentsResponse).ok()).toBe(true);
  await expect(page.locator("#house-agents .ag-card")).toHaveCount(4);
  await expect.poll(() => historyHeading.evaluate((element) => {
    const top = element.getBoundingClientRect().top;
    return top >= 0 && top <= 200;
  }), { timeout: 45_000 }).toBe(true);
});

test("Markets preserves feed order instead of implying an alphabetical ranking when backtests are unavailable", async ({ page }) => {
  const markets = [marketFixture("NVDA", "NVIDIA", "1"), apple, marketFixture("AMD", "Advanced Micro Devices", "3")];
  await page.route("**/api/markets", (route) => route.fulfill({ json: { markets } }));
  await page.route("**/api/markets/*", (route) => route.fulfill({ json: snapshot }));
  await page.route("**/api/backtests/coverage?symbol=AAPL", (route) => route.fulfill({ json: coverage(true) }));
  await page.route("**/api/public/v1/house-backtests", (route) => route.abort());
  await page.goto("/market");

  await expect(page.locator(".mk-backtest-status")).toContainText("Published backtest history could not be loaded");
  const symbols = await page.locator(".mk-row").evaluateAll((items) => items.map((item) => item.querySelector(".mk-asset-text b")?.textContent?.trim().replace("Options", "") ?? ""));
  expect(symbols).toEqual(["NVDA", "AAPL", "AMD"]);
});

test("Markets preserves feed order and explains an empty completed backtest campaign", async ({ page }) => {
  const markets = [marketFixture("NVDA", "NVIDIA", "1"), apple, marketFixture("AMD", "Advanced Micro Devices", "3")];
  await page.route("**/api/markets", (route) => route.fulfill({ json: { markets } }));
  await page.route("**/api/markets/*", (route) => {
    const symbol = new URL(route.request().url()).pathname.split("/").at(-1) ?? "AAPL";
    return route.fulfill({ json: { ...snapshot, symbol } });
  });
  await page.route(/\/api\/backtests\/coverage\?symbol=/, (route) => {
    const symbol = new URL(route.request().url()).searchParams.get("symbol") ?? "AAPL";
    return route.fulfill({ json: { ...coverage(true), symbol } });
  });
  await page.route("**/api/public/v1/house-backtests", (route) => route.fulfill({ json: {
    campaignId: "optra-empty-campaign-test",
    asOf: "2026-11-26T00:00:00.000Z",
    status: "complete",
    runs: [],
  } }));
  await page.goto("/market");

  const rows = page.locator(".mk-row");
  await expect(rows).toHaveCount(3);
  await expect.poll(() => rows.first().textContent()).not.toContain("Loading verified history");
  const symbols = await rows.evaluateAll((items) => items.map((item) => item.querySelector(".mk-asset-text b")?.textContent?.trim().replace("Options", "") ?? ""));
  expect(symbols).toEqual(["NVDA", "AAPL", "AMD"]);
  await expect(page.locator(".mk-backtest-status")).toContainText("Published backtest history contains no runs; market feed order is shown.");
  await expect(rows.first()).toContainText("No published backtest runs");
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
