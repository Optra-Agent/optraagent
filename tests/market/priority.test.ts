import { describe, expect, it } from "vitest";
import { MARKET_PRIORITY_SYMBOLS, prioritizeMarkets } from "../../lib/market/market-priority";

describe("market priority", () => {
  it("places all campaign-verified symbols first and preserves remaining market order", () => {
    const markets = ["AAPL", "NVDA", "TSLA", "AMD", "MSFT", "AMZN", "GOOGL", "META", "PLTR", "AAOI"]
      .map((symbol) => ({ symbol }));

    expect(prioritizeMarkets(markets).map(({ symbol }) => symbol)).toEqual([
      ...MARKET_PRIORITY_SYMBOLS,
      "AAPL",
      "AAOI",
    ]);
  });

  it("keeps every market and does not mutate the registry response", () => {
    const markets = [{ symbol: "AAPL" }, { symbol: "NVDA" }, { symbol: "AAOI" }];
    const ordered = prioritizeMarkets(markets);

    expect(ordered).toHaveLength(markets.length);
    expect(ordered.map(({ symbol }) => symbol)).toEqual(["NVDA", "AAPL", "AAOI"]);
    expect(markets.map(({ symbol }) => symbol)).toEqual(["AAPL", "NVDA", "AAOI"]);
  });
});
