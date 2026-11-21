import type { MarketCandle } from "../../lib/domain/contracts";
import type { EarningsEvent, EarningsSnapshot } from "../../lib/market/earnings";
import { buildHouseRecipe } from "../../lib/hooks/house-specs";
import type { HouseRecipeInput, HouseStrategyTemplateId } from "../../lib/hooks/house-specs";
import { canonicalRecipeHash } from "../../lib/hooks/recipe-validator";
import { initialStrategyAccount, runStrategyTick } from "../../lib/engine/strategy/run-strategy-tick";
import type { StrategyAccount, StrategyPosition, StrategyTickInput, StrategyTickResult } from "../../lib/engine/strategy/types";

export const HOUR = 3_600_000;
export const TOKEN = "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec";

/** Deterministic hourly share-price candles ending exactly at `endAt`: a base path plus a bounded, repeatable wiggle. */
export function makeCandles(options: { endAt: string; count: number; price: (index: number, count: number) => number; wiggle?: number; symbol?: string }): MarketCandle[] {
  const endMs = Date.parse(options.endAt);
  const wiggle = options.wiggle ?? 0.004;
  const candles: MarketCandle[] = [];
  for (let index = 0; index < options.count; index += 1) {
    const endAtMs = endMs - (options.count - 1 - index) * HOUR;
    const noise = 1 + wiggle * Math.sin(index * 1.7) * Math.cos(index * 0.31);
    const close = options.price(index, options.count) * noise;
    const open = options.price(Math.max(0, index - 1), options.count) * (1 + wiggle * Math.sin((index - 1) * 1.7) * Math.cos((index - 1) * 0.31));
    const high = Math.max(open, close) * 1.001;
    const low = Math.min(open, close) * 0.999;
    const fixed = (value: number) => value.toFixed(6);
    candles.push({
      symbol: options.symbol ?? "NVDA",
      source: "crius_robinhood_chain_candles",
      tokenAddress: TOKEN as MarketCandle["tokenAddress"],
      interval: "1h",
      startAt: new Date(endAtMs - HOUR).toISOString(),
      endAt: new Date(endAtMs).toISOString(),
      receivedAt: new Date(endAtMs + 60_000).toISOString(),
      tokenOpenUsd: fixed(open), tokenHighUsd: fixed(high), tokenLowUsd: fixed(low), tokenCloseUsd: fixed(close),
      shareOpenUsd: fixed(open), shareHighUsd: fixed(high), shareLowUsd: fixed(low), shareCloseUsd: fixed(close),
      multiplierSharesPerToken: "1",
      multiplierStatus: "stable_verified",
      tradeCount: 5,
      volumeUsd: "1000",
      poolCount: 1,
      filled: false,
    });
  }
  return candles;
}

export function earningsSnapshot(events: Array<Partial<EarningsEvent> & { reportDate: string }>, symbol = "NVDA"): EarningsSnapshot {
  return {
    symbol,
    source: "robinhood_marketdata_earnings",
    fetchedAt: "2026-11-09T00:00:00.000Z",
    events: events.map((event, index) => ({
      reportAt: null, timing: "pm", verified: true, fiscalYear: 2027, fiscalQuarter: index + 1, ...event,
    })),
  };
}

/** Tuesday 2026-11-10 15:00Z (10:00 ET, regular session). Weekly expiries follow on 11-13, 11-20 at 16:00 ET (21:00Z). */
export const SESSION_AT = "2026-11-10T15:00:00.000Z";

export type Harness = {
  recipe: ReturnType<typeof buildHouseRecipe>;
  hash: string;
  candles: MarketCandle[];
  run: (overrides?: Partial<StrategyTickInput> & { index?: number }) => StrategyTickResult;
};

/** A one-tick harness over a synthetic history. `index` selects the evaluated candle; everything before it is history. */
export function harness(templateId: HouseStrategyTemplateId, options: {
  recipe?: Partial<HouseRecipeInput>;
  candles?: MarketCandle[];
  earnings?: EarningsSnapshot | null;
  price?: (index: number, count: number) => number;
  count?: number;
  endAt?: string;
  wiggle?: number;
} = {}): Harness {
  const recipe = buildHouseRecipe(templateId, { underlyingSymbol: "NVDA", ...options.recipe });
  const hash = canonicalRecipeHash(recipe);
  const candles = options.candles ?? makeCandles({ endAt: options.endAt ?? SESSION_AT, count: options.count ?? 900, price: options.price ?? (() => 200), wiggle: options.wiggle ?? 0.006 });
  const earnings = options.earnings === undefined ? earningsSnapshot([{ reportDate: "2027-01-27" }]) : options.earnings;
  return {
    recipe, hash, candles,
    run(overrides = {}) {
      const { index = candles.length - 1, ...rest } = overrides;
      return runStrategyTick({
        agentId: "agent-1", tickId: `tick-${index}`, occurredAt: candles[index]!.endAt, recipe, recipeHash: hash, snapshot: null,
        currentCandle: candles[index]!, history: candles.slice(0, index), corporateActionDates: [], earnings,
        account: initialStrategyAccount(recipe, candles[index]!.endAt), positions: [], includeMarketContext: false, state: { status: "running" },
        ...rest,
      });
    },
  };
}

export function shortPosition(overrides: Partial<StrategyPosition> = {}): StrategyPosition {
  return {
    id: "pos-1", symbol: "NVDA", optionType: "call", side: "short", quantity: "10", averageEntryUsd: "3", markPriceUsd: "3", peakMarkPriceUsd: "3",
    strikeUsd: "210", expiryAt: "2026-11-13T21:00:00.000Z", impliedVolatility: "0.6", modelName: "black_scholes_european_call", premiumSource: "modeled",
    modelInputs: { rescues: 0 }, collateralUsd: "0", structureId: null, legRole: null, openedAt: "2026-11-09T15:00:00.000Z", status: "open", ...overrides,
  };
}

export function account(recipe: ReturnType<typeof buildHouseRecipe>, overrides: Partial<StrategyAccount> = {}, metaOverrides: Partial<StrategyAccount["meta"]> = {}): StrategyAccount {
  const base = initialStrategyAccount(recipe, SESSION_AT)!;
  return { ...base, ...overrides, meta: { ...base.meta, startedAt: "2026-11-09T15:00:00.000Z", referenceStartPriceUsd: "200", ...metaOverrides } };
}

export function hook(result: StrategyTickResult, hookId: string) {
  return result.decision.hookResults.find((item) => item.hookId === hookId);
}
