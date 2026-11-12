import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { annualizedRealizedVolatility, blackScholesEuropeanPut, rv30ImpliedVolatility } from "../../lib/options/black-scholes";
import { createCriusHistoryFeed } from "../../lib/market/crius-history";

const capture = JSON.parse(await readFile(new URL("../fixtures/aapl-crius-hourly-capture.json", import.meta.url), "utf8")) as {
  capturedAt: string;
  asset: Record<string, unknown>;
  candles: unknown;
  corpActions: unknown[];
};

describe("documented paper put model", () => {
  it("matches a standard at-the-money European put reference case", () => {
    const put = blackScholesEuropeanPut({
      spotUsd: 100,
      strikeUsd: 100,
      expiryAt: "2027-01-01T00:00:00.000Z",
      valuationAt: "2026-01-01T00:00:00.000Z",
      volatility: 0.2,
    });

    expect(put.premiumUsd).toBeCloseTo(7.9656, 3);
    expect(put.model).toBe("black_scholes_european_put");
    expect(put.unitShares).toBe(1);
    expect(put.assumptions).toEqual({ riskFreeRate: 0, dividendYield: 0, dayCount: "365_calendar_days" });
  });

  it("rejects stale or nonsensical model inputs instead of manufacturing a price", () => {
    expect(() => blackScholesEuropeanPut({ spotUsd: 100, strikeUsd: 100, expiryAt: "2026-01-01T00:00:00Z", valuationAt: "2026-01-02T00:00:00Z", volatility: 0.2 })).toThrow(RangeError);
    expect(() => blackScholesEuropeanPut({ spotUsd: 100, strikeUsd: 100, expiryAt: "2027-01-01T00:00:00Z", valuationAt: "2026-01-01T00:00:00Z", volatility: 0 })).toThrow(RangeError);
  });

  it("derives an RV30 proxy from captured real candles and applies the documented 1.1 IV multiplier", async () => {
    const history = createCriusHistoryFeed({
      fetcher: (async (input: string | URL | Request) => {
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
        if (url.pathname === "/rhj/corporate-actions") return Response.json({ corpActions: capture.corpActions });
        return Response.json(url.pathname.endsWith("/candles") ? capture.candles : { assets: [capture.asset] });
      }) as typeof fetch,
      now: () => new Date(capture.capturedAt),
      listMarkets: async () => [{ symbol: "AAPL", currentMultiplier: String(capture.asset.currentMultiplier), tokenAddress: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9" }],
    });
    const result = await history.getHistory("AAPL");
    const rv30 = annualizedRealizedVolatility(result.candles, 720);
    const iv = rv30ImpliedVolatility(result.candles);

    expect(result.coverage.ready).toBe(true);
    expect(rv30).toBeGreaterThan(0);
    expect(iv?.rv30).toBe(rv30);
    expect(iv?.iv).toBeCloseTo(rv30! * 1.1, 12);
    expect(blackScholesEuropeanPut({
      spotUsd: Number(result.candles.at(-1)!.shareCloseUsd),
      strikeUsd: Number(result.candles.at(-1)!.shareCloseUsd) * 0.93,
      expiryAt: new Date(new Date(result.candles.at(-1)!.endAt).getTime() + 30 * 86400000).toISOString(),
      valuationAt: result.candles.at(-1)!.endAt,
      volatility: iv!.iv,
    }).premiumUsd).toBeGreaterThan(0);
  });
});
