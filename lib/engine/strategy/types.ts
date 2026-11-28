import type { AgentDecision, HookResult, MarketCandle, MarketSnapshot, RecipeV1 } from "../../domain/contracts";
import type { VolatilityOraclePayload } from "../../economics/resource-validator";
import type { EarningsEvent, EarningsSnapshot } from "../../market/earnings";

export type StrategyTemplateId = "covered_call" | "cash_secured_put" | "earnings_straddle";

export type StrategyModelName = "black_scholes_european_call" | "black_scholes_european_put";

/** One modeled option position (a leg). Short positions carry a liability; long positions carry value. */
export type StrategyPosition = {
  id?: string;
  symbol: string;
  optionType: "call" | "put";
  side: "long" | "short";
  quantity: string;
  /** Per-unit fill price including slippage: the credit received for a short, the cost paid for a long. */
  averageEntryUsd: string;
  markPriceUsd: string;
  peakMarkPriceUsd: string;
  strikeUsd: string;
  expiryAt: string;
  impliedVolatility: string;
  modelName: StrategyModelName;
  premiumSource: "modeled";
  modelInputs: Record<string, unknown>;
  /** Virtual USDG reserved against a short put: strike × quantity. */
  collateralUsd: string;
  structureId: string | null;
  legRole: string | null;
  openedAt: string;
  status: "open" | "closed";
  closedAt?: string | null;
  realizedPnlUsd?: string;
};

export type StrategyAccountMeta = {
  /** Covered Call: virtual shares the calls are written against. */
  referenceShares: number;
  referenceStartPriceUsd: string | null;
  startedAt: string | null;
  entries: number;
  closes: number;
  winningCloses: number;
  rolls: number;
  settledItm: number;
  settledOtm: number;
  premiumCollectedUsd: string;
  premiumPaidUsd: string;
  worstTradeUsd: string | null;
  /** Earnings Straddle: report dates already traded, so one event is never entered twice. */
  tradedEarnings: string[];
};

export type StrategyAccount = {
  initialCapitalUsd: string;
  cashUsd: string;
  realizedPnlUsd: string;
  peakEquityUsd: string;
  dailyStartEquityUsd: string;
  dailyStartDate: string;
  meta: StrategyAccountMeta;
};

export type StrategyOrderIntent = {
  action: "open" | "close" | "settle";
  purpose: "open" | "take_profit" | "stop_loss" | "pre_expiry_close" | "rescue_roll_close" | "rescue_roll_open" | "rescue_close" | "expiry_settlement";
  legRole: string | null;
  /** Position the fill belongs to: an existing position id, or `new:<n>` for a position this tick opens. */
  positionKey: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: string;
  priceUsd: string;
  modelPremiumUsd: string;
  feeUsd: "0";
  slippageBps: number;
  instrumentType: "modeled_option";
  optionType: "call" | "put";
  strikeUsd: string;
  expiryAt: string;
  impliedVolatility: string;
  modelName: StrategyModelName;
  premiumSource: "modeled";
  modelInputs: Record<string, unknown>;
};

export type PositionChange = { key: string; action: "open" | "update" | "close"; position: StrategyPosition };

export type StrategyPortfolioUpdate = { account: StrategyAccount; changes: PositionChange[] };

export type StrategyTickInput = {
  agentId: string;
  tickId: string;
  occurredAt: string;
  recipe: RecipeV1;
  recipeHash: string;
  snapshot: MarketSnapshot | null;
  currentCandle?: MarketCandle | null;
  /** Finalized hourly candles before the evaluation, oldest first. At least 721 are required; more lets Trendix use more days. */
  history?: MarketCandle[];
  corporateActionDates?: string[];
  earnings?: EarningsSnapshot | null;
  account?: StrategyAccount | null;
  positions?: StrategyPosition[];
  paidVolatilityResource?: VolatilityOraclePayload | null;
  includeMarketContext?: boolean;
  state: { status: "draft" | "running" | "paused" | "stopped" };
};

export type StrategyTickResult = {
  decision: AgentDecision;
  orderIntents: StrategyOrderIntent[];
  portfolio: StrategyPortfolioUpdate;
};

export type StrategyEvidence = {
  hookResults: HookResult[];
  earningsEvents?: EarningsEvent[];
};

export const EMPTY_STRATEGY_META: StrategyAccountMeta = {
  referenceShares: 0,
  referenceStartPriceUsd: null,
  startedAt: null,
  entries: 0,
  closes: 0,
  winningCloses: 0,
  rolls: 0,
  settledItm: 0,
  settledOtm: 0,
  premiumCollectedUsd: "0",
  premiumPaidUsd: "0",
  worstTradeUsd: null,
  tradedEarnings: [],
};

function metaNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function metaString(value: unknown, fallback: string): string {
  return typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value) ? value : fallback;
}

/** Reads the persisted account `meta` jsonb defensively: an old or partial row falls back to zeros. */
export function parseStrategyMeta(value: unknown): StrategyAccountMeta {
  const record = value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    referenceShares: metaNumber(record.referenceShares),
    referenceStartPriceUsd: typeof record.referenceStartPriceUsd === "string" ? record.referenceStartPriceUsd : null,
    startedAt: typeof record.startedAt === "string" ? record.startedAt : null,
    entries: metaNumber(record.entries),
    closes: metaNumber(record.closes),
    winningCloses: metaNumber(record.winningCloses),
    rolls: metaNumber(record.rolls),
    settledItm: metaNumber(record.settledItm),
    settledOtm: metaNumber(record.settledOtm),
    premiumCollectedUsd: metaString(record.premiumCollectedUsd, "0"),
    premiumPaidUsd: metaString(record.premiumPaidUsd, "0"),
    worstTradeUsd: typeof record.worstTradeUsd === "string" && /^-?\d+(?:\.\d+)?$/.test(record.worstTradeUsd) ? record.worstTradeUsd : null,
    tradedEarnings: Array.isArray(record.tradedEarnings) ? record.tradedEarnings.filter((item): item is string => typeof item === "string") : [],
  };
}
