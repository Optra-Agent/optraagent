import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { buildProtectivePutRecipe } from "../../lib/hooks/catalog";
import { createCriusHistoryFeed } from "../../lib/market/crius-history";
import { inspectCandleCoverage, REQUIRED_HISTORY_CANDLES, REQUIRED_HOURLY_SAMPLES, runBacktest } from "../../lib/backtest/run";

const capture = JSON.parse(await readFile(new URL("../fixtures/aapl-crius-hourly-capture.json", import.meta.url), "utf8")) as {
  capturedAt: string;
  asset: Record<string, unknown>;
  candles: unknown;
  corpActions: unknown[];
};

async function capturedHistory() {
  return createCriusHistoryFeed({
    fetcher: (async (input: string | URL | Request) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      if (url.pathname === "/rhj/corporate-actions") return Response.json({ corpActions: capture.corpActions });
      return Response.json(url.pathname.endsWith("/candles") ? capture.candles : { assets: [capture.asset] });
    }) as typeof fetch,
    now: () => new Date(capture.capturedAt),
    listMarkets: async () => [{ symbol: "AAPL", currentMultiplier: String(capture.asset.currentMultiplier), tokenAddress: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9" }],
  }).getHistory("AAPL");
}

describe("historical paper backtest", () => {
  it("reports provider candle coverage without counting a candle twice", async () => {
    const history = await capturedHistory();
    const coverage = inspectCandleCoverage({ symbol: "AAPL", candles: history.candles, now: capture.capturedAt });

    expect(coverage.availableSamples).toBe(history.candles.length);
    expect(coverage.availableSamples).toBe(1499);
    expect(coverage.requiredSamples).toBe(REQUIRED_HISTORY_CANDLES);
    expect(coverage.startAt).toBe(history.candles.at(-REQUIRED_HISTORY_CANDLES)?.startAt);
    expect(coverage.endAt).toBe(history.candles.at(-1)?.endAt);
  });

  it("requires warmup plus 720 actual hourly decision candles", async () => {
    const history = await capturedHistory();
    const recipe = buildProtectivePutRecipe({ underlyingSymbol: "AAPL", protectedShares: "10", initialCapitalUsd: "100000" });
    const run = runBacktest({ runId: "test-insufficient", recipe, candles: history.candles.slice(0, REQUIRED_HISTORY_CANDLES - 1), corporateActionDates: history.corporateActionDates, now: capture.capturedAt });

    expect(REQUIRED_HOURLY_SAMPLES).toBe(720);
    expect(run.status).toBe("insufficient_data");
    expect(run.sampleCount).toBe(0);
    expect(run.metrics).toBeNull();
    expect(run.hourlyCoverageComplete).toBe(false);
    expect(run.premiumSource).toBe("unavailable");
    expect(run.reason).toContain("1441");
  });

  it("blocks a history window whose multiplier continuity is unverified", async () => {
    const history = await capturedHistory();
    const recipe = buildProtectivePutRecipe({ underlyingSymbol: "AAPL", protectedShares: "10", initialCapitalUsd: "100000" });
    const actionWindow = history.candles.map((candle) => ({ ...candle, multiplierStatus: "action_in_window" as const }));
    const run = runBacktest({ runId: "test-action", recipe, candles: actionWindow, corporateActionDates: history.corporateActionDates, now: capture.capturedAt });

    expect(run.status).toBe("insufficient_data");
    expect(run.metrics).toBeNull();
    expect(run.reason).toContain("multiplier action");
  });

  it("replays real provider history through the same rule engine and computes paper-only metrics", async () => {
    const history = await capturedHistory();
    const recipe = buildProtectivePutRecipe({ underlyingSymbol: "AAPL", protectedShares: "10", initialCapitalUsd: "100000" });
    const run = runBacktest({
      runId: "test-complete",
      recipe,
      candles: history.candles,
      corporateActionDates: history.corporateActionDates,
      requestedCandles: history.coverage.requestedCandles,
      now: capture.capturedAt,
    });

    expect(run).toMatchObject({
      status: "complete",
      sampleCount: 720,
      entryOrderCount: expect.any(Number),
      premiumSource: "modeled",
      pricingMethod: "modeled",
      hourlyCoverageComplete: true,
    });
    expect(run.entryOrderCount).toBeGreaterThan(0);
    expect(run.metrics).toEqual({ totalReturnPct: expect.any(String), maxDrawdownPct: expect.any(String), endingCashUsd: expect.any(String) });
    expect(run.historyDataHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(run.historyProvenance).toMatchObject({ provider: "Crius Robinhood Chain OHLCV", fill: false, multiplierStatus: "stable_verified" });
    expect(run.pricingAssumptions).toMatchObject({ model: "black_scholes_european_put", venueOptionQuote: false, venueFeesIncluded: false });
  }, 20_000);

  it("withholds metrics and launch proof when actual history produces no entry", async () => {
    const history = await capturedHistory();
    const recipe = buildProtectivePutRecipe({ underlyingSymbol: "AAPL", protectedShares: "0.1", initialCapitalUsd: "100000" });
    const run = runBacktest({
      runId: "test-no-entry",
      recipe,
      candles: history.candles,
      corporateActionDates: history.corporateActionDates,
      requestedCandles: history.coverage.requestedCandles,
      now: capture.capturedAt,
    });

    expect(run.status).toBe("failed");
    expect(run.entryOrderCount).toBe(0);
    expect(run.metrics).toBeNull();
    expect(run.reason).toContain("no modeled entry fills");
  }, 20_000);
});
