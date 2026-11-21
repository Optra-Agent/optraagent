import { hasValidPaperSchedulerCredential } from "../../../../lib/paper/scheduler";
import { runEnsureHouseAgents } from "../../../../lib/house/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "cache-control": "no-store" };

/** Idempotently creates, backtests and launches OPTRA's public House Agents in paper mode. It never touches live trading. */
export async function POST(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret?.trim()) {
    return Response.json({ error: { code: "UPSTREAM_UNAVAILABLE", message: "House Agent provisioning is not configured.", retryable: true } }, { status: 503, headers });
  }
  if (!hasValidPaperSchedulerCredential(request, secret)) {
    return Response.json({ error: { code: "UNAUTHORIZED", message: "A valid scheduler credential is required.", retryable: false } }, { status: 401, headers });
  }
  try {
    const outcomes = await runEnsureHouseAgents();
    return Response.json({ agents: outcomes.map(({ key, status, agentId, underlyingSymbol, reason }) => ({ key, status, agentId, underlyingSymbol, reason })) }, { headers });
  } catch {
    return Response.json({ error: { code: "UPSTREAM_UNAVAILABLE", message: "House Agent provisioning is temporarily unavailable.", retryable: true } }, { status: 503, headers });
  }
}
