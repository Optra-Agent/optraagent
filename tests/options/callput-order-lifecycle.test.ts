import { describe, expect, it, vi } from "vitest";
import type { PublicClient } from "viem";
import type { PersistedCallPutOrder } from "../../lib/venue/callput-order-ledger-client";
import { CALLPUT_DUPLICATE_WINDOW_MS, findUnresolvedDuplicate, reconcileCallPutOrderLifecycle } from "../../lib/venue/callput-order-lifecycle";

const ACCOUNT = "0x0000000000000000000000000000000000000011";
const KEY = `0x${"ab".repeat(32)}`;
const TX = `0x${"cd".repeat(32)}`;
const LONG = `0x${"01".repeat(32)}`;
const SHORT = `0x${"02".repeat(32)}`;
const NOW = 1_700_000_100_000;

const openTuple = (status: number, sizeOut = 0n, submittedAt = 1_700_000_000n) => [ACCOUNT, 16, 1_800_000_000n, 42n, 100n, 5_000_000n, 75n, false, submittedAt, status, sizeOut, 123n, status === 0 ? 0n : 1_700_000_030n, 4_000_000n] as const;
const closeTuple = (status: number, submittedAt = 1_700_000_000n) => [ACCOUNT, 16, 1_800_000_000n, 42n, 100n, 4_000_000n, 75n, false, submittedAt, status, 4_100_000n, 123n, 1_700_000_030n] as const;

function openOrder(events: PersistedCallPutOrder["events"]): PersistedCallPutOrder {
  return {
    id: "00000000-0000-4000-8000-000000000001", clientIntentId: "00000000-0000-4000-8000-000000000002", account: ACCOUNT, chainId: 4663, kind: "open",
    intent: { version: 1, chainId: 4663, account: ACCOUNT, kind: "open", strategy: "BuyPutSpread", underlying: "AAPL" as never, underlyingAssetIndex: 16, longOptionId: LONG, shortOptionId: SHORT, expiry: 1_800_000_000, sizeRaw: "100", minSizeRaw: "78", amountInRaw: "5000000", createdAtMs: NOW - 60_000 },
    createdAt: new Date(NOW - 60_000).toISOString(), updatedAt: new Date(NOW - 60_000).toISOString(), events,
  };
}
const tx = (transactionKind: "usdg-approval" | "open-spread", createdAt = "2023-11-14T22:14:00.000Z") => ({ eventId: "e1", referenceKind: "transaction" as const, transactionKind, transactionHash: TX as `0x${string}`, createdAt, verification: "client-reported-reference" as const });
const requestKey = { eventId: "e2", referenceKind: "request-key" as const, transactionKind: "open-spread" as const, transactionHash: TX as `0x${string}`, requestKey: KEY as `0x${string}`, createdAt: "2023-11-14T22:14:30.000Z", verification: "client-reported-reference" as const };

function client(options: { request?: readonly unknown[]; balance?: bigint; receipt?: { status: "success" | "reverted"; logs: unknown[] } | "missing"; rpcDown?: boolean }): PublicClient {
  return {
    getChainId: vi.fn().mockResolvedValue(4663),
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
      if (options.rpcDown) throw new Error("fetch failed for https://rpc.mainnet.chain.robinhood.com/secret");
      if (functionName === "balanceOfBatch") return [options.balance ?? 0n];
      return options.request;
    }),
    getTransactionReceipt: vi.fn(async () => {
      if (options.receipt === "missing") throw Object.assign(new Error("Transaction receipt could not be found."), { name: "TransactionReceiptNotFoundError" });
      if (options.rpcDown) throw new Error("fetch failed");
      return options.receipt;
    }),
  } as unknown as PublicClient;
}

describe("CallPut order lifecycle reconciliation", () => {
  it("flags an intent with no transaction as ambiguous and never as submitted", async () => {
    const result = await reconcileCallPutOrderLifecycle({ order: openOrder([]), client: client({}), nowMs: NOW });
    expect(result).toMatchObject({ state: "intent-only", terminal: false, fillConfirmed: false });
    expect(result.evidence).toMatch(/check your wallet activity/i);
  });

  it("treats a submitted hash without a receipt as awaiting, not as an order", async () => {
    const result = await reconcileCallPutOrderLifecycle({ order: openOrder([tx("open-spread")]), client: client({ receipt: "missing" }), nowMs: NOW });
    expect(result).toMatchObject({ state: "transaction-awaiting-receipt", terminal: false, fillConfirmed: false });
  });

  it("reports a reverted open as terminal with no request created", async () => {
    const result = await reconcileCallPutOrderLifecycle({ order: openOrder([tx("open-spread")]), client: client({ receipt: { status: "reverted", logs: [] } }), nowMs: NOW });
    expect(result).toMatchObject({ state: "transaction-reverted", terminal: true, fillConfirmed: false, tone: "loss" });
    expect(result.evidence).toMatch(/No CallPut request was created/);
  });

  it("calls an approval an allowance, not an order", async () => {
    const result = await reconcileCallPutOrderLifecycle({ order: openOrder([tx("usdg-approval")]), client: client({ receipt: { status: "success", logs: [] } }), nowMs: NOW });
    expect(result).toMatchObject({ state: "approval-confirmed", terminal: true, fillConfirmed: false });
    expect(result.evidence).toMatch(/no position was opened/i);
  });

  it("does not infer a request from a mined open transaction whose receipt has no request log", async () => {
    const result = await reconcileCallPutOrderLifecycle({ order: openOrder([tx("open-spread")]), client: client({ receipt: { status: "success", logs: [] } }), nowMs: NOW });
    expect(result).toMatchObject({ state: "request-awaiting-key", fillConfirmed: false });
    expect(result.evidence).toMatch(/transaction hash alone does not establish an order/i);
  });

  it("follows the keeper outcome from the chain: pending, past delay, cancelled", async () => {
    const order = openOrder([tx("open-spread"), requestKey]);
    expect(await reconcileCallPutOrderLifecycle({ order, client: client({ request: openTuple(0) }), nowMs: 1_700_000_100_000 })).toMatchObject({ state: "pending", terminal: false, fillConfirmed: false });
    expect(await reconcileCallPutOrderLifecycle({ order, client: client({ request: openTuple(0) }), nowMs: 1_700_000_400_000 })).toMatchObject({ state: "pending-past-delay", terminal: false });
    expect(await reconcileCallPutOrderLifecycle({ order, client: client({ request: openTuple(1) }), nowMs: NOW })).toMatchObject({ state: "cancelled", terminal: true, fillConfirmed: false });
  });

  it("confirms a position only when the executed request and the wallet balance agree", async () => {
    const order = openOrder([tx("open-spread"), requestKey]);
    expect(await reconcileCallPutOrderLifecycle({ order, client: client({ request: openTuple(2, 100n), balance: 100n }), nowMs: NOW })).toMatchObject({ state: "executed-confirmed", terminal: true, fillConfirmed: true, tone: "gain" });
    const unconfirmed = await reconcileCallPutOrderLifecycle({ order, client: client({ request: openTuple(2, 100n), balance: 0n }), nowMs: NOW });
    expect(unconfirmed).toMatchObject({ state: "executed-unconfirmed", terminal: false, fillConfirmed: false });
    expect(unconfirmed.evidence).toMatch(/Not treated as a fill/);
  });

  it("reports a missing request key on-chain without a verdict", async () => {
    const order = openOrder([tx("open-spread"), requestKey]);
    const notFound = [ACCOUNT, 0, 0n, 0n, 0n, 0n, 0n, false, 0n, 0, 0n, 0n, 0n, 0n] as const;
    expect(await reconcileCallPutOrderLifecycle({ order, client: client({ request: notFound }), nowMs: NOW })).toMatchObject({ state: "request-not-found", fillConfirmed: false });
  });

  it("survives an RPC failure: no inference, redacted endpoint, retryable", async () => {
    const result = await reconcileCallPutOrderLifecycle({ order: openOrder([tx("open-spread"), requestKey]), client: client({ rpcDown: true }), nowMs: NOW });
    expect(result).toMatchObject({ state: "rpc-unavailable", terminal: false, fillConfirmed: false });
    expect(result.evidence).not.toContain("rpc.mainnet");
    expect(result.evidence).toContain("[endpoint]");
  });

  it("reconciles a close request against the position-token reduction", async () => {
    const order: PersistedCallPutOrder = {
      ...openOrder([{ ...tx("open-spread"), transactionKind: "close-position" as never }, { ...requestKey, transactionKind: "close-position" as never }]), kind: "close",
      intent: { version: 1, chainId: 4663, account: ACCOUNT, underlying: "AAPL" as never, underlyingAssetIndex: 16, createdAtMs: NOW - 60_000, id: "close-1", kind: "close", optionTokenId: "42", positionBalanceBeforeRaw: "400", sizeRaw: "100", minAmountOutRaw: "1", minOutWhenSwapRaw: "0" },
    };
    expect(await reconcileCallPutOrderLifecycle({ order, client: client({ request: closeTuple(2), balance: 300n }), nowMs: NOW })).toMatchObject({ state: "executed-confirmed", fillConfirmed: true });
    expect(await reconcileCallPutOrderLifecycle({ order, client: client({ request: closeTuple(2), balance: 400n }), nowMs: NOW })).toMatchObject({ state: "executed-unconfirmed", fillConfirmed: false });
  });
});

describe("CallPut duplicate-request guard", () => {
  const base = { account: ACCOUNT, strategy: "BuyPutSpread", longOptionId: LONG, shortOptionId: SHORT, sizeRaw: "100", createdAtMs: NOW - 60_000, submitted: true, terminal: false };
  const current = { clientIntentId: "new", account: ACCOUNT.toUpperCase().replace("0X", "0x"), strategy: "BuyPutSpread", longOptionId: LONG, shortOptionId: SHORT, sizeRaw: "100" };

  it("blocks an identical unresolved submission inside the window", () => {
    expect(findUnresolvedDuplicate([{ ...base, clientIntentId: "old" }], current, NOW)).not.toBeNull();
  });
  it("ignores the same intent, a different size or leg, an unsubmitted draft, a terminal order and an expired window", () => {
    expect(findUnresolvedDuplicate([{ ...base, clientIntentId: "new" }], current, NOW)).toBeNull();
    expect(findUnresolvedDuplicate([{ ...base, clientIntentId: "o", sizeRaw: "200" }], current, NOW)).toBeNull();
    expect(findUnresolvedDuplicate([{ ...base, clientIntentId: "o", shortOptionId: LONG }], current, NOW)).toBeNull();
    expect(findUnresolvedDuplicate([{ ...base, clientIntentId: "o", submitted: false }], current, NOW)).toBeNull();
    expect(findUnresolvedDuplicate([{ ...base, clientIntentId: "o", terminal: true }], current, NOW)).toBeNull();
    expect(findUnresolvedDuplicate([{ ...base, clientIntentId: "o", createdAtMs: NOW - CALLPUT_DUPLICATE_WINDOW_MS - 1 }], current, NOW)).toBeNull();
  });
});
