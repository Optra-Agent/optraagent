/**
 * Demo Mode helpers for markets CallPut does not list. Everything here is simulated and must be shown as such: the
 * candles are a seeded random walk, the option prices come from a Black-Scholes model with an assumed volatility, and
 * a "ticket" is a local what-if with no wallet, transaction or position behind it.
 */
import { blackScholesEuropeanOption } from "../options/black-scholes";
import { CALLPUT_ROBINHOOD_UNDERLYINGS } from "../venue/callput-robinhood-write";
import { CHART_INTERVAL_MS } from "./crius-candles";
import type { ChartCandle, ChartInterval } from "./crius-candles";

/** The market has real CallPut instruments only when CallPut lists its symbol as an underlying. */
export function callPutUnderlyingFor(symbol: string): keyof typeof CALLPUT_ROBINHOOD_UNDERLYINGS | null {
  const ticker = symbol.trim().toUpperCase();
  return Object.hasOwn(CALLPUT_ROBINHOOD_UNDERLYINGS, ticker) ? (ticker as keyof typeof CALLPUT_ROBINHOOD_UNDERLYINGS) : null;
}

function seeded(seed: string): () => number {
  let state = 2166136261;
  for (const char of seed) state = Math.imul(state ^ char.charCodeAt(0), 16777619) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const gaussian = (random: () => number) => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());

/** Simulated candles ending at `nowMs`, scaled to roughly `anchorUsd`. Deterministic per symbol and interval. */
export function buildDemoCandles(symbol: string, interval: ChartInterval, anchorUsd: number, nowMs: number, count = 120): ChartCandle[] {
  const width = CHART_INTERVAL_MS[interval];
  const random = seeded(`${symbol}:${interval}`);
  const stepVol = 0.45 * Math.sqrt(width / (365 * 86_400_000));
  const lastStart = Math.floor(nowMs / width) * width;
  const closes: number[] = [anchorUsd];
  for (let index = 1; index <= count; index += 1) closes.unshift(closes[0]! / Math.exp(stepVol * gaussian(random)));
  const candles: ChartCandle[] = [];
  for (let index = 0; index < count; index += 1) {
    const open = closes[index]!; const close = closes[index + 1]!;
    const high = Math.max(open, close) * (1 + Math.abs(gaussian(random)) * stepVol * 0.4);
    const low = Math.min(open, close) / (1 + Math.abs(gaussian(random)) * stepVol * 0.4);
    const start = lastStart - (count - 1 - index) * width;
    candles.push({ t: start, o: open, h: high, l: low, c: close, v: 0, n: 1, forming: start + width > nowMs });
  }
  return candles;
}

export type DemoOptionRow = { strike: number; callPremium: number; callDelta: number; putPremium: number; putDelta: number };
export type DemoExpiry = { expiryAt: string; label: string; days: number; rows: DemoOptionRow[] };

/** Strike step that gives about 9 to 15 strikes across +/-15% of spot. */
function strikeStep(spot: number): number {
  const target = spot * 0.03;
  const steps = [0.5, 1, 2.5, 5, 10, 25, 50, 100, 250, 500, 1000];
  return steps.find((step) => step >= target) ?? 1000;
}

/** Modeled option chain for three expiries. `volatility` is an assumption, not a market quote. */
export function buildDemoChain(spotUsd: number, volatility: number, nowMs: number): DemoExpiry[] {
  if (!(spotUsd > 0) || !(volatility > 0) || !(volatility <= 5)) throw new RangeError("Demo chain needs a positive spot price and volatility up to 500%.");
  const step = strikeStep(spotUsd);
  const centre = Math.round(spotUsd / step) * step;
  const strikes: number[] = [];
  for (let offset = -5; offset <= 5; offset += 1) {
    const strike = centre + offset * step;
    if (strike > 0) strikes.push(Number(strike.toFixed(2)));
  }
  const valuationAt = new Date(nowMs).toISOString();
  return [7, 14, 30].map((days) => {
    const expiry = new Date(Math.ceil((nowMs + days * 86_400_000) / 86_400_000) * 86_400_000 + 21 * 3_600_000);
    const expiryAt = expiry.toISOString();
    const rows = strikes.map((strike) => {
      const input = { spotUsd, strikeUsd: strike, expiryAt, valuationAt, volatility };
      const call = blackScholesEuropeanOption("call", input);
      const put = blackScholesEuropeanOption("put", input);
      return { strike, callPremium: call.premiumUsd, callDelta: call.delta, putPremium: put.premiumUsd, putDelta: put.delta };
    });
    return { expiryAt, label: expiry.toISOString().slice(0, 10), days, rows };
  });
}

export type DemoTicket = {
  side: "call" | "put"; strike: number; expiryAt: string; units: number; premiumPerUnit: number;
  cost: number; maxLoss: number; breakeven: number; maxGain: number | null;
};

/** Long call or long put what-if. Cost is the modeled premium; max loss is the premium paid. */
export function buildDemoTicket(side: "call" | "put", row: DemoOptionRow, expiryAt: string, units: number): DemoTicket {
  if (!(units > 0) || !Number.isFinite(units)) throw new RangeError("Units must be a positive number.");
  const premiumPerUnit = side === "call" ? row.callPremium : row.putPremium;
  const cost = premiumPerUnit * units;
  return {
    side, strike: row.strike, expiryAt, units, premiumPerUnit, cost, maxLoss: cost,
    breakeven: side === "call" ? row.strike + premiumPerUnit : row.strike - premiumPerUnit,
    maxGain: side === "call" ? null : Math.max(row.strike - premiumPerUnit, 0) * units,
  };
}

/** Profit or loss at expiry for a long option ticket, one point per spot price. */
export function demoPayoffAt(ticket: DemoTicket, spotAtExpiry: number): number {
  const intrinsic = ticket.side === "call" ? Math.max(spotAtExpiry - ticket.strike, 0) : Math.max(ticket.strike - spotAtExpiry, 0);
  return (intrinsic - ticket.premiumPerUnit) * ticket.units;
}
