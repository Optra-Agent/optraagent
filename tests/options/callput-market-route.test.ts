import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../../app/api/venue/callput/market/route";

const feed = {
  timestamp: 1_795_162_747_470, lastUpdatedAt: "2026-11-20T08:00:00.000Z",
  data: {
    pvSource: { chainId: 4663, version: 1 },
    spotIndices: { AAPL: 350.98, SPY: 600 },
    market: {
      AAPL: { expiries: [1795798800], options: { "1795798800": { put: [
        { optionId: `0x${"11".repeat(32)}`, instrument: "AAPL-A", isOptionAvailable: true, expiry: 1795798800, strikePrice: 340, markPrice: 1.6, markIv: 0.3, riskPremiumRateForBuy: 0.2, riskPremiumRateForSell: 0.2, delta: 0, gamma: 0, vega: 0, theta: 0 },
        { optionId: `0x${"22".repeat(32)}`, instrument: "AAPL-B", isOptionAvailable: false, expiry: 1795798800, strikePrice: 335, markPrice: 0.9, markIv: 0.3, riskPremiumRateForBuy: 0.2, riskPremiumRateForSell: 0.2, delta: 0, gamma: 0, vega: 0, theta: 0 },
      ] } } },
      SPY: { expiries: [], options: {} },
    },
  },
};

describe("GET /api/venue/callput/market", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rejects unknown underlyings without calling the venue", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const response = await GET(new Request("http://localhost/api/venue/callput/market?underlying=DOGE"));
    expect(response.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns only available legs for the requested underlying with a short cache", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(feed), { status: 200 })));
    const response = await GET(new Request("http://localhost/api/venue/callput/market?underlying=aapl"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("s-maxage=15");
    const body = await response.json() as { options: Array<{ instrument: string; quoteType: string }>; spotIndexRaw: Record<string, number>; chainId: number };
    expect(body.chainId).toBe(4663);
    expect(body.options.map((option) => option.instrument)).toEqual(["AAPL-A"]);
    expect(body.options[0].quoteType).toBe("indicative");
    expect(body.spotIndexRaw).toEqual({ AAPL: 350.98 });
  });

  it("fails closed with no quote when the feed is down or tagged for another chain", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 503 })));
    expect((await GET(new Request("http://localhost/api/venue/callput/market?underlying=AAPL"))).status).toBe(502);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ...feed, data: { ...feed.data, pvSource: { chainId: 1 } } }), { status: 200 })));
    expect((await GET(new Request("http://localhost/api/venue/callput/market?underlying=AAPL"))).status).toBe(502);
  });
});
