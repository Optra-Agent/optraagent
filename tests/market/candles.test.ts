import { describe, expect, it } from "vitest";
import { ASSET_LOGO_FILES, assetLogoPath } from "../../lib/market/asset-logos";
import { CandleFeedError, createCriusCandleFeed, parseCriusCandles } from "../../lib/market/crius-candles";
import { createCandleHandler } from "../../lib/market/candle-handlers";
import { callPutUnderlyingFor } from "../../lib/market/callput-support";
import { ema, macd, rsi, sma } from "../../lib/market/indicators";
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
    // No trades in the window is an empty series, not an error.
    expect(parseCriusCandles(payload({ t: [], o: [], h: [], l: [], c: [], n: [], v: [] }), "1h", 1, NOW)).toEqual([]);
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
  it("shares one provider call between repeated requests but never caches a failure", async () => {
    let calls = 0; let fail = true;
    const feed = feedWith((async (url: string) => { calls += 1; if (fail) throw new Error("offline"); const interval = new URL(url).searchParams.get("interval"); return Response.json({ data: { ...payload().data, interval } }); }) as unknown as typeof fetch);
    await expect(feed.getSeries("AAPL", "1d")).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
    fail = false;
    const [first, second] = await Promise.all([feed.getSeries("AAPL", "1d"), feed.getSeries("AAPL", "1d")]);
    await feed.getSeries("AAPL", "1d");
    expect(first).toBe(second);
    expect(calls).toBe(3); // two attempts for the failure (one retry), one shared call for the later successes
    await feed.getSeries("AAPL", "4h");
    expect(calls).toBe(4);
  });
  it("retries once after a fast upstream error but not after a 4xx or a timeout", async () => {
    let calls = 0;
    const flaky = feedWith((async () => { calls += 1; return calls === 1 ? new Response("x", { status: 502 }) : Response.json(payload()); }) as unknown as typeof fetch);
    expect((await flaky.getSeries("AAPL", "1h")).candles).toHaveLength(2);
    expect(calls).toBe(2);
    calls = 0;
    await expect(feedWith((async () => { calls += 1; return new Response("x", { status: 404 }); }) as unknown as typeof fetch).getSeries("AAPL", "1h")).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
    expect(calls).toBe(1);
    calls = 0;
    await expect(feedWith((async () => { calls += 1; throw new DOMException("timed out", "TimeoutError"); }) as unknown as typeof fetch).getSeries("AAPL", "1h")).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
    expect(calls).toBe(1);
    calls = 0;
    await expect(feedWith((async () => { calls += 1; return new Response("x", { status: 503 }); }) as unknown as typeof fetch).getSeries("AAPL", "1h")).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
    expect(calls).toBe(2);
  });
  it("validates the query and returns API errors", async () => {
    const handler = createCandleHandler(feedWith(ok));
    expect((await handler("AAPL", new URLSearchParams("interval=2m"))).status).toBe(400);
    expect((await handler("AAPL", new URLSearchParams("limit=1501"))).status).toBe(400);
    expect((await handler("AAPL", new URLSearchParams("limit=1500"))).status).toBe(200);
    expect((await handler("NOPE", new URLSearchParams())).status).toBe(404);
    const good = await handler("AAPL", new URLSearchParams("interval=1h&limit=120"));
    expect(good.status).toBe(200);
    expect(good.headers.get("cache-control")).toBe("no-store");
    const down = createCandleHandler(feedWith((async () => { throw new Error("offline"); }) as unknown as typeof fetch));
    expect((await down("AAPL", new URLSearchParams())).status).toBe(503);
  });
});

describe("CallPut market support", () => {
  it("only calls a market tradable when CallPut lists its symbol", () => {
    expect(callPutUnderlyingFor("aapl")).toBe("AAPL");
    expect(callPutUnderlyingFor("AEIS")).toBeNull();
    expect(callPutUnderlyingFor("ADBE")).toBeNull();
    expect(callPutUnderlyingFor("constructor")).toBeNull();
  });
});

describe("indicators", () => {
  const closes = [44, 44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.0, 46.03, 46.41, 46.22, 45.64];
  it("computes SMA and leaves early values empty", () => {
    expect(sma([1, 2, 3, 4], 2)).toEqual([null, 1.5, 2.5, 3.5]);
    expect(sma([1, 2], 5)).toEqual([null, null]);
  });
  it("computes Wilder RSI that matches an independent calculation", () => {
    const values = rsi(closes, 14);
    expect(values.slice(0, 14).every((v) => v === null)).toBe(true);
    expect(values[14]).toBeCloseTo(72.4409, 3);
    expect(values[16]).toBeCloseTo(68.0885, 3);
    expect(values[20]).toBeCloseTo(59.2795, 3);
    expect(rsi([1, 2, 3], 14).every((v) => v === null)).toBe(true);
    expect(rsi(Array(20).fill(5), 14)[19]).toBe(50);
    expect(rsi(Array.from({ length: 20 }, (_, i) => i + 1), 14)[19]).toBe(100);
  });
  it("computes EMA seeded by SMA and MACD only when enough closes exist", () => {
    expect(ema([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
    const flat = macd(Array(60).fill(10));
    expect(flat[24]).toBeNull();
    expect(flat[25]).toMatchObject({ macd: 0, signal: null });
    expect(flat[33]).toMatchObject({ macd: 0, signal: 0, histogram: 0 });
    const rising = macd(Array.from({ length: 60 }, (_, i) => 100 + i));
    expect(rising[59]!.macd).toBeGreaterThan(0);
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
