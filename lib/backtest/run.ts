import { createHash } from "node:crypto";
import {
  BacktestCoverageSchema,
  BacktestRunSchema,
  MarketCandleSchema,
  MarketSnapshotSchema,
} from "../domain/contracts";
import type { BacktestCoverage, BacktestRun, MarketCandle, MarketSnapshot, RecipeV1 } from "../domain/contracts";
import { runTick, type PaperAccountState, type PaperOptionPositionState } from "../engine/run-tick";
import { initialStrategyAccount, runStrategyTick, strategyEquity } from "../engine/strategy/run-strategy-tick";
import { applyPositionChanges } from "../engine/strategy/portfolio";
import type { StrategyAccount, StrategyPosition } from "../engine/strategy/types";
import { isHouseStrategyTemplate } from "../hooks/house-specs";
import type { HouseStrategyTemplateId } from "../hooks/house-specs";
import type { EarningsSnapshot } from "../market/earnings";
import { canonicalRecipeHash, validateRecipe } from "../hooks/recipe-validator";

export const REQUIRED_HOURLY_SAMPLES = 720;
export const REQUIRED_WARMUP_CANDLES = 721;
export const REQUIRED_HISTORY_CANDLES = REQUIRED_HOURLY_SAMPLES + REQUIRED_WARMUP_CANDLES;
export const MIN_SHORT_DECISION_HOURS = 168;
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

type ConsecutiveSelection = {
  window: MarketCandle[];
  fullWindow: boolean;
  shorterWindow: boolean;
  consecutiveHours: number;
  parsedCount: number;
  allValid: boolean;
  actionInWindow: boolean;
  tokenAddress: string | null;
  multiplierStatus: MarketCandle["multiplierStatus"];
};

function selectConsecutiveCandleWindow(input: { symbol: string; candles: MarketCandle[]; nowMs: number }): ConsecutiveSelection {
  let consecutiveHours = 0;
  let previousStart = 0;
  let allValid = true;
  let parsedCount = 0;
  let actionInWindow = false;
  let tokenAddress: string | null = null;
  let multiplierStatus: MarketCandle["multiplierStatus"] = "unverified";
  const streaks: MarketCandle[][] = [];
  let currentStreak: MarketCandle[] = [];

  for (const candidate of input.candles) {
    if ((candidate as Partial<MarketCandle>).multiplierStatus === "action_in_window") actionInWindow = true;
    const result = MarketCandleSchema.safeParse(candidate);
    if (!result.success || result.data.symbol !== input.symbol || result.data.filled || result.data.tradeCount <= 0 || result.data.multiplierStatus !== "stable_verified") {
      allValid = false;
      if (currentStreak.length > 0) { streaks.push(currentStreak); currentStreak = []; }
      previousStart = 0;
      continue;
    }
    const candle = result.data;
    const start = new Date(candle.startAt).getTime();
    const end = new Date(candle.endAt).getTime();
    const received = new Date(candle.receivedAt).getTime();
    if (end > input.nowMs || received > input.nowMs || end - start !== HOUR_MS) {
      allValid = false;
      if (currentStreak.length > 0) { streaks.push(currentStreak); currentStreak = []; }
      previousStart = 0;
      continue;
    }
    if (previousStart > 0 && start - previousStart === HOUR_MS) {
      currentStreak.push(candle);
    } else {
      if (currentStreak.length > 0) streaks.push(currentStreak);
      currentStreak = [candle];
    }
    consecutiveHours = Math.max(consecutiveHours, currentStreak.length);
    previousStart = start;
    parsedCount += 1;
    if (!tokenAddress) tokenAddress = candle.tokenAddress;
    multiplierStatus = candle.multiplierStatus;
  }
  if (currentStreak.length > 0) streaks.push(currentStreak);

  // Prefer the most recent streak that satisfies the full 1441-hour requirement.
  for (let idx = streaks.length - 1; idx >= 0; idx -= 1) {
    const streak = streaks[idx]!;
    if (streak.length >= REQUIRED_HISTORY_CANDLES) {
      return {
        window: streak.slice(-REQUIRED_HISTORY_CANDLES),
        fullWindow: true,
        shorterWindow: false,
        consecutiveHours,
        parsedCount,
        allValid,
        actionInWindow,
        tokenAddress,
        multiplierStatus,
      };
    }
  }

  // Otherwise, select the most recent streak that satisfies the full 721-hour warmup + >=168h decision window.
  const minShortTotal = REQUIRED_WARMUP_CANDLES + MIN_SHORT_DECISION_HOURS;
  for (let idx = streaks.length - 1; idx >= 0; idx -= 1) {
    const streak = streaks[idx]!;
    if (streak.length >= minShortTotal) {
      return {
        window: streak,
        fullWindow: false,
        shorterWindow: true,
        consecutiveHours,
        parsedCount,
        allValid,
        actionInWindow,
        tokenAddress,
        multiplierStatus,
      };
    }
  }

  const lastStreak = streaks.at(-1) ?? [];
  return {
    window: lastStreak,
    fullWindow: false,
    shorterWindow: false,
    consecutiveHours,
    parsedCount,
    allValid,
    actionInWindow,
    tokenAddress,
    multiplierStatus,
  };
}

export function inspectCandleCoverage(input: { symbol: string; candles: MarketCandle[]; now: string }): BacktestCoverage {
  const nowMs = new Date(input.now).getTime();
  const selection = selectConsecutiveCandleWindow({ symbol: input.symbol, candles: input.candles, nowMs });
  const ready = selection.fullWindow && (selection.allValid || selection.window.length >= REQUIRED_HISTORY_CANDLES);
  const reason = ready
    ? `${REQUIRED_HOURLY_SAMPLES} hourly strategy samples and ${REQUIRED_WARMUP_CANDLES} warmup candles are consecutive, closed, nonempty, and multiplier verified.`
    : selection.actionInWindow
      ? "The candle window crosses a stock-token multiplier action; share-price normalization is unverified."
      : `Only ${selection.consecutiveHours} consecutive verified candles are available; ${REQUIRED_HISTORY_CANDLES} are required for 720 decisions and RV30 warmup.`;
  const first = selection.window[0];
  const last = selection.window.at(-1);
  return BacktestCoverageSchema.parse({
    symbol: input.symbol,
    availableSamples: selection.parsedCount,
    requiredSamples: REQUIRED_HISTORY_CANDLES,
    startAt: first?.startAt ?? null,
    endAt: last?.endAt ?? null,
    consecutiveHours: selection.consecutiveHours,
    ready,
    dataSource: "crius_robinhood_chain_candles",
    tokenAddress: selection.tokenAddress,
    multiplierStatus: selection.actionInWindow ? "action_in_window" : selection.multiplierStatus,
    fillApplied: false,
    reason,
  });
}

function formatMetric(value: number): string {
  return value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

const STRATEGY_PRICING: Record<HouseStrategyTemplateId, { model: string; description: string }> = {
  covered_call: { model: "black_scholes_european_call", description: "short weekly call, 5% out of the money by default, against virtual reference shares" },
  cash_secured_put: { model: "black_scholes_european_put", description: "short weekly put at a 0.25 target delta, secured by virtual USDG equal to strike × quantity" },
  earnings_straddle: { model: "black_scholes_european_straddle", description: "long at-the-money call and put opened before a company-confirmed earnings report" },
};

function sha256Json(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function runStrategyBacktest(input: {
  runId: string;
  recipe: RecipeV1;
  templateId: HouseStrategyTemplateId;
  candles: MarketCandle[];
  corporateActionDates: string[];
  earnings: EarningsSnapshot | null;
  now: string;
  requestedCandles?: number;
  allowShorterWindow?: boolean;
}): BacktestRun {
  const { recipe, candles, templateId } = input;
  const recipeHash = canonicalRecipeHash(recipe);
  const coverage = inspectCandleCoverage({ symbol: recipe.underlyingSymbol, candles, now: input.now });
  const selection = selectConsecutiveCandleWindow({ symbol: recipe.underlyingSymbol, candles, nowMs: new Date(input.now).getTime() });
  const canReplay = selection.fullWindow || (Boolean(input.allowShorterWindow) && selection.shorterWindow);
  const replayCandles = canReplay ? selection.window : candles;
  const first = replayCandles[0];
  const last = replayCandles.at(-1);
  const earningsEvents = input.earnings?.events ?? [];
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
    corporateActionDates: input.corporateActionDates,
    earnings: input.earnings
      ? { source: input.earnings.source, fetchedAt: input.earnings.fetchedAt, eventCount: earningsEvents.length, eventsHash: sha256Json(earningsEvents), historicalDatesAsPublishedNow: true }
      : { source: "unavailable", fetchedAt: null, eventCount: 0, eventsHash: null },
  };
  const spec = STRATEGY_PRICING[templateId];
  const pricingAssumptions: Record<string, unknown> = {
    model: spec.model,
    strategy: spec.description,
    volatility: "annualized sample standard deviation of 720 hourly log returns × 1.1 (RV30 proxy; no option-chain IV)",
    ivRank: "Volra ranks the latest 168-hour realized volatility within the 30-day window; it is a modeled proxy, not an option-chain IV rank",
    annualizationHours: 8760,
    riskFreeRate: 0,
    dividendYield: 0,
    tenor: "weekly 16:00 America/New_York expiries chosen by Tenora; positions settle at the modeled intrinsic value (cash settled)",
    modelUnitShares: 1,
    strikeIncrementUsd: 0.01,
    slippageBps: 50,
    venueFeesIncluded: false,
    venueOptionQuote: false,
    earningsIvPremiumModeled: false,
    benchmarks: {
      underlying: templateId === "covered_call"
        ? "hold the same virtual reference shares with the cash buffer idle; price-only, no dividends, fees, or slippage"
        : "buy initial USD capital at the first decision candle's share-normalized close and hold to the final decision candle close; price-only, no dividends, fees, or slippage",
      cash: "flat USD-denominated initial capital with zero yield; no USDG/USD market price path is modeled",
    },
  };
  const validation = validateRecipe(recipe);
  let status: BacktestRun["status"] = "insufficient_data";
  let reason = coverage.reason;
  let metrics: BacktestRun["metrics"] = null;
  let sampleCount = 0;
  let entryOrderCount = 0;
  let exitOrderCount = 0;

  if (canReplay && validation.valid) {
    const decisionStart = REQUIRED_WARMUP_CANDLES;
    const decisionCandles = replayCandles.slice(decisionStart);
    let account: StrategyAccount | null = initialStrategyAccount(recipe, replayCandles[decisionStart]!.endAt);
    let positions: StrategyPosition[] = [];
    const decisionCounts = { open: 0, hold: 0, close: 0, skip: 0 };
    const equitySeries: number[] = [];
    let idSequence = 0;
    for (let index = decisionStart; index < replayCandles.length; index += 1) {
      const candle = replayCandles[index]!;
      const result = runStrategyTick({
        agentId: `backtest:${input.runId}`,
        tickId: `sample-${index}`,
        occurredAt: candle.endAt,
        recipe,
        recipeHash,
        snapshot: null,
        currentCandle: candle,
        history: replayCandles.slice(0, index),
        corporateActionDates: input.corporateActionDates,
        earnings: input.earnings,
        account,
        positions,
        includeMarketContext: false,
        state: { status: "running" },
      });
      decisionCounts[result.decision.action] += 1;
      account = result.portfolio.account;
      positions = applyPositionChanges(positions, result.portfolio.changes, (key) => `${input.runId}:${idSequence++}:${key}`);
      entryOrderCount += result.orderIntents.filter((order) => order.action === "open" && order.purpose === "open").length;
      exitOrderCount += result.orderIntents.filter((order) => order.action !== "open").length;
      const equity = strategyEquity(templateId, account, positions, Number(candle.shareCloseUsd));
      equitySeries.push(equity);
    }
    sampleCount = decisionCandles.length;
    const windowDisclosure = selection.fullWindow
      ? ""
      : ` (shorter verified window after ${REQUIRED_WARMUP_CANDLES}-hour RV30 warmup; 720-hour full window unavailable)`;
    const startingSharePrice = Number(decisionCandles[0]!.shareCloseUsd);
    const endingSharePrice = Number(decisionCandles.at(-1)!.shareCloseUsd);
    const benchmarkPricesValid = startingSharePrice > 0 && endingSharePrice > 0 && Number.isFinite(startingSharePrice) && Number.isFinite(endingSharePrice);
    if (entryOrderCount === 0) {
      status = "failed";
      reason = selection.fullWindow
        ? "The complete historical window produced no modeled entry fills; no performance metrics are reported and launch remains blocked."
        : `The shorter verified historical window (${sampleCount} hourly decisions after ${REQUIRED_WARMUP_CANDLES}-hour RV30 warmup) produced no modeled entry fills; no performance metrics are reported and launch remains blocked.`;
    } else if (!benchmarkPricesValid || !account) {
      status = "failed";
      reason = "The first or last decision candle has an invalid share-normalized close; no performance metrics are reported and launch remains blocked.";
    } else {
      const capital = Number(recipe.parameters.initialCapitalUsd);
      const shares = templateId === "covered_call" ? Number(recipe.parameters.referenceShares) : 0;
      // The equity baseline is the account's value before any trade: cash plus (Covered Call) the shares at the first candle.
      const baseline = capital + shares * startingSharePrice;
      const endingEquity = equitySeries.at(-1) ?? baseline;
      let peak = baseline;
      let maxDrawdownPct = 0;
      for (const equity of equitySeries) {
        peak = Math.max(peak, equity);
        if (peak > 0) maxDrawdownPct = Math.max(maxDrawdownPct, (peak - equity) / peak * 100);
      }
      const totalReturnPct = (endingEquity - baseline) / baseline * 100;
      const holdingEnding = templateId === "covered_call" ? capital + shares * endingSharePrice : capital * endingSharePrice / startingSharePrice;
      const holdingReturnPct = (holdingEnding - baseline) / baseline * 100;
      metrics = {
        totalReturnPct: formatMetric(totalReturnPct),
        maxDrawdownPct: formatMetric(maxDrawdownPct),
        endingCashUsd: formatMetric(Number(account.cashUsd)),
        benchmarks: {
          window: { startAt: decisionCandles[0]!.endAt, endAt: decisionCandles.at(-1)!.endAt, decisionSamples: decisionCandles.length },
          underlying: {
            symbol: recipe.underlyingSymbol,
            startingValueUsd: formatMetric(baseline),
            endingValueUsd: formatMetric(holdingEnding),
            returnPct: formatMetric(holdingReturnPct),
            method: templateId === "covered_call" ? "hold_reference_shares_cash_idle" : "buy_and_hold_price_only",
            dividendsIncluded: false,
            feesIncluded: false,
          },
          cash: { startingValueUsd: formatMetric(baseline), endingValueUsd: formatMetric(baseline), returnPct: "0", denomination: "USD", method: "flat_no_yield", usdGPricePath: "not_modeled" },
          vsHoldingPct: formatMetric(totalReturnPct - holdingReturnPct),
          vsCashPct: formatMetric(totalReturnPct),
        },
        strategy: {
          entries: account.meta.entries,
          closes: account.meta.closes,
          winningCloses: account.meta.winningCloses,
          rolls: account.meta.rolls,
          settledItm: account.meta.settledItm,
          settledOtm: account.meta.settledOtm,
          premiumCollectedUsd: account.meta.premiumCollectedUsd,
          premiumPaidUsd: account.meta.premiumPaidUsd,
          decisionCounts,
          worstTradeUsd: account.meta.worstTradeUsd,
        },
      };
      status = "complete";
      reason = `Replayed ${sampleCount} provider candles${windowDisclosure} through the shared strategy engine; ${entryOrderCount} modeled entries and ${exitOrderCount} modeled exits or settlements were applied with disclosed 50 bp slippage and no venue fees.`;
    }
  } else if (canReplay && !validation.valid) {
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
    hourlyCoverageComplete: selection.fullWindow,
    premiumSource: status === "complete" ? "modeled" : "unavailable",
    pricingMethod: status === "complete" ? "modeled" : "unavailable",
    status,
    metrics,
    historyDataHash: hashMarketCandles(candles),
    historyProvenance: provenance,
    pricingAssumptions,
    reason,
    createdAt: input.now,
  });
}

export function runBacktest(input: {
  runId: string;
  recipe: RecipeV1;
  candles?: MarketCandle[];
  corporateActionDates?: string[];
  earnings?: EarningsSnapshot | null;
  now: string;
  requestedCandles?: number;
  allowShorterWindow?: boolean;
}): BacktestRun {
  if (isHouseStrategyTemplate(input.recipe.templateId)) {
    return runStrategyBacktest({
      runId: input.runId,
      recipe: input.recipe,
      templateId: input.recipe.templateId,
      candles: input.candles ?? [],
      corporateActionDates: input.corporateActionDates ?? [],
      earnings: input.earnings ?? null,
      now: input.now,
      ...(input.requestedCandles !== undefined ? { requestedCandles: input.requestedCandles } : {}),
      ...(input.allowShorterWindow !== undefined ? { allowShorterWindow: input.allowShorterWindow } : {}),
    });
  }
  const recipeHash = canonicalRecipeHash(input.recipe);
  const candles = input.candles ?? [];
  const coverage = inspectCandleCoverage({ symbol: input.recipe.underlyingSymbol, candles, now: input.now });
  const selection = selectConsecutiveCandleWindow({ symbol: input.recipe.underlyingSymbol, candles, nowMs: new Date(input.now).getTime() });
  const canReplay = selection.fullWindow || (Boolean(input.allowShorterWindow) && selection.shorterWindow);
  const replayCandles = canReplay ? selection.window : candles;
  const dataHash = hashMarketCandles(candles);
  const first = replayCandles[0];
  const last = replayCandles.at(-1);
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
    benchmarks: {
      underlying: "buy initial USD capital at the first decision candle's share-normalized close and hold to the final decision candle close; price-only, no dividends, fees, or slippage",
      cash: "flat USD-denominated initial capital with zero yield; no USDG/USD market price path is modeled",
    },
  };
  const validation = validateRecipe(input.recipe);
  let status: BacktestRun["status"] = "insufficient_data";
  let reason = coverage.reason;
  let metrics: BacktestRun["metrics"] = null;
  let sampleCount = 0;
  let entryOrderCount = 0;
  let exitOrderCount = 0;
  if (canReplay && validation.valid) {
    const decisionStart = REQUIRED_WARMUP_CANDLES;
    const initialCapital = Number(input.recipe.parameters.initialCapitalUsd);
    let account: PaperAccountState = {
      initialCapitalUsd: initialCapital.toFixed(2),
      cashUsd: initialCapital.toFixed(2),
      realizedPnlUsd: "0",
      peakEquityUsd: initialCapital.toFixed(2),
      dailyStartEquityUsd: initialCapital.toFixed(2),
      dailyStartDate: replayCandles[decisionStart]!.endAt.slice(0, 10),
    };
    let position: PaperOptionPositionState | null = null;
    const equitySeries: number[] = [initialCapital];
    for (let index = decisionStart; index < replayCandles.length; index += 1) {
      const candle = replayCandles[index]!;
      const result = runTick({
        agentId: `backtest:${input.runId}`,
        tickId: `sample-${index}`,
        occurredAt: candle.endAt,
        recipe: input.recipe,
        recipeHash,
        snapshot: null,
        currentCandle: candle,
        history: replayCandles.slice(0, index),
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
    const decisionCandles = replayCandles.slice(decisionStart);
    sampleCount = decisionCandles.length;
    const windowDisclosure = selection.fullWindow
      ? ""
      : ` (shorter verified window after ${REQUIRED_WARMUP_CANDLES}-hour RV30 warmup; 720-hour full window unavailable)`;
    if (entryOrderCount > 0) {
      const startingSharePrice = Number(decisionCandles[0]!.shareCloseUsd);
      const endingSharePrice = Number(decisionCandles.at(-1)!.shareCloseUsd);
      const benchmarkPricesValid = Number.isFinite(startingSharePrice) && startingSharePrice > 0
        && Number.isFinite(endingSharePrice) && endingSharePrice > 0;
      if (!benchmarkPricesValid) {
        status = "failed";
        reason = "The first or last decision candle has an invalid share-normalized close; no performance metrics are reported and launch remains blocked.";
      } else {
        let peak = initialCapital;
        let maxDrawdownPct = 0;
        for (const equity of equitySeries) {
          peak = Math.max(peak, equity);
          if (peak > 0) maxDrawdownPct = Math.max(maxDrawdownPct, (peak - equity) / peak * 100);
        }
        const endingEquity = equitySeries.at(-1) ?? initialCapital;
        const totalReturnPct = (endingEquity - initialCapital) / initialCapital * 100;
        const underlyingEndingValue = initialCapital * endingSharePrice / startingSharePrice;
        const underlyingReturnPct = (underlyingEndingValue - initialCapital) / initialCapital * 100;
        metrics = {
          totalReturnPct: formatMetric(totalReturnPct),
          maxDrawdownPct: formatMetric(maxDrawdownPct),
          endingCashUsd: formatMetric(Number(account.cashUsd)),
          benchmarks: {
            window: {
              startAt: decisionCandles[0]!.endAt,
              endAt: decisionCandles.at(-1)!.endAt,
              decisionSamples: decisionCandles.length,
            },
            underlying: {
              symbol: input.recipe.underlyingSymbol,
              startingValueUsd: formatMetric(initialCapital),
              endingValueUsd: formatMetric(underlyingEndingValue),
              returnPct: formatMetric(underlyingReturnPct),
              method: "buy_and_hold_price_only",
              dividendsIncluded: false,
              feesIncluded: false,
            },
            cash: {
              startingValueUsd: formatMetric(initialCapital),
              endingValueUsd: formatMetric(initialCapital),
              returnPct: "0",
              denomination: "USD",
              method: "flat_no_yield",
              usdGPricePath: "not_modeled",
            },
            vsHoldingPct: formatMetric(totalReturnPct - underlyingReturnPct),
            vsCashPct: formatMetric(totalReturnPct),
          },
        };
        status = "complete";
        reason = `Replayed ${sampleCount} provider candles${windowDisclosure} through the shared engine; ${entryOrderCount} modeled entry fills and ${exitOrderCount} modeled exits were applied with disclosed 50 bp slippage and no venue fees.`;
      }
    } else {
      status = "failed";
      reason = selection.fullWindow
        ? "The complete historical window produced no modeled entry fills; no performance metrics are reported and launch remains blocked."
        : `The shorter verified historical window (${sampleCount} hourly decisions after ${REQUIRED_WARMUP_CANDLES}-hour RV30 warmup) produced no modeled entry fills; no performance metrics are reported and launch remains blocked.`;
    }
  } else if (canReplay && !validation.valid) {
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
    hourlyCoverageComplete: selection.fullWindow,
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
