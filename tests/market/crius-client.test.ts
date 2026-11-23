import { describe, expect, it } from "vitest";
import { createCriusClient, CriusRequestError } from "../../lib/market/crius-client";
import { createCriusCandleFeed } from "../../lib/market/crius-candles";

const URL_CRIUS = "https://api.crius.sh/v1/robinhood/token/0xabc/candles?interval=1h";
const NOW = Date.parse("2026-11-23T17:00:00Z");
const payload = () => ({ data: { interval: "1h", t: [NOW - 7_200_000, NOW - 3_600_000], o: ["100", "101"], h: ["102", "104"], l: ["99", "100"], c: ["101", "103"], n: [3, 5], v: [10, 20] } });
const limited = (code: string, retryAfter?: string) => new Response(JSON.stringify({ error: { code, retry_after_ms: 400 } }), { status: 429, headers: retryAfter ? { "retry-after": retryAfter } : {} });

describe("Crius client", () => {
  it("sends the API key only to a crius.sh host", async () => {
    const seen: Array<string | null> = [];
    const fetcher = (async (_url: string, init: RequestInit) => { seen.push((init.headers as Record<string, string>)["x-api-key"] ?? null); return Response.json({ ok: true }); }) as unknown as typeof fetch;
    const client = createCriusClient({ fetcher, apiKey: "crs_live_test" });
    await client.getJson(URL_CRIUS);
    await client.getJson("https://fixtures.example/v1/robinhood/token/0xabc/candles");
    expect(seen).toEqual(["crs_live_test", null]);
  });

  it("waits out a short per-second limit using retry-after, then succeeds", async () => {
    let calls = 0; const waits: number[] = [];
    const fetcher = (async () => { calls += 1; return calls === 1 ? limited("rate_limited", "1") : Response.json({ ok: true }); }) as unknown as typeof fetch;
    const client = createCriusClient({ fetcher, sleep: async (ms) => { waits.push(ms); } });
    await expect(client.getJson(URL_CRIUS)).resolves.toEqual({ ok: true });
    expect(calls).toBe(2);
    expect(waits).toEqual([1000]);
  });

  it("does not wait out a long limit, names it, and pauses new requests instead of hammering the provider", async () => {
    let calls = 0;
    const fetcher = (async () => { calls += 1; return limited("daily_limit_reached", "40000"); }) as unknown as typeof fetch;
    const client = createCriusClient({ fetcher, sleep: async () => { throw new Error("must not sleep"); }, now: () => new Date(NOW) });
    await expect(client.getJson(URL_CRIUS)).rejects.toMatchObject({ kind: "daily_limit", status: 429 });
    await expect(client.getJson(URL_CRIUS)).rejects.toBeInstanceOf(CriusRequestError);
    expect(calls).toBe(1);
  });

  it("gives up on a rate limit after bounded attempts and retries a server error once", async () => {
    let calls = 0;
    const always = createCriusClient({ fetcher: (async () => { calls += 1; return limited("rate_limited", "0"); }) as unknown as typeof fetch, sleep: async () => undefined });
    await expect(always.getJson(URL_CRIUS)).rejects.toMatchObject({ kind: "rate_limited" });
    expect(calls).toBe(3);
    calls = 0;
    const down = createCriusClient({ fetcher: (async () => { calls += 1; return new Response("x", { status: 502 }); }) as unknown as typeof fetch, sleep: async () => undefined });
    await expect(down.getJson(URL_CRIUS)).rejects.toMatchObject({ kind: "server" });
    expect(calls).toBe(2);
  });
});

describe("candle feed during a provider outage", () => {
  const markets = [{ symbol: "AAPL", name: "Apple", currentMultiplier: "1.0", tokenAddress: "0xaf3d76f1834a1d425780943c99ea8a608f8a93f9" }];

  it("serves the last verified series with its original receivedAt and stale: true, never invented candles", async () => {
    let clock = NOW; let healthy = true;
    const fetcher = (async () => (healthy ? Response.json(payload()) : limited("daily_limit_reached", "40000"))) as unknown as typeof fetch;
    const feed = createCriusCandleFeed({ fetcher, now: () => new Date(clock), listMarkets: async () => markets as never });
    const fresh = await feed.getSeries("AAPL", "1h");
    expect(fresh.stale).toBeUndefined();
    healthy = false; clock = NOW + 10 * 60_000;
    const kept = await feed.getSeries("AAPL", "1h");
    expect(kept.stale).toBe(true);
    expect(kept.receivedAt).toBe(fresh.receivedAt);
    expect(kept.candles).toEqual(fresh.candles);
    healthy = true; clock = NOW + 20 * 60_000;
    expect((await feed.getSeries("AAPL", "1h")).stale).toBeUndefined();
  });

  it("fails with an honest upstream error when nothing verified exists yet", async () => {
    const feed = createCriusCandleFeed({ fetcher: (async () => limited("daily_limit_reached", "40000")) as unknown as typeof fetch, now: () => new Date(NOW), listMarkets: async () => markets as never });
    await expect(feed.getSeries("AAPL", "1h")).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE", retryable: true, message: expect.stringContaining("allowance") });
  });
});
