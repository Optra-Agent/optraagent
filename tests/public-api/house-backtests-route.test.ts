import { describe, expect, it } from "vitest";
import { GET } from "../../app/api/public/v1/house-backtests/route";
import { PublicHouseBacktestCampaignResponseSchema } from "../../lib/domain/contracts";

describe("public House backtest campaign route", () => {
  it("serves the verified campaign with complete and no-entry outcomes", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const parsed = PublicHouseBacktestCampaignResponseSchema.safeParse(await response.json());
    expect(parsed.success, parsed.success ? undefined : JSON.stringify(parsed.error.issues)).toBe(true);
    if (!parsed.success) return;

    const { runs } = parsed.data;
    expect(runs).toHaveLength(32);
    expect(new Set(runs.map((run) => run.symbol))).toEqual(new Set(["AMD", "AMZN", "GOOGL", "META", "MSFT", "NVDA", "PLTR", "TSLA"]));
    expect(new Set(runs.map((run) => run.agentKey))).toHaveLength(4);
    expect(runs.filter((run) => run.status === "complete")).toHaveLength(18);
    const noEntry = runs.filter((run) => run.status === "failed");
    expect(noEntry).toHaveLength(14);
    expect(noEntry.every((run) => run.entryOrderCount === 0 && run.metrics === null && run.reason.includes("no modeled entry fills"))).toBe(true);
    expect(runs.every((run) => run.hourlyCoverageComplete && run.sampleCount === 720 && run.candleCount >= 1441)).toBe(true);
    expect(runs.some((run) => run.metrics && Number(run.metrics.totalReturnPct) < 0)).toBe(true);
    expect(runs.some((run) => run.metrics && Number(run.metrics.totalReturnPct) > 0)).toBe(true);
  });
});
