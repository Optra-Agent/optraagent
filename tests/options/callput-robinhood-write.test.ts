import { describe, expect, it, vi } from "vitest";
import { decodeFunctionData, encodeEventTopics, encodeAbiParameters, getAddress, type Address, type Hex, type PublicClient } from "viem";
import golden from "./fixtures/callput-robinhood-venue-prepared-open.json";
import {
  CALLPUT_APPROVAL_SPENDER,
  CALLPUT_ROBINHOOD_UNDERLYINGS,
  CALLPUT_WRITE_ABIS,
  CallPutRiskError,
  callPutUnderlyingByIndex,
  decodeCallPutOptionId,
  extractCallPutRequestKey,
  extractCallPutSettlement,
  parseCallPutSize,
  prepareCallPutClose,
  prepareCallPutOpenSpread,
  prepareCallPutSettle,
  readCallPutWalletState,
  readAccountAcceptsErc1155,
  reconcileCallPutOpen,
  reconcileCallPutClose,
  reconcileCallPutSettlement,
  type CallPutOpenSpreadInput,
  type CallPutWalletState,
} from "../../lib/venue/callput-robinhood-write";
import { CALLPUT_ROBINHOOD_CONTRACTS, type CallPutRobinhoodMarketData, type CallPutRobinhoodOptionMark } from "../../lib/venue/callput-robinhood-readonly";
import type { CallPutRobinhoodRequestSnapshot } from "../../lib/venue/callput-robinhood-requests";

const NOW_MS = 1_795_162_800_000;
const WALLET = "0x000000000000000000000000000000000000dEaD" as Address;

function leg(side: "call" | "put", id: Hex, strike: number, mark: number, rp: number, overrides: Partial<CallPutRobinhoodOptionMark> = {}): CallPutRobinhoodOptionMark {
  return {
    underlyingSymbol: "AAPL", side, instrument: `AAPL-${strike}`, optionId: id, expiryTimestamp: golden.feed.expiry,
    strikePriceRaw: strike, markPriceRaw: mark, markIvRaw: 0.3, riskPremiumRateForBuy: rp, riskPremiumRateForSell: rp,
    delta: 0, gamma: 0, vega: 0, theta: 0, marketAvailable: true, quoteType: "indicative", ...overrides,
  };
}

function market(overrides: Partial<CallPutRobinhoodMarketData> = {}, legOverrides: Partial<CallPutRobinhoodOptionMark> = {}): CallPutRobinhoodMarketData {
  const f = golden.feed;
  return {
    venue: "callput", network: "robinhood", chainId: 4663,
    sourceUrl: "https://app-data-robinhood.s3.ap-southeast-1.amazonaws.com/market-data.json",
    timestampMs: NOW_MS - 10_000, lastUpdatedAt: new Date(NOW_MS - 10_000).toISOString(), feedVersion: 1,
    spotIndexRaw: { AAPL: f.spot }, futuresIndexRaw: {},
    options: [
      leg("put", golden.request.longOptionId as Hex, f.long.strike, f.long.mark, f.long.rpBuy, legOverrides),
      leg("put", golden.request.shortOptionId as Hex, f.short.strike, f.short.mark, f.short.rpBuy),
    ],
    ...overrides,
  };
}

const wallet: CallPutWalletState = {
  chainId: 4663, account: WALLET, usdgBalanceRaw: 5_000_000n, usdgAllowanceRaw: 0n,
  nativeBalanceWei: 10n ** 16n, executionFeeWei: 60_000_000_000_000n,
};

function openInput(overrides: Partial<CallPutOpenSpreadInput> = {}): CallPutOpenSpreadInput {
  return {
    strategy: "BuyPutSpread", underlying: "AAPL", longOptionId: golden.request.longOptionId as Hex,
    shortOptionId: golden.request.shortOptionId as Hex, size: golden.request.size, market: market(), wallet, nowMs: NOW_MS, ...overrides,
  };
}

describe("CallPut Robinhood write preparation", () => {
  it("reproduces the venue MCP's unsigned BuyPutSpread calldata byte for byte", () => {
    const plan = prepareCallPutOpenSpread(openInput());
    expect(plan.quote.amountInRaw.toString()).toBe(golden.expected.amountInRaw);
    expect(plan.minSizeRaw.toString()).toBe(golden.expected.minSizeRaw);
    expect(plan.transactions.map((tx) => tx.kind)).toEqual(["usdg-approval", "open-spread"]);
    const [approval, open] = plan.transactions;
    expect(approval.to).toBe(CALLPUT_ROBINHOOD_CONTRACTS.usdg);
    expect(approval.data).toBe(golden.expected.approveData);
    expect(open.to).toBe(CALLPUT_ROBINHOOD_CONTRACTS.positionManager);
    expect(open.data).toBe(golden.expected.openData);
    expect(open.value).toBe(BigInt(golden.expected.value));
    expect(open.chainId).toBe(4663);
    expect(plan.intent).toMatchObject({ kind: "open", requestKey: null, txHash: null, underlyingAssetIndex: 16 });
  });

  it("encodes a sell spread with strike-width collateral and flipped legs", () => {
    const plan = prepareCallPutOpenSpread(openInput({
      strategy: "SellPutSpread",
      wallet: { ...wallet, usdgBalanceRaw: 50_000_000n, usdgAllowanceRaw: 10n ** 12n },
    }));
    expect(plan.transactions.map((tx) => tx.kind)).toEqual(["open-spread"]);
    const decoded = decodeFunctionData({ abi: CALLPUT_WRITE_ABIS.positionManager, data: plan.transactions[0].data });
    expect(decoded.functionName).toBe("createOpenPosition");
    const args = decoded.args as readonly unknown[];
    expect(args[1]).toBe(2);
    expect(args[2]).toEqual([false, true, false, false]);
    expect(args[4]).toEqual([false, false, false, false]);
    // strike width 5 * size 1 plus a fee, so more than 5 USDG
    expect((args[7] as bigint) > 5_000_000n).toBe(true);
  });

  it("encodes call spreads with isCalls set", () => {
    const callMarket = market();
    callMarket.options = callMarket.options.map((o) => ({ ...o, side: "call" as const }));
    // Call spread requires long strike < short strike, so swap legs.
    const plan = prepareCallPutOpenSpread(openInput({
      strategy: "BuyCallSpread",
      longOptionId: golden.request.shortOptionId as Hex,
      shortOptionId: golden.request.longOptionId as Hex,
      market: { ...callMarket, options: callMarket.options.map((o) => o.strikePriceRaw === 335 ? { ...o, markPriceRaw: 3, riskPremiumRateForBuy: 0.1, riskPremiumRateForSell: 0.1 } : o) },
      wallet: { ...wallet, usdgAllowanceRaw: 10n ** 12n },
    }));
    const args = decodeFunctionData({ abi: CALLPUT_WRITE_ABIS.positionManager, data: plan.transactions[0].data }).args as readonly unknown[];
    expect(args[2]).toEqual([true, false, false, false]);
    expect(args[4]).toEqual([true, true, false, false]);
  });

  it("skips the approval when allowance already covers the amount, and never approves unlimited", () => {
    const covered = prepareCallPutOpenSpread(openInput({ wallet: { ...wallet, usdgAllowanceRaw: 900_811n } }));
    expect(covered.transactions.map((tx) => tx.kind)).toEqual(["open-spread"]);
    const approve = prepareCallPutOpenSpread(openInput()).transactions[0];
    const decoded = decodeFunctionData({ abi: CALLPUT_WRITE_ABIS.erc20, data: approve.data });
    expect(decoded.args).toEqual([CALLPUT_APPROVAL_SPENDER, 900_811n]);
  });

  it.each([
    ["stale feed", { market: market({ timestampMs: NOW_MS - 6 * 60_000 }) }, "feed-fresh"],
    ["wrong wallet chain", { wallet: { ...wallet, chainId: 1 } }, "chain"],
    ["unavailable leg", { market: market({}, { marketAvailable: false }) }, "legs-available"],
    ["leg missing from feed", { shortOptionId: `0x${"11".repeat(32)}` as Hex }, "legs-listed"],
    ["inverted put strikes", { longOptionId: golden.request.shortOptionId as Hex, shortOptionId: golden.request.longOptionId as Hex }, "strike-order"],
    ["size precision beyond 18 decimals", { size: "0.0000000000000000001" }, "size"],
    ["zero size", { size: "0" }, "size"],
    ["collateral over cap", { maxCollateralRaw: 100_000n }, "collateral-cap"],
    ["insufficient USDG", { wallet: { ...wallet, usdgBalanceRaw: 1n } }, "usdg-balance"],
    ["insufficient gas", { wallet: { ...wallet, nativeBalanceWei: 1n } }, "native-balance"],
    ["execution fee above ceiling", { wallet: { ...wallet, executionFeeWei: 10n ** 15n } }, "execution-fee"],
    ["inside the 30 minute buffer", { nowMs: golden.feed.expiry * 1000 - 600_000, market: market({ timestampMs: golden.feed.expiry * 1000 - 600_000 - 1000 }) }, "expiry-buffer"],
    ["bad min fill", { minFillBps: 50 }, "min-fill"],
  ] as const)("blocks %s", (_name, override, checkId) => {
    let error: unknown;
    try { prepareCallPutOpenSpread(openInput(override as Partial<CallPutOpenSpreadInput>)); } catch (reason) { error = reason; }
    expect(error).toBeInstanceOf(CallPutRiskError);
    expect((error as CallPutRiskError).failed.map((c) => c.id)).toContain(checkId);
  });

  it("rejects unsupported underlyings and strategies instead of guessing", () => {
    expect(() => prepareCallPutOpenSpread(openInput({ underlying: "DOGE" }))).toThrow(CallPutRiskError);
    expect(() => prepareCallPutOpenSpread(openInput({ strategy: "BuyPut" as never }))).toThrow(CallPutRiskError);
  });

  it("does not export a naked single-leg open", async () => {
    const mod = await import("../../lib/venue/callput-robinhood-write");
    expect(Object.keys(mod).some((name) => /naked|single/i.test(name))).toBe(false);
  });

  it("decodes optionIds and the underlying table", () => {
    expect(decodeCallPutOptionId(golden.request.longOptionId)).toEqual({ underlyingAssetIndex: 16, expiry: golden.feed.expiry, strike: 340 });
    expect(callPutUnderlyingByIndex(16)).toBe("AAPL");
    expect(callPutUnderlyingByIndex(99)).toBeNull();
    expect(Object.keys(CALLPUT_ROBINHOOD_UNDERLYINGS)).toHaveLength(20);
    expect(parseCallPutSize("1.5", 18)).toBe(1_500_000_000_000_000_000n);
    expect(() => parseCallPutSize("1e3", 18)).toThrow();
  });
});

describe("CallPut close and settle preparation", () => {
  const optionTokenId = BigInt(`0x${"0010"}${"006b09b710"}${"56"}${"0".repeat(64 - 4 - 10 - 2)}`);
  const operator = CALLPUT_ROBINHOOD_CONTRACTS.controller as Address;
  const position = (overrides = {}) => ({
    chainId: 4663, account: WALLET, positionBalanceRaw: 10n ** 18n, operatorApproved: false, operator,
    nativeBalanceWei: 10n ** 16n, executionFeeWei: 60_000_000_000_000n, ...overrides,
  });

  it("prepares setApprovalForAll then createClosePosition with explicit floors", () => {
    const { transactions } = prepareCallPutClose({
      underlying: "AAPL", optionTokenId, sizeRaw: 5n * 10n ** 17n, minAmountOutRaw: 1n, minOutWhenSwapRaw: 1n,
      position: position(), nowMs: NOW_MS,
    });
    expect(transactions.map((tx) => tx.kind)).toEqual(["option-token-approval", "close-position"]);
    expect(transactions[0].to).toBe(getAddress(CALLPUT_ROBINHOOD_UNDERLYINGS.AAPL.optionsToken));
    expect(decodeFunctionData({ abi: CALLPUT_WRITE_ABIS.optionsToken, data: transactions[0].data }).args).toEqual([operator, true]);
    const args = decodeFunctionData({ abi: CALLPUT_WRITE_ABIS.positionManager, data: transactions[1].data }).args as readonly unknown[];
    expect(args.slice(0, 3)).toEqual([16, optionTokenId, 5n * 10n ** 17n]);
    expect(args[6]).toBe(false);
    expect(transactions[1].value).toBe(60_000_000_000_000n);
  });

  it.each([
    ["zero output floor", { minAmountOutRaw: 0n }, "min-amount-out"],
    ["zero swap floor", { minOutWhenSwapRaw: 0n }, "min-out-swap"],
    ["size above balance", { sizeRaw: 2n * 10n ** 18n }, "size"],
    ["wrong underlying token", { underlying: "TSLA" }, "token-underlying"],
    ["after expiry", { nowMs: golden.feed.expiry * 1000 + 1000 }, "close-before-expiry"],
  ] as const)("blocks close with %s", (_name, override, id) => {
    let error: unknown;
    try {
      prepareCallPutClose({ underlying: "AAPL", optionTokenId, sizeRaw: 10n ** 17n, minAmountOutRaw: 1n, minOutWhenSwapRaw: 1n, position: position(), nowMs: NOW_MS, ...override } as never);
    } catch (reason) { error = reason; }
    expect(error).toBeInstanceOf(CallPutRiskError);
    expect((error as CallPutRiskError).failed.map((c) => c.id)).toContain(id);
  });

  it("settles only after expiry and only for held tokens", () => {
    const after = golden.feed.expiry * 1000 + 60_000;
    const ok = prepareCallPutSettle({ underlying: "AAPL", optionTokenId, minOutWhenSwapRaw: 1n, position: position({ operatorApproved: true }), nowMs: after });
    expect(ok.transactions.map((tx) => tx.kind)).toEqual(["settle-position"]);
    expect(ok.transactions[0].to).toBe(CALLPUT_ROBINHOOD_CONTRACTS.settleManager);
    expect(ok.transactions[0].value).toBe(0n);
    expect(() => prepareCallPutSettle({ underlying: "AAPL", optionTokenId, minOutWhenSwapRaw: 1n, position: position(), nowMs: NOW_MS })).toThrow(CallPutRiskError);
    expect(() => prepareCallPutSettle({ underlying: "AAPL", optionTokenId, minOutWhenSwapRaw: 1n, position: position({ positionBalanceRaw: 0n }), nowMs: after })).toThrow(CallPutRiskError);
  });
});

describe("CallPut request tracking and reconciliation", () => {
  const KEY = `0x${"ab".repeat(32)}` as Hex;
  function receipt(account: Address, key: Hex, isOpen: boolean, address: Address = CALLPUT_ROBINHOOD_CONTRACTS.positionManager, status: "success" | "reverted" = "success") {
    const topics = encodeEventTopics({ abi: CALLPUT_WRITE_ABIS.positionManager, eventName: "GenerateRequestKey", args: { account, key, isOpen } });
    return { status, logs: [{ address, topics, data: encodeAbiParameters([], []) }] } as never;
  }

  it("extracts the request key from the PositionManager event for the signer", () => {
    expect(extractCallPutRequestKey(receipt(WALLET, KEY, true), { account: WALLET, isOpen: true })).toBe(KEY);
  });

  it("refuses reverted receipts, other emitters, other accounts, wrong direction and missing events", () => {
    expect(() => extractCallPutRequestKey(receipt(WALLET, KEY, true, undefined, "reverted"), { account: WALLET, isOpen: true })).toThrow(/reverted/);
    expect(() => extractCallPutRequestKey(receipt(WALLET, KEY, true, "0x00000000000000000000000000000000000000aa"), { account: WALLET, isOpen: true })).toThrow(/No GenerateRequestKey/);
    expect(() => extractCallPutRequestKey(receipt("0x0000000000000000000000000000000000000001", KEY, true), { account: WALLET, isOpen: true })).toThrow(/No GenerateRequestKey/);
    expect(() => extractCallPutRequestKey(receipt(WALLET, KEY, false), { account: WALLET, isOpen: true })).toThrow(/No GenerateRequestKey/);
    expect(() => extractCallPutRequestKey({ status: "success", logs: [] }, { account: WALLET, isOpen: true })).toThrow(/No GenerateRequestKey/);
  });

  it("extracts settlement evidence only from the matching SettlePosition event", () => {
    const optionTokenId = 99n;
    const size = 500n;
    const event = {
      address: CALLPUT_ROBINHOOD_CONTRACTS.settleManager,
      topics: encodeEventTopics({
        abi: CALLPUT_WRITE_ABIS.settleManager,
        eventName: "SettlePosition",
        args: { account: WALLET, underlyingAssetIndex: 16, expiry: 1_795_795_685 },
      }),
      data: encodeAbiParameters(
        [{ type: "uint256" }, { type: "uint256" }, { type: "address[]" }, { type: "uint256" }, { type: "uint256" }],
        [optionTokenId, size, [CALLPUT_ROBINHOOD_CONTRACTS.usdg], 45n, 90n],
      ),
    };
    const receipt = { status: "success", logs: [event] } as never;
    expect(extractCallPutSettlement(receipt, { account: WALLET, underlyingAssetIndex: 16, optionTokenId }))
      .toMatchObject({ account: WALLET, underlyingAssetIndex: 16, optionTokenId, size, amountOut: 45n, settlePrice: 90n });
    expect(() => extractCallPutSettlement(receipt, { account: "0x0000000000000000000000000000000000000001", underlyingAssetIndex: 16, optionTokenId })).toThrow(/No matching SettlePosition/);
    expect(() => extractCallPutSettlement(receipt, { account: WALLET, underlyingAssetIndex: 16, optionTokenId: 100n })).toThrow(/No matching SettlePosition/);
  });

  const intent = () => ({ ...prepareCallPutOpenSpread(openInput()).intent, requestKey: KEY, txHash: `0x${"cd".repeat(32)}` as Hex });
  const snapshot = (overrides: Partial<CallPutRobinhoodRequestSnapshot>): CallPutRobinhoodRequestSnapshot => ({
    requestKey: KEY, kind: "open", status: "Pending", account: WALLET, underlyingAssetIndex: 16, expiry: 1n, optionTokenId: 99n,
    minSize: 1n, amountIn: 1n, minOutWhenSwap: 0n, size: null, minAmountOut: null, sizeOut: 0n, amountOut: 0n, executionPrice: 0n,
    submittedAt: BigInt(Math.floor(NOW_MS / 1000)), processedAt: 0n, nativeTokenHandling: false, ...overrides,
  });

  it("never reports a fill from a receipt, a missing key, or a bare Executed status", () => {
    const base = intent();
    expect(reconcileCallPutOpen({ intent: { ...base, requestKey: null }, request: null, optionTokenBalanceRaw: null, nowMs: NOW_MS }))
      .toMatchObject({ state: "awaiting-request-key", fillConfirmed: false });
    expect(reconcileCallPutOpen({ intent: base, request: snapshot({ status: "Not found" }), optionTokenBalanceRaw: null, nowMs: NOW_MS }))
      .toMatchObject({ state: "request-not-found", fillConfirmed: false });
    expect(reconcileCallPutOpen({ intent: base, request: snapshot({}), optionTokenBalanceRaw: null, nowMs: NOW_MS + 10_000 }))
      .toMatchObject({ state: "pending", fillConfirmed: false });
    expect(reconcileCallPutOpen({ intent: base, request: snapshot({}), optionTokenBalanceRaw: null, nowMs: NOW_MS + 200_000 }))
      .toMatchObject({ state: "pending-past-delay", fillConfirmed: false });
    expect(reconcileCallPutOpen({ intent: base, request: snapshot({ status: "Cancelled" }), optionTokenBalanceRaw: null, nowMs: NOW_MS }))
      .toMatchObject({ state: "cancelled", fillConfirmed: false });
    const executed = snapshot({ status: "Executed", sizeOut: 500n });
    expect(reconcileCallPutOpen({ intent: base, request: executed, optionTokenBalanceRaw: null, nowMs: NOW_MS }))
      .toMatchObject({ state: "executed-balance-unconfirmed", fillConfirmed: false });
    expect(reconcileCallPutOpen({ intent: base, request: executed, optionTokenBalanceRaw: 499n, nowMs: NOW_MS }))
      .toMatchObject({ state: "executed-balance-unconfirmed", fillConfirmed: false });
    expect(reconcileCallPutOpen({ intent: base, request: snapshot({ status: "Executed", sizeOut: 0n }), optionTokenBalanceRaw: 10n, nowMs: NOW_MS }))
      .toMatchObject({ fillConfirmed: false });
    expect(reconcileCallPutOpen({ intent: base, request: executed, optionTokenBalanceRaw: 500n, nowMs: NOW_MS }))
      .toMatchObject({ state: "executed-balance-confirmed", fillConfirmed: true });
  });

  it("rejects mismatched request key or account", () => {
    expect(() => reconcileCallPutOpen({ intent: intent(), request: snapshot({ requestKey: `0x${"01".repeat(32)}` }), optionTokenBalanceRaw: null, nowMs: NOW_MS })).toThrow(/does not match/);
    expect(() => reconcileCallPutOpen({ intent: intent(), request: snapshot({ account: "0x0000000000000000000000000000000000000002" }), optionTokenBalanceRaw: null, nowMs: NOW_MS })).toThrow(/account differs/);
  });

  it("confirms a close only when its executed request is matched by an independent token-balance decrease", () => {
    const closeRequest = snapshot({
      kind: "close", status: "Executed", size: 500n, optionTokenId: 99n,
      minSize: null, amountIn: null, sizeOut: null, minAmountOut: 1n,
    });
    expect(reconcileCallPutClose({ request: closeRequest, requestKey: KEY, account: WALLET, optionTokenId: 99n, preBalanceRaw: 1_000n, balanceAfterRaw: 500n, nowMs: NOW_MS }))
      .toMatchObject({ state: "executed-position-confirmed", fillConfirmed: true });
    expect(reconcileCallPutClose({ request: closeRequest, requestKey: KEY, account: WALLET, optionTokenId: 99n, preBalanceRaw: 1_000n, balanceAfterRaw: 600n, nowMs: NOW_MS }))
      .toMatchObject({ state: "executed-position-unconfirmed", fillConfirmed: false });
    expect(reconcileCallPutClose({ request: { ...closeRequest, status: "Pending" }, requestKey: KEY, account: WALLET, optionTokenId: 99n, preBalanceRaw: 1_000n, balanceAfterRaw: 500n, nowMs: NOW_MS }))
      .toMatchObject({ state: "pending", fillConfirmed: false });
    expect(() => reconcileCallPutClose({ request: closeRequest, requestKey: KEY, account: WALLET, optionTokenId: 100n, preBalanceRaw: 1_000n, balanceAfterRaw: 500n, nowMs: NOW_MS })).toThrow(/position token/);
  });

  it("confirms settlement only when a matching event and independent position-balance decrease agree", () => {
    const settlement = { account: WALLET, underlyingAssetIndex: 16, optionTokenId: 99n, size: 500n, amountOut: 45n, settlePrice: 90n };
    expect(reconcileCallPutSettlement({ settlement, preBalanceRaw: 1_000n, balanceAfterRaw: 500n }))
      .toMatchObject({ state: "settled-position-confirmed", fillConfirmed: true });
    expect(reconcileCallPutSettlement({ settlement, preBalanceRaw: 1_000n, balanceAfterRaw: 600n }))
      .toMatchObject({ state: "settled-position-unconfirmed", fillConfirmed: false });
    expect(reconcileCallPutSettlement({ settlement: null, preBalanceRaw: 1_000n, balanceAfterRaw: 0n }))
      .toMatchObject({ state: "awaiting-settlement-event", fillConfirmed: false });
  });
});

describe("CallPut pre-flight reads", () => {
  function client(chainId: number, controller: Address = CALLPUT_ROBINHOOD_CONTRACTS.controller as Address) {
    const readContract = vi.fn(async ({ functionName }: { functionName: string }) => {
      if (functionName === "controller") return controller;
      if (functionName === "executionFee") return 60_000_000_000_000n;
      if (functionName === "balanceOf") return 5_000_000n;
      if (functionName === "allowance") return 0n;
      throw new Error(`unexpected ${functionName}`);
    });
    return { getChainId: vi.fn(async () => chainId), getBalance: vi.fn(async () => 10n ** 16n), getCode: vi.fn(async () => "0x"), call: vi.fn(), readContract } as unknown as PublicClient & { readContract: typeof readContract };
  }

  it("reads wallet state only on chain 4663 and with the pinned controller", async () => {
    const ok = client(4663);
    await expect(readCallPutWalletState(ok, WALLET)).resolves.toMatchObject({ usdgBalanceRaw: 5_000_000n, executionFeeWei: 60_000_000_000_000n });
    const wrongChain = client(1);
    await expect(readCallPutWalletState(wrongChain, WALLET)).rejects.toThrow(/Robinhood Mainnet/);
    expect(wrongChain.readContract).not.toHaveBeenCalled();
    await expect(readCallPutWalletState(client(4663, "0x0000000000000000000000000000000000000bad"), WALLET)).rejects.toThrow(/controller/);
  });
});

describe("ERC-1155 receiver safeguard (found on a mainnet fork: a 7702-delegated account made every fill revert)", () => {
  const withCode = (impl: () => Promise<{ data?: string }>) =>
    ({ getCode: vi.fn(async () => "0xef0100cc04506d439d338bde8ebbb074f17a54b7673b95"), call: vi.fn(impl) }) as unknown as PublicClient;

  it("treats a plain account with no code as able to receive option tokens, without any call", async () => {
    const eoa = { getCode: vi.fn(async () => "0x"), call: vi.fn() } as unknown as PublicClient;
    await expect(readAccountAcceptsErc1155(eoa, WALLET)).resolves.toBe(true);
    expect((eoa as unknown as { call: ReturnType<typeof vi.fn> }).call).not.toHaveBeenCalled();
  });

  it("accepts a contract account that returns the ERC-1155 receiver magic value", async () => {
    await expect(readAccountAcceptsErc1155(withCode(async () => ({ data: "0xf23a6e6100000000000000000000000000000000000000000000000000000000" })), WALLET)).resolves.toBe(true);
  });

  it("rejects a contract account whose fallback returns nothing, or that reverts", async () => {
    await expect(readAccountAcceptsErc1155(withCode(async () => ({ data: "0x" })), WALLET)).resolves.toBe(false);
    await expect(readAccountAcceptsErc1155(withCode(async () => { throw new Error("revert"); }), WALLET)).resolves.toBe(false);
  });

  it("calls the account the way the venue does: from PositionManager with the receiver selector", async () => {
    const client = withCode(async () => ({ data: "0xf23a6e61" }));
    await readAccountAcceptsErc1155(client, WALLET);
    const call = (client as unknown as { call: ReturnType<typeof vi.fn> }).call.mock.calls[0]![0] as { account: string; to: string; data: string };
    expect(call.account).toBe(CALLPUT_ROBINHOOD_CONTRACTS.positionManager);
    expect(call.to).toBe(WALLET);
    expect(call.data.startsWith("0xf23a6e61")).toBe(true);
  });

  it("blocks an open order for an account that cannot receive the position, and still allows unknown or accepted", () => {
    expect(() => prepareCallPutOpenSpread(openInput({ wallet: { ...wallet, accountAcceptsErc1155: false } }))).toThrow(/ERC-1155 option tokens/);
    expect(() => prepareCallPutOpenSpread(openInput({ wallet: { ...wallet, accountAcceptsErc1155: true } }))).not.toThrow();
    expect(() => prepareCallPutOpenSpread(openInput())).not.toThrow();
  });
});
