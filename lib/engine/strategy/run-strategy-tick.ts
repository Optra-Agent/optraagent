import { createHash } from "node:crypto";
import { AgentDecisionSchema, MarketCandleSchema, RecipeV1Schema } from "../../domain/contracts";
import type { HookResult, MarketCandle } from "../../domain/contracts";
import { canonicalRecipeHash, validateRecipe } from "../../hooks/recipe-validator";
import { isHouseStrategyTemplate } from "../../hooks/house-specs";
import { blackScholesEuropeanOption, rv30ImpliedVolatility } from "../../options/black-scholes";
import type { ModeledOptionType } from "../../options/black-scholes";
import { HOUR_MS, MODEL_SLIPPAGE_BPS, findCurrentMarket, objectRecord, recordHook, tradePrice, validHistory } from "../common";
import { isRegularEquitySession } from "../us-market-session";
import {
  DAY_MS, dailyCloses, earnexBlockWindow, earnexOnlyWindow, earningsReportMs, evaluateTrendix, historicalEarningsMoves, roundToIncrement,
  rvRankProxy, selectExpiry, solveStrikeForDelta,
} from "./helpers";
import { EMPTY_STRATEGY_META } from "./types";
import type {
  PositionChange, StrategyAccount, StrategyAccountMeta, StrategyModelName, StrategyOrderIntent, StrategyPosition, StrategyTemplateId,
  StrategyTickInput, StrategyTickResult,
} from "./types";

const STAGES: Record<string, NonNullable<HookResult["stage"]>> = {
  volra: "gate", trendix: "gate", earnex: "gate", corpax: "gate",
  percy: "strike", tenora: "strike", deltra: "strike", premo: "strike", strangl: "strike",
  coverix: "size", capra: "size", kelvo: "size",
  profira: "pulse", stopra: "pulse", rescu: "pulse",
  settla: "expiry", nextra: "expiry", lastra: "expiry",
  haltr: "breaker", daylo: "breaker", drawra: "breaker", exposa: "breaker", venux: "breaker",
};
const STAGE_RANK: Record<NonNullable<HookResult["stage"]>, number> = { gate: 0, strike: 1, size: 2, pulse: 3, expiry: 4, breaker: 5 };
const MIN_PREMIUM_USD = 0.01;

function money(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const fixed = value.toFixed(6);
  const trimmed = fixed.replace(/0+$/, "").replace(/\.$/, "");
  return trimmed === "-0" ? "0" : trimmed;
}

function plain(value: number): string {
  return money(Math.max(0, value));
}

function modelFor(optionType: ModeledOptionType): StrategyModelName {
  return optionType === "call" ? "black_scholes_european_call" : "black_scholes_european_put";
}

class Trace {
  private readonly list: HookResult[] = [];
  private readonly seen = new Set<string>();

  add(hookId: string, status: HookResult["status"], reason: string, extras: Partial<Pick<HookResult, "value" | "threshold" | "unit" | "dataRefs" | "text">> = {}): void {
    if (this.seen.has(hookId)) return;
    this.seen.add(hookId);
    this.list.push(recordHook(hookId, STAGES[hookId], status, reason, extras));
  }

  system(hookId: string, status: HookResult["status"], reason: string): void {
    this.list.push(recordHook(hookId, undefined, status, reason));
  }

  has(hookId: string): boolean {
    return this.seen.has(hookId);
  }

  fill(hookIds: readonly string[], reason: string): void {
    for (const hookId of hookIds) if (!this.seen.has(hookId)) this.add(hookId, "noop", reason);
  }

  ordered(): HookResult[] {
    return this.list
      .map((result, index) => ({ result, index }))
      .sort((left, right) => {
        const rank = (result: HookResult) => result.stage ? STAGE_RANK[result.stage] : result.hookId.startsWith("system.") ? -1 : 6;
        return rank(left.result) - rank(right.result) || left.index - right.index;
      })
      .map(({ result }) => result);
  }
}

function label(position: StrategyPosition): string {
  return `${position.side === "short" ? "short" : "long"} ${position.optionType} ${position.strikeUsd}`;
}

function intrinsic(optionType: ModeledOptionType, spot: number, strike: number): number {
  return optionType === "call" ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
}

function signedMark(position: StrategyPosition): number {
  return (position.side === "short" ? -1 : 1) * Number(position.markPriceUsd) * Number(position.quantity);
}

function numberParam(record: Record<string, unknown> | null, key: string): number {
  return Number(record?.[key]);
}

function seedAccount(recipe: StrategyTickInput["recipe"], occurredAt: string, account: StrategyAccount | null | undefined): StrategyAccount | null {
  const capital = Number(recipe.parameters.initialCapitalUsd);
  if (!Number.isFinite(capital) || capital <= 0) return null;
  const shares = recipe.templateId === "covered_call" ? Number(recipe.parameters.referenceShares) : 0;
  if (recipe.templateId === "covered_call" && (!Number.isInteger(shares) || shares <= 0)) return null;
  const base = money(capital);
  return account ?? {
    initialCapitalUsd: base,
    cashUsd: base,
    realizedPnlUsd: "0",
    peakEquityUsd: base,
    dailyStartEquityUsd: base,
    dailyStartDate: occurredAt.slice(0, 10),
    meta: { ...EMPTY_STRATEGY_META, referenceShares: shares, tradedEarnings: [] },
  };
}

/** Virtual starting account for a strategy recipe: used by the repository on agent creation and by backtests. */
export function initialStrategyAccount(recipe: StrategyTickInput["recipe"], occurredAt: string): StrategyAccount | null {
  return seedAccount(recipe, occurredAt, null);
}

function cloneMeta(meta: StrategyAccountMeta): StrategyAccountMeta {
  return { ...meta, tradedEarnings: [...meta.tradedEarnings] };
}

function historyHash(candles: readonly MarketCandle[]): string {
  const stable = candles.map((value) => {
    const candle = { ...MarketCandleSchema.parse(value) };
    delete (candle as Partial<MarketCandle>).receivedAt;
    return candle;
  });
  return `sha256:${createHash("sha256").update(JSON.stringify(stable)).digest("hex")}`;
}

type ExitPlan = { positions: StrategyPosition[]; purpose: StrategyOrderIntent["purpose"]; settle: boolean; note: string };

export function runStrategyTick(input: StrategyTickInput): StrategyTickResult {
  const trace = new Trace();
  const recipeParse = RecipeV1Schema.safeParse(input.recipe);
  const recipe = recipeParse.success ? recipeParse.data : input.recipe;
  const hookIds = recipe.hookIds;
  const source = input.snapshot?.source ?? input.currentCandle?.source ?? "unavailable";
  const startingPositions = (input.positions ?? []).filter((position) => position.status === "open");

  const fallbackAccount: StrategyAccount = seedAccount(recipe, input.occurredAt, input.account) ?? {
    initialCapitalUsd: "0", cashUsd: "0", realizedPnlUsd: "0", peakEquityUsd: "0", dailyStartEquityUsd: "0", dailyStartDate: input.occurredAt.slice(0, 10),
    meta: { ...EMPTY_STRATEGY_META, tradedEarnings: [] },
  };

  const finalize = (
    action: "open" | "hold" | "close" | "skip",
    reason: string,
    orders: StrategyOrderIntent[],
    portfolio: { account: StrategyAccount; changes: PositionChange[] },
    context?: { sourceName?: string; derived?: Record<string, unknown>; history?: MarketCandle[]; earningsEvents?: unknown[] },
  ): StrategyTickResult => {
    trace.fill(hookIds, "Not evaluated this tick because an earlier rule decided the outcome.");
    const history = context?.history ?? [];
    const marketContext = input.includeMarketContext === false ? undefined : {
      observation: input.snapshot ?? input.currentCandle ?? null,
      historyDataHash: history.length ? historyHash(history) : null,
      historyWindow: history.length ? { startAt: history[0]!.startAt, endAt: history.at(-1)!.endAt, candles: history.length } : null,
      corporateActionDates: input.corporateActionDates ?? [],
      model: recipe.parameters.paperModel ?? null,
      derived: context?.derived ?? {},
      earnings: input.earnings ? { source: input.earnings.source, fetchedAt: input.earnings.fetchedAt, events: context?.earningsEvents ?? [] } : null,
      positionsBefore: startingPositions.length,
    };
    return {
      decision: AgentDecisionSchema.parse({
        id: `${input.agentId}:${input.tickId}`,
        agentId: input.agentId,
        tickId: input.tickId,
        action,
        reason,
        hookResults: trace.ordered(),
        ...(marketContext ? { marketContext } : {}),
        snapshotSource: context?.sourceName ?? source,
        recipeHash: input.recipeHash,
        createdAt: input.occurredAt,
      }),
      orderIntents: orders,
      portfolio,
    };
  };

  const unchanged = (account: StrategyAccount = fallbackAccount) => ({ account, changes: [] as PositionChange[] });

  if (input.state.status !== "running") {
    const reason = `Agent is ${input.state.status}; paper ticks require a running agent.`;
    trace.system("system.agent_state", "block", reason);
    return finalize("skip", reason, [], unchanged());
  }
  const templateId = recipe.templateId;
  const hash = recipeParse.success ? canonicalRecipeHash(recipeParse.data) : input.recipeHash;
  if (!recipeParse.success || hash !== input.recipeHash) {
    const reason = "Recipe payload or canonical hash is invalid.";
    trace.system("system.recipe_hash", "error", reason);
    return finalize("skip", reason, [], unchanged());
  }
  if (!isHouseStrategyTemplate(templateId)) {
    const reason = "This template is not evaluated by the options-strategy engine.";
    trace.system("system.recipe_validator", "block", reason);
    return finalize("skip", reason, [], unchanged());
  }
  const validation = validateRecipe(recipe);
  if (!validation.valid) {
    for (const issue of validation.issues) trace.system(issue.hookId ?? "system.recipe_validator", "block", issue.message);
    return finalize("skip", validation.issues.map((issue) => issue.message).join(" "), [], unchanged());
  }
  const template: StrategyTemplateId = templateId;
  const seeded = seedAccount(recipe, input.occurredAt, input.account);
  if (!seeded) {
    const reason = "Paper account capital is missing or invalid.";
    trace.system("system.paper_account", "error", reason);
    return finalize("skip", reason, [], unchanged());
  }

  const current = findCurrentMarket(input);
  if (current.invalidReason || current.spotUsd <= 0 || !Number.isFinite(current.spotUsd)) {
    const reason = current.invalidReason ?? "The current underlying price is invalid.";
    trace.add("haltr", "block", reason);
    trace.add("venux", "block", reason);
    return finalize("skip", reason, [], unchanged(seeded), { sourceName: current.source });
  }
  const checked = validHistory(input.history, recipe.underlyingSymbol, current.observedAt);
  if (checked.reason) {
    trace.add("haltr", "block", checked.reason);
    trace.add("venux", "block", checked.reason);
    trace.add("corpax", "block", checked.reason);
    return finalize("skip", checked.reason, [], unchanged(seeded), { sourceName: current.source });
  }
  const history = checked.history;
  if ((input.corporateActionDates ?? []).some((date) => !Number.isFinite(new Date(date).getTime()))) {
    const reason = "Corporate-action dates are malformed; multiplier continuity cannot be verified.";
    trace.add("corpax", "block", reason);
    return finalize("skip", reason, [], unchanged(seeded), { sourceName: current.source });
  }

  const parameters = recipe.parameters;
  const model = objectRecord(parameters.paperModel)!;
  const spot = current.spotUsd;
  const nowMs = Date.parse(current.observedAt);
  const sessionOpen = isRegularEquitySession(current.observedAt);
  const rv = rv30ImpliedVolatility(history, Number(model.ivMultiplier));
  const previousClose = Number(history.at(-1)!.shareCloseUsd);
  const oneHourMovePct = Math.abs((spot / previousClose - 1) * 100);
  const longHistory = (input.history ?? []).filter((candle) => MarketCandleSchema.safeParse(candle).success && Date.parse(candle.endAt) <= nowMs && candle.endAt !== current.observedAt);

  // 1. Re-mark every open position from the current underlying and the modeled volatility.
  const meta = cloneMeta(seeded.meta);
  const account: StrategyAccount = { ...seeded, meta };
  const positions: StrategyPosition[] = startingPositions.map((position) => ({ ...position }));
  const preMarkEquity = equityOf(template, account, positions, spot, meta);
  const changeById = new Map<string, PositionChange>();
  for (const position of positions) {
    const key = position.id ?? `existing:${positions.indexOf(position)}`;
    try {
      const expired = Date.parse(position.expiryAt) <= nowMs;
      const mark = expired
        ? intrinsic(position.optionType, spot, Number(position.strikeUsd))
        : rv
          ? blackScholesEuropeanOption(position.optionType, { spotUsd: spot, strikeUsd: Number(position.strikeUsd), expiryAt: position.expiryAt, valuationAt: current.observedAt, volatility: rv.iv }).premiumUsd
          : Number(position.markPriceUsd);
      position.markPriceUsd = plain(mark);
      position.peakMarkPriceUsd = plain(Math.max(Number(position.peakMarkPriceUsd), mark));
      if (rv) position.impliedVolatility = plain(rv.iv);
      changeById.set(key, { key, action: "update", position });
    } catch {
      // Keep the last verified mark: a failed model evaluation never invents a price.
    }
  }

  if (!meta.startedAt) {
    meta.startedAt = current.observedAt;
    meta.referenceStartPriceUsd = plain(spot);
  }
  const equity = equityOf(template, account, positions, spot, meta);
  if (account.dailyStartDate !== input.occurredAt.slice(0, 10)) {
    account.dailyStartEquityUsd = money(preMarkEquity);
    account.dailyStartDate = input.occurredAt.slice(0, 10);
  }
  if (!seeded.meta.startedAt) {
    account.peakEquityUsd = money(equity);
    account.dailyStartEquityUsd = money(equity);
  }
  const peakEquity = Math.max(Number(account.peakEquityUsd), preMarkEquity, equity);
  account.peakEquityUsd = money(peakEquity);
  const dailyStart = Number(account.dailyStartEquityUsd);
  const drawdownPct = peakEquity > 0 ? Math.max(0, (peakEquity - equity) / peakEquity * 100) : 0;
  const dailyLossPct = dailyStart > 0 ? Math.max(0, (dailyStart - equity) / dailyStart * 100) : 0;

  // 2. Breakers (always evaluated, entries only).
  const haltr = objectRecord(parameters.haltr)!;
  const daylo = objectRecord(parameters.daylo)!;
  const drawra = objectRecord(parameters.drawra)!;
  const exposa = objectRecord(parameters.exposa)!;
  const venux = objectRecord(parameters.venux)!;
  const haltrPass = oneHourMovePct <= Number(haltr.maxMove1hPct);
  trace.add("haltr", haltrPass ? "pass" : "block", haltrPass ? "The current quote is fresh and the prior-hour move is within the configured bound." : "The prior-hour underlying move exceeded the Haltr bound.", { value: oneHourMovePct, threshold: Number(haltr.maxMove1hPct), unit: "%", dataRefs: [history.at(-1)!.endAt, current.observedAt] });
  const dayloPass = dailyLossPct < Number(daylo.maxDailyLossPct);
  trace.add("daylo", dayloPass ? "pass" : "block", dayloPass ? "Daily realized and marked paper loss is below the configured limit." : "Daily realized and marked paper loss reached the configured limit.", { value: dailyLossPct, threshold: Number(daylo.maxDailyLossPct), unit: "%" });
  const drawraPass = drawdownPct < Number(drawra.maxDrawdownPct);
  trace.add("drawra", drawraPass ? "pass" : "block", drawraPass ? "Paper equity drawdown is below the configured limit." : "Paper equity drawdown reached the configured limit.", { value: drawdownPct, threshold: Number(drawra.maxDrawdownPct), unit: "%" });
  const exposurePct = exposureOf(template, account, positions, spot, meta, equity);
  const exposaPass = exposurePct <= Number(exposa.maxUnderlyingPct);
  trace.add("exposa", exposaPass ? "pass" : "block", exposaPass ? "Underlying exposure is within the paper book cap." : "Underlying exposure exceeds the paper book cap.", { value: exposurePct, threshold: Number(exposa.maxUnderlyingPct), unit: "% of paper equity" });
  const venuxPass = Boolean(venux.allowModeledPremium) && rv !== null;
  trace.add("venux", venuxPass ? "pass" : "block", venuxPass ? "Underlying data and the disclosed premium model are available; no option venue quote or fee schedule is represented." : "A valid modeled premium is unavailable or model mode is disabled.", { value: "modeled", dataRefs: ["robinhood_underlying_price", "crius_1h_history", "black_scholes_model"] });

  const corpax = objectRecord(parameters.corpax)!;
  const actionNearby = Boolean(corpax.flagOpenPositions) && (input.corporateActionDates ?? []).some((date) => {
    const at = Date.parse(date);
    return at >= nowMs - Number(corpax.pauseHoursAfter) * HOUR_MS && at <= nowMs + Number(corpax.pauseHoursBefore) * HOUR_MS;
  });
  const corpaxPass = !actionNearby;
  trace.add("corpax", corpaxPass ? "pass" : "block", corpaxPass ? "No known corporate action is inside the configured pause window." : "A known corporate action is inside the configured pause window.", { value: (input.corporateActionDates ?? []).join(",") || "none", threshold: `${corpax.pauseHoursBefore}h before/${corpax.pauseHoursAfter}h after`, unit: "hours", dataRefs: input.corporateActionDates ?? [] });

  const breakerVetoes = [!haltrPass && "haltr", !dayloPass && "daylo", !drawraPass && "drawra", !exposaPass && "exposa", !venuxPass && "venux"].filter((id): id is string => Boolean(id));
  const orders: StrategyOrderIntent[] = [];
  const changes: PositionChange[] = [];
  const earningsEvents = input.earnings?.events ?? null;
  const relevantEvents = (earningsEvents ?? []).filter((event) => Math.abs(Date.parse(`${event.reportDate}T12:00:00Z`) - nowMs) <= 21 * DAY_MS);
  const derived: Record<string, unknown> = {
    spotUsd: spot, equityUsd: equity, rv30: rv?.rv30 ?? null, iv: rv?.iv ?? null, oneHourMovePct, drawdownPct, dailyLossPct, exposurePct, sessionOpen,
  };
  const ctx = { sourceName: current.source, derived, history, earningsEvents: relevantEvents };

  // 3. Exit evaluation. Settlement is automatic at expiry; every other exit needs an open regular session.
  const open = positions.filter((position) => position.status === "open");
  const structures = new Map<string, StrategyPosition[]>();
  const singles: StrategyPosition[] = [];
  for (const position of open) {
    if (position.structureId) structures.set(position.structureId, [...(structures.get(position.structureId) ?? []), position]);
    else singles.push(position);
  }
  const exitPlans: ExitPlan[] = [];
  const profira = objectRecord(parameters.profira);
  const stopra = objectRecord(parameters.stopra);
  const rescu = objectRecord(parameters.rescu);
  const settla = objectRecord(parameters.settla);
  const lastra = objectRecord(parameters.lastra);
  const notes: Record<string, { status: HookResult["status"]; items: string[] }> = {};
  const priority: Record<string, number> = { action: 3, block: 2, pass: 1, noop: 0 };
  const note = (hookId: string, status: HookResult["status"], item: string) => {
    const entry = notes[hookId] ?? { status, items: [] };
    if ((priority[status] ?? 0) > (priority[entry.status] ?? 0)) entry.status = status;
    entry.items.push(item);
    notes[hookId] = entry;
  };
  const rollPlans: Array<{ old: StrategyPosition; kind: "roll" | "close" }> = [];

  const settlementSpot = (position: StrategyPosition): { price: number; source: string } => {
    const expiryMs = Date.parse(position.expiryAt);
    const candidate = [...longHistory, ...(input.currentCandle ? [input.currentCandle] : [])].find((candle) => Date.parse(candle.endAt) >= expiryMs);
    return candidate ? { price: Number(candidate.shareCloseUsd), source: `candle_close_${candidate.endAt}` } : { price: spot, source: "evaluation_spot" };
  };

  for (const position of singles) {
    const expiryMs = Date.parse(position.expiryAt);
    const hoursToExpiry = (expiryMs - nowMs) / HOUR_MS;
    const entry = Number(position.averageEntryUsd);
    const mark = Number(position.markPriceUsd);
    if (expiryMs <= nowMs) {
      exitPlans.push({ positions: [position], purpose: "expiry_settlement", settle: true, note: label(position) });
      continue;
    }
    if (position.side === "short") {
      const stopMultiple = numberParam(stopra, "premiumMultiple");
      const stop = stopra !== null && Number.isFinite(stopMultiple) && mark >= entry * stopMultiple;
      if (stopra) note("stopra", stop ? "action" : "pass", `${label(position)}: mark ${mark.toFixed(2)} vs stop ${(entry * stopMultiple).toFixed(2)}`);
      const capture = numberParam(profira, "capturePct");
      const take = profira !== null && Number.isFinite(capture) && mark <= entry * (1 - capture / 100);
      if (profira) note("profira", take ? "action" : "pass", `${label(position)}: ${(entry > 0 ? (1 - mark / entry) * 100 : 0).toFixed(0)}% of premium captured vs ${capture}%`);
      const strike = Number(position.strikeUsd);
      const itmPct = position.optionType === "call" ? (spot - strike) / strike * 100 : (strike - spot) / strike * 100;
      const rescues = Number(position.modelInputs.rescues ?? 0);
      const rescueDue = rescu !== null && itmPct >= numberParam(rescu, "itmPct") && rescues < numberParam(rescu, "maxRescues");
      if (rescu) note("rescu", rescueDue && !stop && !take ? "action" : "pass", `${label(position)}: ${Math.abs(itmPct).toFixed(1)}% ${itmPct >= 0 ? "ITM" : "OTM"} vs ${numberParam(rescu, "itmPct")}% ITM trigger, rescue ${rescues}/${numberParam(rescu, "maxRescues")}`);
      const safeOtm = settla !== null && -itmPct >= numberParam(settla, "otmBufferPct") && hoursToExpiry <= numberParam(settla, "checkHoursBefore");
      if (settla) note("settla", hoursToExpiry > numberParam(settla, "checkHoursBefore") ? "noop" : safeOtm ? "action" : "pass", `${label(position)}: ${hoursToExpiry.toFixed(1)}h to expiry, ${(-itmPct).toFixed(1)}% OTM vs ${numberParam(settla, "otmBufferPct")}% buffer${safeOtm ? " — holding to expiry" : ""}`);
      if (stop) exitPlans.push({ positions: [position], purpose: "stop_loss", settle: false, note: label(position) });
      else if (take) exitPlans.push({ positions: [position], purpose: "take_profit", settle: false, note: label(position) });
      else if (rescueDue) rollPlans.push({ old: position, kind: "roll" });
    }
  }
  for (const [structureId, legs] of structures) {
    const expiryMs = Date.parse(legs[0]!.expiryAt);
    if (expiryMs <= nowMs) {
      exitPlans.push({ positions: legs, purpose: "expiry_settlement", settle: true, note: structureId });
      continue;
    }
    const cost = legs.reduce((total, leg) => total + Number(leg.averageEntryUsd) * Number(leg.quantity), 0);
    const value = legs.reduce((total, leg) => total + Number(leg.markPriceUsd) * Number(leg.quantity), 0);
    const gainPct = cost > 0 ? (value / cost - 1) * 100 : 0;
    const gainTarget = numberParam(profira, "gainPct");
    const lossTarget = numberParam(stopra, "lossPct");
    const stop = stopra !== null && -gainPct >= lossTarget;
    const take = profira !== null && gainPct >= gainTarget;
    const hours = (expiryMs - nowMs) / HOUR_MS;
    const preExpiry = lastra !== null && hours <= numberParam(lastra, "hoursBefore");
    const text = `straddle ${legs[0]!.strikeUsd}: ${gainPct.toFixed(1)}% vs cost $${cost.toFixed(2)}`;
    if (stopra) note("stopra", stop ? "action" : "pass", `${text}, stop at −${lossTarget}%`);
    if (profira) note("profira", take && !stop ? "action" : "pass", `${text}, target +${gainTarget}%`);
    if (lastra) note("lastra", preExpiry && !stop && !take ? "action" : "pass", `${hours.toFixed(1)}h to expiry vs ${numberParam(lastra, "hoursBefore")}h close window`);
    if (stop) exitPlans.push({ positions: legs, purpose: "stop_loss", settle: false, note: text });
    else if (take) exitPlans.push({ positions: legs, purpose: "take_profit", settle: false, note: text });
    else if (preExpiry) exitPlans.push({ positions: legs, purpose: "pre_expiry_close", settle: false, note: text });
  }

  const closeFill = (position: StrategyPosition, settle: boolean, settlementPrice: number | null): { fill: number; premium: number; slippageBps: number; side: "buy" | "sell" } => {
    const mark = Number(position.markPriceUsd);
    if (settle) {
      const price = settlementPrice ?? spot;
      const value = intrinsic(position.optionType, price, Number(position.strikeUsd));
      return { fill: value, premium: value, slippageBps: 0, side: position.side === "short" ? "buy" : "sell" };
    }
    const side = position.side === "short" ? "buy" : "sell";
    return { fill: tradePrice(mark, side), premium: mark, slippageBps: MODEL_SLIPPAGE_BPS, side };
  };

  let closedThisTick = 0;
  let settledThisTick = 0;
  let nextOpenIndex = 0;
  const applyClose = (position: StrategyPosition, plan: { purpose: StrategyOrderIntent["purpose"]; settle: boolean }, extraInputs: Record<string, unknown> = {}): number => {
    const settleInfo = plan.settle ? settlementSpot(position) : null;
    const fill = closeFill(position, plan.settle, settleInfo?.price ?? null);
    const quantity = Number(position.quantity);
    const entry = Number(position.averageEntryUsd);
    const cashDelta = position.side === "short" ? -fill.fill * quantity : fill.fill * quantity;
    const pnl = position.side === "short" ? (entry - fill.fill) * quantity : (fill.fill - entry) * quantity;
    account.cashUsd = money(Number(account.cashUsd) + cashDelta);
    account.realizedPnlUsd = money(Number(account.realizedPnlUsd) + pnl);
    meta.closes += 1;
    if (pnl > 0) meta.winningCloses += 1;
    meta.worstTradeUsd = meta.worstTradeUsd === null ? money(pnl) : money(Math.min(Number(meta.worstTradeUsd), pnl));
    if (plan.settle) {
      const itm = intrinsic(position.optionType, settleInfo?.price ?? spot, Number(position.strikeUsd)) > 0;
      if (position.side === "short") {
        if (itm) meta.settledItm += 1; else meta.settledOtm += 1;
      }
      settledThisTick += 1;
    }
    position.status = "closed";
    position.closedAt = current.observedAt;
    position.realizedPnlUsd = money(pnl);
    const key = position.id ?? `existing:${positions.indexOf(position)}`;
    changes.push({ key, action: "close", position: { ...position } });
    orders.push({
      action: plan.settle ? "settle" : "close", purpose: plan.purpose, legRole: position.legRole, positionKey: key, symbol: position.symbol, side: fill.side,
      quantity: position.quantity, priceUsd: plain(fill.fill), modelPremiumUsd: plain(fill.premium), feeUsd: "0", slippageBps: fill.slippageBps,
      instrumentType: "modeled_option", optionType: position.optionType, strikeUsd: position.strikeUsd, expiryAt: position.expiryAt,
      impliedVolatility: position.impliedVolatility, modelName: position.modelName, premiumSource: "modeled",
      modelInputs: { spotUsd: spot, feesIncluded: false, realizedPnlUsd: money(pnl), ...(settleInfo ? { settlementPriceUsd: settleInfo.price, settlementPriceSource: settleInfo.source } : {}), ...extraInputs },
    });
    return pnl;
  };

  for (const plan of exitPlans) {
    if (!plan.settle && !sessionOpen) {
      trace.system("paper.execution", "block", `A ${plan.purpose.replace(/_/g, " ")} is due (${plan.note}), but option-paper fills are restricted to the regular US equity session.`);
      continue;
    }
    for (const position of plan.positions) applyClose(position, plan);
    closedThisTick += 1;
  }

  // Credit rolls (Rescu): close the pressured short and re-open it further out and away, only for a net credit.
  for (const { old } of rollPlans) {
    if (!sessionOpen) {
      note("rescu", "block", `${label(old)}: rescue is due but the market is closed`);
      trace.system("paper.execution", "block", `A rescue roll is due (${label(old)}), but option-paper fills are restricted to the regular US equity session.`);
      continue;
    }
    const tenora = objectRecord(parameters.tenora)!;
    const percy = objectRecord(parameters.percy);
    const deltra = objectRecord(parameters.deltra);
    const expiry = rv ? selectExpiry({ cycle: "weekly", targetDTE: Number(tenora.targetDTE), minDTE: Number(tenora.minDTE), nowMs, afterMs: Date.parse(old.expiryAt) }) : null;
    let newStrike: number | null = null;
    if (expiry && rv) {
      if (old.optionType === "call" && percy) newStrike = Math.max(roundToIncrement(spot * (1 + Number(percy.otmPct) / 100), Number(percy.strikeIncrementUsd)), Number(old.strikeUsd));
      if (old.optionType === "put" && deltra) {
        const solved = solveStrikeForDelta({ optionType: "put", spotUsd: spot, expiryAt: expiry.expiryAt, valuationAt: current.observedAt, volatility: rv.iv, targetAbsDelta: Number(deltra.targetDelta) });
        if (solved !== null) newStrike = Math.min(roundToIncrement(solved, Number(deltra.strikeIncrementUsd)), Number(old.strikeUsd));
      }
    }
    let rolled = false;
    if (expiry && rv && newStrike !== null && !breakerVetoes.length) {
      try {
        const quote = blackScholesEuropeanOption(old.optionType, { spotUsd: spot, strikeUsd: newStrike, expiryAt: expiry.expiryAt, valuationAt: current.observedAt, volatility: rv.iv });
        const credit = tradePrice(quote.premiumUsd, "sell");
        const buyback = tradePrice(Number(old.markPriceUsd), "buy");
        const quantity = Number(old.quantity);
        const net = (credit - buyback) * quantity;
        const requireCredit = rescu?.requireNetCredit !== false;
        if (net > 0 || !requireCredit) {
          const rescues = Number(old.modelInputs.rescues ?? 0) + 1;
          applyClose(old, { purpose: "rescue_roll_close", settle: false }, { rescue: rescues });
          meta.rolls += 1;
          closedThisTick += 1;
          const collateral = old.optionType === "put" ? newStrike * quantity : 0;
          const key = `new:${nextOpenIndex}`;
          nextOpenIndex += 1;
          const next: StrategyPosition = {
            symbol: old.symbol, optionType: old.optionType, side: "short", quantity: old.quantity, averageEntryUsd: plain(credit), markPriceUsd: plain(quote.premiumUsd), peakMarkPriceUsd: plain(quote.premiumUsd),
            strikeUsd: newStrike.toFixed(2), expiryAt: expiry.expiryAt, impliedVolatility: plain(rv.iv), modelName: old.modelName, premiumSource: "modeled",
            modelInputs: { spotUsd: spot, rv30: rv.rv30, iv: rv.iv, delta: quote.delta, riskFreeRate: 0, dividendYield: 0, unitShares: 1, feesIncluded: false, rescues, rolledFrom: old.id ?? null, expiryDte: expiry.dte },
            collateralUsd: money(collateral), structureId: null, legRole: null, openedAt: current.observedAt, status: "open",
          };
          account.cashUsd = money(Number(account.cashUsd) + credit * quantity);
          meta.premiumCollectedUsd = money(Number(meta.premiumCollectedUsd) + credit * quantity);
          positions.push(next);
          changes.push({ key, action: "open", position: next });
          orders.push({
            action: "open", purpose: "rescue_roll_open", legRole: null, positionKey: key, symbol: next.symbol, side: "sell", quantity: next.quantity, priceUsd: next.averageEntryUsd,
            modelPremiumUsd: plain(quote.premiumUsd), feeUsd: "0", slippageBps: MODEL_SLIPPAGE_BPS, instrumentType: "modeled_option", optionType: next.optionType,
            strikeUsd: next.strikeUsd, expiryAt: next.expiryAt, impliedVolatility: next.impliedVolatility, modelName: next.modelName, premiumSource: "modeled", modelInputs: next.modelInputs,
          });
          note("rescu", "action", `${label(old)}: rolled to ${next.optionType} ${next.strikeUsd} exp ${next.expiryAt.slice(0, 10)} for a net credit of $${net.toFixed(2)} (rescue ${rescues})`);
          rolled = true;
        }
      } catch {
        // A failed model evaluation falls through to the close below.
      }
    }
    if (!rolled) {
      applyClose(old, { purpose: "rescue_close", settle: false });
      closedThisTick += 1;
      note("rescu", "action", `${label(old)}: no net-credit roll was available, so the position was closed`);
    }
  }

  for (const [hookId, entry] of Object.entries(notes)) {
    trace.add(hookId, entry.status, entry.items.join("; "));
  }
  for (const hookId of ["profira", "stopra", "rescu", "settla", "lastra"]) {
    if (hookIds.includes(hookId) && !trace.has(hookId)) trace.add(hookId, "noop", open.length ? "No open position reached this rule's window." : "No open position exists to manage.");
  }

  const stillOpen = positions.filter((position) => position.status === "open");
  const structuresOpen = new Set(stillOpen.map((position) => position.structureId ?? position.id ?? `p:${positions.indexOf(position)}`));

  // Persisted updates for positions that were only re-marked.
  const closedKeys = new Set(changes.filter((change) => change.action === "close").map((change) => change.key));
  const updates: PositionChange[] = [];
  for (const [key, change] of changeById) {
    if (closedKeys.has(key)) continue;
    updates.push(change);
  }

  const finishPortfolio = (): { account: StrategyAccount; changes: PositionChange[] } => ({ account, changes: [...updates, ...changes] });

  // 4. Entry evaluation only when nothing was closed this tick and no breaker blocks entries.
  const entryGateIds = ["volra", "trendix", "earnex", "corpax"].filter((hookId) => hookIds.includes(hookId));
  const earningsCtx = (): Record<string, unknown> => ({ earningsSource: input.earnings?.source ?? null, earningsFetchedAt: input.earnings?.fetchedAt ?? null });
  const moveSummary = earningsEvents ? historicalEarningsMoves(earningsEvents, longHistory) : [];

  const decide = (action: "open" | "hold" | "close" | "skip", reason: string): StrategyTickResult => {
    return finalize(action, reason, orders, finishPortfolio(), { ...ctx, derived: { ...derived, equityAfterUsd: equityOf(template, account, positions, spot, meta), earnings: earningsCtx(), historicalEarningsMoves: moveSummary } });
  };

  if (closedThisTick > 0 || settledThisTick > 0) {
    trace.fill(["nextra"], "A new cycle is evaluated at the next tick; every Gate and Breaker is rechecked then.");
    trace.fill(entryGateIds, "Entry rules were not evaluated this tick because a position was closed or settled.");
    const rolled = changes.some((change) => change.action === "open");
    const opensText = rolled ? " and re-opened" : "";
    return decide(rolled ? "open" : "close", `${orders.filter((order) => order.action !== "open").length} modeled position(s) closed or settled${opensText} this tick.`);
  }

  const maxPositions = Number(objectRecord(parameters.capra)?.maxOpenPositions ?? 1);
  const capacity = template === "earnings_straddle" ? structuresOpen.size < maxPositions : stillOpen.length < maxPositions;
  if (!capacity) {
    trace.fill(entryGateIds, "Entry rules were not evaluated: the position limit is reached.");
    trace.fill(["nextra"], "The next cycle opens only after the open position closes or settles.");
    return decide("hold", breakerVetoes.length ? `Position remains open; entry blocked by ${breakerVetoes.join(", ")}.` : "Open model position remains inside its exit rules.");
  }

  // Gates.
  const vetoes: string[] = [...breakerVetoes, ...(!corpaxPass ? ["corpax"] : [])];
  const volra = objectRecord(parameters.volra);
  if (volra) {
    const rank = rvRankProxy(history);
    if (!rank || !rv) {
      trace.add("volra", "block", "DATA_MISSING: not enough realized-volatility history for a modeled IV rank.");
      vetoes.push("volra");
    } else {
      const metric = volra.metric === "ivAbs" ? rv.iv * 100 : rank.rank;
      const pass = volra.op === "below" ? metric < Number(volra.threshold) : metric >= Number(volra.threshold);
      trace.add("volra", pass ? "pass" : "block", `${pass ? "Volra ✓" : "Volra ✗"} modeled IV rank ${rank.rank.toFixed(0)} ${pass ? "≥" : "<"} ${Number(volra.threshold)} (realized-vol proxy, not an option-chain IV).`, {
        value: Number(metric.toFixed(2)), threshold: Number(volra.threshold), unit: volra.metric === "ivAbs" ? "modeled IV %" : "modeled IV rank", dataRefs: [`modeled:rv${rank.windowHours}_rank`, `samples:${rank.samples}`],
      });
      if (!pass) vetoes.push("volra");
    }
  }
  const trendix = objectRecord(parameters.trendix);
  if (trendix) {
    const result = evaluateTrendix(dailyCloses(longHistory, nowMs), spot, Number(trendix.fast), Number(trendix.slow), trendix.direction === "bearish" ? "bearish" : "bullish");
    if (result.status === "missing") {
      trace.add("trendix", "block", `DATA_MISSING: ${result.closes} daily closes are available; ${trendix.slow} are required for the slow average.`, { value: result.closes, threshold: Number(trendix.slow), unit: "daily closes" });
      vetoes.push("trendix");
    } else {
      trace.add("trendix", result.status, `${result.status === "pass" ? "Trendix ✓" : "Trendix ✗"} price ${spot.toFixed(2)} vs SMA${trendix.fast} ${result.fast!.toFixed(2)} and SMA${trendix.slow} ${result.slow!.toFixed(2)}.`, { value: Number(spot.toFixed(2)), threshold: Number(result.fast!.toFixed(2)), unit: "USD vs fast SMA" });
      if (result.status !== "pass") vetoes.push("trendix");
    }
  }
  const earnex = objectRecord(parameters.earnex);
  let earnexEvent = null as ReturnType<typeof earnexOnlyWindow>["event"];
  if (earnex) {
    if (!earningsEvents || earningsEvents.length === 0) {
      trace.add("earnex", "block", "DATA_MISSING: the earnings calendar could not be read, so no earnings-dependent entry is allowed.");
      vetoes.push("earnex");
    } else if (earnex.mode === "only") {
      const result = earnexOnlyWindow(earningsEvents, nowMs, Number(earnex.daysBefore));
      earnexEvent = result.event;
      const traded = result.event ? meta.tradedEarnings.includes(result.event.reportDate) : false;
      const pass = result.status === "pass" && !traded;
      trace.add("earnex", pass ? "pass" : "block", pass ? `Earnex ✓ ${result.reason}` : traded ? `Earnex ✗ the ${result.event!.reportDate} report was already traded.` : `Earnex ✗ ${result.reason}`, {
        value: result.daysToReport ?? "none", threshold: Number(earnex.daysBefore), unit: "days to confirmed report", dataRefs: [`earnings:${input.earnings?.source}:${input.earnings?.fetchedAt}`],
      });
      if (!pass) vetoes.push("earnex");
    } else {
      const result = earnexBlockWindow(earningsEvents, nowMs, Number(earnex.daysBefore), Number(earnex.daysAfter));
      trace.add("earnex", result.blocked ? "block" : "pass", result.blocked ? `Earnex ✗ earnings ${result.event!.reportDate} ${result.event!.verified ? "" : "(estimate) "}is ${result.daysToReport! >= 0 ? `in ${result.daysToReport}d` : `${-result.daysToReport!}d ago`} (blocked).` : `Earnex ✓ no earnings inside the ${earnex.daysBefore}d before / ${earnex.daysAfter}d after window${result.event ? `; next report ${result.event.reportDate}` : ""}.`, {
        value: result.daysToReport ?? "none", threshold: `${earnex.daysBefore}d before/${earnex.daysAfter}d after`, unit: "days to report", dataRefs: [`earnings:${input.earnings?.source}:${input.earnings?.fetchedAt}`],
      });
      if (result.blocked) vetoes.push("earnex");
    }
  }
  const sessionPass = sessionOpen;
  if (!sessionPass) trace.system("paper.session", "block", "Entries and fills are restricted to the regular US equity session, which is closed.");

  if (vetoes.length || !sessionPass || !rv) {
    const blockers = [...vetoes, ...(!sessionPass ? ["session"] : []), ...(!rv && !vetoes.includes("venux") ? ["venux"] : [])];
    trace.fill(["percy", "tenora", "deltra", "premo", "strangl", "coverix", "capra", "kelvo"].filter((hookId) => hookIds.includes(hookId)), `Not evaluated: entry blocked by ${[...new Set(blockers)].join(", ")}.`);
    trace.fill(["nextra"], "A new cycle opens only after every Gate and Breaker passes.");
    const reason = stillOpen.length
      ? `Position remains open; additional entry blocked by ${[...new Set(blockers)].join(", ")}.`
      : `Entry blocked by ${[...new Set(blockers)].join(", ")}.`;
    return decide(stillOpen.length ? "hold" : "skip", reason);
  }

  // Strike and size.
  const tenora = objectRecord(parameters.tenora)!;
  const capra = objectRecord(parameters.capra)!;
  const increment = Number(model.strikeIncrementUsd);
  let expiry: { expiryAt: string; dte: number } | null;
  if (template === "earnings_straddle") {
    const anchor = earnexEvent ? earningsReportMs(earnexEvent) : nowMs;
    expiry = selectExpiry({ cycle: "weekly", targetDTE: Number(tenora.targetDTE), minDTE: Number(tenora.minDTE), nowMs, afterMs: anchor });
  } else {
    expiry = selectExpiry({ cycle: "weekly", targetDTE: Number(tenora.targetDTE), minDTE: Number(tenora.minDTE), nowMs });
  }
  if (!expiry) {
    trace.add("tenora", "block", "NO_EXPIRY: no weekly expiry satisfies the DTE rules.");
    trace.fill(["percy", "deltra", "premo", "strangl", "coverix", "capra", "kelvo"].filter((hookId) => hookIds.includes(hookId)), "Not evaluated: no expiry was selected.");
    trace.fill(["nextra"], "No cycle could be opened.");
    return decide(stillOpen.length ? "hold" : "skip", "Entry blocked: no expiry satisfies the weekly DTE rules.");
  }
  trace.add("tenora", "select", `Tenora → weekly expiry ${expiry.expiryAt.slice(0, 10)} 16:00 ET (DTE ${expiry.dte.toFixed(1)})${template === "earnings_straddle" ? ", the first after the earnings report" : ""}.`, { value: expiry.expiryAt, threshold: Number(tenora.minDTE), unit: "min DTE" });

  const skipEntry = (blockedBy: string, reasonText: string): StrategyTickResult => {
    trace.fill(["percy", "deltra", "premo", "strangl", "coverix", "capra", "kelvo"].filter((hookId) => hookIds.includes(hookId)), `Not evaluated: ${blockedBy}.`);
    trace.fill(["nextra"], "No new cycle was opened.");
    return decide(stillOpen.length ? "hold" : "skip", reasonText);
  };

  const ivValue = rv.iv;
  const quoteAt = (optionType: ModeledOptionType, strike: number) => blackScholesEuropeanOption(optionType, { spotUsd: spot, strikeUsd: strike, expiryAt: expiry.expiryAt, valuationAt: current.observedAt, volatility: ivValue });
  const baseInputs = { spotUsd: spot, rv30: rv.rv30, iv: ivValue, riskFreeRate: 0, dividendYield: 0, unitShares: 1, feesIncluded: false, expiryDte: expiry.dte, rescues: 0 };
  const available = Number(account.cashUsd) - stillOpen.reduce((total, position) => total + Number(position.collateralUsd), 0);

  const newPosition = (optionType: ModeledOptionType, side: "long" | "short", strike: number, quantity: number, premium: number, fill: number, inputs: Record<string, unknown>, structureId: string | null, legRole: string | null, collateral: number): { position: StrategyPosition; order: StrategyOrderIntent } => {
    const key = `new:${nextOpenIndex}`;
    nextOpenIndex += 1;
    const position: StrategyPosition = {
      symbol: recipe.underlyingSymbol, optionType, side, quantity: String(quantity), averageEntryUsd: plain(fill), markPriceUsd: plain(premium), peakMarkPriceUsd: plain(premium),
      strikeUsd: strike.toFixed(2), expiryAt: expiry.expiryAt, impliedVolatility: plain(ivValue), modelName: modelFor(optionType), premiumSource: "modeled",
      modelInputs: inputs, collateralUsd: money(collateral), structureId, legRole, openedAt: current.observedAt, status: "open",
    };
    const order: StrategyOrderIntent = {
      action: "open", purpose: "open", legRole, positionKey: key, symbol: position.symbol, side: side === "short" ? "sell" : "buy", quantity: position.quantity,
      priceUsd: position.averageEntryUsd, modelPremiumUsd: plain(premium), feeUsd: "0", slippageBps: MODEL_SLIPPAGE_BPS, instrumentType: "modeled_option", optionType,
      strikeUsd: position.strikeUsd, expiryAt: position.expiryAt, impliedVolatility: position.impliedVolatility, modelName: position.modelName, premiumSource: "modeled", modelInputs: inputs,
    };
    return { position, order };
  };

  try {
    if (template === "covered_call") {
      const percy = objectRecord(parameters.percy)!;
      const coverix = objectRecord(parameters.coverix)!;
      const strike = roundToIncrement(spot * (1 + Number(percy.otmPct) / 100), Number(percy.strikeIncrementUsd), percy.rounding === "up" ? "up" : percy.rounding === "down" ? "down" : "nearest");
      trace.add("percy", "select", `Percy → ${percy.otmPct}% OTM call: target ${(spot * (1 + Number(percy.otmPct) / 100)).toFixed(2)} → strike ${strike.toFixed(2)} (theoretical, not a listed contract).`, { value: strike, threshold: Number(percy.otmPct), unit: "% OTM" });
      const shares = meta.referenceShares;
      const committed = stillOpen.filter((position) => position.optionType === "call" && position.side === "short").reduce((total, position) => total + Number(position.quantity), 0);
      const coveredAvailable = Math.max(0, Math.floor(shares * Number(coverix.coveragePct) / 100) - committed);
      trace.add("coverix", coveredAvailable > 0 ? "size" : "block", coveredAvailable > 0 ? `Coverix → ${coveredAvailable} one-share call unit(s) covered by ${shares} virtual reference shares (${committed} already committed).` : "INSUFFICIENT_COVER: every virtual reference share is already committed to an open short call.", { value: coveredAvailable, threshold: Number(coverix.coveragePct), unit: "covered units" });
      const quantity = Math.floor(coveredAvailable * Number(capra.maxPctPerPosition) / 100);
      const quote = quoteAt("call", strike);
      const credit = tradePrice(quote.premiumUsd, "sell");
      const capraPass = quantity >= 1 && credit >= MIN_PREMIUM_USD;
      trace.add("capra", capraPass ? "size" : "block", capraPass ? `Capra ✓ ${quantity} covered call unit(s), 1 position, premium ≈ $${(credit * quantity).toFixed(2)}.` : credit < MIN_PREMIUM_USD ? "PREMIUM_TOO_LOW: the modeled premium is below $0.01 per unit." : "CAP_EXCEEDED: no covered unit fits the position cap.", { value: quantity, threshold: Number(capra.maxPctPerPosition), unit: "% of covered units" });
      if (!capraPass) return skipEntry("sizing blocked", credit < MIN_PREMIUM_USD ? "Entry blocked: the modeled premium is below $0.01 per unit." : "Entry blocked: no covered call unit is available.");
      const built = newPosition("call", "short", strike, quantity, quote.premiumUsd, credit, { ...baseInputs, delta: quote.delta, strikeOtmPct: Number(percy.otmPct), referenceShares: shares }, null, null, 0);
      account.cashUsd = money(Number(account.cashUsd) + credit * quantity);
      meta.premiumCollectedUsd = money(Number(meta.premiumCollectedUsd) + credit * quantity);
      meta.entries += 1;
      positions.push(built.position);
      changes.push({ key: built.order.positionKey, action: "open", position: built.position });
      orders.push(built.order);
      trace.add("nextra", "pass", "A new covered-call cycle was opened; every Gate and Breaker passed first.");
      trace.system("paper.execution", "action", `${quantity} one-share modeled call unit(s) sold at a slippage-adjusted theoretical premium; venue fees are excluded.`);
      return decide("open", `Sold ${quantity} modeled covered call unit(s): ${strike.toFixed(2)} strike, expiry ${expiry.expiryAt.slice(0, 10)}; collected $${(credit * quantity).toFixed(2)} (paper).`);
    }

    if (template === "cash_secured_put") {
      const deltra = objectRecord(parameters.deltra)!;
      const premo = objectRecord(parameters.premo)!;
      const solved = solveStrikeForDelta({ optionType: "put", spotUsd: spot, expiryAt: expiry.expiryAt, valuationAt: current.observedAt, volatility: ivValue, targetAbsDelta: Number(deltra.targetDelta) });
      const strike = solved === null ? null : roundToIncrement(solved, Number(deltra.strikeIncrementUsd));
      const quote = strike === null ? null : quoteAt("put", strike);
      const withinTolerance = quote !== null && Math.abs(Math.abs(quote.delta) - Number(deltra.targetDelta)) <= Number(deltra.tolerance);
      if (!quote || strike === null || !withinTolerance) {
        trace.add("deltra", "block", "NO_STRIKE_IN_TOLERANCE: no strike lands within the delta tolerance.");
        return skipEntry("no strike", "Entry blocked: no put strike lands within the delta tolerance.");
      }
      trace.add("deltra", "select", `Deltra → ${strike.toFixed(2)}P, Δ${Math.abs(quote.delta).toFixed(2)} (target ${Number(deltra.targetDelta).toFixed(2)} ±${deltra.tolerance}).`, { value: Number(Math.abs(quote.delta).toFixed(3)), threshold: Number(deltra.targetDelta), unit: "|delta|" });
      const credit = tradePrice(quote.premiumUsd, "sell");
      const premiumPct = credit / spot * 100;
      const premoPass = premiumPct >= Number(premo.minPremiumPct) && credit >= MIN_PREMIUM_USD;
      trace.add("premo", premoPass ? "pass" : "block", `${premoPass ? "Premo ✓" : "Premo ✗ PREMIUM_TOO_LOW"} modeled premium ${premiumPct.toFixed(2)}% of spot ${premoPass ? "≥" : "<"} ${premo.minPremiumPct}%.`, { value: Number(premiumPct.toFixed(3)), threshold: Number(premo.minPremiumPct), unit: "% of spot" });
      if (!premoPass) return skipEntry("premium too low", "Entry blocked: the modeled premium is below the Premo minimum.");
      const budget = Math.min(equity * Number(capra.maxPctPerPosition) / 100, available);
      const quantity = Math.floor(budget / strike);
      const capraPass = quantity >= 1;
      trace.add("capra", capraPass ? "size" : "block", capraPass ? `Capra ✓ ${quantity} cash-secured unit(s): $${(strike * quantity).toFixed(2)} virtual USDG locked (${capra.maxPctPerPosition}% of equity cap, ${stillOpen.length}/${capra.maxOpenPositions} positions).` : "CAP_EXCEEDED: free virtual USDG cannot secure one full strike.", { value: Number((strike * quantity).toFixed(2)), threshold: Number(budget.toFixed(2)), unit: "USD collateral" });
      if (!capraPass) return skipEntry("sizing blocked", "Entry blocked: free virtual USDG cannot secure one unit at this strike.");
      const built = newPosition("put", "short", strike, quantity, quote.premiumUsd, credit, { ...baseInputs, delta: quote.delta, targetDelta: Number(deltra.targetDelta), collateralUsd: strike * quantity }, null, null, strike * quantity);
      account.cashUsd = money(Number(account.cashUsd) + credit * quantity);
      meta.premiumCollectedUsd = money(Number(meta.premiumCollectedUsd) + credit * quantity);
      meta.entries += 1;
      positions.push(built.position);
      changes.push({ key: built.order.positionKey, action: "open", position: built.position });
      orders.push(built.order);
      trace.add("nextra", "pass", "A new cash-secured-put cycle was opened; every Gate and Breaker passed first.");
      trace.system("paper.execution", "action", `${quantity} one-share modeled put unit(s) sold, secured by $${(strike * quantity).toFixed(2)} of virtual USDG; venue fees are excluded.`);
      return decide("open", `Sold ${quantity} modeled cash-secured put unit(s): ${strike.toFixed(2)} strike, expiry ${expiry.expiryAt.slice(0, 10)}; collected $${(credit * quantity).toFixed(2)} (paper).`);
    }

    // Earnings Straddle.
    const strike = roundToIncrement(spot, increment);
    const call = quoteAt("call", strike);
    const put = quoteAt("put", strike);
    const callFill = tradePrice(call.premiumUsd, "buy");
    const putFill = tradePrice(put.premiumUsd, "buy");
    const perUnit = callFill + putFill;
    const impliedMovePct = (call.premiumUsd + put.premiumUsd) / spot * 100;
    const kelvo = objectRecord(parameters.kelvo)!;
    const scale = Math.min(Number(kelvo.maxScale), Math.max(Number(kelvo.minScale), (Number(kelvo.targetVol) / 100) / rv.rv30));
    trace.add("strangl", "select", `Strangl → long ${strike.toFixed(2)} straddle: call $${call.premiumUsd.toFixed(2)} + put $${put.premiumUsd.toFixed(2)}, modeled implied move ±${impliedMovePct.toFixed(1)}%.`, { value: Number(perUnit.toFixed(4)), unit: "USD per unit including slippage" });
    const budget = Math.min(equity * Number(capra.maxPctPerPosition) / 100, Number(account.cashUsd));
    const baseUnits = Math.floor(budget / perUnit);
    const quantity = Math.floor(baseUnits * scale);
    trace.add("kelvo", quantity >= 1 ? "size" : "block", `Kelvo ×${scale.toFixed(2)} (RV30 ${(rv.rv30 * 100).toFixed(0)}% vs target ${kelvo.targetVol}%).`, { value: Number(scale.toFixed(3)), threshold: Number(kelvo.targetVol), unit: "size scale" });
    const capraPass = quantity >= 1;
    trace.add("capra", capraPass ? "size" : "block", capraPass ? `Capra ✓ ${quantity} straddle unit(s), cost $${(perUnit * quantity).toFixed(2)} (${capra.maxPctPerPosition}% cap = $${budget.toFixed(2)}).` : "CAP_EXCEEDED: the premium cap cannot buy one straddle unit.", { value: Number((perUnit * quantity).toFixed(2)), threshold: Number(budget.toFixed(2)), unit: "USD premium" });
    if (!capraPass) return skipEntry("sizing blocked", "Entry blocked: the premium cap cannot buy one straddle unit.");
    const structureId = `${input.agentId}:${input.tickId}`;
    const breakEven = { up: strike + perUnit, down: strike - perUnit };
    const sharedInputs = { ...baseInputs, structure: "long_straddle", reportDate: earnexEvent?.reportDate ?? null, reportAt: earnexEvent ? new Date(earningsReportMs(earnexEvent)).toISOString() : null, impliedMovePct, breakEvenUpUsd: breakEven.up, breakEvenDownUsd: breakEven.down, costPerUnitUsd: perUnit, ...earningsCtx() };
    const callLeg = newPosition("call", "long", strike, quantity, call.premiumUsd, callFill, { ...sharedInputs, delta: call.delta }, structureId, "call", 0);
    const putLeg = newPosition("put", "long", strike, quantity, put.premiumUsd, putFill, { ...sharedInputs, delta: put.delta }, structureId, "put", 0);
    for (const leg of [callLeg, putLeg]) {
      positions.push(leg.position);
      changes.push({ key: leg.order.positionKey, action: "open", position: leg.position });
      orders.push(leg.order);
    }
    account.cashUsd = money(Number(account.cashUsd) - perUnit * quantity);
    meta.premiumPaidUsd = money(Number(meta.premiumPaidUsd) + perUnit * quantity);
    meta.entries += 1;
    if (earnexEvent) meta.tradedEarnings = [...meta.tradedEarnings, earnexEvent.reportDate];
    trace.add("nextra", "noop", "The straddle is held through the report and closed by its exit rules.");
    trace.system("paper.execution", "action", `${quantity} one-share modeled call and put unit(s) bought at slippage-adjusted theoretical premiums; venue fees are excluded.`);
    return decide("open", `Bought ${quantity} modeled long straddle unit(s) at ${strike.toFixed(2)} before the ${earnexEvent?.reportDate ?? "scheduled"} report; cost $${(perUnit * quantity).toFixed(2)}, break-evens ${breakEven.down.toFixed(2)} / ${breakEven.up.toFixed(2)} (paper).`);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    trace.add("venux", "block", `A valid modeled premium is unavailable: ${error.message}`);
    return skipEntry("model failed", "Entry blocked: the premium model could not price the option.");
  }
}

/** Mark-to-model equity: cash, plus long marks, minus short marks, plus (Covered Call) the virtual reference shares at `spot`. */
export function strategyEquity(template: StrategyTemplateId, account: StrategyAccount, positions: StrategyPosition[], spot: number): number {
  return equityOf(template, account, positions, spot, account.meta);
}

function equityOf(template: StrategyTemplateId, account: StrategyAccount, positions: StrategyPosition[], spot: number, meta: StrategyAccountMeta): number {
  const options = positions.filter((position) => position.status === "open").reduce((total, position) => total + signedMark(position), 0);
  const shares = template === "covered_call" ? meta.referenceShares * spot : 0;
  return Number(account.cashUsd) + options + shares;
}

function exposureOf(template: StrategyTemplateId, account: StrategyAccount, positions: StrategyPosition[], spot: number, meta: StrategyAccountMeta, equity: number): number {
  if (equity <= 0) return Number.POSITIVE_INFINITY;
  const open = positions.filter((position) => position.status === "open");
  if (template === "covered_call") return meta.referenceShares * spot / equity * 100;
  if (template === "cash_secured_put") return open.reduce((total, position) => total + Number(position.collateralUsd), 0) / equity * 100;
  return open.reduce((total, position) => total + Number(position.markPriceUsd) * Number(position.quantity), 0) / equity * 100;
}

