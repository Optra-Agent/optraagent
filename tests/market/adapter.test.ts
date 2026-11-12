import { describe, expect, it } from "vitest";
import { createRobinhoodMarketFeed, MarketFeedError } from "../../lib/market/robinhood-feed";

const ASSET = {
  tokenSymbol: "AAPL",
  tokenName: "Apple • Robinhood Token",
  status: "ASSET_STATUS_ACTIVE",
  currentMultiplier: "1.001092264102650688",
  deployments: [{ chainId: 4663, networkName: "Robinhood Chain" }],
};

const QUOTE = {
  tokenSymbol: "AAPL",
  bid: "355.78",
  ask: "356",
  currency: "USD",
  isTradingHalt: false,
  generatedAt: "2026-11-12T03:30:00.000Z",
  tokenBid: "356.168019703945977455",
  tokenAsk: "356.388259639678362960",
  deployments: [{ chainId: 4663 }],
};

function feedFor(asset = ASSET, quote = QUOTE, now = "2026-11-12T03:31:00.000Z") {
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    const payload = url.endsWith("/rhj/assets") ? { assets: [asset] } : { quotes: [quote] };
    return Response.json(payload);
  };
  return createRobinhoodMarketFeed({ fetcher, now: () => new Date(now) });
}

describe("Robinhood market feed", () => {
  it("normalizes_official_quote_and_multiplier_without_recomputing_token_prices", async () => {
    const feed = feedFor();

    await expect(feed.getSnapshot("AAPL")).resolves.toEqual({
      symbol: "AAPL",
      source: "robinhood_stock_token_api",
      observedAt: "2026-11-12T03:30:00.000Z",
      receivedAt: "2026-11-12T03:31:00.000Z",
      underlyingBidUsd: "355.78",
      underlyingAskUsd: "356",
      currentMultiplier: "1.001092264102650688",
      tokenBidUsd: "356.168019703945977455",
      tokenAskUsd: "356.388259639678362960",
      currency: "USD",
      stale: false,
      tradingHalt: false,
      pricingMethod: "recorded",
    });
  });

  it("marks_stale_quotes_as_unusable_for_entry", async () => {
    const feed = feedFor(ASSET, { ...QUOTE, generatedAt: "2026-11-12T03:20:00.000Z" });

    await expect(feed.getSnapshot("AAPL")).resolves.toMatchObject({ stale: true });
  });

  it("rejects_zero_or_invalid_quotes", async () => {
    const zeroPrice = feedFor(ASSET, { ...QUOTE, bid: "0" });
    const crossedMarket = feedFor(ASSET, { ...QUOTE, ask: "355.77" });

    await expect(zeroPrice.getSnapshot("AAPL")).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
    await expect(crossedMarket.getSnapshot("AAPL")).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
  });

  it("rejects_symbols_not_in_the_active_robinhood_chain_registry", async () => {
    const feed = feedFor({ ...ASSET, tokenSymbol: "MSFT" });

    await expect(feed.getSnapshot("AAPL")).rejects.toMatchObject({ code: "DATA_MISSING" });
  });

  it("lists_only_active_assets_deployed_on_robinhood_chain", async () => {
    const feed = createRobinhoodMarketFeed({
      fetcher: async () => Response.json({ assets: [
        ASSET,
        { ...ASSET, tokenSymbol: "HALT", status: "ASSET_STATUS_INACTIVE" },
        { ...ASSET, tokenSymbol: "OTHER", deployments: [{ chainId: 1 }] },
      ] }),
      now: () => new Date("2026-11-12T03:31:00.000Z"),
    });

    await expect(feed.listMarkets()).resolves.toEqual([{ symbol: "AAPL", name: "Apple • Robinhood Token", currentMultiplier: ASSET.currentMultiplier }]);
  });

  it("turns_http_and_timeout_failures_into_retryable_feed_errors", async () => {
    const feed = createRobinhoodMarketFeed({ fetcher: async () => new Response(null, { status: 503 }) });

    await expect(feed.listMarkets()).rejects.toBeInstanceOf(MarketFeedError);
    await expect(feed.listMarkets()).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE", retryable: true });
  });
});
