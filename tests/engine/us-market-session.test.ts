import { describe, expect, it } from "vitest";
import { isRegularEquitySession, marketSessionState, nextEligibleCandleEndMs } from "../../lib/engine/us-market-session";

describe("US regular equity session", () => {
  it("handles eastern time and daylight saving transitions", () => {
    expect(isRegularEquitySession("2026-11-12T15:00:00.000Z")).toBe(true); // 10:00 EST
    expect(isRegularEquitySession("2026-07-13T14:00:00.000Z")).toBe(true); // 10:00 EDT
    expect(isRegularEquitySession("2026-11-12T14:00:00.000Z")).toBe(false); // 09:00 EST
  });

  it("blocks weekends, full market holidays, and hours after the close", () => {
    expect(isRegularEquitySession("2026-11-14T15:00:00.000Z")).toBe(false);
    expect(isRegularEquitySession("2026-11-26T15:00:00.000Z")).toBe(false);
    expect(isRegularEquitySession("2026-11-12T21:00:00.000Z")).toBe(false);
  });

  it("reports why the market is closed and when the scheduler can next evaluate a candle", () => {
    const grace = 5 * 60 * 1000;
    expect(marketSessionState(Date.parse("2026-11-22T00:20:00Z"))).toEqual({ open: false, closedReason: "weekend" });
    expect(marketSessionState(Date.parse("2026-11-26T15:00:00Z"))).toEqual({ open: false, closedReason: "holiday" });
    expect(marketSessionState(Date.parse("2026-11-23T13:00:00Z"))).toEqual({ open: false, closedReason: "before_open" });
    expect(marketSessionState(Date.parse("2026-11-23T21:30:00Z"))).toEqual({ open: false, closedReason: "after_close" });
    expect(marketSessionState(Date.parse("2026-11-23T15:00:00Z"))).toEqual({ open: true, closedReason: null });

    // Sunday: the first candle ending in the Monday session is 10:00 ET (15:00 UTC).
    expect(new Date(nextEligibleCandleEndMs(Date.parse("2026-11-22T00:20:00Z"), grace)!).toISOString()).toBe("2026-11-23T15:00:00.000Z");
    // Still inside the grace window of the 10:00 ET candle: that candle is the next one.
    expect(new Date(nextEligibleCandleEndMs(Date.parse("2026-11-23T15:03:00Z"), grace)!).toISOString()).toBe("2026-11-23T15:00:00.000Z");
    // After the grace window the next boundary is 11:00 ET.
    expect(new Date(nextEligibleCandleEndMs(Date.parse("2026-11-23T15:06:00Z"), grace)!).toISOString()).toBe("2026-11-23T16:00:00.000Z");
    // The last in-session candle is 15:00 ET; after it comes the next trading day.
    expect(new Date(nextEligibleCandleEndMs(Date.parse("2026-11-23T20:10:00Z"), grace)!).toISOString()).toBe("2026-11-24T15:00:00.000Z");
    // Thanksgiving is closed and the day after closes early: Friday's candles end at 10, 11 and 12 ET.
    expect(new Date(nextEligibleCandleEndMs(Date.parse("2026-11-25T21:00:00Z"), grace)!).toISOString()).toBe("2026-11-27T15:00:00.000Z");
    expect(new Date(nextEligibleCandleEndMs(Date.parse("2026-11-27T17:10:00Z"), grace)!).toISOString()).toBe("2026-11-30T15:00:00.000Z");
  });
});
