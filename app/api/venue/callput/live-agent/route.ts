import { getDatabase } from "@/lib/db/client";
import { lookupWalletSession } from "@/lib/auth/session-lookup";
import { createLiveAgentHandlers } from "@/lib/venue/callput-live-agent-handlers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try {
    return await createLiveAgentHandlers({ db: await getDatabase(), readSession: lookupWalletSession }).status(request);
  } catch {
    return Response.json({ error: { code: "DATABASE_UNAVAILABLE", message: "Live Agent status is unavailable.", retryable: true } }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
