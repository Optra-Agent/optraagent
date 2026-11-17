import { describe, expect, it, vi } from "vitest";
import {
  CALLPUT_ROBINHOOD_CONTRACTS,
  CALLPUT_ROBINHOOD_MARKET_FEED_URL,
  CALLPUT_ROBINHOOD_READ_ABIS,
  fetchCallPutRobinhoodMarketData,
  getCallPutRobinhoodOptions,
  isCallPutMarketDataFresh,
  parseCallPutRobinhoodMarketData,
  parseCallPutRequestStatus,
} from "../../lib/venue/callput-robinhood-readonly";

const capturedFeed = {
  timestamp: 1_794_905_121_861,
  lastUpdatedAt: "2026-11-17T08:45:21.861Z",
  data: {
    market: {
      AAPL: {
        expiries: [1_795_021_200],
        options: {
          "1795021200": {
            put: [
              {
                instrument: "AAPL-18NOV26-320-P",
                optionId: "0x0010006afdd99000000000014000000000000000000000000000000000000000",
                strikePrice: 320,
                markIv: 0.403,
                markPrice: 0.00010691423459226884,
                riskPremiumRateForBuy: 0.20114451045205634,
                riskPremiumRateForSell: 0.20114451045205634,
                delta: -0.000052877401921280764,
                gamma: 0.000025202262264265,
                vega: 0.0000464306240514004,
                theta: -0.0006938887011412199,
                isOptionAvailable: true,
                expiry: 1_795_021_200,
              },
            ],
            call: [],
          },
        },
      },
    },
    spotIndices: { AAPL: 351.7988 },
    futuresIndices: { AAPL: 351.802507268 },
    pvSource: { version: 1, chainId: 4663 },
  },
};

describe("CallPut Robinhood read-only market integration", () => {
  it("parses the venue's AAPL put row without treating an indicative mark as an executable fill", () => {
    const snapshot = parseCallPutRobinhoodMarketData(capturedFeed);
    const [put] = getCallPutRobinhoodOptions(snapshot, "AAPL", "put", { availableOnly: true });

    expect(snapshot.chainId).toBe(4663);
    expect(snapshot.lastUpdatedAt).toBe("2026-11-17T08:45:21.861Z");
    expect(snapshot.spotIndexRaw.AAPL).toBe(351.7988);
    expect(put).toMatchObject({
      instrument: "AAPL-18NOV26-320-P",
      optionId: "0x0010006afdd99000000000014000000000000000000000000000000000000000",
      side: "put",
      strikePriceRaw: 320,
      markPriceRaw: 0.00010691423459226884,
      marketAvailable: true,
      quoteType: "indicative",
    });
    expect(put).not.toHaveProperty("executable");
  });

  it("fails closed when the feed's canonical chain tag is not Robinhood mainnet", () => {
    const wrongChain = structuredClone(capturedFeed);
    wrongChain.data.pvSource.chainId = 46630;

    expect(() => parseCallPutRobinhoodMarketData(wrongChain)).toThrow(/chain/i);
  });

  it("fails closed when the feed omits its source metadata", () => {
    const missingSource = {
      ...capturedFeed,
      data: { ...capturedFeed.data, pvSource: undefined },
    };

    expect(() => parseCallPutRobinhoodMarketData(missingSource)).toThrow(/chain/i);
  });

  it("checks caller-supplied freshness bounds without reading the local clock", () => {
    const snapshot = parseCallPutRobinhoodMarketData(capturedFeed);

    expect(isCallPutMarketDataFresh(snapshot, 1_794_905_121_861 + 30_000, 60_000)).toBe(true);
    expect(isCallPutMarketDataFresh(snapshot, 1_794_905_121_861 + 61_000, 60_000)).toBe(false);
    expect(isCallPutMarketDataFresh(snapshot, 1_794_905_121_861 - 1, 60_000)).toBe(false);
  });

  it("fetches only the public feed with no-store semantics and no authorization headers", async () => {
    const fetcher = vi.fn(async () => Response.json(capturedFeed));

    const snapshot = await fetchCallPutRobinhoodMarketData(fetcher as typeof fetch);

    expect(snapshot.chainId).toBe(4663);
    expect(fetcher).toHaveBeenCalledWith(CALLPUT_ROBINHOOD_MARKET_FEED_URL, {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
  });

  it("pins the mainnet deployment references and exports read-only ABIs only", () => {
    expect(CALLPUT_ROBINHOOD_CONTRACTS.positionManager).toBe("0x426a6b482893557E58cF38de635fEbB30Fd6a3C3");
    expect(CALLPUT_ROBINHOOD_CONTRACTS.settleManager).toBe("0xd328D581f3Fb1Ca86D28D573bA1f17409e5112EF");
    expect(CALLPUT_ROBINHOOD_CONTRACTS.usdg).toBe("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");

    for (const abi of Object.values(CALLPUT_ROBINHOOD_READ_ABIS)) {
      expect(abi.length).toBeGreaterThan(0);
      expect(abi.every((item) => item.type !== "function" || item.stateMutability === "view" || item.stateMutability === "pure")).toBe(true);
    }
  });

  it("maps the documented asynchronous request states and rejects unknown enum values", () => {
    expect(parseCallPutRequestStatus(0)).toBe("Pending");
    expect(parseCallPutRequestStatus(1)).toBe("Cancelled");
    expect(parseCallPutRequestStatus(2)).toBe("Executed");
    expect(() => parseCallPutRequestStatus(3)).toThrow(/unknown/i);
  });

  it("rejects non-successful market-feed responses", async () => {
    const fetcher = vi.fn(async () => new Response("unavailable", { status: 503 }));

    await expect(fetchCallPutRobinhoodMarketData(fetcher as typeof fetch)).rejects.toThrow(/503/);
  });
});
