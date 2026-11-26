import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const agentId = "123e4567-e89b-42d3-a456-426614174000";
const hash = `sha256:${"a".repeat(64)}`;
const recipe = { version: 1, name: "Protective Put AAPL", templateId: "protective_put", underlyingSymbol: "AAPL", hookIds: [], parameters: {} };
const agent = { id: agentId, ownerId: "owner-1", name: "Protective Put AAPL", templateId: "protective_put", status: "draft", recipeHash: hash, backtestRunId: null, createdAt: "2026-11-12T03:00:00.000Z", updatedAt: "2026-11-12T03:00:00.000Z" };

const benchmarks = {
  window: { startAt: "2026-10-12T09:00:00.000Z", endAt: "2026-11-11T08:00:00.000Z", decisionSamples: 720 },
  underlying: { symbol: "AAPL", startingValueUsd: "100000.00", endingValueUsd: "104200.00", returnPct: "4.20", method: "buy_and_hold_price_only", dividendsIncluded: false, feesIncluded: false },
  cash: { startingValueUsd: "100000.00", endingValueUsd: "100000.00", returnPct: "0.00", denomination: "USD", method: "flat_no_yield", usdGPricePath: "not_modeled" },
  vsHoldingPct: "-4.95",
  vsCashPct: "-0.75",
};
const run = (metrics: object) => ({
  id: "run-1", recipeHash: hash, dataSource: "crius_robinhood_chain_candles", startAt: "2026-10-12T09:00:00.000Z", endAt: "2026-11-11T08:00:00.000Z",
  sampleCount: 720, entryOrderCount: 2, exitOrderCount: 1, hourlyCoverageComplete: true, premiumSource: "modeled", pricingMethod: "modeled", status: "complete",
  metrics, reason: "Replayed 720 decisions.", createdAt: "2026-11-12T04:00:00.000Z",
});

async function setup(page: Page, metrics: object) {
  await page.route("**/api/me", (route) => route.fulfill({ json: { user: { id: "owner-1", address: "0xfcad0b19bb29d4674531d6f115237e16afce377c" }, expiresAt: "2026-11-19T03:31:00.000Z" } }));
  await page.route("**/api/markets", (route) => route.fulfill({ json: { markets: [{ symbol: "AAPL", name: "Apple", currentMultiplier: "1.001" }] } }));
  await page.route("**/api/backtests/coverage?symbol=AAPL", (route) => route.fulfill({ json: { symbol: "AAPL", availableSamples: 1441, requiredSamples: 1441, startAt: "2026-09-12T08:00:00.000Z", endAt: "2026-11-11T08:00:00.000Z", consecutiveHours: 1441, ready: true, dataSource: "crius_robinhood_chain_candles", multiplierStatus: "stable_verified", fillApplied: false, reason: "Coverage ready." } }));
  await page.route("**/api/agents", (route) => route.fulfill({ json: { agents: [agent] } }));
  await page.route(`**/api/agents/${agentId}`, (route) => route.fulfill({ json: { ...agent, recipe } }));
  await page.route("**/api/backtests", (route) => (route.request().method() === "POST" ? route.fulfill({ json: run(metrics) }) : route.fallback()));
}

test("Lab shows the server's same-window benchmarks next to the strategy result", async ({ page }) => {
  const selectWarnings: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "warning" && message.text().includes("Select is changing from uncontrolled to controlled")) {
      selectWarnings.push(message.text());
    }
  });
  await setup(page, { totalReturnPct: "-0.75", maxDrawdownPct: "1.80", endingCashUsd: "99250.00", benchmarks });
  await page.goto(`/lab?agent=${agentId}`);
  const history = page.getByRole("region", { name: "Historical House Agent backtests" });
  const amznNoEntry = history.getByRole("row", { name: /Cash-Secured Put.*AMZN/ }).filter({ hasText: "No modeled entry" });
  await expect(amznNoEntry.first()).toContainText("No modeled entry");
  await page.getByRole("button", { name: "Run paper backtest" }).click();

  const bench = page.getByRole("region", { name: "Benchmark comparison" });
  await expect(bench.getByText("Compared with the same window")).toBeVisible();
  await expect(bench.getByRole("img", { name: "Protective Put (modeled): -0.75%" })).toBeVisible();
  await expect(bench.getByRole("img", { name: "Buy and hold AAPL: +4.20%" })).toBeVisible();
  await expect(bench.getByRole("img", { name: "Flat USD cash: 0.00%" })).toBeVisible();
  await expect(bench.getByText("-4.95 pp")).toBeVisible();
  await expect(bench.getByText("-0.75 pp")).toBeVisible();
  await expect(bench.getByText(/not a measured USDG return/)).toBeVisible();
  await expect(bench.getByText(/price only/i).first()).toBeVisible();
  expect(selectWarnings).toEqual([]);
});

test("Lab says the comparison is unavailable for an older run without benchmarks", async ({ page }) => {
  await setup(page, { totalReturnPct: "1.25", maxDrawdownPct: "0.90", endingCashUsd: "101250.00" });
  await page.goto(`/lab?agent=${agentId}`);
  await page.getByRole("button", { name: "Run paper backtest" }).click();

  const bench = page.getByRole("region", { name: "Benchmark comparison" });
  await expect(bench.getByText("Benchmark comparison unavailable")).toBeVisible();
  await expect(bench.getByText(/saved before benchmarks were recorded/)).toBeVisible();
  await expect(page.getByText("Compared with the same window")).toHaveCount(0);
  await expect(page.getByText("Total return")).toBeVisible();
});
