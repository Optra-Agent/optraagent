/**
 * The Protective Floor model: a holding of 100 plus one long put, valued at expiry.
 * Pure arithmetic on two assumptions the reader controls (strike and premium). Nothing here is a quote,
 * a backtest or a recorded result. Values are "per 100 of entry value".
 */

export const ENTRY = 100;
export const PRICE_FROM = 60;
export const PRICE_TO = 140;
export const COLUMNS = 21;

export type FloorParams = { strike: number; premium: number };

/** 7% out of the money is the Protective Put recipe default. The premium is an assumption, not a market quote. */
export const DEFAULT_PARAMS: FloorParams = { strike: 93, premium: 2 };
export const STRIKE_RANGE = { min: 80, max: 100, step: 1 } as const;
export const PREMIUM_RANGE = { min: 0.5, max: 6, step: 0.5 } as const;

export type FloorColumn = {
  /** Underlying price at expiry. */
  price: number;
  /** Value of the holding with no put. */
  holding: number;
  /** Net value with the put, after the premium. */
  net: number;
  /** Part of the net value that comes from the holding itself. */
  kept: number;
  /** Part of the net value that the put supplies (the floor filling in). */
  put: number;
  /** Part of the holding value given up to pay the premium. */
  cost: number;
};

export function netAtExpiry(price: number, { strike, premium }: FloorParams): number {
  return Math.max(price, strike) - premium;
}

export function floorColumns(params: FloorParams, count = COLUMNS): FloorColumn[] {
  return Array.from({ length: count }, (_, index) => {
    const price = PRICE_FROM + ((PRICE_TO - PRICE_FROM) * index) / (count - 1);
    const net = netAtExpiry(price, params);
    const kept = Math.min(price, net);
    return { price, holding: price, net, kept, put: Math.max(0, net - kept), cost: Math.max(0, price - net) };
  });
}

export function floorReadout({ strike, premium }: FloorParams) {
  const floor = strike - premium;
  return {
    /** The lowest net value at expiry, whatever the price does. */
    floor,
    /** The most that is lost versus entry, in points per 100. */
    worstLoss: ENTRY - floor,
    /** The expiry price above which the position is ahead of entry after the premium. */
    breakeven: ENTRY + premium,
    /** How far below entry the put starts to pay, in percent. */
    otm: ENTRY - strike,
  };
}

export const clampParams = ({ strike, premium }: FloorParams): FloorParams => ({
  strike: Math.min(STRIKE_RANGE.max, Math.max(STRIKE_RANGE.min, Math.round(strike))),
  premium: Math.min(PREMIUM_RANGE.max, Math.max(PREMIUM_RANGE.min, Math.round(premium * 2) / 2)),
});
