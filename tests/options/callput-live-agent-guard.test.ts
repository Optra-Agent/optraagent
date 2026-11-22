import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import golden from "./fixtures/callput-robinhood-venue-prepared-open.json";
import { prepareCallPutOpenSpread, type CallPutOpenSpreadPlan, type CallPutWalletState } from "../../lib/venue/callput-robinhood-write";
import type { CallPutRobinhoodMarketData, CallPutRobinhoodOptionMark } from "../../lib/venue/callput-robinhood-readonly";
import type { CallPutRobinhoodRequestSnapshot } from "../../lib/venue/callput-robinhood-requests";
import {
  autonomyBlockers,
  canAcquireLease,
  classifyRequests,
  defaultLiveAgentPolicy,
  evaluateLiveAgentOrder,
  liveAgentIdempotencyKey,
  shouldHaltNewOrders,
  type LiveAgentPolicy,
  type LiveAgentState,
} from "../../lib/venue/callput-live-agent-guard";

const NOW_MS = 1_795_162_800_000;
const WALLET = "0x000000000000000000000000000000000000dEaD" as Address;

function leg(id: Hex, strike: number, mark: number, rp: number): CallPutRobinhoodOptionMark {
  return {
    underlyingSymbol: "AAPL", side: "put", instrument: `AAPL-${strike}`, optionId: id, expiryTimestamp: golden.feed.expiry,
    strikePriceRaw: strike, markPriceRaw: mark, markIvRaw: 0.3, riskPremiumRateForBuy: rp, riskPremiumRateForSell: rp,
    delta: 0, gamma: 0, vega: 0, theta: 0, marketAvailable: true, quoteType: "indicative",
  };
}
const f = golden.feed;
const market: CallPutRobinhoodMarketData = {
  venue: "callput", network: "robinhood", chainId: 4663, sourceUrl: "https://app-data-robinhood.s3.ap-southeast-1.amazonaws.com/market-data.json",
  timestampMs: NOW_MS - 10_000, lastUpdatedAt: new Date(NOW_MS - 10_000).toISOString(), feedVersion: 1,
  spotIndexRaw: { AAPL: f.spot }, futuresIndexRaw: {},
  options: [leg(golden.request.longOptionId as Hex, f.long.strike, f.long.mark, f.long.rpBuy), leg(golden.request.shortOptionId as Hex, f.short.strike, f.short.mark, f.short.rpBuy)],
};
const wallet: CallPutWalletState = { chainId: 4663, account: WALLET, usdgBalanceRaw: 5_000_000n, usdgAllowanceRaw: 0n, nativeBalanceWei: 10n ** 16n, executionFeeWei: 60_000_000_000_000n };

function plan(): CallPutOpenSpreadPlan {
  return prepareCallPutOpenSpread({ strategy: "BuyPutSpread", underlying: "AAPL", longOptionId: golden.request.longOptionId as Hex, shortOptionId: golden.request.shortOptionId as Hex, size: golden.request.size, market, wallet, nowMs: NOW_MS });
}
const expiryMs = f.expiry * 1000;
const nowForWindow = expiryMs - 10 * 86_400_000;
function policy(overrides: Partial<LiveAgentPolicy> = {}): LiveAgentPolicy {
  return { ...defaultLiveAgentPolicy(WALLET, WALLET, nowForWindow), enabled: true, allowedUnderlyings: ["AAPL"], maxCollateralPerOrderRaw: 50_000_000n, maxOpenCollateralRaw: 50_000_000n, maxDailyCollateralRaw: 50_000_000n, ...overrides };
}
function state(overrides: Partial<LiveAgentState> = {}): LiveAgentState {
  return { nowMs: nowForWindow, openCollateralRaw: 0n, dailyCollateralRaw: 0n, ordersToday: 0, pendingRequests: 0, openPositions: 0, globalKillSwitch: false, ...overrides };
}
const failed = (d: ReturnType<typeof evaluateLiveAgentOrder>) => d.checks.filter((c) => !c.ok).map((c) => c.id);

describe("live agent order policy", () => {
  it("allows an in-policy order", () => {
    const d = evaluateLiveAgentOrder(policy(), plan(), state());
    expect(failed(d)).toEqual([]);
    expect(d.allowed).toBe(true);
  });

  it("is stopped by default and by the global kill switch", () => {
    expect(failed(evaluateLiveAgentOrder({ ...policy(), enabled: false }, plan(), state()))).toContain("kill-switch");
    expect(failed(evaluateLiveAgentOrder(policy(), plan(), state({ globalKillSwitch: true })))).toContain("kill-switch");
    expect(defaultLiveAgentPolicy(WALLET, WALLET, 0).enabled).toBe(false);
    expect(defaultLiveAgentPolicy(WALLET, WALLET, 0).allowedUnderlyings).toEqual([]);
  });

  it("rejects an expired grant, a foreign trading address, and off-list assets or strategies", () => {
    expect(failed(evaluateLiveAgentOrder(policy({ grantExpiresAtMs: nowForWindow - 1 }), plan(), state()))).toContain("grant-live");
    expect(failed(evaluateLiveAgentOrder(policy({ tradingAddress: "0x0000000000000000000000000000000000000001" }), plan(), state()))).toContain("trading-address");
    expect(failed(evaluateLiveAgentOrder(policy({ allowedUnderlyings: [] }), plan(), state()))).toContain("underlying");
    expect(failed(evaluateLiveAgentOrder(policy({ allowedStrategies: ["SellCallSpread"] }), plan(), state()))).toContain("strategy");
  });

  it("enforces per-order, open-exposure, daily, count and pending limits", () => {
    const p = plan();
    const amount = p.quote.amountInRaw;
    expect(failed(evaluateLiveAgentOrder(policy({ maxCollateralPerOrderRaw: amount - 1n }), p, state()))).toContain("per-order-collateral");
    expect(failed(evaluateLiveAgentOrder(policy(), p, state({ openCollateralRaw: 50_000_000n })))).toContain("open-exposure");
    expect(failed(evaluateLiveAgentOrder(policy(), p, state({ dailyCollateralRaw: 50_000_000n })))).toContain("daily-budget");
    expect(failed(evaluateLiveAgentOrder(policy({ maxOrdersPerDay: 1 }), p, state({ ordersToday: 1 })))).toContain("order-count");
    expect(failed(evaluateLiveAgentOrder(policy(), p, state({ pendingRequests: 1 })))).toContain("pending-requests");
    expect(failed(evaluateLiveAgentOrder(policy(), p, state({ openPositions: 2 })))).not.toContain("open-positions");
    expect(failed(evaluateLiveAgentOrder(policy(), p, state({ openPositions: 3 })))).toContain("open-positions");
  });

  it("enforces the execution-fee cap and the expiry window", () => {
    expect(failed(evaluateLiveAgentOrder(policy({ maxExecutionFeeWei: 1n }), plan(), state()))).toContain("execution-fee");
    expect(failed(evaluateLiveAgentOrder(policy({ minExpiryDays: 11 }), plan(), state()))).toContain("expiry-window");
    expect(failed(evaluateLiveAgentOrder(policy({ maxExpiryDays: 5 }), plan(), state()))).toContain("expiry-window");
  });

  it("fails closed when a venue-side prepare check failed", () => {
    const p = plan();
    p.checks = [...p.checks, { id: "x", ok: false, detail: "venue" }];
    expect(failed(evaluateLiveAgentOrder(policy(), p, state()))).toContain("venue-checks");
  });
});

describe("autonomy blockers", () => {
  it("lists every missing piece of evidence and clears only when all exist", () => {
    const none = autonomyBlockers({ venueDelegationConfirmedRef: null, onchainGrantRef: null, auditRef: null, ownerApprovalRef: null, revocationTested: false });
    expect(none.map((b) => b.id)).toEqual(["venue-delegation", "onchain-grant", "audit", "owner-approval", "revocation"]);
    expect(autonomyBlockers({ venueDelegationConfirmedRef: "ref", onchainGrantRef: "ref", auditRef: "ref", ownerApprovalRef: "ref", revocationTested: true })).toEqual([]);
    expect(autonomyBlockers({ venueDelegationConfirmedRef: "ref", onchainGrantRef: null, auditRef: "ref", ownerApprovalRef: "ref", revocationTested: true }).map((b) => b.id)).toEqual(["onchain-grant"]);
  });
});

describe("idempotency, request monitoring, and lease", () => {
  it("derives a stable idempotency key that changes with the decision", () => {
    const p = plan();
    expect(liveAgentIdempotencyKey("a1", "t1", p)).toBe(liveAgentIdempotencyKey("a1", "t1", plan()));
    expect(liveAgentIdempotencyKey("a1", "t1", p)).not.toBe(liveAgentIdempotencyKey("a1", "t2", p));
    expect(liveAgentIdempotencyKey("a1", "t1", p)).toMatch(/^[0-9a-f]{64}$/);
  });

  const snap = (status: CallPutRobinhoodRequestSnapshot["status"], submittedAt: bigint | null): CallPutRobinhoodRequestSnapshot => ({
    requestKey: `0x${"ab".repeat(32)}`, kind: "open", status, account: WALLET, underlyingAssetIndex: 16, expiry: null, optionTokenId: null, minSize: null, amountIn: null,
    minOutWhenSwap: null, size: null, minAmountOut: null, sizeOut: null, amountOut: null, executionPrice: null, submittedAt, processedAt: null, nativeTokenHandling: null,
  });
  const nowS = 1_795_162_800n;

  it("treats only Executed as settled; stale, unknown and missing requests halt trading", () => {
    expect(classifyRequests([snap("Executed", nowS)], NOW_MS)[0]).toMatchObject({ state: "settled", action: "none" });
    expect(classifyRequests([snap("Pending", nowS - 60n)], NOW_MS)[0]).toMatchObject({ state: "pending", action: "wait" });
    const stale = classifyRequests([snap("Pending", nowS - 1_000n)], NOW_MS);
    expect(stale[0]).toMatchObject({ state: "stale", action: "stop-agent" });
    expect(shouldHaltNewOrders(stale)).toBe(true);
    expect(classifyRequests([snap("Not found", null)], NOW_MS)[0].action).toBe("stop-agent");
    expect(classifyRequests([snap("Pending", null)], NOW_MS)[0].action).toBe("stop-agent");
    expect(classifyRequests([snap("Cancelled", nowS)], NOW_MS)[0]).toMatchObject({ state: "cancelled", action: "inspect-onchain" });
    expect(shouldHaltNewOrders(classifyRequests([snap("Executed", nowS), snap("Pending", nowS - 10n)], NOW_MS))).toBe(false);
  });

  it("allows one scheduler run at a time until the lease expires", () => {
    expect(canAcquireLease(null, 1000)).toBe(true);
    expect(canAcquireLease({ holder: "w1", acquiredAtMs: 1000, ttlMs: 60_000 }, 30_000)).toBe(false);
    expect(canAcquireLease({ holder: "w1", acquiredAtMs: 1000, ttlMs: 60_000 }, 61_000)).toBe(true);
  });
});
