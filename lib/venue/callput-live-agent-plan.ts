/**
 * A grant-bounded plan source for the Live Agent: it turns an owner policy plus the live venue feed into one fully
 * prepared CallPut open-spread plan, or into no plan.
 *
 * This is structure selection (nearest eligible expiry, the two available strikes closest to spot), NOT a trading
 * signal. Whether and when to trade is a separate decision, and no mapping from a Paper House Agent decision to a real
 * order has been approved, so this builder is not wired to the scheduler. Callers (the fork acceptance run, and a future
 * approved signal) decide when to ask for a plan; the worker's policy gates still decide whether it may proceed.
 */
import type { PublicClient } from "viem";
import type { LiveAgentPolicy } from "./callput-live-agent-guard";
import { fetchCallPutRobinhoodMarketData, type CallPutRobinhoodMarketData } from "./callput-robinhood-readonly";
import {
  CallPutRiskError,
  prepareCallPutOpenSpread,
  readCallPutWalletState,
  type CallPutOpenSpreadPlan,
  type CallPutSpreadStrategy,
  type CallPutUnderlyingSymbol,
} from "./callput-robinhood-write";

export type GrantBoundedPlanInput = {
  client: PublicClient;
  policy: LiveAgentPolicy;
  underlying: CallPutUnderlyingSymbol;
  /** Only buy-side spreads are built here. Sell spreads have different collateral semantics and are not supported. */
  strategy: Extract<CallPutSpreadStrategy, "BuyPutSpread" | "BuyCallSpread">;
  /** Decimal underlying size, e.g. "0.1". */
  size: string;
  nowMs: number;
  /** Injectable for tests; defaults to the live venue feed. */
  fetchMarket?: () => Promise<CallPutRobinhoodMarketData>;
};

/**
 * Returns null when nothing may be prepared: the underlying or strategy is not allowed by the policy, no two adjacent
 * available legs exist inside the expiry window, or the venue-side checks fail (balance, allowance, fee, quote age).
 * Rejects on RPC or feed failure so the worker reports it as a read failure and trades nothing.
 */
export async function prepareGrantBoundedPlan(input: GrantBoundedPlanInput): Promise<CallPutOpenSpreadPlan | null> {
  const { policy, underlying, strategy } = input;
  if (!policy.allowedUnderlyings.includes(underlying) || !policy.allowedStrategies.includes(strategy)) return null;

  const market = await (input.fetchMarket ?? fetchCallPutRobinhoodMarketData)();
  const side = strategy === "BuyPutSpread" ? "put" : "call";
  const nowSeconds = input.nowMs / 1000;
  const inWindow = market.options
    .filter((o) => o.underlyingSymbol === underlying && o.side === side && o.marketAvailable)
    .filter((o) => {
      const days = (o.expiryTimestamp - nowSeconds) / 86_400;
      return days >= policy.minExpiryDays && days <= policy.maxExpiryDays;
    })
    .sort((a, b) => a.expiryTimestamp - b.expiryTimestamp || a.strikePriceRaw - b.strikePriceRaw);
  const expiry = inWindow[0]?.expiryTimestamp;
  if (expiry === undefined) return null;

  const spot = market.spotIndexRaw[underlying] ?? 0;
  const [lower, upper] = inWindow
    .filter((o) => o.expiryTimestamp === expiry)
    .sort((a, b) => Math.abs(a.strikePriceRaw - spot) - Math.abs(b.strikePriceRaw - spot))
    .slice(0, 2)
    .sort((a, b) => a.strikePriceRaw - b.strikePriceRaw);
  if (!lower || !upper || lower.strikePriceRaw === upper.strikePriceRaw) return null;
  // A buy put spread is long the higher strike; a buy call spread is long the lower strike.
  const [long, short] = side === "put" ? [upper, lower] : [lower, upper];

  const wallet = await readCallPutWalletState(input.client, policy.tradingAddress);
  try {
    return prepareCallPutOpenSpread({ strategy, underlying, longOptionId: long.optionId, shortOptionId: short.optionId, size: input.size, market, wallet, nowMs: input.nowMs });
  } catch (error) {
    if (error instanceof CallPutRiskError) return null;
    throw error;
  }
}
