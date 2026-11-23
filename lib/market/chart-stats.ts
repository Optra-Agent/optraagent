import type { ChartCandle, ChartInterval } from "./crius-candles";
import { CHART_INTERVAL_MS } from "./crius-candles";

/** Statistics computed only from real candles. Nothing is estimated: a missing window returns null. */
export type WindowStats = { volumeUsd: number; trades: number; high: number; low: number; candles: number };

const DAY_MS = 86_400_000;

/** Change of the latest close against the close of the newest candle that started at least `windowMs` earlier. */
export function changeOver(candles: readonly ChartCandle[], windowMs = DAY_MS): { abs: number; pct: number; referenceT: number } | null {
  const last = candles[candles.length - 1];
  if (!last) return null;
  let reference: ChartCandle | undefined;
  for (let index = candles.length - 2; index >= 0; index -= 1) {
    if (candles[index]!.t <= last.t - windowMs) { reference = candles[index]; break; }
  }
  if (!reference) return null;
  const abs = last.c - reference.c;
  return { abs, pct: (abs / reference.c) * 100, referenceT: reference.t };
}

/** Traded USD volume, trade count and high/low over the candles that started within `windowMs` of the newest one. Null when none qualify. */
export function windowStats(candles: readonly ChartCandle[], windowMs = DAY_MS): WindowStats | null {
  const last = candles[candles.length - 1];
  if (!last) return null;
  const inside = candles.filter((candle) => candle.t > last.t - windowMs);
  if (inside.length === 0) return null;
  return {
    volumeUsd: inside.reduce((total, candle) => total + candle.v, 0),
    trades: inside.reduce((total, candle) => total + candle.n, 0),
    high: Math.max(...inside.map((candle) => candle.h)),
    low: Math.min(...inside.map((candle) => candle.l)),
    candles: inside.length,
  };
}

/** How often the open chart asks for fresh candles. The server keeps a successful series for 60 s, so this never multiplies provider calls. */
export const POLL_MS: Record<ChartInterval, number> = { "15m": 30_000, "1h": 30_000, "4h": 60_000, "1d": 60_000 };

export type Freshness = "live" | "delayed" | "stale";

/**
 * Whether the data on screen is current. Live: the last refresh succeeded within 2.5 poll periods and nothing has failed since.
 * Delayed: older, or the latest refresh failed, but within 5 minutes. Stale: nothing has succeeded for over 5 minutes.
 */
export function freshness(input: { lastOkAt: number; lastFailedAt: number; now: number; pollMs: number }): Freshness {
  const age = input.now - input.lastOkAt;
  if (age > 300_000) return "stale";
  if (input.lastFailedAt > input.lastOkAt || age > input.pollMs * 2.5) return "delayed";
  return "live";
}

/** The refresh timer fires only for a visible tab with no request already in flight. */
export function shouldRefresh(input: { hidden: boolean; inflight: boolean }): boolean {
  return !input.hidden && !input.inflight;
}

/** Whether the newest candle is older than three buckets, which means the token simply has not traded recently (not a data fault). */
export function quietMarket(last: Pick<ChartCandle, "t"> | undefined, interval: ChartInterval, now: number): boolean {
  return Boolean(last) && now - last!.t > CHART_INTERVAL_MS[interval] * 3;
}
