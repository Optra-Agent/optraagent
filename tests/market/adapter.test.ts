import { describe, expect, it } from "vitest";
import { createRobinhoodMarketFeed, MarketFeedError, verifiedLogoUrl } from "../../lib/market/robinhood-feed";

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

describe("asset logos", () => {
  const address = "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9";
  const official = `https://cdn.robinhood.com/ncw_assets/logos/${address.toLowerCase()}.png`;
  const withDeployment = (logoUrl?: string) => ({ ...ASSET, ...(logoUrl ? { logoUrl } : {}), deployments: [{ chainId: 4663, networkName: "Robinhood Chain", contractAddress: address }] });
  const list = (asset: object, logos: "none" | "registry" = "registry") => createRobinhoodMarketFeed({ logos, fetcher: async () => Response.json({ assets: [asset] }) }).listMarkets();

  it("keeps_the_official_logo_that_matches_the_chain_4663_deployment", async () => {
    await expect(list(withDeployment(official))).resolves.toMatchObject([{ symbol: "AAPL", logoUrl: official }]);
    expect(verifiedLogoUrl(official, address)).toBe(official);
  });

  it("exposes_no_logo_by_default_because_the_registry_logo_is_one_generic_image", async () => {
    const [market] = await list(withDeployment(official), "none");
    expect(market).not.toHaveProperty("logoUrl");
    const [defaulted] = await createRobinhoodMarketFeed({ fetcher: async () => Response.json({ assets: [withDeployment(official)] }) }).listMarkets();
    expect(defaulted).not.toHaveProperty("logoUrl");
  });

  it("omits_the_logo_when_the_registry_has_none", async () => {
    const [market] = await list(withDeployment());
    expect(market).not.toHaveProperty("logoUrl");
  });

  it("drops_logos_with_the_wrong_host_scheme_address_or_extras", () => {
    for (const bad of [
      `http://cdn.robinhood.com/ncw_assets/logos/${address.toLowerCase()}.png`,
      `https://evil.example/ncw_assets/logos/${address.toLowerCase()}.png`,
      `https://cdn.robinhood.com.evil.example/ncw_assets/logos/${address.toLowerCase()}.png`,
      "https://cdn.robinhood.com/ncw_assets/logos/0x0000000000000000000000000000000000000001.png",
      "https://cdn.robinhood.com/ncw_assets/logos/aapl.png",
      `${official}?x=1`,
      `https://user:pw@cdn.robinhood.com/ncw_assets/logos/${address.toLowerCase()}.png`,
      "not a url",
      "javascript:alert(1)",
    ]) expect(verifiedLogoUrl(bad, address), bad).toBeUndefined();
    expect(verifiedLogoUrl(official, undefined)).toBeUndefined();
    expect(verifiedLogoUrl(undefined, address)).toBeUndefined();
  });

  it("lists_the_market_without_a_logo_when_the_registry_logo_is_untrusted", async () => {
    const [market] = await list(withDeployment("https://evil.example/logo.png"));
    expect(market?.symbol).toBe("AAPL");
    expect(market).not.toHaveProperty("logoUrl");
  });
});
