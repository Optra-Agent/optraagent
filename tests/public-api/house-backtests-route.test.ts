import { describe, expect, it } from "vitest";
import { GET } from "../../app/api/public/v1/house-backtests/route";
import { PublicHouseBacktestCampaignResponseSchema } from "../../lib/domain/contracts";
import { MARKET_PRIORITY_SYMBOLS } from "../../lib/market/market-priority";

describe("public House backtest campaign route", () => {
  it("serves the verified campaign with complete and no-entry outcomes", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const parsed = PublicHouseBacktestCampaignResponseSchema.safeParse(await response.json());
    expect(parsed.success, parsed.success ? undefined : JSON.stringify(parsed.error.issues)).toBe(true);
    if (!parsed.success) return;

    const { runs, marketCoverage } = parsed.data;
    expect(runs.length).toBeGreaterThanOrEqual(32);
    const verifiedRuns = runs.filter((run) => run.campaignId === "optra-house-history-2026-11-24");
    expect(verifiedRuns).toHaveLength(32);
    expect(new Set(verifiedRuns.map((run) => run.symbol))).toEqual(new Set(MARKET_PRIORITY_SYMBOLS));
    expect(new Set(verifiedRuns.map((run) => run.agentKey))).toHaveLength(4);
    expect(verifiedRuns.filter((run) => run.status === "complete")).toHaveLength(18);
    const noEntry = verifiedRuns.filter((run) => run.status === "failed");
    expect(noEntry).toHaveLength(14);
    expect(noEntry.every((run) => run.entryOrderCount === 0 && run.metrics === null && run.reason.includes("no modeled entry fills"))).toBe(true);
    expect(verifiedRuns.every((run) => run.hourlyCoverageComplete && run.sampleCount === 720 && run.candleCount >= 1441)).toBe(true);
    expect(verifiedRuns.some((run) => run.metrics && Number(run.metrics.totalReturnPct) < 0)).toBe(true);
    expect(verifiedRuns.some((run) => run.metrics && Number(run.metrics.totalReturnPct) > 0)).toBe(true);

    const expandedRuns = runs.filter((run) => run.campaignId === "optra-house-market-coverage-2026-11-26");
    expect(expandedRuns).toHaveLength(60);
    expect(new Set(expandedRuns.map((run) => run.symbol)).size).toBe(15);
    expect(expandedRuns.filter((run) => run.status === "complete")).toHaveLength(33);
    expect(expandedRuns.filter((run) => run.status === "failed")).toHaveLength(27);
    expect(expandedRuns.every((run) => run.hourlyCoverageComplete && run.sampleCount === 720 && run.candleCount >= 1_441)).toBe(true);

    expect(marketCoverage).toHaveLength(205);
    expect(marketCoverage.slice(0, 8).map((market) => market.symbol)).toEqual([...MARKET_PRIORITY_SYMBOLS]);
    expect(new Set(marketCoverage.map((market) => market.symbol)).size).toBe(205);
    expect(marketCoverage.every((market) => Object.keys(market.strategies).sort().join(",") === "cash_secured_put,covered_call,earnings_straddle,protective_put")).toBe(true);
    expect(marketCoverage.filter((market) => market.status === "qualified")).toHaveLength(15);
    expect(marketCoverage.filter((market) => market.status === "corporate_action")).toHaveLength(17);
    expect(marketCoverage.filter((market) => market.status === "insufficient_data")).toHaveLength(173);
    expect(marketCoverage.find((market) => market.symbol === "NVDA")).toMatchObject({ status: "qualified", coverage: { ready: true }, strategies: { protective_put: { status: "complete" } } });
    expect(marketCoverage.reduce((count, market) => count + Object.values(market.strategies).filter((outcome) => outcome.status === "complete").length, 0)).toBe(33);
    expect(marketCoverage.reduce((count, market) => count + Object.values(market.strategies).filter((outcome) => outcome.status === "no_entry").length, 0)).toBe(27);
    expect(marketCoverage.reduce((count, market) => count + Object.values(market.strategies).filter((outcome) => outcome.status === "insufficient_data").length, 0)).toBe(760);
  });
});
