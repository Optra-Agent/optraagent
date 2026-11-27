// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HouseBacktestResults } from "../../components/app/HouseBacktestResults";
import { PublicHouseBacktestCampaignResponseSchema } from "../../lib/domain/contracts";

const CAMPAIGN_ID = "123e4567-e89b-42d3-a456-426614174010";
const RECIPE_HASH = `sha256:${"3e".repeat(32)}`;
const HISTORY_HASH = `sha256:${"9f".repeat(32)}`;
const SNAPSHOT_HASH = `sha256:${"8a".repeat(32)}`;
const EARNINGS_HASH = `sha256:${"6b".repeat(32)}`;

const completeRun = {
  id: "123e4567-e89b-42d3-a456-426614174000",
  campaignId: CAMPAIGN_ID,
  symbol: "AMD",
  agentKey: "optra-covered-call",
  agentLabel: "Covered Call",
  templateId: "covered_call",
  recipeHash: RECIPE_HASH,
  dataSource: "crius_robinhood_chain_candles",
  status: "complete",
  sampleCount: 720,
  entryOrderCount: 1,
  exitOrderCount: 1,
  hourlyCoverageComplete: true,
  premiumSource: "modeled",
  pricingMethod: "modeled",
  startAt: "2026-09-23T06:00:00.000Z",
  endAt: "2026-11-24T17:00:00.000Z",
  historyDataHash: HISTORY_HASH,
  candleSnapshotHash: SNAPSHOT_HASH,
  candleCount: 1499,
  requestedCandles: 1500,
  earningsAvailable: true,
  earningsEventCount: 3,
  earningsEventsHash: EARNINGS_HASH,
  earningsFetchedAt: "2026-11-24T18:44:18.191Z",
  metrics: { totalReturnPct: "-25.901445", maxDrawdownPct: "32.960388", endingCashUsd: "-179.540456" },
  reason: "Replayed 720 provider candles with modeled premiums and 50 bp slippage.",
  createdAt: "2026-11-24T18:48:46.674Z",
};

const noEntryRun = {
  ...completeRun,
  id: "123e4567-e89b-42d3-a456-426614174001",
  symbol: "AMZN",
  agentKey: "optra-cash-secured-put",
  agentLabel: "Cash-Secured Put",
  templateId: "cash_secured_put",
  status: "failed",
  entryOrderCount: 0,
  exitOrderCount: 0,
  premiumSource: "unavailable",
  pricingMethod: "unavailable",
  metrics: null,
  reason: "The complete historical window produced no modeled entry fills; no performance metrics are reported and launch remains blocked.",
};

const marketCoverage = ["AAPL", "NVDA"].map((symbol) => {
  const ready = symbol === "NVDA";
  const outcome = ready
    ? { status: "complete", runId: `run-${symbol}`, campaignId: CAMPAIGN_ID, reason: "Backtest completed with modeled entries." }
    : { status: "insufficient_data", runId: null, campaignId: null, reason: "Only 180 consecutive verified candles are available." };
  return {
    symbol,
    name: symbol === "NVDA" ? "NVIDIA" : "Apple",
    registryTokenAddress: "0x1111111111111111111111111111111111111111",
    currentMultiplier: "1.00109",
    status: ready ? "qualified" : "insufficient_data",
    coverage: {
      symbol, availableSamples: ready ? 1499 : 180, requiredSamples: 1441,
      startAt: "2026-09-23T06:00:00.000Z", endAt: "2026-11-24T17:00:00.000Z",
      consecutiveHours: ready ? 1499 : 180, ready,
      dataSource: "crius_robinhood_chain_candles", tokenAddress: "0x1111111111111111111111111111111111111111",
      multiplierStatus: "stable_verified", fillApplied: false,
      reason: ready ? "1499 verified hourly candles are available." : "Only 180 consecutive verified candles are available.",
    },
    historyDataHash: ready ? HISTORY_HASH : null,
    candleSnapshotHash: ready ? SNAPSHOT_HASH : null,
    corporateActionCount: 0,
    corporateActionDatesHash: EARNINGS_HASH,
    reason: ready ? "History is qualified for 720 decisions." : "Only 180 consecutive verified candles are available.",
    strategies: {
      protective_put: outcome,
      covered_call: outcome,
      cash_secured_put: outcome,
      earnings_straddle: outcome,
    },
  };
});

function serve(body: unknown, status = 200) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));
}

describe("HouseBacktestResults", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("shows signed modeled results and leaves no-entry performance blank", async () => {
    const responseBody = { campaignId: CAMPAIGN_ID, asOf: "2026-11-24T18:48:46.674Z", status: "complete", runs: [completeRun, noEntryRun] };
    const parsed = PublicHouseBacktestCampaignResponseSchema.safeParse(responseBody);
    expect(parsed.success, parsed.success ? undefined : JSON.stringify(parsed.error.issues)).toBe(true);
    serve(responseBody);
    render(createElement(HouseBacktestResults));

    const region = await screen.findByRole("region", { name: "Historical House Agent backtests" });
    const negative = within(region).getByRole("row", { name: /Covered Call.*AMD/ });
    expect(negative.textContent).toMatch(/-25\.90%|−25\.90%/);
    expect(negative.textContent).toMatch(/32\.96%/);
    expect(negative.textContent).toMatch(/1499/);

    const noEntry = within(region).getByRole("row", { name: /Cash-Secured Put.*AMZN/ });
    expect(noEntry.textContent).toMatch(/No modeled entry/);
    expect(noEntry.textContent).toMatch(/No performance metrics/);
    expect(noEntry.textContent).not.toMatch(/0\.00%/);
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe("/api/public/v1/house-backtests");
  });

  it("shows the market-by-strategy matrix in shared priority order", async () => {
    serve({ campaignId: CAMPAIGN_ID, asOf: "2026-11-24T18:48:46.674Z", status: "complete", runs: [completeRun], marketCoverage });
    render(createElement(HouseBacktestResults));

    const matrix = await screen.findByRole("region", { name: "Market-by-strategy coverage" });
    const rows = within(matrix).getAllByRole("row");
    expect(rows[1]?.textContent).toContain("NVDA");
    expect(rows[1]?.textContent).toContain("Verified Historical");
    expect(rows[1]?.textContent).toContain("0x1111…1111");
    expect(rows[1]?.textContent).toContain("Backtested");
    expect(rows[2]?.textContent).toContain("AAPL");
    expect(rows[2]?.textContent).toContain("Limited hourly history");
    expect(rows[2]?.textContent).toContain("Incomplete history");
  });

  it("shows an empty state until a complete campaign is available", async () => {
    serve({ campaignId: "optra-house-history-pending", asOf: "2026-11-24T18:48:46.674Z", status: "pending", runs: [] });
    render(createElement(HouseBacktestResults));

    expect(await screen.findByText("No published House backtest campaign")).toBeTruthy();
  });

  it("shows an error state when the public campaign route is unavailable", async () => {
    serve({ error: { code: "INTERNAL_ERROR", message: "Unable to load the campaign.", retryable: true } }, 503);
    render(createElement(HouseBacktestResults));

    expect((await screen.findByRole("alert")).textContent).toContain("Historical House backtests could not be loaded");
  });
});
