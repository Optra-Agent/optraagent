import { getDatabase } from "@/lib/db/client";
import { lookupWalletSession } from "@/lib/auth/session-lookup";
import { createLiveGateHandlers } from "@/lib/live/handlers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    return await createLiveGateHandlers({ db: await getDatabase(), readSession: lookupWalletSession }).acknowledge(request);
  } catch {
    return Response.json({ error: { code: "DATABASE_UNAVAILABLE", message: "The acknowledgement could not be recorded.", retryable: true } }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
