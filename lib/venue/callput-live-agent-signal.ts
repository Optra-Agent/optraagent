/**
 * Maps a deterministic Paper House Agent decision to a verified CallPut order structure, and turns it into at most one
 * prepared plan per decision.
 *
 * PROPOSED mapping, inactive until the owner records approval in LIVE_MAPPING_APPROVAL_REF. Without that reference the
 * source returns nothing. Even with it, a plan is only requested after G1-G7 pass (the worker asks for no plan before),
 * and every policy gate and the on-chain grant still apply afterwards.
 *
 *   protective_put    -> BuyPutSpread   A defined-risk long put spread replaces the single long put the Paper agent
 *                                       models. Different payoff (capped), same direction of protection.
 *   covered_call      -> none           Needs a sell-call structure with stock collateral semantics; not built.
 *   cash_secured_put  -> none           Needs a sell-put spread with collateral semantics; the plan builder refuses sells.
 *   earnings_straddle -> none           Needs a long call and a long put in one structure; not a CallPut spread.
 *
 * Only an `open` decision starts an order. close, hold and skip send nothing: automated closing needs a delegated close
 * capability that does not exist for this owner today, so positions are closed by the owner's wallet.
 */
import { and, desc, eq, gte } from "drizzle-orm";
import type { PublicClient } from "viem";
import { z } from "zod";
import { agents, paperDecisions } from "../../db/schema";
import type { AppDatabase } from "../db/client";
import { getLiveAgentGrant, toLiveAgentPolicy } from "./callput-live-agent-store";
import { prepareGrantBoundedPlan } from "./callput-live-agent-plan";
import { isCallPutUnderlying, type CallPutOpenSpreadPlan, type CallPutUnderlyingSymbol } from "./callput-robinhood-write";
import type { CallPutRobinhoodMarketData } from "./callput-robinhood-readonly";

/** The venue-verified candidate size (docs/evidence/callput/candidate-order-preflight-20261122.json). The guard's collateral caps still bound it. */
export const LIVE_ORDER_SIZE = "0.1";
/** A decision older than this is not acted on: the market it described is gone. */
export const DECISION_MAX_AGE_MS = 2 * 3_600_000;

export type StructureMapping =
  | { ok: true; strategy: "BuyPutSpread"; underlying: CallPutUnderlyingSymbol; size: string; rationale: string }
  | { ok: false; reason: string };

export function mapDecisionToStructure(templateId: string, underlyingSymbol: string, action: string): StructureMapping {
  if (action !== "open") return { ok: false, reason: `A ${action} decision sends nothing: only an open decision starts an order, and closing is done by the owner's wallet.` };
  const symbol = underlyingSymbol.trim().toUpperCase();
  if (!isCallPutUnderlying(symbol)) return { ok: false, reason: `${symbol} is not a configured CallPut underlying.` };
  switch (templateId) {
    case "protective_put":
      return { ok: true, strategy: "BuyPutSpread", underlying: symbol, size: LIVE_ORDER_SIZE, rationale: "Long put spread as the defined-risk stand-in for the modeled long put." };
    case "covered_call":
      return { ok: false, reason: "Covered Call needs a sell-call structure with stock collateral; it is not built for CallPut." };
    case "cash_secured_put":
      return { ok: false, reason: "Cash-Secured Put needs a sell-put spread with collateral semantics; the live plan builder does not build sell spreads." };
    case "earnings_straddle":
      return { ok: false, reason: "Earnings Straddle needs a long call and a long put together; CallPut spreads cannot express it." };
    default:
      return { ok: false, reason: `No approved mapping exists for ${templateId}.` };
  }
}

export type LiveDecision = { decisionId: string; prepare: () => Promise<CallPutOpenSpreadPlan | null> };
export type LiveDecisionSource = (grant: { ownerId: string; agentId: string; grantId: string }, now: Date) => Promise<LiveDecision | null>;

export type PaperDecisionSourceOptions = {
  db: AppDatabase;
  client: PublicClient;
  env: Record<string, string | undefined>;
  fetchMarket?: () => Promise<CallPutRobinhoodMarketData>;
};

export function createPaperDecisionSource(options: PaperDecisionSourceOptions): LiveDecisionSource {
  return async (grant, now) => {
    if (!options.env.LIVE_MAPPING_APPROVAL_REF?.trim()) return null;
    const isUuid = z.uuid().safeParse(grant.agentId).success;
    const [agent] = await options.db.select({ id: agents.id, templateId: agents.templateId, recipe: agents.recipe })
      .from(agents).where(isUuid ? eq(agents.id, grant.agentId) : eq(agents.houseKey, grant.agentId)).limit(1);
    if (!agent) return null;
    const since = new Date(now.getTime() - DECISION_MAX_AGE_MS);
    const [decision] = await options.db.select({ id: paperDecisions.id, action: paperDecisions.action })
      .from(paperDecisions).where(and(eq(paperDecisions.agentId, agent.id), eq(paperDecisions.action, "open"), gte(paperDecisions.createdAt, since)))
      .orderBy(desc(paperDecisions.createdAt)).limit(1);
    if (!decision) return null;
    const mapping = mapDecisionToStructure(agent.templateId, agent.recipe.underlyingSymbol, decision.action);
    if (!mapping.ok) return null;
    const record = await getLiveAgentGrant(options.db, grant.ownerId, grant.grantId);
    if (!record) return null;
    const policy = toLiveAgentPolicy(record, false);
    return {
      decisionId: decision.id,
      prepare: () => prepareGrantBoundedPlan({ client: options.client, policy, underlying: mapping.underlying, strategy: mapping.strategy, size: mapping.size, nowMs: now.getTime(), ...(options.fetchMarket ? { fetchMarket: options.fetchMarket } : {}) }),
    };
  };
}
