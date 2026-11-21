import { describe, expect, it, vi } from "vitest";
import { appendCallPutOrderReference, createCallPutLedgerId, createCallPutOrderIntent } from "../../lib/venue/callput-order-ledger-client";

const intent = {
  version: 1 as const,
  chainId: 4663 as const,
  account: "0xfcad0b19bb29d4674531d6f115237e16afce377c" as const,
  kind: "open" as const,
  strategy: "BuyPutSpread" as const,
  underlying: "AAPL" as const,
  underlyingAssetIndex: 16,
  longOptionId: `0x${"11".repeat(32)}` as const,
  shortOptionId: `0x${"22".repeat(32)}` as const,
  expiry: 1_795_798_800,
  sizeRaw: "1000000000000000000",
  minSizeRaw: "780000000000000000",
  amountInRaw: "5000000",
  createdAtMs: 1_795_201_042_000,
};
const fetcher = vi.fn(async () => new Response(JSON.stringify({ order: { id: "123e4567-e89b-42d3-a456-426614174000" } }), { status: 201 }));

describe("CallPut browser order ledger client", () => {
  it("creates a UUID-compatible idempotency key for each prepared order", () => {
    expect(createCallPutLedgerId()).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i);
  });

  it("persists the exact intent with same-origin credentials before signing", async () => {
    const result = await createCallPutOrderIntent({ clientIntentId: "123e4567-e89b-42d3-a456-426614174001", intent }, fetcher);
    expect(result.orderId).toBe("123e4567-e89b-42d3-a456-426614174000");
    expect(fetcher).toHaveBeenCalledWith("/api/venue/callput/orders", expect.objectContaining({
      method: "POST",
      credentials: "include",
      cache: "no-store",
      body: JSON.stringify({ clientIntentId: "123e4567-e89b-42d3-a456-426614174001", intent }),
    }));
  });

  it("refuses to proceed when the server does not return a persisted order ID", async () => {
    const unavailable = vi.fn(async () => new Response(JSON.stringify({ error: { message: "CallPut order history is unavailable." } }), { status: 503 }));
    await expect(createCallPutOrderIntent({ clientIntentId: "123e4567-e89b-42d3-a456-426614174001", intent }, unavailable))
      .rejects.toThrow("CallPut order history is unavailable.");
  });

  it("records transaction references without asserting confirmation", async () => {
    const event = {
      eventId: "123e4567-e89b-42d3-a456-426614174002",
      referenceKind: "transaction" as const,
      transactionKind: "open-spread" as const,
      transactionHash: `0x${"ab".repeat(32)}` as const,
    };
    const eventFetcher = vi.fn(async () => new Response(JSON.stringify({ event: { verification: "client-reported-reference" } }), { status: 201 }));
    const result = await appendCallPutOrderReference("123e4567-e89b-42d3-a456-426614174000", event, eventFetcher);
    expect(result.verification).toBe("client-reported-reference");
    expect(eventFetcher).toHaveBeenCalledWith(
      "/api/venue/callput/orders/123e4567-e89b-42d3-a456-426614174000/events",
      expect.objectContaining({ method: "POST", credentials: "include", body: JSON.stringify(event) }),
    );
  });
});
