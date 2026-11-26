import { describe, expect, it } from "vitest";
import { GET } from "../../app/api/public/v1/house-backtests/route";
import { PublicHouseBacktestCampaignResponseSchema } from "../../lib/domain/contracts";

describe("public House backtest campaign route", () => {
  it("serves published history and the 15 qualified markets without the 205-market scan", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const parsed = PublicHouseBacktestCampaignResponseSchema.safeParse(await response.json());
    expect(parsed.success, parsed.success ? undefined : JSON.stringify(parsed.error.issues)).toBe(true);
    if (!parsed.success) return;

    const { runs } = parsed.data;
    expect(parsed.data.campaignId).toBe("optra-house-market-coverage-2026-11-26");
    expect(runs).toHaveLength(92);
    expect("marketCoverage" in parsed.data).toBe(false);
    const qualifiedSymbols = ["AMC", "AMD", "AMZN", "GLD", "GME", "GOOGL", "META", "MSFT", "MSTR", "NVDA", "PLTR", "QQQ", "SPCX", "TSLA", "TTWO"];
    expect([...new Set(runs.map((run) => run.symbol))].sort()).toEqual(qualifiedSymbols.sort());
    expect(new Set(runs.map((run) => run.agentKey)).size).toBe(4);
    expect(new Set(runs.map((run) => run.campaignId))).toEqual(new Set(["optra-house-history-2026-11-24", "optra-house-market-coverage-2026-11-26"]));
    const complete = runs.filter((run) => run.status === "complete");
    expect(complete).toHaveLength(51);
    expect(complete.every((run) => run.metrics !== null && run.hourlyCoverageComplete)).toBe(true);
    const noEntry = runs.filter((run) => run.status === "failed");
    expect(noEntry).toHaveLength(41);
    expect(noEntry.every((run) => run.entryOrderCount === 0 && run.exitOrderCount === 0 && run.metrics === null && run.reason.includes("no modeled entry fills"))).toBe(true);
    expect(runs.every((run) => run.hourlyCoverageComplete && run.sampleCount === 720 && run.candleCount >= 1441)).toBe(true);
    expect(runs.some((run) => run.metrics && Number(run.metrics.totalReturnPct) < 0)).toBe(true);
    expect(runs.some((run) => run.metrics && Number(run.metrics.totalReturnPct) > 0)).toBe(true);
    const verifiedCounts = Object.fromEntries(qualifiedSymbols.map((symbol) => [symbol, complete.filter((run) => run.symbol === symbol).length]));
    expect(verifiedCounts).toEqual({ AMC: 4, AMD: 4, AMZN: 6, GLD: 0, GME: 3, GOOGL: 4, META: 2, MSFT: 4, MSTR: 3, NVDA: 6, PLTR: 6, QQQ: 0, SPCX: 2, TSLA: 3, TTWO: 4 });
  });
});
