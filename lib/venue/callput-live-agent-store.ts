/**
 * Durable state for the CallPut Live Agent: owner grants, emergency stop, single-flight lease and the request ledger.
 *
 * This module never signs, broadcasts, holds keys or calls the venue, and no API route or scheduler imports it yet.
 * Autonomous submission stays disabled: `authorizeLiveAgentOrder` fails closed unless `LIVE_TRADING_ENABLED=true`, the
 * grant is active with every autonomy evidence reference recorded, the durable stop is cleared, the caller holds the
 * lease, no tracked request is stale or unknown, and the pure policy in `callput-live-agent-guard` passes.
 */
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { liveAgentControls, liveAgentGrants, liveAgentLeases, liveAgentRequests } from "../../db/schema";
import type { AppDatabase } from "../db/client";
import { CALLPUT_LIMITS, CALLPUT_ROBINHOOD_UNDERLYINGS, CALLPUT_SPREAD_STRATEGIES, type CallPutOpenSpreadPlan, type CallPutRiskCheck } from "./callput-robinhood-write";
import type { CallPutRobinhoodRequestSnapshot } from "./callput-robinhood-requests";
import {
  autonomyBlockers,
  classifyRequests,
  evaluateLiveAgentOrder,
  liveAgentIdempotencyKey,
  type AutonomyBlocker,
  type AutonomyEvidence,
  type LiveAgentPolicy,
  type LiveAgentState,
} from "./callput-live-agent-guard";

/** Absolute ceilings no owner policy can exceed, whatever the grant row says. */
export const LIVE_AGENT_HARD_CAPS = {
  maxCollateralPerOrderRaw: 10_000_000n,
  maxOpenCollateralRaw: 25_000_000n,
  maxDailyCollateralRaw: 25_000_000n,
  maxOrdersPerDay: 5,
  maxPendingRequests: 1,
  maxGrantLifetimeMs: 30 * 86_400_000,
  /** A request that never obtained a request key within this window is treated as unknown and halts the agent. */
  maxUnkeyedRequestAgeMs: 10 * 60_000,
} as const;

export const LIVE_AGENT_REQUEST_STATES = ["reserved", "submitted", "pending", "executed", "cancelled", "stale", "unknown", "closed"] as const;
export type LiveAgentRequestState = (typeof LIVE_AGENT_REQUEST_STATES)[number];
const UNRESOLVED: readonly LiveAgentRequestState[] = ["reserved", "submitted", "pending", "stale", "unknown"];
const TRANSITIONS: Record<LiveAgentRequestState, readonly LiveAgentRequestState[]> = {
  reserved: ["submitted", "cancelled", "unknown"],
  submitted: ["pending", "executed", "cancelled", "unknown"],
  pending: ["executed", "cancelled", "stale", "unknown"],
  stale: ["executed", "cancelled"],
  unknown: ["pending", "executed", "cancelled"],
  executed: ["closed"],
  cancelled: [],
  closed: [],
};

const AddressSchema = z.string().regex(/^0x[\da-fA-F]{40}$/);
const RawSchema = z.string().regex(/^\d{1,78}$/);
const Bytes32Schema = z.string().regex(/^0x[\da-fA-F]{64}$/);
const RefSchema = z.string().trim().min(3).max(300);

const StoredPolicySchema = z.object({
  allowedUnderlyings: z.array(z.enum(Object.keys(CALLPUT_ROBINHOOD_UNDERLYINGS) as [string, ...string[]])).min(1).max(8),
  allowedStrategies: z.array(z.enum(CALLPUT_SPREAD_STRATEGIES)).min(1),
  maxCollateralPerOrderRaw: RawSchema,
  maxOpenCollateralRaw: RawSchema,
  maxDailyCollateralRaw: RawSchema,
  maxOrdersPerDay: z.number().int().min(1).max(LIVE_AGENT_HARD_CAPS.maxOrdersPerDay),
  maxPendingRequests: z.number().int().min(1).max(LIVE_AGENT_HARD_CAPS.maxPendingRequests),
  maxExecutionFeeWei: RawSchema,
  minExpiryDays: z.number().min(1).max(365),
  maxExpiryDays: z.number().min(1).max(365),
}).strict().superRefine((policy, ctx) => {
  const cap = (value: string, limit: bigint, path: string) => {
    if (BigInt(value) <= 0n || BigInt(value) > limit) ctx.addIssue({ code: "custom", path: [path], message: `Must be between 1 and the hard cap ${limit} raw.` });
  };
  cap(policy.maxCollateralPerOrderRaw, LIVE_AGENT_HARD_CAPS.maxCollateralPerOrderRaw, "maxCollateralPerOrderRaw");
  cap(policy.maxOpenCollateralRaw, LIVE_AGENT_HARD_CAPS.maxOpenCollateralRaw, "maxOpenCollateralRaw");
  cap(policy.maxDailyCollateralRaw, LIVE_AGENT_HARD_CAPS.maxDailyCollateralRaw, "maxDailyCollateralRaw");
  cap(policy.maxExecutionFeeWei, CALLPUT_LIMITS.maxExecutionFeeWei, "maxExecutionFeeWei");
  if (policy.minExpiryDays > policy.maxExpiryDays) ctx.addIssue({ code: "custom", path: ["minExpiryDays"], message: "Minimum expiry exceeds maximum." });
});
export type StoredLiveAgentPolicy = z.infer<typeof StoredPolicySchema>;

const EvidenceSchema = z.object({
  venueDelegationConfirmedRef: RefSchema.nullable().optional(),
  onchainGrantRef: RefSchema.nullable().optional(),
  auditRef: RefSchema.nullable().optional(),
  ownerApprovalRef: RefSchema.nullable().optional(),
  revocationTested: z.boolean().optional(),
}).strict();

const ProposeSchema = z.object({
  ownerAddress: AddressSchema,
  tradingAddress: AddressSchema,
  agentId: z.string().min(1).max(64),
  route: z.enum(["direct-wallet", "callput-account"]),
  policy: StoredPolicySchema,
  expiresAtMs: z.number().int().positive(),
}).strict();
export type ProposeLiveAgentGrantInput = z.input<typeof ProposeSchema>;

export type LiveAgentGrantRecord = {
  id: string;
  ownerId: string;
  agentId: string;
  ownerAddress: string;
  tradingAddress: string;
  route: "direct-wallet" | "callput-account";
  policy: StoredLiveAgentPolicy;
  evidence: AutonomyEvidence;
  status: "proposed" | "active" | "revoked";
  expiresAtMs: number;
};

export type LiveAgentRequestRecord = {
  id: string;
  ownerId: string;
  grantId: string;
  idempotencyKey: string;
  state: LiveAgentRequestState;
  collateralRaw: string;
  transactionHash: string | null;
  requestKey: string | null;
  createdAtMs: number;
};

type GrantRow = typeof liveAgentGrants.$inferSelect;
type RequestRow = typeof liveAgentRequests.$inferSelect;

function emptyEvidence(): AutonomyEvidence {
  return { venueDelegationConfirmedRef: null, onchainGrantRef: null, auditRef: null, ownerApprovalRef: null, revocationTested: false };
}

function toGrant(row: GrantRow): LiveAgentGrantRecord {
  const stored = row.policy as StoredLiveAgentPolicy & { ownerAddress?: string };
  const evidence = { ...emptyEvidence(), ...(row.evidence as Partial<AutonomyEvidence>) };
  return {
    id: row.id,
    ownerId: row.ownerId,
    agentId: row.agentId,
    ownerAddress: String(stored.ownerAddress ?? ""),
    tradingAddress: row.tradingAddress,
    route: row.route as LiveAgentGrantRecord["route"],
    policy: StoredPolicySchema.parse(stripOwner(stored)),
    evidence,
    status: row.status as LiveAgentGrantRecord["status"],
    expiresAtMs: row.expiresAt.getTime(),
  };
}

function stripOwner(policy: StoredLiveAgentPolicy & { ownerAddress?: string }): StoredLiveAgentPolicy {
  const { ownerAddress: _owner, ...rest } = policy;
  void _owner;
  return rest;
}

function toRequest(row: RequestRow): LiveAgentRequestRecord {
  return {
    id: row.id,
    ownerId: row.ownerId,
    grantId: row.grantId,
    idempotencyKey: row.idempotencyKey,
    state: row.state as LiveAgentRequestState,
    collateralRaw: row.collateralRaw,
    transactionHash: row.transactionHash,
    requestKey: row.requestKey,
    createdAtMs: row.createdAt.getTime(),
  };
}

/** The pure guard policy for a grant. `enabled` is true only for an active grant whose durable stop is cleared. */
export function toLiveAgentPolicy(grant: LiveAgentGrantRecord, stopped: boolean): LiveAgentPolicy {
  const p = grant.policy;
  return {
    ownerAddress: grant.ownerAddress as LiveAgentPolicy["ownerAddress"],
    tradingAddress: grant.tradingAddress as LiveAgentPolicy["tradingAddress"],
    enabled: grant.status === "active" && !stopped,
    allowedUnderlyings: p.allowedUnderlyings as LiveAgentPolicy["allowedUnderlyings"],
    allowedStrategies: p.allowedStrategies,
    maxCollateralPerOrderRaw: BigInt(p.maxCollateralPerOrderRaw),
    maxOpenCollateralRaw: BigInt(p.maxOpenCollateralRaw),
    maxDailyCollateralRaw: BigInt(p.maxDailyCollateralRaw),
    maxOrdersPerDay: p.maxOrdersPerDay,
    maxPendingRequests: p.maxPendingRequests,
    maxExecutionFeeWei: BigInt(p.maxExecutionFeeWei),
    minExpiryDays: p.minExpiryDays,
    maxExpiryDays: p.maxExpiryDays,
    grantExpiresAtMs: grant.expiresAtMs,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Emergency stop
// ---------------------------------------------------------------------------------------------------------------------

/** A missing row is a stopped agent. */
export async function getLiveAgentControl(db: AppDatabase, ownerId: string): Promise<{ stopped: boolean; reason: string | null }> {
  const [row] = await db.select().from(liveAgentControls).where(eq(liveAgentControls.ownerId, ownerId)).limit(1);
  return row ? { stopped: row.stopped, reason: row.stopReason } : { stopped: true, reason: "No control record: stopped by default." };
}

/** Always permitted and idempotent. Stopping never requires evidence. */
export async function stopLiveAgent(db: AppDatabase, ownerId: string, reason: string, now: Date): Promise<void> {
  const text = reason.slice(0, 200) || "Stopped.";
  await db.insert(liveAgentControls).values({ ownerId, stopped: true, stopReason: text, updatedAt: now })
    .onConflictDoUpdate({ target: liveAgentControls.ownerId, set: { stopped: true, stopReason: text, updatedAt: now } });
}

export type ResumeResult = { resumed: boolean; blockers: AutonomyBlocker[]; reasons: string[] };

/**
 * Clears the durable stop. Refuses unless the process flag is on, an unexpired active grant exists and every autonomy
 * evidence reference is recorded, and no tracked request is unresolved.
 */
export async function resumeLiveAgent(db: AppDatabase, ownerId: string, now: Date, env: Record<string, string | undefined> = process.env): Promise<ResumeResult> {
  const reasons: string[] = [];
  const blockers: AutonomyBlocker[] = [];
  if (env.LIVE_TRADING_ENABLED !== "true") reasons.push("LIVE_TRADING_ENABLED is not true; autonomous execution is disabled in this deployment.");
  const grants = await db.select().from(liveAgentGrants).where(and(eq(liveAgentGrants.ownerId, ownerId), eq(liveAgentGrants.status, "active")));
  const live = grants.map(toGrant).filter((grant) => grant.expiresAtMs > now.getTime());
  if (live.length === 0) reasons.push("No active, unexpired grant.");
  for (const grant of live) blockers.push(...autonomyBlockers(grant.evidence));
  const unresolved = await db.select({ id: liveAgentRequests.id }).from(liveAgentRequests)
    .where(and(eq(liveAgentRequests.ownerId, ownerId), inArray(liveAgentRequests.state, ["stale", "unknown"]))).limit(1);
  if (unresolved.length > 0) reasons.push("A stale or unknown request must be reconciled first.");
  if (reasons.length > 0 || blockers.length > 0) return { resumed: false, blockers, reasons };
  await db.insert(liveAgentControls).values({ ownerId, stopped: false, stopReason: null, updatedAt: now })
    .onConflictDoUpdate({ target: liveAgentControls.ownerId, set: { stopped: false, stopReason: null, updatedAt: now } });
  return { resumed: true, blockers: [], reasons: [] };
}

// ---------------------------------------------------------------------------------------------------------------------
// Grants
// ---------------------------------------------------------------------------------------------------------------------

/** Creates a `proposed` grant. It cannot trade: activation requires venue, on-chain, audit, owner and revocation evidence. */
export async function proposeLiveAgentGrant(db: AppDatabase, ownerId: string, input: ProposeLiveAgentGrantInput, now: Date): Promise<LiveAgentGrantRecord> {
  const parsed = ProposeSchema.parse(input);
  if (parsed.expiresAtMs <= now.getTime()) throw new Error("Grant expiry must be in the future.");
  if (parsed.expiresAtMs - now.getTime() > LIVE_AGENT_HARD_CAPS.maxGrantLifetimeMs) throw new Error("Grant lifetime exceeds the 30-day hard cap.");
  const [row] = await db.insert(liveAgentGrants).values({
    ownerId,
    agentId: parsed.agentId,
    tradingAddress: parsed.tradingAddress.toLowerCase(),
    route: parsed.route,
    policy: { ...parsed.policy, ownerAddress: parsed.ownerAddress.toLowerCase() },
    evidence: emptyEvidence(),
    status: "proposed",
    expiresAt: new Date(parsed.expiresAtMs),
    createdAt: now,
    updatedAt: now,
  }).returning();
  if (!row) throw new Error("Grant was not stored.");
  return toGrant(row);
}

async function ownedGrant(db: AppDatabase, ownerId: string, grantId: string): Promise<GrantRow | null> {
  const [row] = await db.select().from(liveAgentGrants).where(and(eq(liveAgentGrants.id, grantId), eq(liveAgentGrants.ownerId, ownerId))).limit(1);
  return row ?? null;
}

export async function getLiveAgentGrant(db: AppDatabase, ownerId: string, grantId: string): Promise<LiveAgentGrantRecord | null> {
  const row = await ownedGrant(db, ownerId, grantId);
  return row ? toGrant(row) : null;
}

/** Merges evidence references onto an unrevoked grant. A reference is only a record; it is not verified by this code. */
export async function recordLiveAgentEvidence(db: AppDatabase, ownerId: string, grantId: string, evidence: z.input<typeof EvidenceSchema>, now: Date): Promise<LiveAgentGrantRecord | null> {
  const patch = EvidenceSchema.parse(evidence);
  const row = await ownedGrant(db, ownerId, grantId);
  if (!row || row.status === "revoked") return null;
  const merged = { ...emptyEvidence(), ...(row.evidence as Partial<AutonomyEvidence>) };
  for (const [key, value] of Object.entries(patch)) if (value !== undefined) (merged as Record<string, unknown>)[key] = value;
  const [updated] = await db.update(liveAgentGrants).set({ evidence: merged, updatedAt: now })
    .where(and(eq(liveAgentGrants.id, grantId), eq(liveAgentGrants.ownerId, ownerId))).returning();
  return updated ? toGrant(updated) : null;
}

export type ActivateResult = { activated: boolean; blockers: AutonomyBlocker[]; grant: LiveAgentGrantRecord | null };

export async function activateLiveAgentGrant(db: AppDatabase, ownerId: string, grantId: string, now: Date): Promise<ActivateResult> {
  const row = await ownedGrant(db, ownerId, grantId);
  if (!row || row.status !== "proposed") return { activated: false, blockers: [{ id: "grant-state", detail: "Only an existing proposed grant can be activated." }], grant: row ? toGrant(row) : null };
  const grant = toGrant(row);
  if (grant.expiresAtMs <= now.getTime()) return { activated: false, blockers: [{ id: "grant-expired", detail: "Grant expired before activation." }], grant };
  const blockers = autonomyBlockers(grant.evidence);
  if (blockers.length > 0) return { activated: false, blockers, grant };
  const [updated] = await db.update(liveAgentGrants).set({ status: "active", updatedAt: now })
    .where(and(eq(liveAgentGrants.id, grantId), eq(liveAgentGrants.ownerId, ownerId), eq(liveAgentGrants.status, "proposed"))).returning();
  return { activated: Boolean(updated), blockers: [], grant: updated ? toGrant(updated) : grant };
}

/** Revocation also trips the durable stop in the same call so no later order can pass. */
export async function revokeLiveAgentGrant(db: AppDatabase, ownerId: string, grantId: string, now: Date): Promise<boolean> {
  const [updated] = await db.update(liveAgentGrants).set({ status: "revoked", updatedAt: now })
    .where(and(eq(liveAgentGrants.id, grantId), eq(liveAgentGrants.ownerId, ownerId))).returning({ id: liveAgentGrants.id });
  if (!updated) return false;
  await stopLiveAgent(db, ownerId, "Grant revoked.", now);
  return true;
}

// ---------------------------------------------------------------------------------------------------------------------
// Single-flight lease
// ---------------------------------------------------------------------------------------------------------------------

/** Atomic: the row is taken only when absent, expired or already ours. */
export async function acquireLiveAgentLease(db: AppDatabase, ownerId: string, holder: string, ttlMs: number, now: Date): Promise<boolean> {
  if (!holder || holder.length > 64 || !(ttlMs > 0) || ttlMs > 10 * 60_000) throw new Error("Invalid lease holder or ttl.");
  const expiresAt = new Date(now.getTime() + ttlMs);
  const rows = await db.insert(liveAgentLeases).values({ ownerId, holder, expiresAt })
    .onConflictDoUpdate({
      target: liveAgentLeases.ownerId,
      set: { holder, expiresAt },
      setWhere: sql`${liveAgentLeases.expiresAt} <= ${now.toISOString()}::timestamptz or ${liveAgentLeases.holder} = ${holder}`,
    }).returning({ holder: liveAgentLeases.holder });
  return rows.length === 1 && rows[0]?.holder === holder;
}

export async function releaseLiveAgentLease(db: AppDatabase, ownerId: string, holder: string): Promise<boolean> {
  const rows = await db.delete(liveAgentLeases).where(and(eq(liveAgentLeases.ownerId, ownerId), eq(liveAgentLeases.holder, holder))).returning({ ownerId: liveAgentLeases.ownerId });
  return rows.length === 1;
}

async function holdsLease(db: AppDatabase, ownerId: string, holder: string, now: Date): Promise<boolean> {
  const [row] = await db.select().from(liveAgentLeases).where(and(eq(liveAgentLeases.ownerId, ownerId), eq(liveAgentLeases.holder, holder), gt(liveAgentLeases.expiresAt, now))).limit(1);
  return Boolean(row);
}

// ---------------------------------------------------------------------------------------------------------------------
// Request ledger
// ---------------------------------------------------------------------------------------------------------------------

export async function listLiveAgentRequests(db: AppDatabase, ownerId: string): Promise<LiveAgentRequestRecord[]> {
  const rows = await db.select().from(liveAgentRequests).where(eq(liveAgentRequests.ownerId, ownerId));
  return rows.map(toRequest);
}

export type AdvanceInput = { state: LiveAgentRequestState; transactionHash?: string; requestKey?: string };

/** Monotonic transitions only. Terminal states never change; evidence fields never get overwritten with a different value. */
export async function advanceLiveAgentRequest(db: AppDatabase, ownerId: string, requestId: string, input: AdvanceInput, now: Date): Promise<LiveAgentRequestRecord> {
  const hash = input.transactionHash === undefined ? undefined : Bytes32Schema.parse(input.transactionHash).toLowerCase();
  const key = input.requestKey === undefined ? undefined : Bytes32Schema.parse(input.requestKey).toLowerCase();
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(liveAgentRequests).where(and(eq(liveAgentRequests.id, requestId), eq(liveAgentRequests.ownerId, ownerId))).for("update").limit(1);
    if (!row) throw new Error("Request not found.");
    const from = row.state as LiveAgentRequestState;
    if (!TRANSITIONS[from].includes(input.state)) throw new Error(`Illegal request transition ${from} -> ${input.state}.`);
    if (hash && row.transactionHash && row.transactionHash !== hash) throw new Error("Transaction hash is already recorded and cannot change.");
    if (key && row.requestKey && row.requestKey !== key) throw new Error("Request key is already recorded and cannot change.");
    const nextHash = hash ?? row.transactionHash;
    const nextKey = key ?? row.requestKey;
    if (input.state === "submitted" && !nextHash) throw new Error("A submitted request needs its transaction hash.");
    if ((input.state === "pending" || input.state === "executed") && !nextKey) throw new Error(`A ${input.state} request needs its on-chain request key.`);
    const [updated] = await tx.update(liveAgentRequests).set({ state: input.state, transactionHash: nextHash, requestKey: nextKey, updatedAt: now })
      .where(eq(liveAgentRequests.id, requestId)).returning();
    if (!updated) throw new Error("Request update failed.");
    return toRequest(updated);
  });
}

const utcDayStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

export async function loadLiveAgentState(db: AppDatabase, ownerId: string, now: Date, env: Record<string, string | undefined> = process.env): Promise<LiveAgentState> {
  const control = await getLiveAgentControl(db, ownerId);
  const rows = await db.select().from(liveAgentRequests).where(eq(liveAgentRequests.ownerId, ownerId));
  const dayStart = utcDayStart(now).getTime();
  let open = 0n;
  let daily = 0n;
  let ordersToday = 0;
  let pending = 0;
  for (const row of rows) {
    const state = row.state as LiveAgentRequestState;
    const collateral = BigInt(row.collateralRaw);
    if (state === "executed") open += collateral;
    if (state !== "cancelled" && row.createdAt.getTime() >= dayStart) {
      daily += collateral;
      ordersToday += 1;
    }
    if (UNRESOLVED.includes(state)) pending += 1;
  }
  const processStop = env.LIVE_AGENT_KILL_SWITCH === "true";
  return { nowMs: now.getTime(), openCollateralRaw: open, dailyCollateralRaw: daily, ordersToday, pendingRequests: pending, globalKillSwitch: control.stopped || processStop };
}

/**
 * Reconciles tracked requests with on-chain snapshots. Anything stale or unknown trips the durable stop.
 * Returns true when the agent was (or already is) halted by request health.
 */
export async function reconcileLiveAgentRequests(db: AppDatabase, ownerId: string, snapshots: readonly CallPutRobinhoodRequestSnapshot[], now: Date): Promise<{ halted: boolean; changed: number }> {
  const requests = await listLiveAgentRequests(db, ownerId);
  const byKey = new Map(snapshots.map((snapshot) => [snapshot.requestKey.toLowerCase(), snapshot]));
  const tracked = requests.filter((r) => r.requestKey && ["submitted", "pending", "stale", "unknown"].includes(r.state));
  // A tracked key with no snapshot cannot be proven anything: it is unknown and halts new orders.
  const known = tracked.map((r) => byKey.get(r.requestKey!.toLowerCase())).filter((snapshot): snapshot is CallPutRobinhoodRequestSnapshot => snapshot !== undefined);
  const healthByKey = new Map(classifyRequests(known, now.getTime()).map((h) => [h.requestKey.toLowerCase(), h]));
  for (const r of tracked) if (!healthByKey.has(r.requestKey!.toLowerCase())) healthByKey.set(r.requestKey!.toLowerCase(), { requestKey: r.requestKey!, state: "unknown", action: "stop-agent" });
  const target: Record<string, LiveAgentRequestState> = { settled: "executed", cancelled: "cancelled", pending: "pending", stale: "stale", unknown: "unknown" };
  let changed = 0;
  let halted = false;
  for (const request of requests) {
    let next: LiveAgentRequestState | null = null;
    if (request.requestKey && healthByKey.has(request.requestKey.toLowerCase())) {
      next = target[healthByKey.get(request.requestKey.toLowerCase())!.state] ?? "unknown";
    } else if (["reserved", "submitted"].includes(request.state) && now.getTime() - request.createdAtMs > LIVE_AGENT_HARD_CAPS.maxUnkeyedRequestAgeMs) {
      // Reserved abandons cleanly; a submitted transaction without a request key is a possible silent fill.
      next = request.state === "reserved" ? "cancelled" : "unknown";
    }
    if (next && next !== request.state && TRANSITIONS[request.state].includes(next)) {
      await advanceLiveAgentRequest(db, ownerId, request.id, { state: next }, now);
      changed += 1;
      if (next === "stale" || next === "unknown") halted = true;
    } else if (request.state === "stale" || request.state === "unknown") {
      halted = true;
    }
  }
  if (halted) await stopLiveAgent(db, ownerId, "A tracked request is stale or unknown; reconcile on-chain before resuming.", now);
  return { halted, changed };
}

// ---------------------------------------------------------------------------------------------------------------------
// Authorization (never submits)
// ---------------------------------------------------------------------------------------------------------------------

export type AuthorizeInput = {
  ownerId: string;
  grantId: string;
  agentId: string;
  tickId: string;
  holder: string;
  plan: CallPutOpenSpreadPlan;
  now: Date;
  env?: Record<string, string | undefined>;
};

export type LiveAgentAuthorization = {
  allowed: boolean;
  checks: CallPutRiskCheck[];
  blockers: AutonomyBlocker[];
  idempotencyKey: string;
  request: LiveAgentRequestRecord | null;
  replay: boolean;
};

const check = (id: string, ok: boolean, detail: string): CallPutRiskCheck => ({ id, ok, detail });

/**
 * Evaluates every durable and policy gate and, only when all pass, reserves the request row (idempotent).
 * Reserving is bookkeeping: it signs and submits nothing. A later submission path must still be built, reviewed and
 * separately authorized.
 */
export async function reserveAuthorizedLiveAgentOrder(db: AppDatabase, input: AuthorizeInput): Promise<LiveAgentAuthorization> {
  const env = input.env ?? process.env;
  const key = liveAgentIdempotencyKey(input.agentId, input.tickId, input.plan);
  const grantRow = await ownedGrant(db, input.ownerId, input.grantId);
  const grant = grantRow ? toGrant(grantRow) : null;
  const blockers = grant ? autonomyBlockers(grant.evidence) : [];
  const state = await loadLiveAgentState(db, input.ownerId, input.now, env);
  const control = await getLiveAgentControl(db, input.ownerId);
  const leaseHeld = await holdsLease(db, input.ownerId, input.holder, input.now);
  const unresolvedBad = await db.select({ id: liveAgentRequests.id }).from(liveAgentRequests)
    .where(and(eq(liveAgentRequests.ownerId, input.ownerId), inArray(liveAgentRequests.state, ["stale", "unknown"]))).limit(1);

  const checks: CallPutRiskCheck[] = [
    check("live-flag", env.LIVE_TRADING_ENABLED === "true", env.LIVE_TRADING_ENABLED === "true" ? "Live trading flag is on." : "LIVE_TRADING_ENABLED is not true; autonomous execution is disabled."),
    check("grant-found", grant !== null && grant.agentId === input.agentId, "An owner grant for this exact agent must exist."),
    check("grant-active", grant?.status === "active", "The grant must be active, which requires all autonomy evidence."),
    check("autonomy-evidence", grant !== null && blockers.length === 0, blockers.length === 0 && grant ? "All autonomy evidence references are recorded." : `Missing: ${blockers.map((b) => b.id).join(", ") || "grant"}.`),
    check("durable-stop", !control.stopped, control.stopped ? `Stopped: ${control.reason ?? "no reason recorded"}` : "Durable stop is cleared."),
    check("lease", leaseHeld, "The caller must hold the unexpired single-flight lease."),
    check("request-health", unresolvedBad.length === 0, "No tracked request may be stale or unknown."),
  ];
  if (grant) checks.push(...evaluateLiveAgentOrder(toLiveAgentPolicy(grant, control.stopped), input.plan, state).checks);

  const [existing] = await db.select().from(liveAgentRequests).where(and(eq(liveAgentRequests.ownerId, input.ownerId), eq(liveAgentRequests.idempotencyKey, key))).limit(1);
  if (existing) {
    // The same decision was already recorded and counted. Report it without re-reserving or re-checking caps.
    return { allowed: false, checks, blockers, idempotencyKey: key, request: toRequest(existing), replay: true };
  }
  const allowed = checks.every((c) => c.ok);
  if (!allowed || !grant) return { allowed: false, checks, blockers, idempotencyKey: key, request: null, replay: false };

  const inserted = await db.insert(liveAgentRequests).values({
    ownerId: input.ownerId,
    grantId: grant.id,
    idempotencyKey: key,
    state: "reserved",
    collateralRaw: input.plan.quote.amountInRaw.toString(),
    createdAt: input.now,
    updatedAt: input.now,
  }).onConflictDoNothing().returning();
  const row = inserted[0];
  if (!row) {
    const [raced] = await db.select().from(liveAgentRequests).where(and(eq(liveAgentRequests.ownerId, input.ownerId), eq(liveAgentRequests.idempotencyKey, key))).limit(1);
    return { allowed: false, checks, blockers, idempotencyKey: key, request: raced ? toRequest(raced) : null, replay: true };
  }
  return { allowed: true, checks, blockers, idempotencyKey: key, request: toRequest(row), replay: false };
}
