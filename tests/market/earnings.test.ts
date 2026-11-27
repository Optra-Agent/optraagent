import { describe, expect, it } from "vitest";
import { createEarningsFeed } from "../../lib/market/earnings";

describe("Robinhood earnings feed provenance", () => {
  it("does not turn an upstream failure into an empty earnings calendar", async () => {
    const feed = createEarningsFeed({
      fetcher: async () => new Response("{}", { status: 503 }),
      requestTimeoutMs: 1_000,
    });

    await expect(feed.getEarnings("NVDA")).rejects.toMatchObject({ name: "EarningsFeedError" });
  });

  it("preserves a valid empty provider calendar as an available snapshot", async () => {
    const feed = createEarningsFeed({
      fetcher: async () => Response.json({ results: [] }),
      now: () => new Date("2026-11-26T00:00:00.000Z"),
    });

    await expect(feed.getEarnings("NVDA")).resolves.toMatchObject({
      symbol: "NVDA",
      source: "robinhood_marketdata_earnings",
      fetchedAt: "2026-11-26T00:00:00.000Z",
      events: [],
    });
  });
});
