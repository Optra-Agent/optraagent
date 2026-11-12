import type { MarketCandle } from "../domain/contracts";

const HOURS_PER_YEAR = 24 * 365;
const DAY_MS = 24 * 60 * 60 * 1000;

export type BlackScholesPutInput = {
  spotUsd: number;
  strikeUsd: number;
  expiryAt: string;
  valuationAt: string;
  volatility: number;
  riskFreeRate?: number;
  dividendYield?: number;
};

export type ModeledPutPremium = {
  premiumUsd: number;
  volatility: number;
  d1: number;
  d2: number;
  model: "black_scholes_european_put";
  unitShares: 1;
  assumptions: {
    riskFreeRate: number;
    dividendYield: number;
    dayCount: "365_calendar_days";
  };
};

function normalCdf(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

function validate(input: BlackScholesPutInput): { years: number; rate: number; yieldRate: number } {
  const spot = input.spotUsd;
  const strike = input.strikeUsd;
  const volatility = input.volatility;
  const valuationMs = new Date(input.valuationAt).getTime();
  const expiryMs = new Date(input.expiryAt).getTime();
  const rate = input.riskFreeRate ?? 0;
  const yieldRate = input.dividendYield ?? 0;
  if (![spot, strike, volatility, valuationMs, expiryMs, rate, yieldRate].every(Number.isFinite)) throw new RangeError("Black–Scholes inputs must be finite.");
  if (spot <= 0 || strike <= 0 || volatility <= 0 || expiryMs <= valuationMs) throw new RangeError("Black–Scholes requires positive prices/volatility and a future expiry.");
  if (rate < -1 || rate > 1 || yieldRate < -1 || yieldRate > 1) throw new RangeError("Black–Scholes rates must be between -100% and 100%.");
  return { years: (expiryMs - valuationMs) / (365 * DAY_MS), rate, yieldRate };
}

export function blackScholesEuropeanPut(input: BlackScholesPutInput): ModeledPutPremium {
  const { years, rate, yieldRate } = validate(input);
  const rootTime = Math.sqrt(years);
  const d1 = (Math.log(input.spotUsd / input.strikeUsd) + (rate - yieldRate + (input.volatility ** 2) / 2) * years) / (input.volatility * rootTime);
  const d2 = d1 - input.volatility * rootTime;
  const premiumUsd = input.strikeUsd * Math.exp(-rate * years) * normalCdf(-d2) - input.spotUsd * Math.exp(-yieldRate * years) * normalCdf(-d1);
  if (!Number.isFinite(premiumUsd) || premiumUsd < 0) throw new RangeError("Black–Scholes returned an invalid option premium.");
  return {
    premiumUsd,
    volatility: input.volatility,
    d1,
    d2,
    model: "black_scholes_european_put",
    unitShares: 1,
    assumptions: { riskFreeRate: rate, dividendYield: yieldRate, dayCount: "365_calendar_days" },
  };
}

export function annualizedRealizedVolatility(candles: readonly MarketCandle[], returnHours: number): number | null {
  if (!Number.isInteger(returnHours) || returnHours < 2 || candles.length < returnHours + 1) return null;
  const prices = candles.slice(-(returnHours + 1)).map((candle) => Number(candle.shareCloseUsd));
  if (prices.some((price) => !Number.isFinite(price) || price <= 0)) return null;
  const returns = prices.slice(1).map((price, index) => Math.log(price / prices[index]!));
  const mean = returns.reduce((total, value) => total + value, 0) / returns.length;
  const variance = returns.reduce((total, value) => total + (value - mean) ** 2, 0) / (returns.length - 1);
  const annualized = Math.sqrt(variance * HOURS_PER_YEAR);
  return Number.isFinite(annualized) && annualized > 0 ? annualized : null;
}

export function rv30ImpliedVolatility(candles: readonly MarketCandle[], multiplier = 1.1): { rv30: number; iv: number } | null {
  if (!Number.isFinite(multiplier) || multiplier <= 0) return null;
  const rv30 = annualizedRealizedVolatility(candles, 720);
  if (rv30 === null) return null;
  return { rv30, iv: rv30 * multiplier };
}
