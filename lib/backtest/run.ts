import { createHash } from "node:crypto";
import {
  BacktestCoverageSchema,
  BacktestRunSchema,
  MarketCandleSchema,
  MarketSnapshotSchema,
} from "../domain/contracts";
import type { BacktestCoverage, BacktestRun, MarketCandle, MarketSnapshot, RecipeV1 } from "../domain/contracts";
import { runTick, type PaperAccountState, type PaperOptionPositionState } from "../engine/run-tick";
import { canonicalRecipeHash, validateRecipe } from "../hooks/recipe-validator";

export const REQUIRED_HOURLY_SAMPLES = 720;
export const REQUIRED_WARMUP_CANDLES = 721;
export const REQUIRED_HISTORY_CANDLES = REQUIRED_HOURLY_SAMPLES + REQUIRED_WARMUP_CANDLES;
const HOUR_MS = 60 * 60 * 1000;

function validSnapshots(input: MarketSnapshot[], symbol: string, nowMs: number): MarketSnapshot[] | null {
  const window = input.slice(-REQUIRED_HOURLY_SAMPLES);
  if (window.length !== REQUIRED_HOURLY_SAMPLES) return null;
  const parsed = window.map((snapshot) => MarketSnapshotSchema.safeParse(snapshot));
  if (parsed.some((result) => !result.success)) return null;
  const snapshots = parsed.map((result) => result.success ? result.data : null).filter((snapshot): snapshot is MarketSnapshot => snapshot !== null);
  if (snapshots.some((snapshot) => snapshot.symbol !== symbol || snapshot.stale)) return null;
  const times = snapshots.map((snapshot) => ({ observed: new Date(snapshot.observedAt).getTime(), received: new Date(snapshot.receivedAt).getTime() }));
  if (times.some(({ observed, received }) => observed > nowMs || received > nowMs || received < observed)) return null;
  for (let index = 1; index < times.length; index += 1) {
    const previous = times[index - 1]!;
    const current = times[index]!;
    const hourGap = Math.floor(current.observed / HOUR_MS) - Math.floor(previous.observed / HOUR_MS);
    if (hourGap !== 1 || current.observed <= previous.observed) return null;
  }
  return snapshots;
}

export function inspectHourlyCoverage(input: { symbol: string; snapshots: MarketSnapshot[]; now: string }): BacktestCoverage {
  const nowMs = new Date(input.now).getTime();
  const candidates = input.snapshots.slice(-REQUIRED_HOURLY_SAMPLES);
  const selected = validSnapshots(input.snapshots, input.symbol, nowMs);
  const timestamps = candidates
    .map((snapshot) => MarketSnapshotSchema.safeParse(snapshot))
    .filter((result) => result.success)
    .map((result) => result.data.observedAt);
  let consecutiveHours = 0;
  let currentStreak = 0;
  let previousHour: number | null = null;
  let previousObserved = 0;
  for (const candidate of candidates) {
    const parsed = MarketSnapshotSchema.safeParse(candidate);
    if (!parsed.success || parsed.data.symbol !== input.symbol || parsed.data.stale) {
      currentStreak = 0; previousHour = null; continue;
    }
    const observed = new Date(parsed.data.observedAt).getTime();
    const received = new Date(parsed.data.receivedAt).getTime();
    if (observed > nowMs || received > nowMs || received < observed) { currentStreak = 0; previousHour = null; continue; }
    const hour = Math.floor(observed / HOUR_MS);
    currentStreak = previousHour !== null && hour === previousHour + 1 && observed > previousObserved ? currentStreak + 1 : 1;
    consecutiveHours = Math.max(consecutiveHours, currentStreak);
    previousHour = hour;
    previousObserved = observed;
  }
  const reason = input.snapshots.length < REQUIRED_HOURLY_SAMPLES
    ? `Only ${input.snapshots.length} hourly samples are available; 720 are required.`
    : selected === null
      ? "The most recent samples contain invalid, stale, out-of-order, future, duplicate, or missing hourly data."
      : "720 consecutive UTC hourly market snapshots are available.";
  return BacktestCoverageSchema.parse({
    symbol: input.symbol,
    availableSamples: input.snapshots.length,
    requiredSamples: REQUIRED_HOURLY_SAMPLES,
    startAt: timestamps[0] ?? null,
    endAt: timestamps[timestamps.length - 1] ?? null,
    consecutiveHours,
    ready: selected !== null,
    reason,
  });
}

export function hashMarketCandles(candles: MarketCandle[]): `sha256:${string}` {
  const stable = candles.map((value) => {
    const candle = { ...MarketCandleSchema.parse(value) };
    delete (candle as Partial<MarketCandle>).receivedAt;
    return candle;
  });
  return `sha256:${createHash("sha256").update(JSON.stringify(stable)).digest("hex")}`;
}

export function inspectCandleCoverage(input: { symbol: string; candles: MarketCandle[]; now: string }): BacktestCoverage {
  const nowMs = new Date(input.now).getTime();
  let consecutiveHours = 0;
  let streak = 0;
  let previousStart = 0;
  let valid = true;
  const parsed: MarketCandle[] = [];
  for (const candidate of input.candles) {
    const result = MarketCandleSchema.safeParse(candidate);
    if (!result.success || result.data.symbol !== input.symbol || result.data.filled || result.data.tradeCount <= 0 || result.data.multiplierStatus !== "stable_verified") {
      valid = false;
      streak = 0;
      previousStart = 0;
      continue;
    }
    const candle = result.data;
    const start = new Date(candle.startAt).getTime();
    const end = new Date(candle.endAt).getTime();
    const received = new Date(candle.receivedAt).getTime();
    if (end > nowMs || received > nowMs || end - start !== HOUR_MS) { valid = false; streak = 0; previousStart = 0; continue; }
    streak = previousStart > 0 && start - previousStart === HOUR_MS ? streak + 1 : 1;
    consecutiveHours = Math.max(consecutiveHours, streak);
    previousStart = start;
    parsed.push(candle);
  }
  const consecutiveWindow = parsed.slice(-REQUIRED_HISTORY_CANDLES);
  const ready = valid && consecutiveWindow.length >= REQUIRED_HISTORY_CANDLES && consecutiveHours >= REQUIRED_HISTORY_CANDLES;
  const reason = ready
    ? `${REQUIRED_HOURLY_SAMPLES} hourly strategy samples and ${REQUIRED_WARMUP_CANDLES} warmup candles are consecutive, closed, nonempty, and multiplier verified.`
    : input.candles.some((candle) => candle.multiplierStatus === "action_in_window")
      ? "The candle window crosses a stock-token multiplier action; share-price normalization is unverified."
      : `Only ${consecutiveHours} consecutive verified candles are available; ${REQUIRED_HISTORY_CANDLES} are required for 720 decisions and RV30 warmup.`;
  const first = consecutiveWindow[0];
  const last = consecutiveWindow.at(-1);
  return BacktestCoverageSchema.parse({
    symbol: input.symbol,
    availableSamples: parsed.length,
    requiredSamples: REQUIRED_HISTORY_CANDLES,
    startAt: first?.startAt ?? null,
    endAt: last?.endAt ?? null,
    consecutiveHours,
    ready,
    dataSource: "crius_robinhood_chain_candles",
    tokenAddress: parsed[0]?.tokenAddress ?? null,
    multiplierStatus: input.candles.some((candle) => candle.multiplierStatus === "action_in_window") ? "action_in_window" : parsed.at(-1)?.multiplierStatus ?? "unverified",
    fillApplied: false,
    reason,
  });
}

function formatMetric(value: number): string {
  return value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

export function runBacktest(input: {
  runId: string;
  recipe: RecipeV1;
  candles?: MarketCandle[];
  corporateActionDates?: string[];
  now: string;
  requestedCandles?: number;
}): BacktestRun {
  const recipeHash = canonicalRecipeHash(input.recipe);
  const candles = input.candles ?? [];
  const coverage = inspectCandleCoverage({ symbol: input.recipe.underlyingSymbol, candles, now: input.now });
  const dataHash = hashMarketCandles(candles);
  const first = candles[0];
  const last = candles.at(-1);
  const provenance: Record<string, unknown> = {
    provider: "Crius Robinhood Chain OHLCV",
    endpoint: "GET /v1/robinhood/token/{contractAddress}/candles",
    interval: "1h",
    currency: "usd",
    requestedCandles: input.requestedCandles ?? 1500,
    returnedCandles: candles.length,
    fill: false,
    continuous: false,
    tokenAddress: first?.tokenAddress ?? null,
    multiplierSharesPerToken: first?.multiplierSharesPerToken ?? null,
    multiplierStatus: first?.multiplierStatus ?? "unverified",
    startAt: first?.startAt ?? null,
    endAt: last?.endAt ?? null,
    corporateActionDates: input.corporateActionDates ?? [],
  };
  const pricingAssumptions: Record<string, unknown> = {
    model: "black_scholes_european_put",
    volatility: "annualized sample standard deviation of 720 hourly log returns × 1.1",
    annualizationHours: 8760,
    riskFreeRate: 0,
    dividendYield: 0,
    tenor: "30 calendar days",
    modelUnitShares: 1,
    strikeIncrementUsd: 0.01,
    slippageBps: 50,
    venueFeesIncluded: false,
    venueOptionQuote: false,
  };
  const validation = validateRecipe(input.recipe);
  let status: BacktestRun["status"] = "insufficient_data";
  let reason = coverage.reason;
  let metrics: BacktestRun["metrics"] = null;
  let sampleCount = 0;
  let entryOrderCount = 0;
  let exitOrderCount = 0;
  if (coverage.ready && validation.valid) {
    const decisionStart = candles.length - REQUIRED_HOURLY_SAMPLES;
    const initialCapital = Number(input.recipe.parameters.initialCapitalUsd);
    let account: PaperAccountState = {
      initialCapitalUsd: initialCapital.toFixed(2),
      cashUsd: initialCapital.toFixed(2),
      realizedPnlUsd: "0",
      peakEquityUsd: initialCapital.toFixed(2),
      dailyStartEquityUsd: initialCapital.toFixed(2),
      dailyStartDate: candles[decisionStart]!.endAt.slice(0, 10),
    };
    let position: PaperOptionPositionState | null = null;
    const equitySeries: number[] = [initialCapital];
    for (let index = decisionStart; index < candles.length; index += 1) {
      const candle = candles[index]!;
      const result = runTick({
        agentId: `backtest:${input.runId}`,
        tickId: `sample-${index}`,
        occurredAt: candle.endAt,
        recipe: input.recipe,
        recipeHash,
        snapshot: null,
        currentCandle: candle,
        history: candles.slice(0, index),
        corporateActionDates: input.corporateActionDates,
        account,
        position,
        includeMarketContext: false,
        state: { status: "running" },
      });
      account = result.portfolio.account;
      position = result.portfolio.position?.status === "open" ? result.portfolio.position : null;
      entryOrderCount += result.orderIntents.filter((order) => order.action === "open").length;
      exitOrderCount += result.orderIntents.filter((order) => order.action === "close").length;
      const equity = Number(account.cashUsd) + (position ? Number(position.markPriceUsd) * Number(position.quantity) : 0);
      equitySeries.push(equity);
    }
    sampleCount = REQUIRED_HOURLY_SAMPLES;
    if (entryOrderCount > 0) {
      let peak = initialCapital;
      let maxDrawdownPct = 0;
      for (const equity of equitySeries) {
        peak = Math.max(peak, equity);
        if (peak > 0) maxDrawdownPct = Math.max(maxDrawdownPct, (peak - equity) / peak * 100);
      }
      const endingEquity = equitySeries.at(-1) ?? initialCapital;
      metrics = {
        totalReturnPct: formatMetric((endingEquity - initialCapital) / initialCapital * 100),
        maxDrawdownPct: formatMetric(maxDrawdownPct),
        endingCashUsd: formatMetric(Number(account.cashUsd)),
      };
      status = "complete";
      reason = `Replayed ${sampleCount} provider candles through the shared engine; ${entryOrderCount} modeled entry fills and ${exitOrderCount} modeled exits were applied with disclosed 50 bp slippage and no venue fees.`;
    } else {
      status = "failed";
      reason = "The complete historical window produced no modeled entry fills; no performance metrics are reported and launch remains blocked.";
    }
  } else if (coverage.ready && !validation.valid) {
    status = "failed";
    reason = `Recipe is not executable for paper options: ${validation.issues.map((issue) => issue.message).join(" ")}`;
  }

  return BacktestRunSchema.parse({
    id: input.runId,
    recipeHash,
    dataSource: first?.source ?? "unavailable",
    startAt: first?.startAt ?? input.now,
    endAt: last?.endAt ?? input.now,
    sampleCount,
    entryOrderCount,
    exitOrderCount,
    hourlyCoverageComplete: coverage.ready,
    premiumSource: status === "complete" ? "modeled" : "unavailable",
    pricingMethod: status === "complete" ? "modeled" : "unavailable",
    status,
    metrics,
    historyDataHash: dataHash,
    historyProvenance: provenance,
    pricingAssumptions,
    reason,
    createdAt: input.now,
  });
}
