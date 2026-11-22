import { getDatabase } from "@/lib/db/client";
import { lookupWalletSession } from "@/lib/auth/session-lookup";
import { createPublicClient, http, type Address } from "viem";
import { robinhoodMainnet } from "@/lib/chain/robinhood";
import { createLiveGateHandlers } from "@/lib/live/handlers";
import { readCallPutAccountGates } from "@/lib/venue/callput-account-gates";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try {
    return await createLiveGateHandlers({ db: await getDatabase(), readSession: lookupWalletSession, readAccountGates: (owner) => readCallPutAccountGates(createPublicClient({ chain: robinhoodMainnet, transport: http() }), owner as Address) }).status(request);
  } catch {
    return Response.json({ error: { code: "DATABASE_UNAVAILABLE", message: "Live gate status is unavailable.", retryable: true } }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
