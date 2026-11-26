import { encodeAbiParameters, encodeEventTopics, UserRejectedRequestError, type Address, type Hex, type PublicClient } from "viem";
import { describe, expect, it, vi } from "vitest";
import golden from "./fixtures/callput-robinhood-venue-prepared-open.json";
import { defaultLiveAgentPolicy, type LiveAgentPolicy } from "../../lib/venue/callput-live-agent-guard";
import { prepareGrantBoundedPlan } from "../../lib/venue/callput-live-agent-plan";
import { createSignerSubmitter, type LiveAgentTransactionSigner } from "../../lib/venue/callput-live-agent-submitter";
import { NotBroadcastError } from "../../lib/venue/callput-live-agent-worker";
import { CALLPUT_ROBINHOOD_CONTRACTS, type CallPutRobinhoodMarketData, type CallPutRobinhoodOptionMark } from "../../lib/venue/callput-robinhood-readonly";
import { CALLPUT_WRITE_ABIS, prepareCallPutOpenSpread, type CallPutWalletState } from "../../lib/venue/callput-robinhood-write";

const WALLET = "0x000000000000000000000000000000000000dEaD" as Address;
const OTHER = "0x00000000000000000000000000000000000000aa" as Address;
const NOW_MS = 1_795_162_800_000;
const KEY = `0x${"ab".repeat(32)}` as Hex;
const H1 = `0x${"11".repeat(32)}` as Hex;
const H2 = `0x${"22".repeat(32)}` as Hex;
const f = golden.feed;

function leg(side: "call" | "put", id: Hex, strike: number, mark: number, rp: number, expiry = f.expiry): CallPutRobinhoodOptionMark {
  return {
    underlyingSymbol: "AAPL", side, instrument: `AAPL-${strike}-${side}`, optionId: id, expiryTimestamp: expiry,
    strikePriceRaw: strike, markPriceRaw: mark, markIvRaw: 0.3, riskPremiumRateForBuy: rp, riskPremiumRateForSell: rp,
    delta: 0, gamma: 0, vega: 0, theta: 0, marketAvailable: true, quoteType: "indicative",
  };
}
const market = (extra: CallPutRobinhoodOptionMark[] = []): CallPutRobinhoodMarketData => ({
  venue: "callput", network: "robinhood", chainId: 4663, sourceUrl: "https://app-data-robinhood.s3.ap-southeast-1.amazonaws.com/market-data.json",
  timestampMs: NOW_MS - 10_000, lastUpdatedAt: new Date(NOW_MS - 10_000).toISOString(), feedVersion: 1,
  spotIndexRaw: { AAPL: f.spot }, futuresIndexRaw: {},
  options: [leg("put", golden.request.longOptionId as Hex, f.long.strike, f.long.mark, f.long.rpBuy), leg("put", golden.request.shortOptionId as Hex, f.short.strike, f.short.mark, f.short.rpBuy), ...extra],
});
const wallet = (allowance = 0n): CallPutWalletState => ({ chainId: 4663, account: WALLET, usdgBalanceRaw: 5_000_000n, usdgAllowanceRaw: allowance, nativeBalanceWei: 10n ** 16n, executionFeeWei: 60_000_000_000_000n, accountAcceptsErc1155: true });
const plan = (allowance = 0n) =>
  prepareCallPutOpenSpread({ strategy: "BuyPutSpread", underlying: "AAPL", longOptionId: golden.request.longOptionId as Hex, shortOptionId: golden.request.shortOptionId as Hex, size: "0.1", market: market(), wallet: wallet(allowance), nowMs: NOW_MS });

function receipt(status: "success" | "reverted", withKey: boolean) {
  const logs = withKey
    ? [{ address: CALLPUT_ROBINHOOD_CONTRACTS.positionManager, topics: encodeEventTopics({ abi: CALLPUT_WRITE_ABIS.positionManager, eventName: "GenerateRequestKey", args: { account: WALLET, key: KEY, isOpen: true } }), data: encodeAbiParameters([], []) }]
    : [];
  return { status, logs } as never;
}

function harness(opts: { sendError?: (index: number) => unknown; simulateFail?: (index: number) => boolean; receipts?: Array<"timeout" | ReturnType<typeof receipt>> } = {}) {
  let sends = 0;
  let sims = 0;
  let waits = 0;
  const order: string[] = [];
  const signer: LiveAgentTransactionSigner = {
    address: WALLET,
    sendTransaction: vi.fn(async () => {
      const i = sends++;
      order.push(`send${i}`);
      const err = opts.sendError?.(i);
      if (err) throw err;
      return i === 0 ? H1 : H2;
    }),
  };
  const publicClient = {
    call: vi.fn(async () => {
      const i = sims++;
      order.push(`sim${i}`);
      if (opts.simulateFail?.(i)) throw new Error("execution reverted");
      return { data: "0x" };
    }),
    waitForTransactionReceipt: vi.fn(async () => {
      const r = opts.receipts?.[waits++] ?? receipt("success", true);
      if (r === "timeout") throw new Error("timed out");
      order.push("receipt");
      return r;
    }),
  } as unknown as Pick<PublicClient, "call" | "waitForTransactionReceipt">;
  return { signer, publicClient, order, counts: () => ({ sends, sims }) };
}

describe("Live Agent signer submitter (no key held here: the signer is injected)", () => {
  it("sends the approval, then the open, simulating each right before it is sent, and returns the request key from the receipt", async () => {
    const h = harness({ receipts: [receipt("success", false), receipt("success", true)] });
    const result = await createSignerSubmitter({ publicClient: h.publicClient, signer: h.signer }).submit(plan());
    expect(result).toEqual({ transactionHash: H2, requestKey: KEY });
    expect(h.order).toEqual(["sim0", "send0", "receipt", "sim1", "send1", "receipt"]);
  });

  it("sends only the open when the allowance already covers the order", async () => {
    const h = harness();
    const result = await createSignerSubmitter({ publicClient: h.publicClient, signer: h.signer }).submit(plan(10n ** 12n));
    expect(result).toEqual({ transactionHash: H1, requestKey: KEY });
    expect(h.counts()).toEqual({ sends: 1, sims: 1 });
  });

  it("refuses before any simulation or broadcast when the signer is not the plan's account", async () => {
    const h = harness();
    const other = { ...h.signer, address: OTHER };
    await expect(createSignerSubmitter({ publicClient: h.publicClient, signer: other }).submit(plan())).rejects.toBeInstanceOf(NotBroadcastError);
    expect(h.counts()).toEqual({ sends: 0, sims: 0 });
  });

  it("proves nothing was sent when the first simulation reverts", async () => {
    const h = harness({ simulateFail: (i) => i === 0 });
    await expect(createSignerSubmitter({ publicClient: h.publicClient, signer: h.signer }).submit(plan())).rejects.toBeInstanceOf(NotBroadcastError);
    expect(h.counts()).toEqual({ sends: 0, sims: 1 });
  });

  it("treats a failed approval send as not-broadcast for the order, with no open attempted", async () => {
    const h = harness({ sendError: (i) => (i === 0 ? new Error("socket hang up") : undefined) });
    await expect(createSignerSubmitter({ publicClient: h.publicClient, signer: h.signer }).submit(plan())).rejects.toBeInstanceOf(NotBroadcastError);
    expect(h.counts().sends).toBe(1);
  });

  it("treats a reverted or unseen approval as not-broadcast and never sends the open", async () => {
    for (const r of [receipt("reverted", false), "timeout" as const]) {
      const h = harness({ receipts: [r] });
      await expect(createSignerSubmitter({ publicClient: h.publicClient, signer: h.signer }).submit(plan())).rejects.toBeInstanceOf(NotBroadcastError);
      expect(h.counts().sends).toBe(1);
    }
  });

  it("classifies an open send: a wallet rejection is provably not sent, any other error is an unknown outcome", async () => {
    const rejected = harness({ sendError: () => new UserRejectedRequestError(new Error("denied")) });
    await expect(createSignerSubmitter({ publicClient: rejected.publicClient, signer: rejected.signer }).submit(plan(10n ** 12n))).rejects.toBeInstanceOf(NotBroadcastError);

    const ambiguous = harness({ sendError: () => new Error("socket hang up") });
    const outcome = await createSignerSubmitter({ publicClient: ambiguous.publicClient, signer: ambiguous.signer }).submit(plan(10n ** 12n)).catch((e: unknown) => e);
    expect(outcome).toBeInstanceOf(Error);
    expect(outcome).not.toBeInstanceOf(NotBroadcastError);
  });

  it("returns the hash without a key when the open receipt is not seen or carries no request event", async () => {
    const unseen = harness({ receipts: ["timeout"] });
    expect(await createSignerSubmitter({ publicClient: unseen.publicClient, signer: unseen.signer }).submit(plan(10n ** 12n))).toEqual({ transactionHash: H1 });
    const noEvent = harness({ receipts: [receipt("success", false)] });
    expect(await createSignerSubmitter({ publicClient: noEvent.publicClient, signer: noEvent.signer }).submit(plan(10n ** 12n))).toEqual({ transactionHash: H1 });
  });

  it("says no order was created when the open mines as a revert", async () => {
    const h = harness({ receipts: [receipt("reverted", false)] });
    await expect(createSignerSubmitter({ publicClient: h.publicClient, signer: h.signer }).submit(plan(10n ** 12n))).rejects.toThrow(/reverted on-chain/);
  });
});

describe("grant-bounded plan source", () => {
  const policy = (over: Partial<LiveAgentPolicy> = {}): LiveAgentPolicy => ({ ...defaultLiveAgentPolicy(WALLET, WALLET, NOW_MS), enabled: true, allowedUnderlyings: ["AAPL"], ...over });
  const walletClient = (usdg = 5_000_000n) => {
    const readContract = vi.fn(async ({ functionName }: { functionName: string }) => {
      if (functionName === "controller") return CALLPUT_ROBINHOOD_CONTRACTS.controller;
      if (functionName === "executionFee") return 60_000_000_000_000n;
      if (functionName === "balanceOf") return usdg;
      if (functionName === "allowance") return 0n;
      throw new Error(`unexpected ${functionName}`);
    });
    return { getChainId: vi.fn(async () => 4663), getBalance: vi.fn(async () => 10n ** 16n), getCode: vi.fn(async () => "0x"), call: vi.fn(), readContract } as unknown as PublicClient;
  };
  const base = (over: Partial<Parameters<typeof prepareGrantBoundedPlan>[0]> = {}) => ({
    client: walletClient(), policy: policy(), underlying: "AAPL" as const, strategy: "BuyPutSpread" as const, size: "0.1", nowMs: NOW_MS, fetchMarket: async () => market(), ...over,
  });

  it("selects the long higher strike and short lower strike of the adjacent pair for a buy put spread", async () => {
    const result = await prepareGrantBoundedPlan(base());
    expect(result?.intent).toMatchObject({ underlying: "AAPL", strategy: "BuyPutSpread", longOptionId: golden.request.longOptionId, shortOptionId: golden.request.shortOptionId });
    expect(result?.transactions.map((t) => t.kind)).toEqual(["usdg-approval", "open-spread"]);
  });

  it("returns no plan when the policy does not allow the underlying or strategy", async () => {
    expect(await prepareGrantBoundedPlan(base({ policy: policy({ allowedUnderlyings: [] }) }))).toBeNull();
    expect(await prepareGrantBoundedPlan(base({ policy: policy({ allowedStrategies: ["SellPutSpread"] }) }))).toBeNull();
  });

  it("returns no plan outside the expiry window, and when fewer than two strikes are available", async () => {
    expect(await prepareGrantBoundedPlan(base({ policy: policy({ minExpiryDays: 30, maxExpiryDays: 45 }) }))).toBeNull();
    const oneLeg = async () => ({ ...market(), options: [market().options[0]!] });
    expect(await prepareGrantBoundedPlan(base({ fetchMarket: oneLeg }))).toBeNull();
  });

  it("returns no plan, instead of throwing, when the wallet cannot fund the order", async () => {
    expect(await prepareGrantBoundedPlan(base({ client: walletClient(1n) }))).toBeNull();
  });

  it("rejects on a feed failure so the worker reports a read failure and trades nothing", async () => {
    await expect(prepareGrantBoundedPlan(base({ fetchMarket: async () => { throw new Error("feed down"); } }))).rejects.toThrow(/feed down/);
  });
});
