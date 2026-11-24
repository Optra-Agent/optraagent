import { getDatabase } from "@/lib/db/client";
import { lookupWalletSession } from "@/lib/auth/session-lookup";
import { createLiveAgentHandlers } from "@/lib/venue/callput-live-agent-handlers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    return await createLiveAgentHandlers({ db: await getDatabase(), readSession: lookupWalletSession }).refreshJurisdiction(request);
  } catch {
    return Response.json({ error: { code: "DATABASE_UNAVAILABLE", message: "Live Agent jurisdiction evidence is unavailable.", retryable: true } }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
