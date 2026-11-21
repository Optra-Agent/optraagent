import { getDatabase } from "@/lib/db/client";
import { lookupWalletSession } from "@/lib/auth/session-lookup";
import { createLiveAgentHandlers } from "@/lib/venue/callput-live-agent-handlers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    return await createLiveAgentHandlers({ db: await getDatabase(), readSession: lookupWalletSession }).stop(request);
  } catch {
    return Response.json({ error: { code: "DATABASE_UNAVAILABLE", message: "Live Agent stop could not be recorded.", retryable: true } }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
