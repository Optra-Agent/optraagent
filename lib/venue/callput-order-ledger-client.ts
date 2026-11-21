import type { CallPutOrderIntentRecord } from "./callput-order-ledger";

export type CallPutTransactionReference = {
  eventId: string;
  referenceKind: "transaction" | "request-key";
  transactionKind: "usdg-approval" | "open-spread" | "option-token-approval" | "close-position" | "settle-position";
  transactionHash: `0x${string}`;
  requestKey?: `0x${string}`;
};

export type PersistedCallPutOrder = {
  id: string;
  clientIntentId: string;
  account: string;
  chainId: 4663;
  kind: "open" | "close" | "settle";
  intent: CallPutOrderIntentRecord;
  createdAt: string;
  updatedAt: string;
  events: Array<CallPutTransactionReference & { createdAt: string; verification: "client-reported-reference" }>;
};

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json();
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function responseError(body: Record<string, unknown>, fallback: string): Error {
  const error = body.error;
  if (error !== null && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return new Error(error.message);
  }
  return new Error(fallback);
}

export function createCallPutLedgerId(): string {
  const id = globalThis.crypto?.randomUUID?.();
  if (!id) throw new Error("Secure browser ID generation is unavailable; no wallet transaction can be prepared.");
  return id;
}

export async function createCallPutOrderIntent(
  input: { clientIntentId: string; intent: CallPutOrderIntentRecord },
  fetcher: typeof fetch = fetch,
): Promise<{ orderId: string }> {
  const response = await fetcher("/api/venue/callput/orders", {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await responseBody(response);
  const order = body.order;
  const orderId = order !== null && typeof order === "object" && "id" in order ? order.id : null;
  if (!response.ok) throw responseError(body, "CallPut order history is unavailable; no wallet transaction was sent.");
  if (typeof orderId !== "string") throw new Error("CallPut order history did not return a persisted order ID; no wallet transaction was sent.");
  return { orderId };
}

export async function appendCallPutOrderReference(
  orderId: string,
  event: CallPutTransactionReference,
  fetcher: typeof fetch = fetch,
): Promise<{ verification: "client-reported-reference" }> {
  const response = await fetcher(`/api/venue/callput/orders/${encodeURIComponent(orderId)}/events`, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(event),
  });
  const body = await responseBody(response);
  if (!response.ok) throw responseError(body, "The transaction reference could not be synced to server history.");
  const saved = body.event;
  if (saved === null || typeof saved !== "object" || !("verification" in saved) || saved.verification !== "client-reported-reference") {
    throw new Error("Server history did not confirm the unverified transaction reference.");
  }
  return { verification: "client-reported-reference" };
}

export async function listCallPutOrderIntents(fetcher: typeof fetch = fetch): Promise<PersistedCallPutOrder[]> {
  const response = await fetcher("/api/venue/callput/orders", { method: "GET", credentials: "include", cache: "no-store" });
  const body = await responseBody(response);
  if (!response.ok) throw responseError(body, "CallPut server history is unavailable.");
  return Array.isArray(body.orders) ? body.orders as PersistedCallPutOrder[] : [];
}
