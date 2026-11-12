import { describe, expect, it } from "vitest";
import { createMarketHistoryCollector } from "../../lib/backtest/collector";
import { MarketFeedError } from "../../lib/market/robinhood-feed";
import type { MarketSnapshot } from "../../lib/domain/contracts";

const snapshot: MarketSnapshot = {
  symbol: "AAPL", source: "robinhood_stock_token_api", observedAt: "2026-11-12T03:30:00.000Z", receivedAt: "2026-11-12T03:31:00.000Z",
  underlyingBidUsd: "355.78", underlyingAskUsd: "356", currentMultiplier: "1.001", tokenBidUsd: "356.16", tokenAskUsd: "356.38",
  currency: "USD", stale: false, tradingHalt: false, pricingMethod: "recorded",
};

function harness(secret: string | undefined = "test-secret") {
  const calls: string[] = [];
  const saves: MarketSnapshot[] = [];
  const collector = createMarketHistoryCollector({
    secret,
    symbols: ["AAPL", "MSFT"],
    getSnapshot: async (symbol) => { calls.push(symbol); if (symbol === "MSFT") throw new MarketFeedError("DATA_MISSING", "missing", false); return { ...snapshot, symbol }; },
    storeSnapshot: async (value) => { saves.push(value); return true; },
  });
  return { collector, calls, saves };
}

describe("hourly market history collector", () => {
  it("rejects_missing_or_invalid_cron_secrets_before_fetching_data", async () => {
    const missing = harness("");
    const invalid = harness();
    const missingResponse = await missing.collector.collect(new Request("http://localhost", { method: "POST" }));
    const invalidResponse = await invalid.collector.collect(new Request("http://localhost", { method: "POST", headers: { authorization: "Bearer wrong" } }));

    expect(missingResponse.status).toBe(503);
    expect(invalidResponse.status).toBe(401);
    expect(missing.calls).toEqual([]);
    expect(invalid.calls).toEqual([]);
  });

  it("stores_verified_snapshots_and_reports_unavailable_symbols_without_fabricating_rows", async () => {
    const { collector, calls, saves } = harness();
    const response = await collector.collect(new Request("http://localhost", {
      method: "POST", headers: { authorization: "Bearer test-secret" },
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ requested: 2, stored: 1, alreadyRecorded: 0, unavailableSymbols: ["MSFT"] });
    expect(calls).toEqual(["AAPL", "MSFT"]);
    expect(saves).toEqual([snapshot]);
  });

  it("does_not_store_duplicate_hourly_samples", async () => {
    const collector = createMarketHistoryCollector({
      secret: "test-secret", symbols: ["AAPL"], getSnapshot: async () => snapshot, storeSnapshot: async () => false,
    });
    const response = await collector.collect(new Request("http://localhost", { method: "POST", headers: { authorization: "Bearer test-secret" } }));

    await expect(response.json()).resolves.toMatchObject({ stored: 0, alreadyRecorded: 1 });
  });
});
