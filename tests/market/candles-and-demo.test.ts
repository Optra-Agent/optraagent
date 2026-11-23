import { describe, expect, it } from "vitest";
import { ASSET_LOGO_FILES, assetLogoPath } from "../../lib/market/asset-logos";
import { CandleFeedError, createCriusCandleFeed, parseCriusCandles } from "../../lib/market/crius-candles";
import { createCandleHandler } from "../../lib/market/candle-handlers";
import { buildDemoCandles, buildDemoChain, buildDemoTicket, callPutUnderlyingFor, demoPayoffAt } from "../../lib/market/options-demo";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const NOW = Date.parse("2026-11-23T10:30:00Z");
const payload = (overrides: Record<string, unknown[]> = {}) => ({ data: { interval: "1h", t: [NOW - 7_200_000, NOW - 3_600_000], o: ["100", "101"], h: ["102", "104"], l: ["99", "100"], c: ["101", "103"], n: [3, 5], v: [10, 20], ...overrides } });

describe("parseCriusCandles", () => {
  it("converts token prices to share-equivalent prices and marks the forming bucket", () => {
    const candles = parseCriusCandles(payload(), "1h", 2, NOW)!;
    expect(candles.map((c) => c.c)).toEqual([50.5, 51.5]);
    expect(candles.map((c) => c.forming)).toEqual([false, false]);
    expect(parseCriusCandles(payload({ t: [NOW - 7_200_000, NOW - 1_000] }), "1h", 1, NOW)!.at(-1)!.forming).toBe(true);
  });
  it("drops malformed rows instead of repairing them", () => {
    const candles = parseCriusCandles(payload({ h: ["98", "104"], n: [3, 0] }), "1h", 1, NOW)!;
    expect(candles).toEqual([]);
    expect(parseCriusCandles(payload({ o: ["100"] }), "1h", 1, NOW)).toBeNull();
    expect(parseCriusCandles(payload(), "4h", 1, NOW)).toBeNull();
    expect(parseCriusCandles({}, "1h", 1, NOW)).toBeNull();
  });
});

describe("candle feed and handler", () => {
  const markets = [{ symbol: "AAPL", name: "Apple", currentMultiplier: "1.0", tokenAddress: "0xaf3d76f1834a1d425780943c99ea8a608f8a93f9" }];
  const feedWith = (fetcher: typeof fetch) => createCriusCandleFeed({ fetcher, now: () => new Date(NOW), listMarkets: async () => markets as never });
  const ok = (async () => Response.json(payload())) as unknown as typeof fetch;

  it("requests the provider's native interval without fill and returns a validated series", async () => {
    const urls: string[] = [];
    const feed = feedWith((async (url: string) => { urls.push(url); return Response.json(payload()); }) as unknown as typeof fetch);
    const series = await feed.getSeries("aapl", "1h", 120);
    expect(series.candles).toHaveLength(2);
    expect(series.source).toBe("crius_robinhood_chain_candles");
    expect(urls[0]).toContain("interval=1h&limit=120&fill=false&continuous=false");
  });
  it("maps unknown markets, bad input and provider failures to distinct errors", async () => {
    await expect(feedWith(ok).getSeries("NOPE", "1h")).rejects.toMatchObject({ code: "DATA_MISSING" });
    await expect(feedWith(ok).getSeries("bad symbol", "1h")).rejects.toMatchObject({ code: "UNSUPPORTED" });
    await expect(feedWith((async () => new Response("x", { status: 500 })) as unknown as typeof fetch).getSeries("AAPL", "1h")).rejects.toBeInstanceOf(CandleFeedError);
    await expect(feedWith((async () => Response.json({ nope: true })) as unknown as typeof fetch).getSeries("AAPL", "1h")).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
  });
  it("validates the query and returns API errors", async () => {
    const handler = createCandleHandler(feedWith(ok));
    expect((await handler("AAPL", new URLSearchParams("interval=2m"))).status).toBe(400);
    expect((await handler("AAPL", new URLSearchParams("limit=9999"))).status).toBe(400);
    expect((await handler("NOPE", new URLSearchParams())).status).toBe(404);
    const good = await handler("AAPL", new URLSearchParams("interval=1h&limit=120"));
    expect(good.status).toBe(200);
    expect(good.headers.get("cache-control")).toBe("no-store");
    const down = createCandleHandler(feedWith((async () => { throw new Error("offline"); }) as unknown as typeof fetch));
    expect((await down("AAPL", new URLSearchParams())).status).toBe(503);
  });
});

describe("demo options", () => {
  it("is deterministic, well-formed and ends at the anchor price", () => {
    const a = buildDemoCandles("ADBE", "1h", 300, NOW); const b = buildDemoCandles("ADBE", "1h", 300, NOW);
    expect(a).toEqual(b);
    expect(a).toHaveLength(120);
    expect(a.at(-1)!.c).toBeCloseTo(300, 6);
    for (const c of a) { expect(c.h).toBeGreaterThanOrEqual(Math.max(c.o, c.c)); expect(c.l).toBeLessThanOrEqual(Math.min(c.o, c.c)); }
  });
  it("models a chain whose premiums behave like options", () => {
    const chain = buildDemoChain(300, 0.45, NOW);
    expect(chain).toHaveLength(3);
    const near = chain[0]!.rows; const low = near[0]!; const high = near.at(-1)!;
    expect(low.putPremium).toBeLessThan(high.putPremium);
    expect(low.callPremium).toBeGreaterThan(high.callPremium);
    expect(chain[2]!.rows[5]!.callPremium).toBeGreaterThan(chain[0]!.rows[5]!.callPremium);
    expect(() => buildDemoChain(0, 0.4, NOW)).toThrow(RangeError);
    expect(() => buildDemoChain(300, 9, NOW)).toThrow(RangeError);
  });
  it("computes a long ticket's cost, break-even and expiry payoff", () => {
    const row = { strike: 300, callPremium: 10, callDelta: 0.5, putPremium: 8, putDelta: -0.5 };
    const call = buildDemoTicket("call", row, "2026-12-01T21:00:00.000Z", 2);
    expect(call).toMatchObject({ cost: 20, maxLoss: 20, breakeven: 310, maxGain: null });
    expect(demoPayoffAt(call, 290)).toBe(-20);
    expect(demoPayoffAt(call, 320)).toBe(20);
    const put = buildDemoTicket("put", row, "2026-12-01T21:00:00.000Z", 1);
    expect(put.breakeven).toBe(292);
    expect(demoPayoffAt(put, 250)).toBe(42);
    expect(() => buildDemoTicket("call", row, "x", 0)).toThrow(RangeError);
  });
  it("only calls a market real when CallPut lists its symbol", () => {
    expect(callPutUnderlyingFor("aapl")).toBe("AAPL");
    expect(callPutUnderlyingFor("ADBE")).toBeNull();
    expect(callPutUnderlyingFor("constructor")).toBeNull();
  });
});

describe("bundled logos", () => {
  it("every mapped ticker has its file and nothing is guessed for the rest", () => {
    for (const [ticker, type] of Object.entries(ASSET_LOGO_FILES)) expect(existsSync(resolve(__dirname, `../../public/logos/${ticker}.${type}`))).toBe(true);
    expect(assetLogoPath("aapl")).toBe("/logos/AAPL.png");
    expect(assetLogoPath("GOOGL")).toBe("/logos/GOOGL.svg");
    expect(assetLogoPath("SOXX")).toBeUndefined();
    expect(assetLogoPath("__proto__")).toBeUndefined();
  });
});
