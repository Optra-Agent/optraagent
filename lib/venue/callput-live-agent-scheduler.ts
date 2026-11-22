/**
 * Scheduled Live Agent pass. Disabled unless `LIVE_TRADING_ENABLED=true`. When enabled it visits every active,
 * unexpired grant and runs one worker tick. The default plan source returns no plan because no mapping from a Paper
 * Agent decision to a CallPut order has been approved, and there is no bundled submission route. In practice a pass
 * therefore reconciles and monitors in-flight requests and halts on stale or unknown ones. It never submits.
 */
import { and, eq, gt } from "drizzle-orm";
import { createPublicClient, http, type Hex } from "viem";
import { liveAgentGrants } from "../../db/schema";
import { robinhoodMainnet } from "../chain/robinhood";
import type { AppDatabase } from "../db/client";
import type { GateReport } from "../live/gates";
import { loadAcknowledgedCountry, loadLiveGateReport } from "../live/gate-loader";
import { readCallPutRobinhoodRequest, type CallPutRobinhoodRequestSnapshot } from "./callput-robinhood-requests";
import { runLiveAgentTick, type LiveAgentSubmitter, type LiveAgentTickResult } from "./callput-live-agent-worker";
import type { CallPutOpenSpreadPlan } from "./callput-robinhood-write";

export type LiveAgentScheduleOptions = {
  db: AppDatabase;
  now?: Date;
  env?: Record<string, string | undefined>;
  readSnapshots?: (keys: Hex[]) => Promise<CallPutRobinhoodRequestSnapshot[]>;
  preparePlan?: (grant: { ownerId: string; agentId: string; grantId: string }) => Promise<CallPutOpenSpreadPlan | null>;
  submitter?: LiveAgentSubmitter;
  /** Test seam only. Production leaves this unset and gets the database-backed G1–G7 evaluation. */
  gates?: (grant: { ownerId: string; agentId: string; grantId: string }) => Promise<GateReport>;
  runId?: string;
};

function defaultSnapshotReader(): (keys: Hex[]) => Promise<CallPutRobinhoodRequestSnapshot[]> {
  const client = createPublicClient({ chain: robinhoodMainnet, transport: http() });
  return (keys) => Promise.all(keys.map((key) => readCallPutRobinhoodRequest(client, "open", key)));
}

export async function runLiveAgentSchedule(options: LiveAgentScheduleOptions): Promise<{ status: "disabled" | "completed"; results: Array<{ grantId: string } & LiveAgentTickResult> }> {
  const env = options.env ?? process.env;
  if (env.LIVE_TRADING_ENABLED !== "true") return { status: "disabled", results: [] };
  const now = options.now ?? new Date();
  const grants = await options.db.select().from(liveAgentGrants).where(and(eq(liveAgentGrants.status, "active"), gt(liveAgentGrants.expiresAt, now)));
  const readSnapshots = options.readSnapshots ?? defaultSnapshotReader();
  const runId = options.runId ?? `cron-${now.getTime()}`;
  const hourBucket = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000).toISOString();
  const results: Array<{ grantId: string } & LiveAgentTickResult> = [];
  for (const grant of grants) {
    const result = await runLiveAgentTick({
      db: options.db, ownerId: grant.ownerId, grantId: grant.id, agentId: grant.agentId, tickId: hourBucket, holder: runId, now, env,
      preparePlan: () => (options.preparePlan ? options.preparePlan({ ownerId: grant.ownerId, agentId: grant.agentId, grantId: grant.id }) : Promise.resolve(null)),
      readSnapshots,
      // No request exists here, so the country is the one recorded with the owner's acknowledgement (null fails G5).
      gates: options.gates ? () => options.gates!({ ownerId: grant.ownerId, agentId: grant.agentId, grantId: grant.id }) : async () => loadLiveGateReport({ db: options.db, ownerId: grant.ownerId, walletAddress: null, country: await loadAcknowledgedCountry(options.db, grant.ownerId), now, env, grantId: grant.id, agentRef: grant.agentId }),
      ...(options.submitter ? { submitter: options.submitter } : {}),
    });
    results.push({ grantId: grant.id, ...result });
  }
  return { status: "completed", results };
}
