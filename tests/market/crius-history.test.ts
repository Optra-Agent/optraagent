import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createCriusHistoryFeed } from "../../lib/market/crius-history";

const capture = JSON.parse(await readFile(new URL("../fixtures/aapl-crius-hourly-capture.json", import.meta.url), "utf8")) as {
  capturedAt: string;
  asset: Record<string, unknown>;
  candles: { data: { t: number[]; n: number[]; c: number[]; [key: string]: unknown }; meta: { pools: string[] } };
  corpActions: Array<Record<string, unknown>>;
};

function feed(input: { actionResponse?: unknown; candleResponse?: unknown; now?: string } = {}) {
  const urls: URL[] = [];
  const responseByPath = new Map<string, unknown>([
    ["/rhj/assets", { assets: [capture.asset] }],
    ["/rhj/corporate-actions", input.actionResponse ?? { corpActions: capture.corpActions }],
  ]);
  const fetcher = async (inputUrl: string | URL | Request): Promise<Response> => {
    const url = new URL(typeof inputUrl === "string" ? inputUrl : inputUrl instanceof URL ? inputUrl.toString() : inputUrl.url);
    urls.push(url);
    const payload = url.pathname.endsWith("/candles")
      ? input.candleResponse ?? capture.candles
      : responseByPath.get(url.pathname);
    return payload === undefined ? new Response("missing", { status: 404 }) : Response.json(payload);
  };
  const instance = createCriusHistoryFeed({
    fetcher: fetcher as typeof fetch,
    now: () => new Date(input.now ?? capture.capturedAt),
    listMarkets: async () => [{
      symbol: "AAPL",
      name: "Apple",
      currentMultiplier: String(capture.asset.currentMultiplier),
      tokenAddress: (capture.asset.deployments as Array<{ contractAddress: string }>)[0]!.contractAddress,
    }],
  });
  return { instance, urls };
}

describe("Crius hourly market history", () => {
  it("normalizes real nonempty candles, drops the open hour, and reports auditable coverage", async () => {
    const { instance, urls } = feed();
    const result = await instance.getHistory("aapl");
    const candleRequest = urls.find((url) => url.pathname.endsWith("/candles"))!;
    const latestClosedStart = new Date(capture.capturedAt).setUTCMinutes(0, 0, 0) - 60 * 60 * 1000;
    const last = result.candles.at(-1)!;

    expect(candleRequest.searchParams.get("interval")).toBe("1h");
    expect(candleRequest.searchParams.get("limit")).toBe("1500");
    expect(candleRequest.searchParams.get("fill")).toBe("false");
    expect(candleRequest.searchParams.get("continuous")).toBe("false");
    expect(candleRequest.searchParams.get("currency")).toBe("usd");
    expect(result.candles).toHaveLength(1499);
    expect(result.candles.every((candle) => candle.filled === false && candle.tradeCount > 0)).toBe(true);
    expect(result.coverage).toMatchObject({ ready: true, availableCandles: 1499, requiredCandles: 1440, multiplierStatus: "stable_verified", fillApplied: false });
    expect(new Date(last.startAt).getTime()).toBe(latestClosedStart);
    expect(last.multiplierSharesPerToken).toBe(String(capture.asset.currentMultiplier));
    expect(Number(last.shareCloseUsd)).toBeCloseTo(Number(last.tokenCloseUsd) / Number(capture.asset.currentMultiplier), 7);
    expect(result.corporateActionDates).toEqual(["2026-11-16T00:00:00.000Z"]);
  });

  it("blocks history normalization when a corporate action overlaps the multiplier window", async () => {
    const action = structuredClone(capture.corpActions[0]!);
    action.processDate = { year: 2026, month: 10, day: 1 };
    const { instance } = feed({ actionResponse: { corpActions: [action] } });

    const result = await instance.getHistory("AAPL");

    expect(result.coverage).toMatchObject({ ready: false, multiplierStatus: "action_in_window" });
    expect(result.coverage.reason).toContain("cannot be verified");
    expect(result.candles.every((candle) => candle.multiplierStatus === "action_in_window")).toBe(true);
  });

  it("fails closed when corporate-action provenance is unavailable", async () => {
    const { instance } = feed({ actionResponse: { unexpected: [] } });

    const result = await instance.getHistory("AAPL");

    expect(result.candles).toEqual([]);
    expect(result.coverage).toMatchObject({ ready: false, multiplierStatus: "unverified", fillApplied: false });
    expect(result.providerError).toBe("Robinhood corporate-action history returned an invalid response.");
  });

  it("reports malformed candle payloads separately from genuine empty history", async () => {
    const { instance } = feed({ candleResponse: { data: { interval: "1h", currency: "usd", t: [], o: [1], h: [], l: [], c: [], n: [], v: [] } } });

    const result = await instance.getHistory("AAPL");

    expect(result.candles).toEqual([]);
    expect(result.providerError).toBe("Crius candle history returned an invalid response.");
  });

  it("does not bridge a missing real trade bucket or accept provider-filled rows", async () => {
    const raw = structuredClone(capture.candles);
    raw.data.t[800] += 60 * 60 * 1000;
    const { instance } = feed({ candleResponse: raw });

    const result = await instance.getHistory("AAPL");

    expect(result.coverage.ready).toBe(false);
    expect(result.coverage.consecutiveHours).toBeLessThan(result.coverage.availableCandles);
  });

  it("treats genuine empty history as insufficient data and shares corporate-action requests", async () => {
    const emptyCandles = { data: { interval: "1h", currency: "usd", t: [], o: [], h: [], l: [], c: [], n: [], v: [] } };
    const markets = [
      { symbol: "AAPL", currentMultiplier: "1", tokenAddress: "0x1111111111111111111111111111111111111111" },
      { symbol: "AMD", currentMultiplier: "1", tokenAddress: "0x2222222222222222222222222222222222222222" },
    ];
    let corporateActionRequests = 0;
    const fetcher = async (inputUrl: string | URL | Request): Promise<Response> => {
      const url = new URL(typeof inputUrl === "string" ? inputUrl : inputUrl instanceof URL ? inputUrl.toString() : inputUrl.url);
      if (url.pathname.endsWith("/corporate-actions")) {
        corporateActionRequests += 1;
        await Promise.resolve();
        return Response.json({ corpActions: [] });
      }
      return Response.json(emptyCandles);
    };
    const instance = createCriusHistoryFeed({ fetcher: fetcher as typeof fetch, listMarkets: async () => markets, now: () => new Date(capture.capturedAt) });

    const [aapl, amd] = await Promise.all([instance.getHistory("AAPL"), instance.getHistory("AMD")]);

    expect(corporateActionRequests).toBe(1);
    for (const history of [aapl, amd]) {
      expect(history.candles).toEqual([]);
      expect(history.providerError).toBeUndefined();
      expect(history.coverage).toMatchObject({ ready: false, availableCandles: 0, multiplierStatus: "stable_verified" });
    }
  });
});
