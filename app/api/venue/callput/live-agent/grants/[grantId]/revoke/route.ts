import { getDatabase } from "@/lib/db/client";
import { lookupWalletSession } from "@/lib/auth/session-lookup";
import { createLiveAgentHandlers } from "@/lib/venue/callput-live-agent-handlers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ grantId: string }> }): Promise<Response> {
  try {
    const { grantId } = await context.params;
    return await createLiveAgentHandlers({ db: await getDatabase(), readSession: lookupWalletSession }).revoke(request, grantId);
  } catch {
    return Response.json({ error: { code: "DATABASE_UNAVAILABLE", message: "Live Agent revocation could not be recorded.", retryable: true } }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
