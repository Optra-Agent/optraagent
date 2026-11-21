import { describe, expect, it } from "vitest";
import {
  dailyCloses, earnexBlockWindow, earnexOnlyWindow, earningsReportMs, evaluateTrendix, historicalEarningsMoves, listExpiryCandidates, rvRankProxy,
  roundToIncrement, selectExpiry, solveStrikeForDelta,
} from "../../lib/engine/strategy/helpers";
import { blackScholesEuropeanOption } from "../../lib/options/black-scholes";
import { earningsSnapshot, makeCandles } from "./strategy-fixtures";

const ev = (reportDate: string, extra: Record<string, unknown> = {}) => earningsSnapshot([{ reportDate, ...extra }]).events[0]!;

describe("Tenora expiry selection", () => {
  it("lists weekly expiries at 16:00 America/New_York, across the daylight-saving change", () => {
    // 2026-11-01 is the US fall-back date: Friday 2026-10-30 closes at 20:00Z (EDT), Friday 2026-11-06 at 21:00Z (EST).
    const candidates = listExpiryCandidates("weekly", Date.parse("2026-10-27T15:00:00.000Z"), 20).map((ms) => new Date(ms).toISOString());
    expect(candidates.slice(0, 3)).toEqual(["2026-10-30T20:00:00.000Z", "2026-11-06T21:00:00.000Z", "2026-11-13T21:00:00.000Z"]);
  });

  it("moves a Friday holiday expiry to Thursday", () => {
    // Good Friday 2027-03-26 is a market holiday.
    const candidates = listExpiryCandidates("weekly", Date.parse("2027-03-22T15:00:00.000Z"), 10).map((ms) => new Date(ms).toISOString());
    expect(candidates[0]).toBe("2027-03-25T20:00:00.000Z");
  });

  it("chooses the expiry nearest targetDTE with at least minDTE", () => {
    const now = Date.parse("2026-11-10T15:00:00.000Z");
    // From a Tuesday the next Friday is 3.25 days out and the one after 10.25: 7 is nearer to the later one.
    expect(selectExpiry({ cycle: "weekly", targetDTE: 5, minDTE: 2, nowMs: now })?.expiryAt).toBe("2026-11-13T21:00:00.000Z");
    expect(selectExpiry({ cycle: "weekly", targetDTE: 7, minDTE: 2, nowMs: now })?.expiryAt).toBe("2026-11-20T21:00:00.000Z");
    // minDTE excludes the nearest Friday, which is only 3.25 days out.
    expect(selectExpiry({ cycle: "weekly", targetDTE: 3, minDTE: 4, nowMs: now })?.expiryAt).toBe("2026-11-20T21:00:00.000Z");
  });

  it("picks the first expiry strictly after an anchor for the earnings straddle", () => {
    const now = Date.parse("2026-11-10T15:00:00.000Z");
    const afterReport = Date.parse("2026-11-12T21:00:00.000Z");
    expect(selectExpiry({ cycle: "weekly", targetDTE: 7, minDTE: 2, nowMs: now, afterMs: afterReport })?.expiryAt).toBe("2026-11-13T21:00:00.000Z");
    expect(selectExpiry({ cycle: "weekly", targetDTE: 7, minDTE: 2, nowMs: now, afterMs: Date.parse("2026-11-13T21:00:00.000Z") })?.expiryAt).toBe("2026-11-20T21:00:00.000Z");
  });

  it("supports monthly (third Friday) and daily cycles", () => {
    const now = Date.parse("2026-11-10T15:00:00.000Z");
    expect(selectExpiry({ cycle: "monthly", targetDTE: 10, minDTE: 5, nowMs: now })?.expiryAt).toBe("2026-11-20T21:00:00.000Z");
    expect(selectExpiry({ cycle: "daily", targetDTE: 1, minDTE: 1, nowMs: now })?.expiryAt).toBe("2026-11-11T21:00:00.000Z");
  });

  it("rounds strikes to the model grid", () => {
    expect(roundToIncrement(210.126, 0.01)).toBe(210.13);
    expect(roundToIncrement(210.126, 0.5, "down")).toBe(210);
    expect(roundToIncrement(210.126, 0.5, "up")).toBe(210.5);
  });
});

describe("Earnex windows", () => {
  const now = Date.parse("2026-11-10T15:00:00.000Z");
  it("blocks inside [E − daysBefore, E + daysAfter] for confirmed and estimated dates alike", () => {
    expect(earnexBlockWindow([ev("2026-11-12")], now, 2, 1)).toMatchObject({ blocked: true, daysToReport: 2 });
    expect(earnexBlockWindow([ev("2026-11-13", { verified: false })], now, 2, 1)).toMatchObject({ blocked: false, daysToReport: 3 });
    expect(earnexBlockWindow([ev("2026-11-09")], now, 2, 1)).toMatchObject({ blocked: true, daysToReport: -1 });
    expect(earnexBlockWindow([ev("2026-11-08")], now, 2, 1).blocked).toBe(false);
  });

  it("only mode needs a confirmed, upcoming report inside the window", () => {
    expect(earnexOnlyWindow([ev("2026-11-12")], now, 3)).toMatchObject({ status: "pass", daysToReport: 2 });
    expect(earnexOnlyWindow([ev("2026-11-12", { verified: false })], now, 3).status).toBe("block");
    expect(earnexOnlyWindow([ev("2026-11-20")], now, 3).status).toBe("block");
    expect(earnexOnlyWindow([ev("2026-11-05")], now, 3).status).toBe("block");
    expect(earnexOnlyWindow(null, now, 3).status).toBe("missing");
    expect(earnexOnlyWindow([], now, 3).status).toBe("missing");
  });

  it("falls back to the conservative edge of the report date when no timestamp exists", () => {
    expect(new Date(earningsReportMs(ev("2026-11-12", { timing: "pm" }))).toISOString()).toBe("2026-11-12T21:00:00.000Z");
    expect(new Date(earningsReportMs(ev("2026-11-12", { timing: "am" }))).toISOString()).toBe("2026-11-12T14:30:00.000Z");
    expect(new Date(earningsReportMs(ev("2026-11-12", { reportAt: "2026-11-12T20:20:00.000Z" }))).toISOString()).toBe("2026-11-12T20:20:00.000Z");
  });
});

describe("modeled volatility rank, Trendix and strike solving", () => {
  it("ranks the latest 168-hour realized volatility within the 30-day window", () => {
    const calm = makeCandles({ endAt: "2026-11-10T15:00:00.000Z", count: 800, price: () => 200, wiggle: 0.002 });
    const rank = rvRankProxy(calm.slice(0, -1));
    expect(rank).not.toBeNull();
    expect(rank!.rank).toBeGreaterThanOrEqual(0);
    expect(rank!.rank).toBeLessThanOrEqual(100);
    expect(rank!.samples).toBeGreaterThan(500);
    // A volatility burst in the final week must rank at the top of the window.
    const burst = makeCandles({ endAt: "2026-11-10T15:00:00.000Z", count: 800, price: (index, count) => 200 * (1 + (index > count - 170 ? 0.05 * Math.sin(index) : 0)), wiggle: 0.002 });
    expect(rvRankProxy(burst.slice(0, -1))!.rank).toBeGreaterThan(95);
    expect(rvRankProxy(calm.slice(0, 50))).toBeNull();
  });

  it("aggregates completed UTC days and evaluates the trend, reporting missing data instead of guessing", () => {
    const candles = makeCandles({ endAt: "2026-11-10T15:00:00.000Z", count: 1200, price: (index) => 100 + index * 0.05, wiggle: 0.001 });
    const closes = dailyCloses(candles, Date.parse("2026-11-10T15:00:00.000Z"));
    expect(closes.length).toBeGreaterThanOrEqual(49);
    expect(closes.length).toBeLessThanOrEqual(50);
    expect(evaluateTrendix(closes, 170, 5, 10, "bullish")).toMatchObject({ status: "pass" });
    expect(evaluateTrendix(closes, 50, 5, 10, "bullish").status).toBe("block");
    expect(evaluateTrendix(closes, 170, 20, 80, "bullish").status).toBe("missing");
    expect(evaluateTrendix([...closes].reverse(), 50, 5, 10, "bearish").status).toBe("pass");
  });

  it("solves the strike that lands on the target delta", () => {
    const input = { spotUsd: 200, expiryAt: "2026-11-20T21:00:00.000Z", valuationAt: "2026-11-10T15:00:00.000Z", volatility: 0.6 };
    const put = solveStrikeForDelta({ optionType: "put", targetAbsDelta: 0.25, ...input })!;
    expect(put).toBeLessThan(200);
    expect(Math.abs(blackScholesEuropeanOption("put", { ...input, strikeUsd: put }).delta)).toBeCloseTo(0.25, 3);
    const call = solveStrikeForDelta({ optionType: "call", targetAbsDelta: 0.25, ...input })!;
    expect(call).toBeGreaterThan(200);
    expect(blackScholesEuropeanOption("call", { ...input, strikeUsd: call }).delta).toBeCloseTo(0.25, 3);
  });

  it("measures realized earnings moves from candles that cover the report", () => {
    const candles = makeCandles({ endAt: "2026-11-20T15:00:00.000Z", count: 400, price: (index, count) => (index < count - 90 ? 200 : 230), wiggle: 0.0002 });
    const report = ev("2026-11-16", { reportAt: "2026-11-16T21:20:00.000Z" });
    const moves = historicalEarningsMoves([report, ev("2026-12-01", { verified: false })], candles);
    expect(moves).toHaveLength(1);
    expect(moves[0]!.reportDate).toBe("2026-11-16");
    expect(moves[0]!.movePct).toBeGreaterThan(10);
    expect(historicalEarningsMoves([ev("2026-01-05")], candles)).toEqual([]);
  });
});
