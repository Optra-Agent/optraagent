import type { MarketCandle } from "../../domain/contracts";
import type { EarningsEvent } from "../../market/earnings";
import { blackScholesEuropeanOption } from "../../options/black-scholes";
import type { ModeledOptionType } from "../../options/black-scholes";
import { easternDateKey, easternWallClockToUtcMs, isUsMarketDay, usMarketCloseUtcMs } from "../us-market-session";

export const DAY_MS = 24 * 60 * 60 * 1000;
const HOURS_PER_YEAR = 24 * 365;

export function roundToIncrement(value: number, increment: number, mode: "nearest" | "up" | "down" = "nearest"): number {
  const scaled = value / increment;
  const rounded = mode === "up" ? Math.ceil(scaled - 1e-9) : mode === "down" ? Math.floor(scaled + 1e-9) : Math.round(scaled);
  return Number((rounded * increment).toFixed(2));
}

function dayNumber(dateKey: string): number {
  const [year, month, day] = dateKey.split("-").map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

function addDays(year: number, month: number, day: number, days: number): { year: number; month: number; day: number } {
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

/** The last trading day on or before a calendar day, so a Friday holiday expires on Thursday. */
function lastMarketDayOnOrBefore(year: number, month: number, day: number): { year: number; month: number; day: number } {
  let cursor = { year, month, day };
  for (let guard = 0; guard < 7; guard += 1) {
    if (isUsMarketDay(cursor.year, cursor.month, cursor.day)) return cursor;
    cursor = addDays(cursor.year, cursor.month, cursor.day, -1);
  }
  return cursor;
}

export type ExpiryRequest = {
  cycle: "daily" | "weekly" | "monthly";
  targetDTE: number;
  minDTE: number;
  nowMs: number;
  /** When set, pick the first expiry strictly after this instant (earnings straddle) instead of the nearest to targetDTE. */
  afterMs?: number;
};

/** Candidate expiries are regular-session closes: every trading day (daily), each Friday (weekly) or the third Friday (monthly). */
export function listExpiryCandidates(cycle: ExpiryRequest["cycle"], nowMs: number, horizonDays = 120): number[] {
  const candidates = new Set<number>();
  const startKey = easternDateKey(nowMs);
  const [startYear, startMonth, startDay] = startKey.split("-").map(Number) as [number, number, number];
  for (let offset = 0; offset <= horizonDays; offset += 1) {
    const date = addDays(startYear, startMonth, startDay, offset);
    const weekday = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
    if (cycle === "daily") {
      if (isUsMarketDay(date.year, date.month, date.day)) candidates.add(usMarketCloseUtcMs(date.year, date.month, date.day));
    } else if (weekday === 5) {
      if (cycle === "weekly" || (date.day >= 15 && date.day <= 21)) {
        const trading = lastMarketDayOnOrBefore(date.year, date.month, date.day);
        candidates.add(usMarketCloseUtcMs(trading.year, trading.month, trading.day));
      }
    }
  }
  return [...candidates].sort((left, right) => left - right);
}

export function selectExpiry(request: ExpiryRequest): { expiryAt: string; dte: number } | null {
  const candidates = listExpiryCandidates(request.cycle, request.nowMs);
  let best: number | null = null;
  for (const candidate of candidates) {
    const dte = (candidate - request.nowMs) / DAY_MS;
    if (dte < request.minDTE) continue;
    if (request.afterMs !== undefined) {
      if (candidate > request.afterMs) { best = candidate; break; }
      continue;
    }
    if (best === null || Math.abs(dte - request.targetDTE) < Math.abs((best - request.nowMs) / DAY_MS - request.targetDTE) - 1e-9) best = candidate;
  }
  return best === null ? null : { expiryAt: new Date(best).toISOString(), dte: (best - request.nowMs) / DAY_MS };
}

function candlePrices(candles: readonly MarketCandle[]): number[] {
  return candles.map((candle) => Number(candle.shareCloseUsd));
}

export type RankProxy = { current: number; min: number; max: number; rank: number; samples: number; windowHours: number };

/**
 * Volra's v1 input. No recorded option IV exists, so this is a rank of a realized-volatility proxy: the annualized
 * 168-hour RV of the latest bar against every 168-hour RV in the supplied 30-day window. It is disclosed as modeled
 * everywhere it appears and is never presented as an option-chain IV rank.
 */
export function rvRankProxy(candles: readonly MarketCandle[], windowHours = 168): RankProxy | null {
  const prices = candlePrices(candles.slice(-721));
  if (prices.length < windowHours + 2 || prices.some((price) => !Number.isFinite(price) || price <= 0)) return null;
  const returns = prices.slice(1).map((price, index) => Math.log(price / prices[index]!));
  const prefix = [0];
  const prefixSquares = [0];
  for (const value of returns) {
    prefix.push(prefix.at(-1)! + value);
    prefixSquares.push(prefixSquares.at(-1)! + value * value);
  }
  const series: number[] = [];
  for (let end = windowHours; end <= returns.length; end += 1) {
    const sum = prefix[end]! - prefix[end - windowHours]!;
    const squares = prefixSquares[end]! - prefixSquares[end - windowHours]!;
    const variance = (squares - (sum * sum) / windowHours) / (windowHours - 1);
    series.push(Math.sqrt(Math.max(0, variance) * HOURS_PER_YEAR));
  }
  const current = series.at(-1)!;
  const min = Math.min(...series);
  const max = Math.max(...series);
  if (!Number.isFinite(current) || current <= 0) return null;
  return { current, min, max, rank: max === min ? 50 : ((current - min) / (max - min)) * 100, samples: series.length, windowHours };
}

/** Completed UTC-day closes (the last bar of each UTC date before `beforeMs`'s date), oldest first. */
export function dailyCloses(candles: readonly MarketCandle[], beforeMs: number): number[] {
  const todayKey = new Date(beforeMs).toISOString().slice(0, 10);
  const byDate = new Map<string, number>();
  for (const candle of candles) {
    const date = candle.endAt.slice(0, 10);
    if (date >= todayKey) continue;
    byDate.set(date, Number(candle.shareCloseUsd));
  }
  return [...byDate.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, close]) => close);
}

export type TrendixResult = { status: "pass" | "block" | "missing"; price: number; fast: number | null; slow: number | null; closes: number };

export function evaluateTrendix(closes: number[], price: number, fast: number, slow: number, direction: "bullish" | "bearish"): TrendixResult {
  if (closes.length < slow) return { status: "missing", price, fast: null, slow: null, closes: closes.length };
  const mean = (values: number[]) => values.reduce((total, value) => total + value, 0) / values.length;
  const fastAverage = mean(closes.slice(-fast));
  const slowAverage = mean(closes.slice(-slow));
  const aligned = direction === "bullish" ? price > fastAverage && fastAverage > slowAverage : price < fastAverage && fastAverage < slowAverage;
  return { status: aligned ? "pass" : "block", price, fast: fastAverage, slow: slowAverage, closes: closes.length };
}

/** When a report becomes public. A missing timestamp falls back to the conservative edge of the report date. */
export function earningsReportMs(event: EarningsEvent): number {
  if (event.reportAt) return Date.parse(event.reportAt);
  const [year, month, day] = event.reportDate.split("-").map(Number) as [number, number, number];
  if (event.timing === "pm") return easternWallClockToUtcMs(year, month, day, 16, 0);
  if (event.timing === "am") return easternWallClockToUtcMs(year, month, day, 9, 30);
  return easternWallClockToUtcMs(year, month, day, 0, 0);
}

export type EarnexBlock = { blocked: boolean; event: EarningsEvent | null; daysToReport: number | null };

/** Block mode: any known date (confirmed or estimated) inside [E − daysBefore, E + daysAfter] blocks, the conservative direction. */
export function earnexBlockWindow(events: readonly EarningsEvent[], nowMs: number, daysBefore: number, daysAfter: number): EarnexBlock {
  const today = dayNumber(easternDateKey(nowMs));
  let nearest: { event: EarningsEvent; delta: number } | null = null;
  for (const event of events) {
    const delta = dayNumber(event.reportDate) - today;
    if (delta >= -daysAfter && delta <= daysBefore) return { blocked: true, event, daysToReport: delta };
    if (delta > 0 && (!nearest || delta < nearest.delta)) nearest = { event, delta };
  }
  return { blocked: false, event: nearest?.event ?? null, daysToReport: nearest?.delta ?? null };
}

export type EarnexOnly = { status: "pass" | "block" | "missing"; event: EarningsEvent | null; daysToReport: number | null; reason: string };

/** Only mode: the next report must be confirmed, still in the future, and within daysBefore calendar days. */
export function earnexOnlyWindow(events: readonly EarningsEvent[] | null, nowMs: number, daysBefore: number): EarnexOnly {
  if (!events || events.length === 0) return { status: "missing", event: null, daysToReport: null, reason: "No earnings calendar data is available." };
  const today = dayNumber(easternDateKey(nowMs));
  const upcoming = events.filter((event) => earningsReportMs(event) > nowMs).sort((left, right) => earningsReportMs(left) - earningsReportMs(right));
  const next = upcoming[0];
  if (!next) return { status: "block", event: null, daysToReport: null, reason: "No upcoming earnings date is published." };
  const delta = dayNumber(next.reportDate) - today;
  if (!next.verified) return { status: "block", event: next, daysToReport: delta, reason: `The next report (${next.reportDate}) is an estimate that the company has not confirmed.` };
  if (delta > daysBefore) return { status: "block", event: next, daysToReport: delta, reason: `The next confirmed report (${next.reportDate}) is ${delta} days away; entries open ${daysBefore} days before.` };
  return { status: "pass", event: next, daysToReport: delta, reason: `Confirmed report ${next.reportDate} (${next.timing}) is ${delta} day(s) away.` };
}

/** Strike whose absolute delta equals the target, by bisection (put delta rises with strike, call delta falls). */
export function solveStrikeForDelta(input: {
  optionType: ModeledOptionType; spotUsd: number; expiryAt: string; valuationAt: string; volatility: number; targetAbsDelta: number;
}): number | null {
  let low = input.spotUsd * 0.3;
  let high = input.spotUsd * 1.7;
  const absDelta = (strike: number) => Math.abs(blackScholesEuropeanOption(input.optionType, {
    spotUsd: input.spotUsd, strikeUsd: strike, expiryAt: input.expiryAt, valuationAt: input.valuationAt, volatility: input.volatility,
  }).delta);
  try {
    for (let iteration = 0; iteration < 60; iteration += 1) {
      const middle = (low + high) / 2;
      const value = absDelta(middle);
      const increasingWithStrike = input.optionType === "put";
      if (value < input.targetAbsDelta === increasingWithStrike) low = middle; else high = middle;
    }
    return (low + high) / 2;
  } catch {
    return null;
  }
}

export type EarningsMove = { reportDate: string; movePct: number };

/** Absolute price move from the last bar before each report to the bar closing 24 hours after it, where the candles cover it. */
export function historicalEarningsMoves(events: readonly EarningsEvent[], candles: readonly MarketCandle[]): EarningsMove[] {
  const moves: EarningsMove[] = [];
  for (const event of events) {
    if (!event.verified) continue;
    const reportMs = earningsReportMs(event);
    let before: MarketCandle | null = null;
    let after: MarketCandle | null = null;
    for (const candle of candles) {
      const end = Date.parse(candle.endAt);
      if (end <= reportMs) before = candle;
      else if (!after && end >= reportMs + DAY_MS) after = candle;
    }
    if (!before || !after) continue;
    const start = Number(before.shareCloseUsd);
    const finish = Number(after.shareCloseUsd);
    if (!(start > 0) || !(finish > 0)) continue;
    moves.push({ reportDate: event.reportDate, movePct: Math.abs(finish / start - 1) * 100 });
  }
  return moves;
}
