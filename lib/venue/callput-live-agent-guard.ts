/**
 * Authorization boundary for automated CallPut Live Agent orders.
 *
 * Pure policy code: it never signs, broadcasts, holds keys, or calls the venue. It decides whether a prepared
 * order (from `prepareCallPutOpenSpread`) may be PROPOSED for submission, and it reports why autonomous
 * submission is still blocked. Autonomous submission requires every blocker below to clear; today the venue
 * delegation blocker cannot be cleared from inside this repository.
 */
import { createHash } from "node:crypto";
import type { Address } from "viem";
import { CALLPUT_LIMITS, type CallPutOpenSpreadPlan, type CallPutRiskCheck, type CallPutSpreadStrategy, type CallPutUnderlyingSymbol } from "./callput-robinhood-write";
import type { CallPutRobinhoodRequestSnapshot } from "./callput-robinhood-requests";

export type LiveAgentPolicy = {
  /** Wallet that owns the funds and signed the grant. */
  ownerAddress: Address;
  /** The only address the agent may trade from (owner EOA or the owner's smart account). */
  tradingAddress: Address;
  /** Emergency stop. Defaults to stopped; the owner must explicitly enable. */
  enabled: boolean;
  allowedUnderlyings: readonly CallPutUnderlyingSymbol[];
  allowedStrategies: readonly CallPutSpreadStrategy[];
  maxCollateralPerOrderRaw: bigint;
  maxOpenCollateralRaw: bigint;
  maxDailyCollateralRaw: bigint;
  maxOrdersPerDay: number;
  maxPendingRequests: number;
  maxExecutionFeeWei: bigint;
  minExpiryDays: number;
  maxExpiryDays: number;
  /** Absolute end of the owner's authorization. */
  grantExpiresAtMs: number;
};

export type LiveAgentState = {
  nowMs: number;
  openCollateralRaw: bigint;
  /** Collateral committed in the current UTC day, including requests still pending. */
  dailyCollateralRaw: bigint;
  ordersToday: number;
  pendingRequests: number;
  /** Process-level stop (env or admin). Either this or `policy.enabled === false` blocks. */
  globalKillSwitch: boolean;
};

export type LiveAgentDecision = { allowed: boolean; checks: CallPutRiskCheck[] };

const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function defaultLiveAgentPolicy(ownerAddress: Address, tradingAddress: Address, nowMs: number): LiveAgentPolicy {
  return {
    ownerAddress,
    tradingAddress,
    enabled: false,
    allowedUnderlyings: [],
    allowedStrategies: ["BuyPutSpread"],
    maxCollateralPerOrderRaw: 10_000_000n, // 10 USDG
    maxOpenCollateralRaw: 25_000_000n,
    maxDailyCollateralRaw: 25_000_000n,
    maxOrdersPerDay: 2,
    maxPendingRequests: 1,
    maxExecutionFeeWei: CALLPUT_LIMITS.maxExecutionFeeWei,
    minExpiryDays: 3,
    maxExpiryDays: 45,
    grantExpiresAtMs: nowMs + 24 * 3_600_000,
  };
}

/** Every check must pass; a missing or malformed value fails closed. */
export function evaluateLiveAgentOrder(policy: LiveAgentPolicy, plan: CallPutOpenSpreadPlan, state: LiveAgentState): LiveAgentDecision {
  const intent = plan.intent;
  const collateral = plan.quote.amountInRaw;
  const feeWei = plan.transactions.find((tx) => tx.kind === "open-spread")?.value ?? -1n;
  const expiryDays = (intent.expiry * 1000 - state.nowMs) / 86_400_000;
  const checks: CallPutRiskCheck[] = [
    { id: "kill-switch", ok: policy.enabled && !state.globalKillSwitch, detail: policy.enabled && !state.globalKillSwitch ? "Agent is enabled." : "Emergency stop is active or the agent was never enabled." },
    { id: "grant-live", ok: state.nowMs < policy.grantExpiresAtMs, detail: state.nowMs < policy.grantExpiresAtMs ? "Owner grant is unexpired." : "Owner grant expired; the owner must renew it." },
    { id: "trading-address", ok: sameAddress(intent.account, policy.tradingAddress) && plan.transactions.every((tx) => sameAddress(tx.from, policy.tradingAddress)), detail: "Order must originate from the granted trading address only." },
    { id: "underlying", ok: policy.allowedUnderlyings.includes(intent.underlying), detail: `${intent.underlying} must be on the owner allowlist.` },
    { id: "strategy", ok: policy.allowedStrategies.includes(intent.strategy), detail: `${intent.strategy} must be on the owner allowlist.` },
    { id: "per-order-collateral", ok: collateral > 0n && collateral <= policy.maxCollateralPerOrderRaw, detail: `Collateral ${collateral} raw must be within ${policy.maxCollateralPerOrderRaw} raw per order.` },
    { id: "open-exposure", ok: state.openCollateralRaw + collateral <= policy.maxOpenCollateralRaw, detail: `Open exposure after this order must stay within ${policy.maxOpenCollateralRaw} raw.` },
    { id: "daily-budget", ok: state.dailyCollateralRaw + collateral <= policy.maxDailyCollateralRaw, detail: `Daily commitment after this order must stay within ${policy.maxDailyCollateralRaw} raw.` },
    { id: "order-count", ok: state.ordersToday < policy.maxOrdersPerDay, detail: `At most ${policy.maxOrdersPerDay} orders per UTC day.` },
    { id: "pending-requests", ok: state.pendingRequests < policy.maxPendingRequests, detail: `At most ${policy.maxPendingRequests} unresolved request(s); reconcile before submitting more.` },
    { id: "execution-fee", ok: feeWei >= 0n && feeWei <= policy.maxExecutionFeeWei, detail: `Execution fee must be within ${policy.maxExecutionFeeWei} wei.` },
    { id: "expiry-window", ok: expiryDays >= policy.minExpiryDays && expiryDays <= policy.maxExpiryDays, detail: `Expiry must be ${policy.minExpiryDays}–${policy.maxExpiryDays} days out.` },
    { id: "venue-checks", ok: plan.checks.every((check) => check.ok), detail: "Every venue-side prepare check must pass." },
  ];
  return { allowed: checks.every((check) => check.ok), checks };
}

export type AutonomyBlocker = { id: string; detail: string };
export type AutonomyEvidence = {
  /** Written CallPut confirmation of the delegation/session-key permission terms. */
  venueDelegationConfirmedRef: string | null;
  /** Reference to the owner's on-chain grant (session key / smart-account permission) transaction. */
  onchainGrantRef: string | null;
  /** Independent audit covering the account/session contracts used. */
  auditRef: string | null;
  /** Owner's explicit approval of autonomous trading. */
  ownerApprovalRef: string | null;
  /** Revocation procedure was rehearsed. */
  revocationTested: boolean;
};

/** Autonomous submission stays blocked until every item is evidenced. Nothing here can be satisfied by code alone. */
export function autonomyBlockers(evidence: AutonomyEvidence): AutonomyBlocker[] {
  const blockers: AutonomyBlocker[] = [];
  if (!evidence.venueDelegationConfirmedRef) blockers.push({ id: "venue-delegation", detail: "CallPut has not confirmed a supported delegation/automation model in writing." });
  if (!evidence.onchainGrantRef) blockers.push({ id: "onchain-grant", detail: "No owner-signed on-chain grant limits the agent's key; software limits alone are insufficient." });
  if (!evidence.auditRef) blockers.push({ id: "audit", detail: "Independent audit of the account/session contracts is missing." });
  if (!evidence.ownerApprovalRef) blockers.push({ id: "owner-approval", detail: "Owner has not approved autonomous trading for this exact policy." });
  if (!evidence.revocationTested) blockers.push({ id: "revocation", detail: "Grant revocation has not been rehearsed." });
  return blockers;
}

/** Stable idempotency key: the same agent decision can never produce two orders. */
export function liveAgentIdempotencyKey(agentId: string, tickId: string, plan: CallPutOpenSpreadPlan): string {
  const { intent } = plan;
  return createHash("sha256")
    .update([agentId, tickId, intent.account.toLowerCase(), intent.strategy, intent.longOptionId, intent.shortOptionId, intent.sizeRaw, intent.amountInRaw].join("|"))
    .digest("hex");
}

export type RequestHealth = { requestKey: string; state: "settled" | "pending" | "stale" | "cancelled" | "unknown"; action: "none" | "wait" | "inspect-onchain" | "stop-agent" };

/**
 * Classifies tracked requests. A tx hash alone is never a fill: only `Executed` is settled.
 * A request pending beyond the venue window is stale; stale or unknown requests halt new orders.
 */
export function classifyRequests(requests: readonly CallPutRobinhoodRequestSnapshot[], nowMs: number): RequestHealth[] {
  const windowMs = (CALLPUT_LIMITS.maxTimeDelaySeconds + 120) * 1000;
  return requests.map((r) => {
    const key = r.requestKey;
    if (r.status === "Executed") return { requestKey: key, state: "settled", action: "none" };
    if (r.status === "Cancelled") return { requestKey: key, state: "cancelled", action: "inspect-onchain" };
    if (r.status === "Pending") {
      const submitted = r.submittedAt === null ? null : Number(r.submittedAt) * 1000;
      if (submitted === null) return { requestKey: key, state: "unknown", action: "stop-agent" };
      return nowMs - submitted > windowMs ? { requestKey: key, state: "stale", action: "stop-agent" } : { requestKey: key, state: "pending", action: "wait" };
    }
    return { requestKey: key, state: "unknown", action: "stop-agent" };
  });
}

/** True when monitoring says new orders must stop. */
export const shouldHaltNewOrders = (health: readonly RequestHealth[]): boolean => health.some((h) => h.action === "stop-agent");

export type SchedulerLease = { holder: string; acquiredAtMs: number; ttlMs: number } | null;

/** Single-flight lease so overlapping scheduler runs cannot double-submit. */
export function canAcquireLease(lease: SchedulerLease, nowMs: number): boolean {
  return lease === null || nowMs - lease.acquiredAtMs >= lease.ttlMs;
}
