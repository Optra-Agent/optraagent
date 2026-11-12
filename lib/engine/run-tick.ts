import { createHash } from "node:crypto";
import {
  AgentDecisionSchema,
  HookResultSchema,
  MarketCandleSchema,
  MarketSnapshotSchema,
  RecipeV1Schema,
} from "../domain/contracts";
import type { AgentDecision, HookResult, MarketCandle, MarketSnapshot, RecipeV1 } from "../domain/contracts";
import { annualizedRealizedVolatility, blackScholesEuropeanPut, rv30ImpliedVolatility } from "../options/black-scholes";
import { canonicalRecipeHash, validateRecipe } from "../hooks/recipe-validator";
import { isRegularEquitySession } from "./us-market-session";

const MAX_QUOTE_AGE_MS = 2 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 15 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MODEL_SLIPPAGE_BPS = 50;

export type TickState = { status: "draft" | "running" | "paused" | "stopped" };

export type PaperAccountState = {
  initialCapitalUsd: string;
  cashUsd: string;
  realizedPnlUsd: string;
  peakEquityUsd: string;
  dailyStartEquityUsd: string;
  dailyStartDate: string;
};

export type PaperOptionPositionState = {
  id?: string;
  symbol: string;
  quantity: string;
  averageEntryUsd: string;
  markPriceUsd: string;
  peakMarkPriceUsd: string;
  strikeUsd: string;
  expiryAt: string;
  impliedVolatility: string;
  modelName: "black_scholes_european_put";
  premiumSource: "modeled";
  modelInputs: Record<string, unknown>;
  openedAt: string;
  status: "open" | "closed";
};

export type PaperOrderIntent = {
  action: "open" | "close";
  symbol: string;
  side: "buy" | "sell";
  quantity: string;
  priceUsd: string;
  modelPremiumUsd: string;
  feeUsd: "0";
  slippageBps: number;
  instrumentType: "modeled_option";
  optionType: "put";
  strikeUsd: string;
  expiryAt: string;
  impliedVolatility: string;
  modelName: "black_scholes_european_put";
  premiumSource: "modeled";
  modelInputs: Record<string, unknown>;
  positionId?: string;
};

export type PaperPortfolioUpdate = {
  account: PaperAccountState;
  position: PaperOptionPositionState | null;
  positionAction: "unchanged" | "open" | "update" | "close";
};

export type RunTickInput = {
  agentId: string;
  tickId: string;
  occurredAt: string;
  recipe: RecipeV1;
  recipeHash: string;
  snapshot: MarketSnapshot | null;
  currentCandle?: MarketCandle | null;
  history?: MarketCandle[];
  corporateActionDates?: string[];
  account?: PaperAccountState | null;
  position?: PaperOptionPositionState | null;
  includeMarketContext?: boolean;
  state: TickState;
};

export type RunTickResult = {
  decision: AgentDecision;
  orderIntents: PaperOrderIntent[];
  portfolio: PaperPortfolioUpdate;
};

function numeric(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function cents(value: number): string {
  return Math.max(0, value).toFixed(2);
}

function premiumString(value: number): string {
  return Math.max(0, value).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function recordHook(
  hookId: string,
  stage: HookResult["stage"],
  status: HookResult["status"],
  reason: string,
  extras: Partial<Pick<HookResult, "value" | "threshold" | "unit" | "dataRefs">> = {},
): HookResult {
  return HookResultSchema.parse({ hookId, stage, status, reason, ...extras });
}

function prerequisiteTrace(failingHooks: string[], reason: string): HookResult[] {
  const stages: Record<string, HookResult["stage"]> = {
    calmo: "gate", corpax: "gate", sessia: "gate", percy: "strike", tenora: "strike", coverix: "size", capra: "size",
    trailo: "pulse", lastra: "expiry", nextra: "expiry", haltr: "breaker", daylo: "breaker", drawra: "breaker", exposa: "breaker", venux: "breaker",
  };
  const failing = new Set(failingHooks);
  return Object.entries(stages).map(([hookId, stage]) => recordHook(
    hookId,
    stage,
    failing.has(hookId) ? "block" : "noop",
    failing.has(hookId) ? reason : `Not evaluated because a prerequisite failed: ${reason}`,
  ));
}

function initialAccount(recipe: RecipeV1, occurredAt: string, account: PaperAccountState | null | undefined): PaperAccountState | null {
  const initialCapital = numeric(recipe.parameters.initialCapitalUsd);
  if (!initialCapital || initialCapital <= 0) return null;
  const date = occurredAt.slice(0, 10);
  return {
    initialCapitalUsd: account?.initialCapitalUsd ?? cents(initialCapital),
    cashUsd: account?.cashUsd ?? cents(initialCapital),
    realizedPnlUsd: account?.realizedPnlUsd ?? "0",
    peakEquityUsd: account?.peakEquityUsd ?? cents(initialCapital),
    dailyStartEquityUsd: account?.dailyStartEquityUsd ?? cents(initialCapital),
    dailyStartDate: account?.dailyStartDate ?? date,
  };
}

function roundStrike(spot: number, otmPct: number, increment: number, rounding: unknown): number {
  const target = spot * (1 - otmPct / 100);
  const scaled = target / increment;
  const rounded = rounding === "up" ? Math.ceil(scaled) : rounding === "down" ? Math.floor(scaled) : Math.round(scaled);
  return Number((rounded * increment).toFixed(2));
}

function tradePrice(premium: number, side: "buy" | "sell"): number {
  const bps = MODEL_SLIPPAGE_BPS / 10_000;
  return premium * (side === "buy" ? 1 + bps : 1 - bps);
}

function snapshotSpot(snapshot: MarketSnapshot): number {
  return (Number(snapshot.underlyingBidUsd) + Number(snapshot.underlyingAskUsd)) / 2;
}

function findCurrentMarket(input: RunTickInput): { spotUsd: number; observedAt: string; source: string; invalidReason: string | null } {
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

function validHistory(historyInput: MarketCandle[] | undefined, symbol: string, observedAt: string): { history: MarketCandle[]; reason: string | null } {
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

function computeMark(position: PaperOptionPositionState, spot: number, volatility: number, valuationAt: string): number {
  const expiryMs = new Date(position.expiryAt).getTime();
  if (expiryMs <= new Date(valuationAt).getTime()) return Math.max(0, Number(position.strikeUsd) - spot);
  return blackScholesEuropeanPut({
    spotUsd: spot,
    strikeUsd: Number(position.strikeUsd),
    expiryAt: position.expiryAt,
    valuationAt,
    volatility,
  }).premiumUsd;
}

function finalize(input: RunTickInput, action: AgentDecision["action"], reason: string, hookResults: HookResult[], source: string, orders: PaperOrderIntent[], portfolio: PaperPortfolioUpdate): RunTickResult {
  const history = input.history?.slice(-721) ?? [];
  const stableHistory = history.map((value) => {
    const candle = { ...MarketCandleSchema.parse(value) };
    delete (candle as Partial<MarketCandle>).receivedAt;
    return candle;
  });
  const historyDataHash = `sha256:${createHash("sha256").update(JSON.stringify(stableHistory)).digest("hex")}`;
  const marketContext = input.includeMarketContext === false ? undefined : {
    observation: input.snapshot ?? input.currentCandle ?? null,
    historyDataHash,
    history,
    corporateActionDates: input.corporateActionDates ?? [],
    model: input.recipe.parameters.paperModel ?? null,
  };
  return {
    decision: AgentDecisionSchema.parse({
      id: `${input.agentId}:${input.tickId}`,
      agentId: input.agentId,
      tickId: input.tickId,
      action,
      reason,
      hookResults,
      ...(marketContext ? { marketContext } : {}),
      snapshotSource: source,
      recipeHash: input.recipeHash,
      createdAt: input.occurredAt,
    }),
    orderIntents: orders,
    portfolio,
  };
}

export function runTick(input: RunTickInput): RunTickResult {
  const hookResults: HookResult[] = [];
  const emptyPortfolio: PaperPortfolioUpdate = {
    account: initialAccount(input.recipe, input.occurredAt, input.account) ?? {
      initialCapitalUsd: "0", cashUsd: "0", realizedPnlUsd: "0", peakEquityUsd: "0", dailyStartEquityUsd: "0", dailyStartDate: input.occurredAt.slice(0, 10),
    },
    position: input.position ?? null,
    positionAction: "unchanged",
  };
  const recipeParse = RecipeV1Schema.safeParse(input.recipe);
  const recipe = recipeParse.success ? recipeParse.data : input.recipe;
  const hash = recipeParse.success ? canonicalRecipeHash(recipeParse.data) : input.recipeHash;
  if (input.state.status !== "running") {
    const reason = `Agent is ${input.state.status}; paper ticks require a running agent.`;
    hookResults.push(recordHook("system.agent_state", undefined, "block", reason));
    return finalize(input, "skip", reason, hookResults, input.snapshot?.source ?? input.currentCandle?.source ?? "unavailable", [], emptyPortfolio);
  }
  if (!recipeParse.success || hash !== input.recipeHash) {
    const reason = "Recipe payload or canonical hash is invalid.";
    hookResults.push(recordHook("system.recipe_hash", undefined, "error", reason));
    return finalize(input, "skip", reason, hookResults, input.snapshot?.source ?? input.currentCandle?.source ?? "unavailable", [], emptyPortfolio);
  }
  const validation = validateRecipe(recipe);
  if (!validation.valid) {
    for (const issue of validation.issues) hookResults.push(recordHook(issue.hookId ?? "system.recipe_validator", undefined, "block", issue.message));
    return finalize(input, "skip", validation.issues.map((issue) => issue.message).join(" "), hookResults, input.snapshot?.source ?? input.currentCandle?.source ?? "unavailable", [], emptyPortfolio);
  }

  const account = initialAccount(recipe, input.occurredAt, input.account);
  if (!account) {
    const reason = "Paper account capital is missing or invalid.";
    hookResults.push(recordHook("system.paper_account", undefined, "error", reason));
    return finalize(input, "skip", reason, hookResults, input.snapshot?.source ?? input.currentCandle?.source ?? "unavailable", [], emptyPortfolio);
  }
  const current = findCurrentMarket(input);
  if (current.invalidReason || current.spotUsd <= 0 || !Number.isFinite(current.spotUsd)) {
    const reason = current.invalidReason ?? "The current underlying price is invalid.";
    hookResults.push(...prerequisiteTrace(["haltr", "venux"], reason));
    return finalize(input, "skip", reason, hookResults, current.source, [], { ...emptyPortfolio, account });
  }
  const { history, reason: historyError } = validHistory(input.history, recipe.underlyingSymbol, current.observedAt);
  if (historyError) {
    const reason = historyError;
    hookResults.push(...prerequisiteTrace(["haltr", "calmo", "corpax", "venux"], reason));
    return finalize(input, "skip", reason, hookResults, current.source, [], { ...emptyPortfolio, account });
  }
  if ((input.corporateActionDates ?? []).some((date) => !Number.isFinite(new Date(date).getTime()))) {
    const reason = "Corporate-action dates are malformed; multiplier continuity cannot be verified.";
    hookResults.push(...prerequisiteTrace(["corpax"], reason));
    return finalize(input, "skip", reason, hookResults, current.source, [], { ...emptyPortfolio, account });
  }

  const parameters = recipe.parameters;
  const calmo = objectRecord(parameters.calmo)!;
  const corpax = objectRecord(parameters.corpax)!;
  const sessia = objectRecord(parameters.sessia)!;
  const percy = objectRecord(parameters.percy)!;
  const tenora = objectRecord(parameters.tenora)!;
  const coverix = objectRecord(parameters.coverix)!;
  const capra = objectRecord(parameters.capra)!;
  const trailo = objectRecord(parameters.trailo)!;
  const lastra = objectRecord(parameters.lastra)!;
  const haltr = objectRecord(parameters.haltr)!;
  const daylo = objectRecord(parameters.daylo)!;
  const drawra = objectRecord(parameters.drawra)!;
  const exposa = objectRecord(parameters.exposa)!;
  const venux = objectRecord(parameters.venux)!;
  const model = objectRecord(parameters.paperModel)!;

  const spot = current.spotUsd;
  const previousClose = Number(history.at(-1)!.shareCloseUsd);
  const oneHourMovePct = Math.abs((spot / previousClose - 1) * 100);
  const rvFast = annualizedRealizedVolatility(history, Number(calmo.rvFastHours));
  const rvSlow = annualizedRealizedVolatility(history, Number(calmo.rvSlowHours));
  const rvRatio = rvFast !== null && rvSlow !== null && rvSlow > 0 ? rvFast / rvSlow : null;
  const rv30 = rv30ImpliedVolatility(history, Number(model.ivMultiplier));
  const actionNow = new Date(current.observedAt).getTime();
  const actionWindowBefore = Number(corpax.pauseHoursBefore) * HOUR_MS;
  const actionWindowAfter = Number(corpax.pauseHoursAfter) * HOUR_MS;
  const actionNearby = Boolean(corpax.flagOpenPositions) && (input.corporateActionDates ?? []).some((date) => {
    const actionAt = new Date(date).getTime();
    return actionAt >= actionNow - actionWindowAfter && actionAt <= actionNow + actionWindowBefore;
  });
  const sessionOpen = isRegularEquitySession(current.observedAt);
  const currentMarkValue = input.position ? Number(input.position.markPriceUsd) * Number(input.position.quantity) : 0;
  const equityBeforeMark = Number(account.cashUsd) + currentMarkValue;
  const currentDate = input.occurredAt.slice(0, 10);
  const dailyStart = account.dailyStartDate === currentDate ? Number(account.dailyStartEquityUsd) : equityBeforeMark;
  let nextPosition: PaperOptionPositionState | null = input.position ?? null;
  let positionAction: PaperPortfolioUpdate["positionAction"] = "unchanged";
  if (input.position && rv30) {
    try {
      const mark = computeMark(input.position, spot, rv30.iv, current.observedAt);
      const peak = Math.max(Number(input.position.peakMarkPriceUsd), mark);
      nextPosition = { ...input.position, markPriceUsd: premiumString(mark), peakMarkPriceUsd: premiumString(peak), impliedVolatility: premiumString(rv30.iv) };
      positionAction = "update";
    } catch {
      // Keep the last verified position mark; missing model inputs only block new evaluation.
    }
  }
  const equity = Number(account.cashUsd) + (nextPosition ? Number(nextPosition.markPriceUsd) * Number(nextPosition.quantity) : 0);
  const peakEquity = Math.max(Number(account.peakEquityUsd), equityBeforeMark, equity);
  const currentDrawdownPct = peakEquity > 0 ? Math.max(0, (peakEquity - equity) / peakEquity * 100) : 0;
  const dailyLossPct = dailyStart > 0 ? Math.max(0, (dailyStart - equity) / dailyStart * 100) : 0;
  const nextAccount: PaperAccountState = {
    ...account,
    peakEquityUsd: cents(peakEquity),
    dailyStartEquityUsd: cents(dailyStart),
    dailyStartDate: currentDate,
  };

  const oneHourMax = Number(haltr.maxMove1hPct);
  const haltrPass = oneHourMovePct <= oneHourMax;
  hookResults.push(recordHook("haltr", "breaker", haltrPass ? "pass" : "block", haltrPass ? "Current quote/candle is fresh, not halted, and the prior-hour move is within the configured bound." : "The prior-hour underlying move exceeded the Haltr bound.", { value: oneHourMovePct, threshold: oneHourMax, unit: "%", dataRefs: [history.at(-1)!.endAt, current.observedAt] }));

  const dayloLimit = Number(daylo.maxDailyLossPct);
  const dayloPass = dailyLossPct < dayloLimit;
  hookResults.push(recordHook("daylo", "breaker", dayloPass ? "pass" : "block", dayloPass ? "Daily realized and marked paper loss is below the configured limit." : "Daily realized and marked paper loss reached the configured limit.", { value: dailyLossPct, threshold: dayloLimit, unit: "%" }));

  const drawdownLimit = Number(drawra.maxDrawdownPct);
  const drawraPass = currentDrawdownPct < drawdownLimit;
  hookResults.push(recordHook("drawra", "breaker", drawraPass ? "pass" : "block", drawraPass ? "Paper equity drawdown is below the configured limit." : "Paper equity drawdown reached the configured limit.", { value: currentDrawdownPct, threshold: drawdownLimit, unit: "%" }));

  const protectedShares = Number(parameters.protectedShares);
  const referenceExposurePct = spot * protectedShares / Number(account.initialCapitalUsd) * 100;
  const exposaLimit = Number(exposa.maxUnderlyingPct);
  const exposaPass = referenceExposurePct <= exposaLimit;
  hookResults.push(recordHook("exposa", "breaker", exposaPass ? "pass" : "block", exposaPass ? "Configured reference-share notional is within the paper capital exposure cap." : "Configured reference-share notional exceeds the paper capital exposure cap.", { value: referenceExposurePct, threshold: exposaLimit, unit: "%" }));

  const venuxPass = Boolean(venux.allowModeledPremium) && rv30 !== null && Number.isFinite(spot) && spot > 0;
  hookResults.push(recordHook("venux", "breaker", venuxPass ? "pass" : "block", venuxPass ? "Underlying data and the disclosed premium model are available; no option venue quote or fee schedule is represented." : "A valid modeled premium is unavailable or model mode is disabled.", { value: venux ? "modeled" : "unavailable", dataRefs: ["robinhood_underlying_price", "crius_1h_history", "black_scholes_model"] }));

  const fastHours = Number(calmo.rvFastHours);
  const slowHours = Number(calmo.rvSlowHours);
  const calmLimit = Number(calmo.rvRatioMax);
  const maxHourlyMove = Number(calmo.maxHourlyMovePct);
  const calmoPass = rvRatio !== null && rvRatio <= calmLimit && oneHourMovePct <= maxHourlyMove;
  hookResults.push(recordHook("calmo", "gate", calmoPass ? "pass" : "block", calmoPass ? "RVfast/RV30 is calm and the latest hourly price change is bounded." : "Calmo requires valid RVfast/RV30, the configured calm ratio, and a bounded hourly move.", { value: rvRatio ?? "unavailable", threshold: calmLimit, unit: "RV ratio", dataRefs: [`rv${fastHours}`, `rv${slowHours}`, history.at(-1)!.endAt] }));

  const corpaxPass = !actionNearby;
  hookResults.push(recordHook("corpax", "gate", corpaxPass ? "pass" : "block", corpaxPass ? "No known corporate action is inside the configured pause window." : "A known corporate action is inside the configured pause window.", { value: (input.corporateActionDates ?? []).join(",") || "none", threshold: `${corpax.pauseHoursBefore}h before/${corpax.pauseHoursAfter}h after`, unit: "hours", dataRefs: input.corporateActionDates ?? [] }));

  const sessionPass = sessia.sessions instanceof Array && sessia.sessions.includes("regular") && sessionOpen;
  hookResults.push(recordHook("sessia", "gate", sessionPass ? "pass" : "block", sessionPass ? "Entry timestamp falls inside the regular US equity session." : "Entries are restricted to regular US equity hours and the market is closed.", { value: current.observedAt, threshold: "09:30–16:00 America/New_York, market days", unit: "local market time" }));

  const entryVetoes = [
    !haltrPass && "haltr", !dayloPass && "daylo", !drawraPass && "drawra", !exposaPass && "exposa", !venuxPass && "venux",
    !calmoPass && "calmo", !corpaxPass && "corpax", !sessionPass && "sessia",
  ].filter((id): id is string => Boolean(id));
  const orders: PaperOrderIntent[] = [];

  if (input.position) {
    const position = nextPosition ?? input.position;
    if (!rv30) {
      hookResults.push(recordHook("trailo", "pulse", "block", "Current RV30 is unavailable; the position mark and exit price cannot be updated."));
      hookResults.push(recordHook("lastra", "expiry", "block", "Current model inputs are unavailable; expiry exit evaluation is blocked."));
      hookResults.push(recordHook("nextra", "expiry", "noop", "The next cycle is not evaluated while the prior model position remains open."));
      const reason = "Open position remains unchanged because valid model mark inputs are unavailable.";
      return finalize(input, "hold", reason, hookResults, current.source, [], { account: nextAccount, position, positionAction });
    }
    const mark = Number(position.markPriceUsd);
    const priorPeak = Number(position.peakMarkPriceUsd);
    const entryPrice = Number(position.averageEntryUsd);
    const armedAt = entryPrice * (1 + Number(trailo.activateAtGainPct) / 100);
    const trailArmed = priorPeak >= armedAt;
    const trailStop = trailArmed && mark <= priorPeak * (1 - Number(trailo.trailPct) / 100);
    const expiryHours = (new Date(position.expiryAt).getTime() - new Date(current.observedAt).getTime()) / HOUR_MS;
    const expiryExit = expiryHours <= Number(lastra.hoursBefore);
    hookResults.push(recordHook("trailo", "pulse", trailStop ? "action" : "pass", trailStop ? "Modeled premium retraced to its armed trailing stop." : trailArmed ? "Trailing stop is armed and has not fired." : "Trailing stop activates after the configured premium gain.", { value: mark, threshold: trailArmed ? priorPeak * (1 - Number(trailo.trailPct) / 100) : armedAt, unit: "USD modeled premium" }));
    hookResults.push(recordHook("lastra", "expiry", expiryExit ? "action" : "pass", expiryExit ? "The modeled put is within the configured pre-expiry close window." : "The modeled put is outside the pre-expiry close window.", { value: expiryHours, threshold: Number(lastra.hoursBefore), unit: "hours to model expiry" }));
    hookResults.push(recordHook("nextra", "expiry", "noop", "Nextra evaluates the next model cycle after this position closes; every cycle still rechecks Breakers."));
    if ((trailStop || expiryExit) && sessionOpen) {
      const units = Number(position.quantity);
      const fill = tradePrice(mark, "sell");
      orders.push({
        action: "close", symbol: recipe.underlyingSymbol, side: "sell", quantity: position.quantity,
        priceUsd: premiumString(fill), modelPremiumUsd: premiumString(mark), feeUsd: "0", slippageBps: MODEL_SLIPPAGE_BPS,
        instrumentType: "modeled_option", optionType: "put", strikeUsd: position.strikeUsd, expiryAt: position.expiryAt,
        impliedVolatility: premiumString(rv30.iv), modelName: "black_scholes_european_put", premiumSource: "modeled",
        modelInputs: { spotUsd: spot, rv30: rv30.rv30, iv: rv30.iv, model: "black_scholes_european_put", unitShares: 1, feesIncluded: false },
        ...(position.id ? { positionId: position.id } : {}),
      });
      nextAccount.cashUsd = cents(Number(nextAccount.cashUsd) + fill * units);
      nextAccount.realizedPnlUsd = premiumString(Number(nextAccount.realizedPnlUsd) + (fill - entryPrice) * units);
      nextPosition = { ...position, status: "closed", markPriceUsd: premiumString(mark), peakMarkPriceUsd: premiumString(Math.max(priorPeak, mark)) };
      positionAction = "close";
      const actionReason = trailStop ? "Trailing premium stop fired." : "Modeled position reached its pre-expiry close window.";
      hookResults.push(recordHook("paper.execution", undefined, "action", `${units} one-share modeled put units closed at a slippage-adjusted theoretical premium.`));
      return finalize(input, "close", actionReason, hookResults, current.source, orders, { account: nextAccount, position: nextPosition, positionAction });
    }
    if ((trailStop || expiryExit) && !sessionOpen) hookResults.push(recordHook("paper.execution", undefined, "block", "The model exit is due, but an option-paper fill is restricted to the regular session."));
    hookResults.push(recordHook("paper.position", undefined, "pass", "Open model position was marked from current underlying data; entry Breakers did not interrupt exit evaluation."));
    return finalize(input, "hold", entryVetoes.length ? `Position remains open; entry blocked by ${entryVetoes.join(", ")}.` : "Open model position remains inside its exit rules.", hookResults, current.source, [], { account: nextAccount, position: nextPosition, positionAction });
  }

  const percyType = percy.type;
  const percySide = percy.side;
  const otmPct = Number(percy.otmPct);
  const strikeIncrement = Number(percy.strikeIncrementUsd);
  const strike = roundStrike(spot, otmPct, strikeIncrement, percy.rounding);
  hookResults.push(recordHook("percy", "strike", "select", "Selected the configured theoretical 7% out-of-the-money put strike; this is not a listed venue contract.", { value: strike, threshold: otmPct, unit: "% OTM", dataRefs: [current.observedAt] }));

  const targetDte = Number(tenora.targetDTE);
  const expiryAt = new Date(new Date(current.observedAt).getTime() + targetDte * 24 * HOUR_MS).toISOString();
  hookResults.push(recordHook("tenora", "strike", "select", "Selected exact calendar-day model tenor; no exchange expiry calendar was inferred.", { value: targetDte, threshold: tenora.minDTE as number, unit: "calendar days" }));

  const coveredUnits = Math.floor(protectedShares * Number(coverix.coveragePct) / 100);
  hookResults.push(recordHook("coverix", "size", coveredUnits > 0 ? "size" : "block", coveredUnits > 0 ? "Configured virtual reference shares determine one-share model units; no wallet balance is read or locked." : "No positive virtual share coverage is available.", { value: coveredUnits, threshold: coverix.coveragePct as number, unit: "one-share model units" }));

  const hasPosition = false;
  const capraPositionsPass = hasPosition || Number(capra.maxOpenPositions) >= 1;
  let unitPremium = 0;
  let orderQuantity = 0;
  let orderFill = 0;
  if (rv30 && percyType === "put" && percySide === "buy") {
    unitPremium = blackScholesEuropeanPut({ spotUsd: spot, strikeUsd: strike, expiryAt, valuationAt: current.observedAt, volatility: rv30.iv }).premiumUsd;
    orderFill = tradePrice(unitPremium, "buy");
    const holdingValue = spot * protectedShares;
    const premiumBudget = holdingValue * Number(capra.maxPremiumPctHolding) / 100;
    const availableCash = Number(nextAccount.cashUsd);
    orderQuantity = Math.max(0, Math.floor(Math.min(coveredUnits, premiumBudget / orderFill, availableCash / orderFill)));
  }
  const capraPass = capraPositionsPass && orderQuantity > 0;
  hookResults.push(recordHook("capra", "size", capraPass ? "size" : "block", capraPass ? "Option-unit quantity fits the 2% reference-holding premium cap, virtual coverage, one-position limit, and paper cash." : "Premium cost, paper cash, virtual share coverage, or the one-position limit prevents an entry.", { value: capraPass ? orderQuantity * orderFill : 0, threshold: spot * protectedShares * Number(capra.maxPremiumPctHolding) / 100, unit: "USD modeled premium including slippage" }));
  hookResults.push(recordHook("trailo", "pulse", "noop", "No open model position exists to trail."));
  hookResults.push(recordHook("lastra", "expiry", "noop", "No open model position exists to close before expiry."));
  hookResults.push(recordHook("nextra", "expiry", "pass", "A new modeled protection cycle may be considered; all Gates and Breakers are still evaluated."));

  if (entryVetoes.length || !capraPass || !sessionPass || !rv30) {
    const blockers = [...entryVetoes, ...(!capraPass ? ["capra"] : []), ...(!rv30 ? ["venux"] : [])];
    const reason = blockers.length ? `Entry blocked by ${[...new Set(blockers)].join(", ")}.` : "No paper option order intent was produced.";
    return finalize(input, "skip", reason, hookResults, current.source, [], { account: nextAccount, position: null, positionAction: "unchanged" });
  }

  const quantity = String(orderQuantity);
  const position: PaperOptionPositionState = {
    symbol: recipe.underlyingSymbol,
    quantity,
    averageEntryUsd: premiumString(orderFill),
    markPriceUsd: premiumString(unitPremium),
    peakMarkPriceUsd: premiumString(unitPremium),
    strikeUsd: cents(strike),
    expiryAt,
    impliedVolatility: premiumString(rv30.iv),
    modelName: "black_scholes_european_put",
    premiumSource: "modeled",
    modelInputs: { spotUsd: spot, rv30: rv30.rv30, iv: rv30.iv, riskFreeRate: 0, dividendYield: 0, strikeOtmPct: otmPct, expiryDteCalendar: targetDte, unitShares: 1, feesIncluded: false },
    openedAt: current.observedAt,
    status: "open",
  };
  const order: PaperOrderIntent = {
    action: "open", symbol: recipe.underlyingSymbol, side: "buy", quantity,
    priceUsd: premiumString(orderFill), modelPremiumUsd: premiumString(unitPremium), feeUsd: "0", slippageBps: MODEL_SLIPPAGE_BPS,
    instrumentType: "modeled_option", optionType: "put", strikeUsd: cents(strike), expiryAt,
    impliedVolatility: premiumString(rv30.iv), modelName: "black_scholes_european_put", premiumSource: "modeled",
    modelInputs: position.modelInputs,
  };
  nextAccount.cashUsd = cents(Number(nextAccount.cashUsd) - orderFill * orderQuantity);
  positionAction = "open";
  hookResults.push(recordHook("paper.execution", undefined, "action", `${orderQuantity} one-share modeled put units opened at a slippage-adjusted theoretical premium; venue fees are excluded.`));
  return finalize(input, "open", `Opened ${orderQuantity} modeled one-share Protective Put units for paper execution.`, hookResults, current.source, [order], { account: nextAccount, position, positionAction });
}
