// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ACCOUNT = "0x000000000000000000000000000000000000dEaD";
const KEY = `0x${"ab".repeat(32)}`;
const TX = `0x${"cd".repeat(32)}`;
const mocks = vi.hoisted(() => ({ connected: true, publicClient: null as unknown }));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: mocks.connected ? "0x000000000000000000000000000000000000dEaD" : undefined, chainId: 4663, isConnected: mocks.connected }),
  usePublicClient: () => mocks.publicClient,
}));

import { CallPutOrderHistory } from "../../components/app/tape/CallPutOrderHistory";

const intent = (createdAtMs: number) => ({ version: 1, chainId: 4663, account: ACCOUNT, kind: "open", strategy: "BuyPutSpread", underlying: "AAPL", underlyingAssetIndex: 16, longOptionId: `0x${"01".repeat(32)}`, shortOptionId: `0x${"02".repeat(32)}`, expiry: 1_800_000_000, sizeRaw: "100000000000000000", minSizeRaw: "78000000000000000", amountInRaw: "340000", createdAtMs });
const order = (id: string, createdAt: string, events: unknown[]) => ({ id, clientIntentId: id, account: ACCOUNT.toLowerCase(), chainId: 4663, kind: "open", intent: intent(Date.parse(createdAt)), createdAt, updatedAt: createdAt, events });
const txEvent = { eventId: "e1", referenceKind: "transaction", transactionKind: "open-spread", transactionHash: TX, createdAt: "2026-11-22T01:00:10.000Z", verification: "client-reported-reference" };
const keyEvent = { eventId: "e2", referenceKind: "request-key", transactionKind: "open-spread", transactionHash: TX, requestKey: KEY, createdAt: "2026-11-22T01:00:20.000Z", verification: "client-reported-reference" };

const nowSeconds = () => BigInt(Math.floor(Date.now() / 1000));
const pendingTuple = () => [ACCOUNT, 16, 1_800_000_000n, 42n, 100n, 5_000_000n, 75n, false, nowSeconds(), 0, 0n, 0n, 0n, 0n];

function client(o: { request?: unknown[]; rpcFail?: boolean } = {}) {
  return {
    getChainId: vi.fn(async () => 4663),
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
      if (o.rpcFail) throw new Error("HTTP request failed. URL: https://rpc.mainnet.chain.robinhood.com");
      return functionName === "balanceOfBatch" ? [0n] : o.request ?? pendingTuple();
    }),
    getTransactionReceipt: vi.fn(async () => ({ status: "success", logs: [] })),
  };
}

function ledger(orders: unknown[], status = 200) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(status === 200 ? { orders } : { error: { code: "UNAUTHORIZED", message: "A valid wallet session is required." } }), { status })));
}

describe("CallPutOrderHistory", () => {
  beforeEach(() => { mocks.connected = true; mocks.publicClient = client(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("renders nothing and reads nothing while no wallet is connected", () => {
    mocks.connected = false;
    ledger([]);
    const { container } = render(createElement(CallPutOrderHistory));
    expect(container.textContent).toBe("");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("lists saved orders with explorer links, reads their outcome from the chain, and never calls a hash a fill", async () => {
    ledger([
      order("00000000-0000-4000-8000-000000000001", "2026-11-22T01:00:00.000Z", [txEvent, keyEvent]),
      order("00000000-0000-4000-8000-000000000002", "2026-11-22T00:30:00.000Z", []),
    ]);
    render(createElement(CallPutOrderHistory));

    const list = await screen.findByTestId("callput-order-history");
    await waitFor(() => expect(within(list).getByText("Queued with keeper")).toBeTruthy());
    expect(within(list).getByText("No transaction recorded")).toBeTruthy();
    expect(within(list).getByText(/check your wallet activity before preparing again/i)).toBeTruthy();
    const link = within(list).getByRole("link", { name: /open spread/i }) as HTMLAnchorElement;
    expect(link.href).toBe(`https://robinhoodchain.blockscout.com/tx/${TX}`);
    expect(within(list).getAllByText(/Buy Put Spread · AAPL · size 0\.1 · est\. collateral 0\.340000 USDG/)).toHaveLength(2);
    expect(screen.getByText(/A transaction hash proves a transaction was included, not that an options order filled/)).toBeTruthy();
    expect(screen.queryByText("Balance-confirmed")).toBeNull();
    expect(screen.getByText(/NOT A PAPER DECISION/)).toBeTruthy();
  });

  it("keeps the saved references and says so when the chain read fails", async () => {
    mocks.publicClient = client({ rpcFail: true });
    ledger([order("00000000-0000-4000-8000-000000000001", "2026-11-22T01:00:00.000Z", [txEvent, keyEvent])]);
    render(createElement(CallPutOrderHistory));

    const list = await screen.findByTestId("callput-order-history");
    await waitFor(() => expect(within(list).getByText("Chain read unavailable")).toBeTruthy());
    expect(list.textContent).not.toContain("rpc.mainnet");
    expect(within(list).getByRole("link", { name: /open spread/i })).toBeTruthy();
  });

  it("explains how to load history when the wallet has no session", async () => {
    ledger([], 401);
    render(createElement(CallPutOrderHistory));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Sign in with your wallet/);
  });

  it("re-reads on Refresh and shows an empty state when the wallet has no orders", async () => {
    ledger([]);
    const user = userEvent.setup();
    render(createElement(CallPutOrderHistory));
    expect(await screen.findByText(/No CallPut orders have been saved for this wallet/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThanOrEqual(2));
  });
});
