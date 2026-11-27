import { describe, expect, it } from "vitest";
import { GET } from "../../app/api/public/v1/house-backtests/route";
import { PublicHouseBacktestCampaignResponseSchema } from "../../lib/domain/contracts";

describe("public House backtest campaign route", () => {
  it("serves published verified and simulated coverage across all 205 markets", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const parsed = PublicHouseBacktestCampaignResponseSchema.safeParse(await response.json());
    expect(parsed.success, parsed.success ? undefined : JSON.stringify(parsed.error.issues)).toBe(true);
    if (!parsed.success) return;

    const { runs, marketCoverage } = parsed.data;
    expect(parsed.data.campaignId).toBe("optra-house-market-coverage-2026-11-28-v3");
    expect(marketCoverage).toHaveLength(205);
    const qualified = marketCoverage.filter((market) => market.status === "qualified");
    const simulated = marketCoverage.filter((market) => market.status === "simulated");
    expect(qualified).toHaveLength(28);
    expect(simulated).toHaveLength(177);
    expect(runs).toHaveLength(820);

    const verifiedRuns = runs.filter((run) => run.dataSource === "crius_robinhood_chain_candles");
    const simulatedRuns = runs.filter((run) => run.dataSource === "synthetic_deterministic_scenario");
    expect(verifiedRuns).toHaveLength(112);
    expect(simulatedRuns).toHaveLength(708);
    expect(simulatedRuns.every((run) => run.hourlyCoverageComplete === false)).toBe(true);
    expect(verifiedRuns.filter((run) => run.status === "complete")).toHaveLength(53);
    expect(verifiedRuns.filter((run) => run.status === "failed")).toHaveLength(59);
  });
});
