/**
 * Scheduled Live Agent pass. Disabled unless `LIVE_TRADING_ENABLED=true`. When enabled it visits every active,
 * unexpired grant and runs one worker tick. The default plan source returns no plan because no mapping from a Paper
 * Agent decision to a CallPut order has been approved, and there is no bundled submission route. In practice a pass
 * therefore reconciles and monitors in-flight requests and halts on stale or unknown ones. It never submits.
 */
import { and, count, eq, gt, inArray } from "drizzle-orm";
import { createPublicClient, http, type Address, type Hex } from "viem";
import { liveAgentGrants, liveAgentRequests } from "../../db/schema";
import { robinhoodMainnet } from "../chain/robinhood";
import type { AppDatabase } from "../db/client";
import type { GateReport } from "../live/gates";
import { loadLiveGateReport } from "../live/gate-loader";
import { readCallPutAccountGates, type CallPutAccountGates } from "./callput-account-gates";
import { getLiveAgentGrant } from "./callput-live-agent-store";
import { readCallPutRobinhoodRequest, type CallPutRobinhoodRequestSnapshot } from "./callput-robinhood-requests";
import { runLiveAgentTick, type LiveAgentSubmitter, type LiveAgentTickResult, type LiveAgentTickStatus } from "./callput-live-agent-worker";
import type { CallPutOpenSpreadPlan } from "./callput-robinhood-write";
import type { LiveDecisionSource } from "./callput-live-agent-signal";

export type LiveAgentScheduleOptions = {
  db: AppDatabase;
  now?: Date;
  env?: Record<string, string | undefined>;
  readSnapshots?: (keys: Hex[]) => Promise<CallPutRobinhoodRequestSnapshot[]>;
  /** Fresh read-only factory state for the owner's CallPut Account. A failure keeps G2 closed. */
  readAccountGates?: (owner: Address, tradingAddress?: Address) => Promise<CallPutAccountGates>;
  preparePlan?: (grant: { ownerId: string; agentId: string; grantId: string }) => Promise<CallPutOpenSpreadPlan | null>;
  submitter?: LiveAgentSubmitter;
  /**
   * Approved decision-to-order source (see callput-live-agent-signal). When it yields a decision, the tick id is the
   * decision id, so the same decision can never produce a second order in a later hour. Without a decision the tick
   * still runs for reconciliation and monitoring and asks for no plan.
   */
  decisionSource?: LiveDecisionSource;
  /** Test seam only. Production leaves this unset and gets the database-backed G1–G7 evaluation. */
  gates?: (grant: { ownerId: string; agentId: string; grantId: string }) => Promise<GateReport>;
  runId?: string;
};

export type LiveAgentMonitoringSummary = {
  status: "disabled" | "ok" | "attention" | "critical";
  resultCount: number;
  statusCounts: Partial<Record<LiveAgentTickStatus, number>>;
  criticalCount: number;
  attentionCount: number;
  pendingReconciliationCount: number | null;
  noActiveGrants: boolean;
  decisionSourceFailureCount: number;
};

const CRITICAL_STATUSES: LiveAgentTickStatus[] = ["halted", "submission-unknown", "rpc-failure"];
const ATTENTION_STATUSES: LiveAgentTickStatus[] = ["gated", "stopped", "blocked", "lease-busy", "no-submission-route"];

/** A completed cron request is not automatically a healthy or operational scheduler pass. */
export function summarizeLiveAgentSchedule(outcome: {
  status: "disabled" | "completed";
  /** null means the disabled scheduler did not query request state. */
  pendingReconciliationCount: number | null;
  results: Array<{ status: LiveAgentTickStatus; decisionSourceFailure?: boolean }>;
}): LiveAgentMonitoringSummary {
  const statusCounts: Partial<Record<LiveAgentTickStatus, number>> = {};
  for (const result of outcome.results) statusCounts[result.status] = (statusCounts[result.status] ?? 0) + 1;
  const countStatuses = (statuses: LiveAgentTickStatus[]) => statuses.reduce((count, status) => count + (statusCounts[status] ?? 0), 0);
  const criticalCount = countStatuses(CRITICAL_STATUSES);
  const noActiveGrants = outcome.status === "completed" && outcome.results.length === 0;
  const decisionSourceFailureCount = outcome.results.filter((result) => result.decisionSourceFailure).length;
  const attentionCount = countStatuses(ATTENTION_STATUSES) + Number(noActiveGrants) + decisionSourceFailureCount;
  return {
    status: outcome.status === "disabled" ? "disabled" : criticalCount > 0 ? "critical" : attentionCount > 0 ? "attention" : "ok",
    resultCount: outcome.results.length,
    statusCounts,
    criticalCount,
    attentionCount,
    // Read durable unresolved work; per-pass submission counts miss requests from earlier ticks.
    pendingReconciliationCount: outcome.pendingReconciliationCount,
    noActiveGrants,
    decisionSourceFailureCount,
  };
}

function defaultSnapshotReader(): (keys: Hex[]) => Promise<CallPutRobinhoodRequestSnapshot[]> {
  const client = createPublicClient({ chain: robinhoodMainnet, transport: http() });
  return (keys) => Promise.all(keys.map((key) => readCallPutRobinhoodRequest(client, "open", key)));
}

function defaultAccountGateReader(): (owner: Address, tradingAddress?: Address) => Promise<CallPutAccountGates> {
  const client = createPublicClient({ chain: robinhoodMainnet, transport: http() });
  return (owner, tradingAddress) => readCallPutAccountGates(client, owner, tradingAddress);
}

export type LiveAgentScheduleResult = { grantId: string } & LiveAgentTickResult & { decisionSourceFailure?: boolean };

export async function runLiveAgentSchedule(options: LiveAgentScheduleOptions): Promise<{ status: "disabled" | "completed"; results: LiveAgentScheduleResult[]; pendingReconciliationCount: number | null }> {
  const env = options.env ?? process.env;
  if (env.LIVE_TRADING_ENABLED !== "true") return { status: "disabled", results: [], pendingReconciliationCount: null };
  const now = options.now ?? new Date();
  const grants = await options.db.select().from(liveAgentGrants).where(and(eq(liveAgentGrants.status, "active"), gt(liveAgentGrants.expiresAt, now)));
  const readSnapshots = options.readSnapshots ?? defaultSnapshotReader();
  const readAccountGates = options.readAccountGates ?? defaultAccountGateReader();
  const runId = options.runId ?? `cron-${now.getTime()}`;
  const hourBucket = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000).toISOString();
  const results: LiveAgentScheduleResult[] = [];
  for (const grant of grants) {
    const ref = { ownerId: grant.ownerId, agentId: grant.agentId, grantId: grant.id };
    // A failed decision read prevents an order, but must remain visible to operators rather than masquerading as no-trade.
    let decisionSourceFailure = false;
    const decision = options.decisionSource ? await options.decisionSource(ref, now).catch(() => { decisionSourceFailure = true; return null; }) : null;
    const result = await runLiveAgentTick({
      db: options.db, ownerId: grant.ownerId, grantId: grant.id, agentId: grant.agentId, tickId: decision ? `decision:${decision.decisionId}` : hourBucket, holder: runId, now, env,
      preparePlan: () => (decision ? decision.prepare() : options.preparePlan ? options.preparePlan(ref) : Promise.resolve(null)),
      readSnapshots,
      // A scheduled worker has no owner-request headers. G5 can pass only with fresh owner-bound proof stored on this grant.
      gates: options.gates ? () => options.gates!({ ownerId: grant.ownerId, agentId: grant.agentId, grantId: grant.id }) : async () => {
        const active = await getLiveAgentGrant(options.db, grant.ownerId, grant.id);
        if (!active || active.status !== "active" || !active.ownerAddress) throw new Error("The active grant's owner address is unavailable.");
        const accountGates = await readAccountGates(active.ownerAddress as Address, active.tradingAddress as Address);
        return loadLiveGateReport({ db: options.db, ownerId: grant.ownerId, walletAddress: active.ownerAddress, country: null, geoSource: null, evaluationContext: "scheduled-worker", accountGates, now, env, grantId: grant.id, agentRef: grant.agentId });
      },
      ...(options.submitter ? { submitter: options.submitter } : {}),
    });
    results.push({
      grantId: grant.id,
      ...result,
      ...(decisionSourceFailure ? { decisionSourceFailure: true, detail: `${result.detail} Decision source read failed; no order was considered.` } : {}),
    });
  }
  const [pending] = await options.db.select({ count: count() }).from(liveAgentRequests)
    .where(inArray(liveAgentRequests.state, ["reserved", "submitted", "pending", "stale", "unknown"]));
  return { status: "completed", results, pendingReconciliationCount: Number(pending?.count ?? 0) };
}
