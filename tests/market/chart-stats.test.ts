import { describe, expect, it } from "vitest";
import { POLL_MS, changeOver, freshness, quietMarket, shouldRefresh, windowStats } from "../../lib/market/chart-stats";
import type { ChartCandle } from "../../lib/market/crius-candles";

const H = 3_600_000;
const T0 = Date.parse("2026-11-20T00:00:00Z");
const candle = (index: number, close: number, extra: Partial<ChartCandle> = {}): ChartCandle => ({ t: T0 + index * H, o: close, h: close + 1, l: close - 1, c: close, v: 100, n: 2, forming: false, ...extra });
const series = Array.from({ length: 30 }, (_, index) => candle(index, 100 + index));

describe("chart statistics", () => {
  it("measures the 24h change against the real candle a day earlier", () => {
    const change = changeOver(series)!;
    expect(change.referenceT).toBe(T0 + 5 * H);
    expect(change.abs).toBe(129 - 105);
    expect(change.pct).toBeCloseTo((24 / 105) * 100, 6);
  });
  it("returns null instead of guessing when history is too short", () => {
    expect(changeOver(series.slice(20))).toBeNull();
    expect(changeOver([])).toBeNull();
    expect(windowStats([])).toBeNull();
  });
  it("sums volume and trades and finds the high and low over the window only", () => {
    const stats = windowStats(series)!;
    expect(stats.candles).toBe(24);
    expect(stats.volumeUsd).toBe(2400);
    expect(stats.trades).toBe(48);
    expect(stats.high).toBe(130);
    expect(stats.low).toBe(105); // oldest candle in the window is index 6: close 106, low 105
  });
});

describe("refresh policy", () => {
  const base = { lastOkAt: 1_000_000, lastFailedAt: 0, pollMs: 30_000 };
  it("is live right after a success and while within 2.5 poll periods", () => {
    expect(freshness({ ...base, now: base.lastOkAt + 10_000 })).toBe("live");
    expect(freshness({ ...base, now: base.lastOkAt + 74_000 })).toBe("live");
  });
  it("is delayed when a refresh failed or the data ages, and stale after five minutes", () => {
    expect(freshness({ ...base, now: base.lastOkAt + 80_000 })).toBe("delayed");
    expect(freshness({ ...base, lastFailedAt: base.lastOkAt + 5_000, now: base.lastOkAt + 10_000 })).toBe("delayed");
    expect(freshness({ ...base, now: base.lastOkAt + 301_000 })).toBe("stale");
    expect(freshness({ ...base, lastFailedAt: base.lastOkAt - 1, now: base.lastOkAt + 10_000 })).toBe("live");
  });
  it("never refreshes a hidden tab or overlaps requests", () => {
    expect(shouldRefresh({ hidden: false, inflight: false })).toBe(true);
    expect(shouldRefresh({ hidden: true, inflight: false })).toBe(false);
    expect(shouldRefresh({ hidden: false, inflight: true })).toBe(false);
  });
  it("polls no faster than the server's 60 second cache can make useful", () => {
    expect(Math.min(...Object.values(POLL_MS))).toBeGreaterThanOrEqual(30_000);
  });
  it("calls a market quiet only when the newest candle is more than three buckets old", () => {
    const last = candle(0, 100);
    expect(quietMarket(last, "1h", last.t + 2 * H)).toBe(false);
    expect(quietMarket(last, "1h", last.t + 4 * H)).toBe(true);
    expect(quietMarket(undefined, "1h", Date.now())).toBe(false);
  });
});
