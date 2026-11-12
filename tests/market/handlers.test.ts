import { describe, expect, it } from "vitest";
import { createMarketHandlers } from "../../lib/market/handlers";
import { MarketFeedError } from "../../lib/market/robinhood-feed";

describe("market API handlers", () => {
  it("returns_supported_markets_without_a_session_or_cache", async () => {
    const handlers = createMarketHandlers({
      listMarkets: async () => [{ symbol: "AAPL", name: "Apple", currentMultiplier: "1" }],
      getSnapshot: async () => { throw new Error("not used"); },
    });

    const response = await handlers.list();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ markets: [{ symbol: "AAPL", name: "Apple", currentMultiplier: "1" }] });
  });

  it("returns_a_normalized_snapshot_for_a_supported_symbol", async () => {
    const snapshot = {
      symbol: "AAPL", source: "robinhood_stock_token_api", observedAt: "2026-11-12T03:30:00.000Z", receivedAt: "2026-11-12T03:31:00.000Z",
      underlyingBidUsd: "355.78", underlyingAskUsd: "356", currentMultiplier: "1.001", tokenBidUsd: "356.16", tokenAskUsd: "356.38",
      currency: "USD", stale: false, tradingHalt: false, pricingMethod: "recorded",
    } as const;
    const handlers = createMarketHandlers({ listMarkets: async () => [], getSnapshot: async () => snapshot });

    const response = await handlers.detail("aapl");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(snapshot);
  });

  it("maps_missing_and_upstream_failures_to_discriminated_errors", async () => {
    const missing = createMarketHandlers({
      listMarkets: async () => [],
      getSnapshot: async () => { throw new MarketFeedError("DATA_MISSING", "No quote is available.", false); },
    });
    const unavailable = createMarketHandlers({
      listMarkets: async () => { throw new MarketFeedError("UPSTREAM_UNAVAILABLE", "Try again later.", true); },
      getSnapshot: async () => { throw new Error("not used"); },
    });

    expect((await missing.detail("MSFT")).status).toBe(404);
    await expect((await missing.detail("MSFT")).json()).resolves.toMatchObject({ error: { code: "DATA_MISSING" } });
    expect((await unavailable.list()).status).toBe(503);
    await expect((await unavailable.list()).json()).resolves.toMatchObject({ error: { code: "UPSTREAM_UNAVAILABLE", retryable: true } });
  });
});
