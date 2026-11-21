import { getDatabase } from "@/lib/db/client";
import { lookupWalletSession } from "@/lib/auth/session-lookup";
import { createCallPutOrderHandlers } from "@/lib/venue/callput-order-ledger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handlers() {
  return createCallPutOrderHandlers({ db: await getDatabase(), readSession: lookupWalletSession });
}

function unavailable(): Response {
  return Response.json({ error: { code: "DATABASE_UNAVAILABLE", message: "CallPut order history is unavailable.", retryable: true } }, {
    status: 503,
    headers: { "cache-control": "no-store" },
  });
}

export async function GET(request: Request): Promise<Response> {
  try {
    return await (await handlers()).list(request);
  } catch {
    return unavailable();
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    return await (await handlers()).create(request);
  } catch {
    return unavailable();
  }
}
