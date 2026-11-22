/**
 * One scheduled tick of the CallPut Live Agent for one owner grant.
 *
 * It wires the durable store to the three outside dependencies it needs and nothing else: a plan source, an on-chain
 * request reader and a submission route. There is NO bundled submission route. The venue's delegation terms for OPTRA
 * agents are unverified, so `submitter` stays undefined in production and a tick can only reconcile, monitor and
 * (when everything passes) reserve and then cancel the reservation. Nothing here signs or holds keys.
 */
import type { Hex } from "viem";
import type { AppDatabase } from "../db/client";
import type { GateReport } from "../live/gates";
import type { CallPutOpenSpreadPlan, CallPutRiskCheck } from "./callput-robinhood-write";
import type { CallPutRobinhoodRequestSnapshot } from "./callput-robinhood-requests";
import {
  acquireLiveAgentLease,
  advanceLiveAgentRequest,
  getLiveAgentControl,
  listLiveAgentRequests,
  releaseLiveAgentLease,
  reconcileLiveAgentRequests,
  reserveAuthorizedLiveAgentOrder,
  stopLiveAgent,
} from "./callput-live-agent-store";

export type LiveAgentSubmission = { transactionHash: Hex; requestKey?: Hex };

/** Thrown by a submitter only when it can prove nothing was broadcast. Any other error is treated as an unknown outcome. */
export class NotBroadcastError extends Error {
  readonly name = "NotBroadcastError";
}

export type LiveAgentSubmitter = { submit: (plan: CallPutOpenSpreadPlan) => Promise<LiveAgentSubmission> };

export type LiveAgentTickInput = {
  db: AppDatabase;
  ownerId: string;
  grantId: string;
  agentId: string;
  tickId: string;
  holder: string;
  now: Date;
  env?: Record<string, string | undefined>;
  /** A freshly prepared plan, or null when the agent decided not to trade. Reject on RPC or quote failure. */
  preparePlan: () => Promise<CallPutOpenSpreadPlan | null>;
  /** On-chain snapshots for the tracked request keys. Reject on RPC failure. */
  readSnapshots: (requestKeys: Hex[]) => Promise<CallPutRobinhoodRequestSnapshot[]>;
  /**
   * Evaluates PM gates G1–G7 for this owner and grant. Required: the worker never decides on its own that live trading
   * is allowed. A rejection is treated as "not allowed", never as a pass.
   */
  gates: () => Promise<GateReport>;
  submitter?: LiveAgentSubmitter;
  leaseMs?: number;
};

export type LiveAgentTickStatus =
  | "disabled"
  | "lease-busy"
  | "rpc-failure"
  | "halted"
  | "stopped"
  | "gated"
  | "no-trade"
  | "blocked"
  | "replayed"
  | "no-submission-route"
  | "submitted"
  | "submission-unknown";

export type LiveAgentTickResult = { status: LiveAgentTickStatus; detail: string; checks?: CallPutRiskCheck[]; requestId?: string };

const TRACKED = ["submitted", "pending", "stale", "unknown"];

export async function runLiveAgentTick(input: LiveAgentTickInput): Promise<LiveAgentTickResult> {
  const env = input.env ?? process.env;
  if (env.LIVE_TRADING_ENABLED !== "true") return { status: "disabled", detail: "LIVE_TRADING_ENABLED is not true; no live-agent work was done." };
  const { db, ownerId, now } = input;

  if (!(await acquireLiveAgentLease(db, ownerId, input.holder, input.leaseMs ?? 120_000, now))) {
    return { status: "lease-busy", detail: "Another worker holds the single-flight lease." };
  }
  try {
    // 1. Reconcile what is already in flight before considering anything new.
    const tracked = (await listLiveAgentRequests(db, ownerId)).filter((r) => r.requestKey && TRACKED.includes(r.state));
    try {
      const snapshots = tracked.length === 0 ? [] : await input.readSnapshots(tracked.map((r) => r.requestKey as Hex));
      const reconciled = await reconcileLiveAgentRequests(db, ownerId, snapshots, now);
      if (reconciled.halted) return { status: "halted", detail: "A tracked request is stale or unknown; the agent is stopped until it is reconciled on-chain." };
    } catch {
      // A failed read proves nothing. Do not trade and do not guess a request state.
      return { status: "rpc-failure", detail: "Request status could not be read; no order was considered." };
    }

    const control = await getLiveAgentControl(db, ownerId);
    if (control.stopped) return { status: "stopped", detail: control.reason ?? "The agent is stopped." };

    // 2. Every PM gate must pass before a plan is even requested. Reconciliation above still ran.
    let gateReport: GateReport;
    try {
      gateReport = await input.gates();
    } catch {
      return { status: "gated", detail: "The live gates could not be evaluated; no order was considered." };
    }
    if (!gateReport.allPass) return { status: "gated", detail: `Live gates not met: ${gateReport.gates.filter((gate) => !gate.pass).map((gate) => gate.id).join(", ")}. No order was considered.` };

    // 3. Ask for a plan. No plan is a normal outcome.
    let plan: CallPutOpenSpreadPlan | null;
    try {
      plan = await input.preparePlan();
    } catch {
      return { status: "rpc-failure", detail: "A fresh executable quote could not be prepared; no order was considered." };
    }
    if (!plan) return { status: "no-trade", detail: "The agent produced no order for this tick." };

    // 4. Every durable and policy gate, then an idempotent reservation.
    const auth = await reserveAuthorizedLiveAgentOrder(db, {
      ownerId, grantId: input.grantId, agentId: input.agentId, tickId: input.tickId, holder: input.holder, plan, now, env,
    });
    if (auth.replay) return { status: "replayed", detail: "This decision was already recorded.", checks: auth.checks, ...(auth.request ? { requestId: auth.request.id } : {}) };
    if (!auth.allowed || !auth.request) return { status: "blocked", detail: `Blocked by: ${auth.checks.filter((c) => !c.ok).map((c) => c.id).join(", ")}.`, checks: auth.checks };
    const request = auth.request;

    // 5. Submission. Without a verified route the reservation is released immediately so it cannot wedge the agent.
    if (!input.submitter) {
      await advanceLiveAgentRequest(db, ownerId, request.id, { state: "cancelled" }, now);
      return { status: "no-submission-route", detail: "Authorized, but no verified delegated submission route is configured. Nothing was sent.", checks: auth.checks, requestId: request.id };
    }
    try {
      const sent = await input.submitter.submit(plan);
      await advanceLiveAgentRequest(db, ownerId, request.id, { state: "submitted", transactionHash: sent.transactionHash }, now);
      if (sent.requestKey) await advanceLiveAgentRequest(db, ownerId, request.id, { state: "pending", requestKey: sent.requestKey }, now);
      return { status: "submitted", detail: sent.requestKey ? "Submitted; tracking the request key." : "Submitted; the request key is still to be read from the receipt.", checks: auth.checks, requestId: request.id };
    } catch (error) {
      if (error instanceof NotBroadcastError) {
        await advanceLiveAgentRequest(db, ownerId, request.id, { state: "cancelled" }, now);
        return { status: "blocked", detail: "The submission route reported that nothing was broadcast.", checks: auth.checks, requestId: request.id };
      }
      // Possibly broadcast: never assume nothing was sent. Halt until reconciled on-chain.
      await advanceLiveAgentRequest(db, ownerId, request.id, { state: "unknown" }, now);
      await stopLiveAgent(db, ownerId, "A submission ended with an unknown outcome; reconcile on-chain before resuming.", now);
      return { status: "submission-unknown", detail: "The submission outcome is unknown. The agent is stopped.", checks: auth.checks, requestId: request.id };
    }
  } finally {
    await releaseLiveAgentLease(db, ownerId, input.holder);
  }
}
