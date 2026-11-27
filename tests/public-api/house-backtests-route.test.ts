import { describe, expect, it } from "vitest";
import { GET } from "../../app/api/public/v1/house-backtests/route";
import { PublicHouseBacktestCampaignResponseSchema } from "../../lib/domain/contracts";

describe("public House backtest campaign route", () => {
  it("serves published history across the 205-market registry", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const parsed = PublicHouseBacktestCampaignResponseSchema.safeParse(await response.json());
    expect(parsed.success, parsed.success ? undefined : JSON.stringify(parsed.error.issues)).toBe(true);
    if (!parsed.success) return;

    const { runs, marketCoverage } = parsed.data;
    expect(parsed.data.campaignId).toBe("optra-house-market-coverage-2026-11-27");
    expect(marketCoverage).toHaveLength(205);
    const qualified = marketCoverage.filter((market) => market.status === "qualified");
    expect(qualified).toHaveLength(28);
    expect(runs).toHaveLength(112);
    expect(new Set(runs.map((run) => run.agentKey)).size).toBe(4);
    const complete = runs.filter((run) => run.status === "complete");
    expect(complete).toHaveLength(53);
    expect(complete.every((run) => run.metrics !== null)).toBe(true);
    const noEntry = runs.filter((run) => run.status === "failed");
    expect(noEntry).toHaveLength(59);
    expect(noEntry.every((run) => run.entryOrderCount === 0 && run.exitOrderCount === 0 && run.metrics === null && run.reason.includes("no modeled entry fills"))).toBe(true);
    expect(runs.every((run) => run.sampleCount >= 168 && run.candleCount >= 889)).toBe(true);
    expect(runs.some((run) => run.metrics && Number(run.metrics.totalReturnPct) < 0)).toBe(true);
    expect(runs.some((run) => run.metrics && Number(run.metrics.totalReturnPct) > 0)).toBe(true);
  });
});
