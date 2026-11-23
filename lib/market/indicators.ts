/**
 * Technical indicators computed only from the candles passed in. Nothing is padded or extrapolated: a value is null until
 * enough real closes exist, and callers must say so instead of drawing something.
 */

/** Simple moving average of `period` closes. */
export function sma(closes: readonly number[], period: number): Array<number | null> {
  const out: Array<number | null> = [];
  let sum = 0;
  for (let index = 0; index < closes.length; index += 1) {
    sum += closes[index]!;
    if (index >= period) sum -= closes[index - period]!;
    out.push(index >= period - 1 ? sum / period : null);
  }
  return out;
}

/** Exponential moving average, seeded with the SMA of the first `period` closes. */
export function ema(closes: readonly number[], period: number): Array<number | null> {
  const out: Array<number | null> = new Array(closes.length).fill(null);
  if (closes.length < period) return out;
  const k = 2 / (period + 1);
  let previous = closes.slice(0, period).reduce((total, value) => total + value, 0) / period;
  out[period - 1] = previous;
  for (let index = period; index < closes.length; index += 1) {
    previous = closes[index]! * k + previous * (1 - k);
    out[index] = previous;
  }
  return out;
}

/** Wilder's RSI. Needs `period + 1` closes before the first value. */
export function rsi(closes: readonly number[], period = 14): Array<number | null> {
  const out: Array<number | null> = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gain = 0; let loss = 0;
  for (let index = 1; index <= period; index += 1) {
    const change = closes[index]! - closes[index - 1]!;
    if (change >= 0) gain += change; else loss -= change;
  }
  let averageGain = gain / period; let averageLoss = loss / period;
  const toRsi = () => (averageLoss === 0 ? (averageGain === 0 ? 50 : 100) : 100 - 100 / (1 + averageGain / averageLoss));
  out[period] = toRsi();
  for (let index = period + 1; index < closes.length; index += 1) {
    const change = closes[index]! - closes[index - 1]!;
    averageGain = (averageGain * (period - 1) + Math.max(change, 0)) / period;
    averageLoss = (averageLoss * (period - 1) + Math.max(-change, 0)) / period;
    out[index] = toRsi();
  }
  return out;
}

export type MacdPoint = { macd: number; signal: number | null; histogram: number | null };

/** MACD (fast EMA minus slow EMA) with its signal EMA. Needs `slow` closes for the line and `slow + signal - 1` for the signal. */
export function macd(closes: readonly number[], fast = 12, slow = 26, signalPeriod = 9): Array<MacdPoint | null> {
  const fastEma = ema(closes, fast); const slowEma = ema(closes, slow);
  const line: Array<number | null> = closes.map((_, index) => (fastEma[index] != null && slowEma[index] != null ? fastEma[index]! - slowEma[index]! : null));
  const firstIndex = line.findIndex((value) => value !== null);
  const signal: Array<number | null> = new Array(closes.length).fill(null);
  if (firstIndex >= 0) {
    const defined = line.slice(firstIndex) as number[];
    ema(defined, signalPeriod).forEach((value, offset) => { signal[firstIndex + offset] = value; });
  }
  return line.map((value, index) => (value === null ? null : { macd: value, signal: signal[index] ?? null, histogram: signal[index] == null ? null : value - signal[index]! }));
}
