import { getDatabase } from "@/lib/db/client";
import { lookupWalletSession } from "@/lib/auth/session-lookup";
import { createCallPutOrderHandlers } from "@/lib/venue/callput-order-ledger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ orderId: string }> };

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { orderId } = await context.params;
    const handlers = createCallPutOrderHandlers({ db: await getDatabase(), readSession: lookupWalletSession });
    return await handlers.appendEvent(request, orderId);
  } catch {
    return Response.json({ error: { code: "DATABASE_UNAVAILABLE", message: "CallPut transaction history is unavailable.", retryable: true } }, {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }
}
