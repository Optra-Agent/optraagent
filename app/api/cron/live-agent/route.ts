import { getDatabase } from "@/lib/db/client";
import { hasValidPaperSchedulerCredential } from "@/lib/paper/scheduler";
import { createPublicClient, http } from "viem";
import { robinhoodMainnet } from "@/lib/chain/robinhood";
import { createPaperDecisionSource } from "@/lib/venue/callput-live-agent-signal";
import { runLiveAgentSchedule } from "@/lib/venue/callput-live-agent-scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "cache-control": "no-store" };

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret?.trim()) {
    return Response.json({ error: { code: "UPSTREAM_UNAVAILABLE", message: "The Live Agent scheduler is not configured.", retryable: true } }, { status: 503, headers });
  }
  if (!hasValidPaperSchedulerCredential(request, secret)) {
    return Response.json({ error: { code: "UNAUTHORIZED", message: "A valid scheduler credential is required.", retryable: false } }, { status: 401, headers });
  }
  if (process.env.LIVE_TRADING_ENABLED !== "true") return Response.json({ status: "disabled", results: [] }, { headers });
  try {
    const db = await getDatabase();
    const client = createPublicClient({ chain: robinhoodMainnet, transport: http() });
    // The decision source is inert until the owner records LIVE_MAPPING_APPROVAL_REF, and no signer is wired here, so this pass still cannot submit.
    const outcome = await runLiveAgentSchedule({ db, decisionSource: createPaperDecisionSource({ db, client, env: process.env }) });
    return Response.json({ status: outcome.status, results: outcome.results.map(({ grantId, status, detail }) => ({ grantId, status, detail })) }, { headers });
  } catch {
    return Response.json({ error: { code: "UPSTREAM_UNAVAILABLE", message: "The Live Agent scheduler is temporarily unavailable.", retryable: true } }, { status: 503, headers });
  }
}
