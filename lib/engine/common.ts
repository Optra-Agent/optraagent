import { HookResultSchema, MarketCandleSchema, MarketSnapshotSchema } from "../domain/contracts";
import type { HookResult, MarketCandle, MarketSnapshot } from "../domain/contracts";

export const MAX_QUOTE_AGE_MS = 2 * 60 * 1000;
export const MAX_FUTURE_SKEW_MS = 15 * 1000;
export const HOUR_MS = 60 * 60 * 1000;
export const MODEL_SLIPPAGE_BPS = 50;

export type CurrentMarketInput = {
  occurredAt: string;
  recipe: { underlyingSymbol: string };
  snapshot: MarketSnapshot | null;
  currentCandle?: MarketCandle | null;
};

export function numeric(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function cents(value: number): string {
  return Math.max(0, value).toFixed(2);
}

export function premiumString(value: number): string {
  return Math.max(0, value).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

export function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function recordHook(
  hookId: string,
  stage: HookResult["stage"],
  status: HookResult["status"],
  reason: string,
  extras: Partial<Pick<HookResult, "value" | "threshold" | "unit" | "dataRefs">> = {},
): HookResult {
  return HookResultSchema.parse({ hookId, stage, status, reason, ...extras });
}

export function tradePrice(premium: number, side: "buy" | "sell"): number {
  const bps = MODEL_SLIPPAGE_BPS / 10_000;
  return premium * (side === "buy" ? 1 + bps : 1 - bps);
}

export function snapshotSpot(snapshot: MarketSnapshot): number {
  return (Number(snapshot.underlyingBidUsd) + Number(snapshot.underlyingAskUsd)) / 2;
}

export function findCurrentMarket(input: CurrentMarketInput): { spotUsd: number; observedAt: string; source: string; invalidReason: string | null } {
  if (input.currentCandle) {
    const parsed = MarketCandleSchema.safeParse(input.currentCandle);
    if (!parsed.success) return { spotUsd: 0, observedAt: input.occurredAt, source: "unavailable", invalidReason: "Historical candle does not match the market data contract." };
    const candle = parsed.data;
    if (candle.symbol !== input.recipe.underlyingSymbol || candle.multiplierStatus !== "stable_verified" || candle.filled || candle.endAt !== input.occurredAt) {
      return { spotUsd: 0, observedAt: candle.endAt, source: candle.source, invalidReason: "Historical candle is mismatched, incomplete, or has unverified multiplier provenance." };
    }
    return { spotUsd: Number(candle.shareCloseUsd), observedAt: candle.endAt, source: candle.source, invalidReason: null };
  }
  if (!input.snapshot) return { spotUsd: 0, observedAt: input.occurredAt, source: "unavailable", invalidReason: "A current Robinhood quote is unavailable." };
  const parsed = MarketSnapshotSchema.safeParse(input.snapshot);
  if (!parsed.success) return { spotUsd: 0, observedAt: input.occurredAt, source: "unavailable", invalidReason: "Current Robinhood quote does not match the market data contract." };
  const snapshot = parsed.data;
  if (snapshot.symbol !== input.recipe.underlyingSymbol) return { spotUsd: 0, observedAt: snapshot.observedAt, source: snapshot.source, invalidReason: "The current quote symbol does not match the recipe underlying." };
  const ageMs = new Date(input.occurredAt).getTime() - new Date(snapshot.observedAt).getTime();
  if (snapshot.stale || ageMs > MAX_QUOTE_AGE_MS || ageMs < -MAX_FUTURE_SKEW_MS) return { spotUsd: 0, observedAt: snapshot.observedAt, source: snapshot.source, invalidReason: "The current quote is stale or from the future." };
  if (snapshot.tradingHalt) return { spotUsd: 0, observedAt: snapshot.observedAt, source: snapshot.source, invalidReason: "Robinhood reports a trading halt." };
  return { spotUsd: snapshotSpot(snapshot), observedAt: snapshot.observedAt, source: snapshot.source, invalidReason: null };
}

export function validHistory(historyInput: MarketCandle[] | undefined, symbol: string, observedAt: string): { history: MarketCandle[]; reason: string | null } {
  if (!historyInput || historyInput.length < 721) return { history: [], reason: "At least 721 prior finalized hourly candles are required for RV30." };
  const parsed: MarketCandle[] = [];
  for (const value of historyInput) {
    const candle = MarketCandleSchema.safeParse(value);
    if (!candle.success || candle.data.symbol !== symbol || candle.data.multiplierStatus !== "stable_verified" || candle.data.filled) {
      return { history: [], reason: "Historical candles contain invalid, synthetic, or unverified multiplier data." };
    }
    if (new Date(candle.data.endAt).getTime() > new Date(observedAt).getTime()) return { history: [], reason: "Historical data includes a candle after the evaluation time." };
    parsed.push(candle.data);
  }
  const tail = parsed.slice(-721);
  for (let index = 1; index < tail.length; index += 1) {
    const previous = new Date(tail[index - 1]!.startAt).getTime();
    const current = new Date(tail[index]!.startAt).getTime();
    if (current - previous !== HOUR_MS) return { history: [], reason: "Historical data contains a missing or duplicate hourly candle." };
  }
  return { history: tail, reason: null };
}

