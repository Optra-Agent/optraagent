// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics } from "viem";
import { CALLPUT_ROBINHOOD_CONTRACTS } from "../../lib/venue/callput-robinhood-readonly";
import { CALLPUT_WRITE_ABIS } from "../../lib/venue/callput-robinhood-write";

const ACCOUNT = "0x000000000000000000000000000000000000dEaD" as const;
const KEY = `0x${"ab".repeat(32)}` as const;
const EXPIRY = Math.floor(Date.now() / 1000) + 7 * 86_400;
const TOKEN_ID = BigInt(`0x0010${EXPIRY.toString(16).padStart(10, "0")}56${"0".repeat(48)}`);
const EXPIRED_TOKEN_ID = BigInt(`0x0010${(Math.floor(Date.now() / 1000) - 3_600).toString(16).padStart(10, "0")}56${"0".repeat(48)}`);
const mocks = vi.hoisted(() => ({ account: "0x000000000000000000000000000000000000dEaD", publicClient: null as unknown, walletClient: null as unknown }));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: mocks.account, chainId: 4663, isConnected: true }),
  usePublicClient: () => mocks.publicClient,
  useWalletClient: () => ({ data: mocks.walletClient }),
}));

function publicClient(receiptLogs: unknown[] = []) {
  return {
    getChainId: vi.fn(async () => 4663),
    getBalance: vi.fn(async () => 10n ** 17n),
    estimateGas: vi.fn(async () => 21_000n),
    estimateFeesPerGas: vi.fn(async () => ({ gasPrice: 1_000_000_000n })),
    getGasPrice: vi.fn(async () => 1_000_000_000n),
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
      if (functionName === "controller") return CALLPUT_ROBINHOOD_CONTRACTS.controller;
      if (functionName === "executionFee") return 60_000_000_000_000n;
      if (functionName === "balanceOfBatch") return [10n ** 18n];
      if (functionName === "isApprovedForAll") return true;
      throw new Error(`unexpected ${functionName}`);
    }),
    waitForTransactionReceipt: vi.fn(async () => ({ status: "success", logs: receiptLogs })),
    getTransactionReceipt: vi.fn(async () => ({ status: "success", logs: receiptLogs })),
  };
}

function settlementLog() {
  const expiry = Number((EXPIRED_TOKEN_ID >> 200n) & 0xffffffffffn);
  return {
    address: CALLPUT_ROBINHOOD_CONTRACTS.settleManager,
    topics: encodeEventTopics({
      abi: CALLPUT_WRITE_ABIS.settleManager,
      eventName: "SettlePosition",
      args: { account: ACCOUNT, underlyingAssetIndex: 16, expiry },
    }),
    data: encodeAbiParameters(
      [{ type: "uint256" }, { type: "uint256" }, { type: "address[]" }, { type: "uint256" }, { type: "uint256" }],
      [EXPIRED_TOKEN_ID, 100n, [CALLPUT_ROBINHOOD_CONTRACTS.usdg], 45n, 90n],
    ),
  };
}

async function loadActions(liveEnabled: boolean, flags: { close?: boolean; settle?: boolean } = {}) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_CALLPUT_LIVE_ORDERS", liveEnabled ? "true" : "false");
  vi.stubEnv("NEXT_PUBLIC_CALLPUT_CLOSE", (flags.close ?? liveEnabled) ? "true" : "false");
  vi.stubEnv("NEXT_PUBLIC_CALLPUT_SETTLE", (flags.settle ?? liveEnabled) ? "true" : "false");
  return (await import("../../components/app/tape/CallPutPositionActions")).CallPutPositionActions;
}

async function prepareClose(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByText("Close or settle a position"));
  await user.type(screen.getByLabelText("Option token ID (decimal)"), TOKEN_ID.toString());
  await user.type(screen.getByLabelText("Close size (raw underlying units)"), "100000000000000000");
  await user.type(screen.getByLabelText("Minimum amount out (raw USDG)"), "1");
  await user.type(screen.getByLabelText("Minimum swap output (raw)"), "1");
  await user.click(screen.getByRole("button", { name: "Prepare close" }));
  await screen.findByText("Position transaction review");
}

describe("CallPutPositionActions", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = init?.method ?? "GET";
      if (url === "/api/venue/callput/orders" && method === "POST") {
        return new Response(JSON.stringify({ order: { id: "123e4567-e89b-42d3-a456-426614174000" } }), { status: 201 });
      }
      if (url.endsWith("/events")) return new Response(JSON.stringify({ event: { verification: "client-reported-reference" } }), { status: 201 });
      return new Response(JSON.stringify({ orders: [] }), { status: 200 });
    }));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    mocks.walletClient = null;
    mocks.publicClient = null;
  });

  it("keeps close signing disabled when the build flag is off", async () => {
    mocks.publicClient = publicClient();
    const sendTransaction = vi.fn();
    mocks.walletClient = { sendTransaction, chain: { id: 4663 } };
    const Actions = await loadActions(false);
    const user = userEvent.setup();
    render(createElement(Actions));
    await prepareClose(user);
    expect((screen.getByRole("button", { name: "Sign position transaction" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Signing is disabled in this build/)).toBeTruthy();
    expect(sendTransaction).not.toHaveBeenCalled();
  });

  it("gates close and settle signing independently, and an unset flag keeps both off", async () => {
    for (const [close, settle] of [[true, false], [false, true], [true, true], [false, false]] as const) {
      vi.resetModules();
      vi.stubEnv("NEXT_PUBLIC_CALLPUT_CLOSE", close ? "true" : "false");
      vi.stubEnv("NEXT_PUBLIC_CALLPUT_SETTLE", settle ? "true" : "false");
      const { callPutPositionActionEnabled } = await import("../../components/app/tape/CallPutOrderPanel");
      expect([callPutPositionActionEnabled("close"), callPutPositionActionEnabled("settle")]).toEqual([close, settle]);
    }
    vi.resetModules();
    vi.unstubAllEnvs();
    const { callPutPositionActionEnabled } = await import("../../components/app/tape/CallPutOrderPanel");
    expect([callPutPositionActionEnabled("close"), callPutPositionActionEnabled("settle")]).toEqual([false, false]);
  });

  it("keeps close signing off when only the settle flag is on", async () => {
    mocks.publicClient = publicClient();
    const sendTransaction = vi.fn();
    mocks.walletClient = { sendTransaction, chain: { id: 4663 } };
    const Actions = await loadActions(true, { close: false, settle: true });
    const user = userEvent.setup();
    render(createElement(Actions));
    await prepareClose(user);
    expect((screen.getByRole("button", { name: "Sign position transaction" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Signing is disabled in this build for close/)).toBeTruthy();
    expect(sendTransaction).not.toHaveBeenCalled();
  });

  it("does not open the wallet prompt when the server cannot persist a position action", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      return init?.method === "POST"
        ? new Response(JSON.stringify({ error: { message: "CallPut order history is unavailable." } }), { status: 503 })
        : new Response(JSON.stringify({ orders: [] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    mocks.publicClient = publicClient();
    const sendTransaction = vi.fn(async () => `0x${"cd".repeat(32)}`);
    mocks.walletClient = { sendTransaction, chain: { id: 4663 } };
    const Actions = await loadActions(true);
    const user = userEvent.setup();
    render(createElement(Actions));
    await prepareClose(user);
    await user.click(screen.getByLabelText("I reviewed this exact transaction and approve it."));
    await user.click(screen.getByRole("button", { name: "Sign position transaction" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/venue/callput/orders", expect.objectContaining({ method: "POST" }));
    expect(sendTransaction).not.toHaveBeenCalled();
  });

  it("fails closed when the RPC returns an incomplete EIP-1559 fee quote", async () => {
    const pc = publicClient();
    pc.estimateFeesPerGas.mockImplementationOnce(async () => ({ maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: null } as never));
    mocks.publicClient = pc;
    mocks.walletClient = { sendTransaction: vi.fn(), chain: { id: 4663 } };
    const Actions = await loadActions(true);
    const user = userEvent.setup();
    render(createElement(Actions));
    await user.click(screen.getByText("Close or settle a position"));
    await user.type(screen.getByLabelText("Option token ID (decimal)"), TOKEN_ID.toString());
    await user.type(screen.getByLabelText("Close size (raw underlying units)"), "100000000000000000");
    await user.type(screen.getByLabelText("Minimum amount out (raw USDG)"), "1");
    await user.type(screen.getByLabelText("Minimum swap output (raw)"), "1");
    await user.click(screen.getByRole("button", { name: "Prepare close" }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/incomplete EIP-1559 fee quote/i);
    expect(screen.queryByText("Position transaction review")).toBeNull();
  });

  it("signs a reviewed direct-wallet close once and persists its request key", async () => {
    const topics = encodeEventTopics({
      abi: CALLPUT_WRITE_ABIS.positionManager,
      eventName: "GenerateRequestKey",
      args: { account: ACCOUNT, key: KEY, isOpen: false },
    });
    const pc = publicClient([{ address: CALLPUT_ROBINHOOD_CONTRACTS.positionManager, topics, data: encodeAbiParameters([], []) }]);
    pc.estimateFeesPerGas.mockImplementationOnce(async () => ({ maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 100_000_000n } as never));
    const sendTransaction = vi.fn(async () => `0x${"cd".repeat(32)}`);
    mocks.publicClient = pc;
    mocks.walletClient = { sendTransaction, chain: { id: 4663 } };
    const Actions = await loadActions(true);
    const user = userEvent.setup();
    render(createElement(Actions));
    await prepareClose(user);

    const sign = screen.getByRole("button", { name: "Sign position transaction" }) as HTMLButtonElement;
    expect(sign.disabled).toBe(true);
    await user.click(screen.getByLabelText("I reviewed this exact transaction and approve it."));
    expect(sign.disabled).toBe(false);
    await user.click(sign);

    await screen.findByText(KEY);
    expect(sendTransaction).toHaveBeenCalledTimes(1);
    const sent = (sendTransaction.mock.calls as unknown as Array<[{
      to: string; value: bigint; gas: bigint; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint; gasPrice?: bigint;
    }]>)[0][0];
    expect(sent).toMatchObject({
      to: CALLPUT_ROBINHOOD_CONTRACTS.positionManager,
      value: 60_000_000_000_000n,
      gas: 21_000n,
      maxFeePerGas: 2_000_000_000n,
      maxPriorityFeePerGas: 100_000_000n,
    });
    expect(sent.gasPrice).toBeUndefined();
    expect(pc.getChainId).toHaveBeenCalledTimes(2);
    expect(pc.getBalance).toHaveBeenCalledTimes(2);
    const saved = JSON.parse(window.localStorage.getItem("optra.callput.robinhood.position-actions.v1") ?? "[]")[0];
    expect(saved).toMatchObject({ kind: "close", requestKey: KEY, txHash: `0x${"cd".repeat(32)}`, chainId: 4663 });
    expect(screen.getByText(/request submitted.*not a fill yet/i)).toBeTruthy();
  });

  it("refuses a reviewed close when the RPC chain changes after preparation", async () => {
    const pc = publicClient();
    pc.getChainId.mockResolvedValueOnce(4663).mockResolvedValueOnce(1);
    const sendTransaction = vi.fn();
    mocks.publicClient = pc;
    mocks.walletClient = { sendTransaction, chain: { id: 4663 } };
    const Actions = await loadActions(true);
    const user = userEvent.setup();
    render(createElement(Actions));
    await prepareClose(user);
    await user.click(screen.getByLabelText("I reviewed this exact transaction and approve it."));
    await user.click(screen.getByRole("button", { name: "Sign position transaction" }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/Switch your wallet to Robinhood Mainnet/i);
    expect(sendTransaction).not.toHaveBeenCalled();
  });

  it("refuses a reviewed close when native balance falls below value plus gas after preparation", async () => {
    const pc = publicClient();
    pc.getBalance.mockResolvedValueOnce(10n ** 17n).mockResolvedValueOnce(1n);
    const sendTransaction = vi.fn();
    mocks.publicClient = pc;
    mocks.walletClient = { sendTransaction, chain: { id: 4663 } };
    const Actions = await loadActions(true);
    const user = userEvent.setup();
    render(createElement(Actions));
    await prepareClose(user);
    await user.click(screen.getByLabelText("I reviewed this exact transaction and approve it."));
    await user.click(screen.getByRole("button", { name: "Sign position transaction" }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/native balance no longer covers/i);
    expect(sendTransaction).not.toHaveBeenCalled();
  });

  it("shows explicit settlement reconciliation state after event and independent balance evidence", async () => {
    const pc = publicClient([settlementLog()]);
    let balanceReads = 0;
    pc.readContract.mockImplementation(async ({ functionName }: { functionName: string }) => {
      if (functionName === "controller") return CALLPUT_ROBINHOOD_CONTRACTS.controller;
      if (functionName === "executionFee") return 60_000_000_000_000n;
      if (functionName === "balanceOfBatch") {
        balanceReads += 1;
        return [balanceReads === 1 ? 1_000n : 0n];
      }
      if (functionName === "isApprovedForAll") return true;
      throw new Error(`unexpected ${functionName}`);
    });
    const sendTransaction = vi.fn(async () => `0x${"cd".repeat(32)}`);
    mocks.publicClient = pc;
    mocks.walletClient = { sendTransaction, chain: { id: 4663 } };
    const Actions = await loadActions(true);
    const user = userEvent.setup();
    render(createElement(Actions));
    await user.click(screen.getByText("Close or settle a position"));
    await user.selectOptions(screen.getByLabelText("Action", { exact: true }), "settle");
    await user.type(screen.getByLabelText("Option token ID (decimal)"), EXPIRED_TOKEN_ID.toString());
    await user.type(screen.getByLabelText("Minimum swap output (raw)"), "1");
    await user.click(screen.getByRole("button", { name: "Prepare settlement" }));
    await screen.findByText("Position transaction review");
    await user.click(screen.getByLabelText("I reviewed this exact transaction and approve it."));
    await user.click(screen.getByRole("button", { name: "Sign position transaction" }));

    expect(await screen.findByText("settled-position-confirmed")).toBeTruthy();
    expect(sendTransaction).toHaveBeenCalledTimes(1);
    expect(JSON.parse(window.localStorage.getItem("optra.callput.robinhood.position-actions.v1") ?? "[]")[0])
      .toMatchObject({ kind: "settle", reconciliation: { state: "settled-position-confirmed", fillConfirmed: true } });
  });

  it("preserves locally reconciled settlement evidence when hydrating the matching server intent", async () => {
    const orderId = "123e4567-e89b-42d3-a456-426614174010";
    const clientIntentId = "123e4567-e89b-42d3-a456-426614174011";
    const txHash = `0x${"cd".repeat(32)}`;
    const eventId = "123e4567-e89b-42d3-a456-426614174012";
    window.localStorage.setItem("optra.callput.robinhood.position-actions.v1", JSON.stringify([{
      version: 1, id: clientIntentId, clientIntentId, chainId: 4663, account: ACCOUNT, kind: "settle", underlying: "AAPL",
      underlyingAssetIndex: 16, optionTokenId: EXPIRED_TOKEN_ID.toString(), positionBalanceBeforeRaw: "1000", sizeRaw: null,
      minAmountOutRaw: null, minOutWhenSwapRaw: "1", createdAtMs: Date.now(), txHash, requestKey: null,
      settlement: { sizeRaw: "100", amountOutRaw: "45", settlePriceRaw: "90" },
      pendingTransaction: { kind: "settle-position", txHash, status: "confirmed", eventId, historySynced: true },
      reconciliation: { state: "settled-position-confirmed", fillConfirmed: true, evidence: "Settlement receipt and independent balance read" },
    }]));
    const serverOrder = {
      id: orderId, clientIntentId, account: ACCOUNT, chainId: 4663, kind: "settle",
      intent: {
        version: 1, chainId: 4663, account: ACCOUNT, id: clientIntentId, kind: "settle", underlying: "AAPL",
        underlyingAssetIndex: 16, optionTokenId: EXPIRED_TOKEN_ID.toString(), positionBalanceBeforeRaw: "1000",
        sizeRaw: null, minAmountOutRaw: null, minOutWhenSwapRaw: "1", createdAtMs: Date.now(),
      },
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      events: [{
        id: "event-row", orderId, eventId, referenceKind: "transaction", transactionKind: "settle-position",
        transactionHash: txHash, requestKey: null, createdAt: new Date().toISOString(), verification: "client-reported-reference",
      }],
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ orders: [serverOrder] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    mocks.publicClient = publicClient();
    mocks.walletClient = { sendTransaction: vi.fn(), chain: { id: 4663 } };
    const Actions = await loadActions(false);
    render(createElement(Actions));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      const hydrated = JSON.parse(window.localStorage.getItem("optra.callput.robinhood.position-actions.v1") ?? "[]")[0];
      expect(hydrated).toMatchObject({
        serverOrderId: orderId,
        settlement: { sizeRaw: "100", amountOutRaw: "45", settlePriceRaw: "90" },
        pendingTransaction: { status: "confirmed", txHash },
        reconciliation: { state: "settled-position-confirmed", fillConfirmed: true },
      });
    });
  });

  it("recovers a persisted close receipt, request key, and venue state without resubmitting", async () => {
    const orderId = "123e4567-e89b-42d3-a456-426614174030";
    const clientIntentId = "123e4567-e89b-42d3-a456-426614174031";
    const txHash = `0x${"cd".repeat(32)}`;
    const eventId = "123e4567-e89b-42d3-a456-426614174032";
    const tokenExpiry = Number((TOKEN_ID >> 200n) & 0xffffffffffn);
    const request = [ACCOUNT, 16, tokenExpiry, TOKEN_ID, 100n, 4_000_000n, 0n, false, 1_700_000_000n, 2, 4_100_000n, 123n, 1_700_000_030n];
    const serverOrder = {
      id: orderId, clientIntentId, account: ACCOUNT, chainId: 4663, kind: "close",
      intent: {
        version: 1, chainId: 4663, account: ACCOUNT, id: clientIntentId, kind: "close", underlying: "AAPL",
        underlyingAssetIndex: 16, optionTokenId: TOKEN_ID.toString(), positionBalanceBeforeRaw: "1000",
        sizeRaw: "100", minAmountOutRaw: "1", minOutWhenSwapRaw: "1", createdAtMs: Date.now(),
      },
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      events: [{
        id: "event-row", orderId, eventId, referenceKind: "transaction", transactionKind: "close-position",
        transactionHash: txHash, requestKey: null, createdAt: new Date().toISOString(), verification: "client-reported-reference",
      }],
    };
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      return url === "/api/venue/callput/orders"
        ? new Response(JSON.stringify({ orders: [serverOrder] }), { status: 200 })
        : new Response(JSON.stringify({ event: { verification: "client-reported-reference" } }), { status: 200 });
    }));
    const requestKeyTopics = encodeEventTopics({
      abi: CALLPUT_WRITE_ABIS.positionManager,
      eventName: "GenerateRequestKey",
      args: { account: ACCOUNT, key: KEY, isOpen: false },
    });
    const pc = publicClient([{ address: CALLPUT_ROBINHOOD_CONTRACTS.positionManager, topics: requestKeyTopics, data: encodeAbiParameters([], []) }]);
    pc.readContract.mockImplementation((async ({ functionName }: { functionName: string }) => {
      if (functionName === "controller") return CALLPUT_ROBINHOOD_CONTRACTS.controller;
      if (functionName === "executionFee") return 60_000_000_000_000n;
      if (functionName === "balanceOfBatch") return [900n];
      if (functionName === "isApprovedForAll") return true;
      if (functionName === "closePositionRequests") return request;
      throw new Error(`unexpected ${functionName}`);
    }) as never);
    const sendTransaction = vi.fn();
    mocks.publicClient = pc;
    mocks.walletClient = { sendTransaction, chain: { id: 4663 } };
    const Actions = await loadActions(false);
    const user = userEvent.setup();
    render(createElement(Actions));

    await user.click(await screen.findByRole("button", { name: "Recover transaction" }));
    await waitFor(() => {
      const recovered = JSON.parse(window.localStorage.getItem("optra.callput.robinhood.position-actions.v1") ?? "[]")[0];
      expect(recovered).toMatchObject({
        serverOrderId: orderId,
        txHash,
        requestKey: KEY,
        requestKeySynced: true,
        reconciliation: { state: "executed-position-confirmed", fillConfirmed: true },
      });
    });
    expect(sendTransaction).not.toHaveBeenCalled();
    expect(pc.getTransactionReceipt).toHaveBeenCalledWith({ hash: txHash });
  });

  it("recovers a persisted settlement receipt and reconciles the resulting position balance without resubmitting", async () => {
    const orderId = "123e4567-e89b-42d3-a456-426614174020";
    const clientIntentId = "123e4567-e89b-42d3-a456-426614174021";
    const txHash = `0x${"cd".repeat(32)}`;
    const eventId = "123e4567-e89b-42d3-a456-426614174022";
    const serverOrder = {
      id: orderId, clientIntentId, account: ACCOUNT, chainId: 4663, kind: "settle",
      intent: {
        version: 1, chainId: 4663, account: ACCOUNT, id: clientIntentId, kind: "settle", underlying: "AAPL",
        underlyingAssetIndex: 16, optionTokenId: EXPIRED_TOKEN_ID.toString(), positionBalanceBeforeRaw: "1000",
        sizeRaw: null, minAmountOutRaw: null, minOutWhenSwapRaw: "1", createdAtMs: Date.now(),
      },
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      events: [{
        id: "event-row", orderId, eventId, referenceKind: "transaction", transactionKind: "settle-position",
        transactionHash: txHash, requestKey: null, createdAt: new Date().toISOString(), verification: "client-reported-reference",
      }],
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ orders: [serverOrder] }), { status: 200 })));
    const pc = publicClient([settlementLog()]);
    pc.readContract.mockImplementation(async ({ functionName }: { functionName: string }) => {
      if (functionName === "controller") return CALLPUT_ROBINHOOD_CONTRACTS.controller;
      if (functionName === "executionFee") return 60_000_000_000_000n;
      if (functionName === "balanceOfBatch") return [0n];
      if (functionName === "isApprovedForAll") return true;
      throw new Error(`unexpected ${functionName}`);
    });
    const sendTransaction = vi.fn();
    mocks.publicClient = pc;
    mocks.walletClient = { sendTransaction, chain: { id: 4663 } };
    const Actions = await loadActions(false);
    const user = userEvent.setup();
    render(createElement(Actions));

    await user.click(await screen.findByRole("button", { name: "Recover transaction" }));

    await waitFor(() => {
      const recovered = JSON.parse(window.localStorage.getItem("optra.callput.robinhood.position-actions.v1") ?? "[]")[0];
      expect(recovered).toMatchObject({
        serverOrderId: orderId,
        txHash,
        settlement: { sizeRaw: "100", amountOutRaw: "45", settlePriceRaw: "90" },
        reconciliation: { state: "settled-position-confirmed", fillConfirmed: true },
      });
    });
    expect(document.body.textContent).toContain("Settlement: 100 raw units · 45 raw USDG · price 90");
    expect(document.body.textContent).toContain("settled-position-confirmed");
    expect(sendTransaction).not.toHaveBeenCalled();
    expect(pc.getTransactionReceipt).toHaveBeenCalledWith({ hash: txHash });
    });

    it("labels settlement native value accurately instead of presenting it as an execution fee", async () => {
    mocks.publicClient = publicClient();
    mocks.walletClient = { sendTransaction: vi.fn(), chain: { id: 4663 } };
    const Actions = await loadActions(false);
    const user = userEvent.setup();
    render(createElement(Actions));
    await user.click(screen.getByText("Close or settle a position"));
    await user.selectOptions(screen.getByLabelText("Action", { exact: true }), "settle");
    await user.type(screen.getByLabelText("Option token ID (decimal)"), EXPIRED_TOKEN_ID.toString());
    await user.type(screen.getByLabelText("Minimum swap output (raw)"), "1");
    await user.click(screen.getByRole("button", { name: "Prepare settlement" }));
    await screen.findByText("Position transaction review");

    const valueLabel = screen.getByText("Native transaction value (wei)");
    expect(valueLabel.parentElement?.textContent).toMatch(/0\s*$/);
    expect((screen.getByRole("button", { name: "Sign position transaction" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
