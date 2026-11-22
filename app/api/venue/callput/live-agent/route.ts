import { getDatabase } from "@/lib/db/client";
import { lookupWalletSession } from "@/lib/auth/session-lookup";
import { createLiveAgentHandlers } from "@/lib/venue/callput-live-agent-handlers";
import { createPublicClient, http, type Address } from "viem";
import { robinhoodMainnet } from "@/lib/chain/robinhood";
import { readCallPutAccountGates } from "@/lib/venue/callput-account-gates";
import { assessVenueDelegation, fetchCallPutAccountCapability } from "@/lib/venue/callput-account-capability";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The venue resource changes rarely; cache it so the status page does not poll a third party on every load.
let cached: { at: number; value: { fetchedAt: string; findings: Awaited<ReturnType<typeof readOnce>>["findings"] } } | null = null;
async function readOnce() {
  const capability = await fetchCallPutAccountCapability();
  return { fetchedAt: new Date().toISOString(), findings: assessVenueDelegation(capability, { underlying: "AAPL", strategy: "BuyPutSpread" }) };
}
async function readVenueDelegation() {
  if (cached && Date.now() - cached.at < 10 * 60_000) return cached.value;
  const value = await readOnce();
  cached = { at: Date.now(), value };
  return value;
}

const readAccountGates = (owner: string) => readCallPutAccountGates(createPublicClient({ chain: robinhoodMainnet, transport: http() }), owner as Address);

export async function GET(request: Request): Promise<Response> {
  try {
    return await createLiveAgentHandlers({ db: await getDatabase(), readSession: lookupWalletSession, readVenueDelegation, readAccountGates }).status(request);
  } catch {
    return Response.json({ error: { code: "DATABASE_UNAVAILABLE", message: "Live Agent status is unavailable.", retryable: true } }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
