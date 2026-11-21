import { describe, expect, it, vi } from "vitest";
import { runBacktest } from "../../lib/backtest/run";
import { buildHouseRecipe } from "../../lib/hooks/house-specs";
import { buildProtectivePutRecipe } from "../../lib/hooks/catalog";
import { CAPTURE, earningsFor, historyAt } from "../integration/market-capture";

vi.setConfig({ testTimeout: 120_000 });

const NOW = new Date(CAPTURE.capturedAt);

async function backtest(symbol: string, recipe: ReturnType<typeof buildHouseRecipe>) {
  const history = await historyAt(symbol, NOW);
  expect(history.coverage.ready, history.coverage.reason).toBe(true);
  return runBacktest({ runId: `bt-${symbol}-${recipe.templateId}`, recipe, candles: history.candles, corporateActionDates: history.corporateActionDates, earnings: earningsFor(symbol), now: NOW.toISOString(), requestedCandles: history.coverage.requestedCandles });
}

describe("30-day backtests on captured Robinhood Chain candles", () => {
  it("Covered Call NVDA: replays 720 decisions, records modeled entries, and reports the loss and holding benchmark honestly", async () => {
    const run = await backtest("NVDA", buildHouseRecipe("covered_call", { underlyingSymbol: "NVDA", initialCapitalUsd: 2000, referenceShares: 100 }));
    expect(run).toMatchObject({ status: "complete", sampleCount: 720, hourlyCoverageComplete: true, premiumSource: "modeled", pricingMethod: "modeled" });
    expect(run.entryOrderCount).toBeGreaterThanOrEqual(1);
    expect(run.metrics?.benchmarks?.underlying).toMatchObject({ method: "hold_reference_shares_cash_idle", dividendsIncluded: false, feesIncluded: false });
    expect(run.metrics?.benchmarks?.cash).toMatchObject({ returnPct: "0", method: "flat_no_yield" });
    expect(run.metrics?.strategy?.entries).toBeGreaterThanOrEqual(1);
    const decisions = run.metrics!.strategy!.decisionCounts;
    expect(decisions.open + decisions.hold + decisions.close + decisions.skip).toBe(720);
    expect(Number(run.metrics!.strategy!.premiumCollectedUsd)).toBeGreaterThan(0);
    expect(run.pricingAssumptions).toMatchObject({ earningsIvPremiumModeled: false, venueFeesIncluded: false, venueOptionQuote: false });
    expect(run.historyProvenance).toMatchObject({ earnings: { source: "robinhood_marketdata_earnings", eventsHash: expect.stringMatching(/^sha256:/) } });
    expect(run.reason).toContain("shared strategy engine");
  });

  it("Cash-Secured Put TSLA: locks virtual collateral and records entries and exits", async () => {
    const run = await backtest("TSLA", buildHouseRecipe("cash_secured_put", { underlyingSymbol: "TSLA", initialCapitalUsd: 10_000 }));
    expect(run.status).toBe("complete");
    expect(run.entryOrderCount).toBeGreaterThanOrEqual(1);
    expect(run.metrics?.benchmarks?.underlying?.method).toBe("buy_and_hold_price_only");
    expect(Number(run.metrics!.maxDrawdownPct)).toBeGreaterThanOrEqual(0);
    expect(run.metrics!.strategy!.premiumPaidUsd).toBe("0");
  });

  it("Earnings Straddle NVDA: trades the confirmed 2026-11-17 report once and reports the result", async () => {
    const run = await backtest("NVDA", buildHouseRecipe("earnings_straddle", { underlyingSymbol: "NVDA", initialCapitalUsd: 10_000 }));
    expect(run.status).toBe("complete");
    expect(run.entryOrderCount).toBe(2);
    expect(run.metrics?.strategy).toMatchObject({ entries: 1 });
    expect(Number(run.metrics!.strategy!.premiumPaidUsd)).toBeGreaterThan(0);
    expect(run.metrics!.strategy!.premiumCollectedUsd).toBe("0");
  });

  it("does not manufacture trades: a strategy with no modeled entry in the window is failed and blocks launch", async () => {
    const run = await backtest("NVDA", buildHouseRecipe("cash_secured_put", { underlyingSymbol: "NVDA", initialCapitalUsd: 10_000 }));
    expect(run.status).toBe("failed");
    expect(run.metrics).toBeNull();
    expect(run.premiumSource).toBe("unavailable");
    expect(run.reason).toContain("no modeled entry fills");
  });

  it("a straddle underlying with no report in the window is failed, not padded", async () => {
    const run = await backtest("TSLA", buildHouseRecipe("earnings_straddle", { underlyingSymbol: "TSLA", initialCapitalUsd: 10_000 }));
    expect(run.status).toBe("failed");
    expect(run.entryOrderCount).toBe(0);
  });

  it("is deterministic: the same candles, earnings and recipe produce the same run", async () => {
    const recipe = buildHouseRecipe("earnings_straddle", { underlyingSymbol: "NVDA", initialCapitalUsd: 10_000 });
    const first = await backtest("NVDA", recipe);
    const second = await backtest("NVDA", recipe);
    expect(second).toEqual(first);
  });

  it("without an earnings calendar the straddle cannot trade and Covered Call blocks on DATA_MISSING", async () => {
    const history = await historyAt("NVDA", NOW);
    const straddle = runBacktest({ runId: "bt-no-earnings", recipe: buildHouseRecipe("earnings_straddle", { underlyingSymbol: "NVDA" }), candles: history.candles, corporateActionDates: history.corporateActionDates, earnings: null, now: NOW.toISOString() });
    expect(straddle.status).toBe("failed");
    const covered = runBacktest({ runId: "bt-no-earnings-cc", recipe: buildHouseRecipe("covered_call", { underlyingSymbol: "NVDA" }), candles: history.candles, corporateActionDates: history.corporateActionDates, earnings: null, now: NOW.toISOString() });
    expect(covered.status).toBe("failed");
    expect(covered.historyProvenance).toMatchObject({ earnings: { source: "unavailable" } });
  });

  it("Protective Put keeps its existing backtest path", async () => {
    const history = await historyAt("NVDA", NOW);
    const run = runBacktest({ runId: "bt-pp", recipe: buildProtectivePutRecipe({ underlyingSymbol: "NVDA", protectedShares: "100", initialCapitalUsd: "100000" }), candles: history.candles, corporateActionDates: history.corporateActionDates, now: NOW.toISOString() });
    expect(run.status).toBe("complete");
    expect(run.metrics?.benchmarks?.underlying?.method).toBe("buy_and_hold_price_only");
    expect(run.metrics?.strategy).toBeUndefined();
  });
});
