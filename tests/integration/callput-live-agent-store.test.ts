import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import golden from "../options/fixtures/callput-robinhood-venue-prepared-open.json";
import { DrizzleAuthRepository } from "../../lib/auth/drizzle-repository";
import { createDatabase, type DatabaseConnection } from "../../lib/db/client";
import { prepareCallPutOpenSpread, type CallPutOpenSpreadPlan, type CallPutWalletState } from "../../lib/venue/callput-robinhood-write";
import type { CallPutRobinhoodMarketData, CallPutRobinhoodOptionMark } from "../../lib/venue/callput-robinhood-readonly";
import type { CallPutRobinhoodRequestSnapshot } from "../../lib/venue/callput-robinhood-requests";
import {
  LIVE_AGENT_HARD_CAPS,
  acquireLiveAgentLease,
  activateLiveAgentGrant,
  advanceLiveAgentRequest,
  getLiveAgentControl,
  getLiveAgentGrant,
  listLiveAgentRequests,
  loadLiveAgentState,
  proposeLiveAgentGrant,
  recordLiveAgentEvidence,
  reconcileLiveAgentRequests,
  releaseLiveAgentLease,
  reserveAuthorizedLiveAgentOrder,
  resumeLiveAgent,
  revokeLiveAgentGrant,
  stopLiveAgent,
  type ProposeLiveAgentGrantInput,
} from "../../lib/venue/callput-live-agent-store";

const WALLET = "0x000000000000000000000000000000000000dEaD" as Address;
const OTHER = "0xfa0426d7ad93f4f1e990bd4c1103c771344ada17" as Address;
const f = golden.feed;
const EXPIRY_MS = f.expiry * 1000;
const NOW = new Date(EXPIRY_MS - 10 * 86_400_000);
const LIVE_ENV = { LIVE_TRADING_ENABLED: "true" };
const HASH_A = `0x${"a1".repeat(32)}` as Hex;
const HASH_B = `0x${"b2".repeat(32)}` as Hex;
const KEY_A = `0x${"c3".repeat(32)}` as Hex;
const FULL_EVIDENCE = {
  venueDelegationConfirmedRef: "CallPut written confirmation 2026-11-21",
  onchainGrantRef: "0x" + "d4".repeat(32),
  auditRef: "Independent audit report SHA-256 e5e5",
  ownerApprovalRef: "Owner approval record",
  revocationTested: true,
};

function leg(id: Hex, strike: number, mark: number, rp: number): CallPutRobinhoodOptionMark {
  return {
    underlyingSymbol: "AAPL", side: "put", instrument: `AAPL-${strike}`, optionId: id, expiryTimestamp: f.expiry,
    strikePriceRaw: strike, markPriceRaw: mark, markIvRaw: 0.3, riskPremiumRateForBuy: rp, riskPremiumRateForSell: rp,
    delta: 0, gamma: 0, vega: 0, theta: 0, marketAvailable: true, quoteType: "indicative",
  };
}
const market: CallPutRobinhoodMarketData = {
  venue: "callput", network: "robinhood", chainId: 4663, sourceUrl: "https://app-data-robinhood.s3.ap-southeast-1.amazonaws.com/market-data.json",
  timestampMs: NOW.getTime() - 10_000, lastUpdatedAt: new Date(NOW.getTime() - 10_000).toISOString(), feedVersion: 1,
  spotIndexRaw: { AAPL: f.spot }, futuresIndexRaw: {},
  options: [leg(golden.request.longOptionId as Hex, f.long.strike, f.long.mark, f.long.rpBuy), leg(golden.request.shortOptionId as Hex, f.short.strike, f.short.mark, f.short.rpBuy)],
};
const wallet: CallPutWalletState = { chainId: 4663, account: WALLET, usdgBalanceRaw: 5_000_000n, usdgAllowanceRaw: 0n, nativeBalanceWei: 10n ** 16n, executionFeeWei: 60_000_000_000_000n };
const plan = (): CallPutOpenSpreadPlan => prepareCallPutOpenSpread({ strategy: "BuyPutSpread", underlying: "AAPL", longOptionId: golden.request.longOptionId as Hex, shortOptionId: golden.request.shortOptionId as Hex, size: golden.request.size, market, wallet, nowMs: NOW.getTime() });

const proposal = (overrides: Partial<ProposeLiveAgentGrantInput> = {}): ProposeLiveAgentGrantInput => ({
  ownerAddress: WALLET,
  tradingAddress: WALLET,
  agentId: "agent-1",
  route: "direct-wallet",
  expiresAtMs: NOW.getTime() + 86_400_000,
  policy: {
    allowedUnderlyings: ["AAPL"], allowedStrategies: ["BuyPutSpread"],
    maxCollateralPerOrderRaw: "10000000", maxOpenCollateralRaw: "25000000", maxDailyCollateralRaw: "25000000",
    maxOrdersPerDay: 2, maxPendingRequests: 1, maxExecutionFeeWei: "300000000000000", minExpiryDays: 3, maxExpiryDays: 45,
  },
  ...overrides,
});

describe("durable CallPut Live Agent store", () => {
  let rootDir: string | undefined;
  const open: DatabaseConnection[] = [];

  afterEach(async () => {
    for (const connection of open.splice(0)) await connection.close();
    if (rootDir) rmSync(rootDir, { recursive: true, force: true });
    rootDir = undefined;
  });

  async function setup() {
    rootDir = mkdtempSync(join(tmpdir(), "optra-live-agent-"));
    const connection = await createDatabase({ dataDir: join(rootDir, "db"), nodeEnv: "test" });
    open.push(connection);
    const auth = new DrizzleAuthRepository(connection.db);
    const owner = await auth.findOrCreateUser(WALLET);
    const stranger = await auth.findOrCreateUser(OTHER);
    return { connection, db: connection.db, ownerId: owner.id, strangerId: stranger.id };
  }

  async function activeGrant(db: DatabaseConnection["db"], ownerId: string) {
    const grant = await proposeLiveAgentGrant(db, ownerId, proposal(), NOW);
    await recordLiveAgentEvidence(db, ownerId, grant.id, FULL_EVIDENCE, NOW);
    const result = await activateLiveAgentGrant(db, ownerId, grant.id, NOW);
    expect(result.activated).toBe(true);
    return grant;
  }

  async function readyToOrder(db: DatabaseConnection["db"], ownerId: string) {
    const grant = await activeGrant(db, ownerId);
    expect((await resumeLiveAgent(db, ownerId, NOW, LIVE_ENV)).resumed).toBe(true);
    expect(await acquireLiveAgentLease(db, ownerId, "worker-1", 60_000, NOW)).toBe(true);
    return grant;
  }

  const order = (grantId: string, ownerId: string, tickId = "tick-1", env: Record<string, string | undefined> = LIVE_ENV, holder = "worker-1") =>
    ({ ownerId, grantId, agentId: "agent-1", tickId, holder, plan: plan(), now: NOW, env });

  it("is stopped by default and a proposed grant cannot trade", async () => {
    const { db, ownerId } = await setup();
    expect(await getLiveAgentControl(db, ownerId)).toMatchObject({ stopped: true });
    const grant = await proposeLiveAgentGrant(db, ownerId, proposal(), NOW);
    expect(grant.status).toBe("proposed");
    const result = await reserveAuthorizedLiveAgentOrder(db, order(grant.id, ownerId));
    expect(result.allowed).toBe(false);
    expect(result.checks.filter((c) => !c.ok).map((c) => c.id)).toEqual(expect.arrayContaining(["grant-active", "autonomy-evidence", "durable-stop", "lease"]));
    expect(await listLiveAgentRequests(db, ownerId)).toHaveLength(0);
  });

  it("refuses activation until all five autonomy evidence items are recorded", async () => {
    const { db, ownerId } = await setup();
    const grant = await proposeLiveAgentGrant(db, ownerId, proposal(), NOW);
    const none = await activateLiveAgentGrant(db, ownerId, grant.id, NOW);
    expect(none.activated).toBe(false);
    expect(none.blockers.map((b) => b.id).sort()).toEqual(["audit", "onchain-grant", "owner-approval", "revocation", "venue-delegation"]);
    await recordLiveAgentEvidence(db, ownerId, grant.id, { venueDelegationConfirmedRef: "CallPut written confirmation", onchainGrantRef: "0xgrant-tx", auditRef: "audit-1", ownerApprovalRef: "owner-1" }, NOW);
    const partial = await activateLiveAgentGrant(db, ownerId, grant.id, NOW);
    expect(partial.blockers.map((b) => b.id)).toEqual(["revocation"]);
    expect((await getLiveAgentGrant(db, ownerId, grant.id))?.status).toBe("proposed");
  });

  it("rejects grants beyond the hard caps, the 30-day lifetime, unknown assets and extra fields", async () => {
    const { db, ownerId } = await setup();
    const over = proposal();
    await expect(proposeLiveAgentGrant(db, ownerId, { ...over, policy: { ...over.policy, maxCollateralPerOrderRaw: String(LIVE_AGENT_HARD_CAPS.maxCollateralPerOrderRaw + 1n) } }, NOW)).rejects.toThrow();
    await expect(proposeLiveAgentGrant(db, ownerId, { ...over, policy: { ...over.policy, maxOrdersPerDay: 6 } }, NOW)).rejects.toThrow();
    await expect(proposeLiveAgentGrant(db, ownerId, { ...over, policy: { ...over.policy, maxPendingRequests: 2 } }, NOW)).rejects.toThrow();
    await expect(proposeLiveAgentGrant(db, ownerId, { ...over, policy: { ...over.policy, maxExecutionFeeWei: "300000000000001" } }, NOW)).rejects.toThrow();
    await expect(proposeLiveAgentGrant(db, ownerId, { ...over, policy: { ...over.policy, allowedUnderlyings: ["DOGE"] } }, NOW)).rejects.toThrow();
    await expect(proposeLiveAgentGrant(db, ownerId, { ...over, expiresAtMs: NOW.getTime() + LIVE_AGENT_HARD_CAPS.maxGrantLifetimeMs + 1 }, NOW)).rejects.toThrow(/30-day/);
    await expect(proposeLiveAgentGrant(db, ownerId, { ...over, expiresAtMs: NOW.getTime() - 1 }, NOW)).rejects.toThrow(/future/);
    await expect(proposeLiveAgentGrant(db, ownerId, { ...over, policy: { ...over.policy, extra: 1 } } as unknown as ProposeLiveAgentGrantInput, NOW)).rejects.toThrow();
    await expect(proposeLiveAgentGrant(db, ownerId, { ...over, tradingAddress: "0x123" }, NOW)).rejects.toThrow();
  });

  it("isolates owners: another user cannot read, evidence, activate or revoke a grant", async () => {
    const { db, ownerId, strangerId } = await setup();
    const grant = await proposeLiveAgentGrant(db, ownerId, proposal(), NOW);
    expect(await getLiveAgentGrant(db, strangerId, grant.id)).toBeNull();
    expect(await recordLiveAgentEvidence(db, strangerId, grant.id, FULL_EVIDENCE, NOW)).toBeNull();
    expect((await activateLiveAgentGrant(db, strangerId, grant.id, NOW)).activated).toBe(false);
    expect(await revokeLiveAgentGrant(db, strangerId, grant.id, NOW)).toBe(false);
    expect((await getLiveAgentGrant(db, ownerId, grant.id))?.evidence.auditRef).toBeNull();
    const own = await reserveAuthorizedLiveAgentOrder(db, order(grant.id, strangerId));
    expect(own.allowed).toBe(false);
    expect(own.checks.find((c) => c.id === "grant-found")?.ok).toBe(false);
  });

  it("only resumes when the flag, an active grant and the evidence are all present", async () => {
    const { db, ownerId } = await setup();
    expect((await resumeLiveAgent(db, ownerId, NOW, {})).resumed).toBe(false);
    const grant = await activeGrant(db, ownerId);
    const noFlag = await resumeLiveAgent(db, ownerId, NOW, {});
    expect(noFlag.resumed).toBe(false);
    expect(noFlag.reasons.join(" ")).toMatch(/LIVE_TRADING_ENABLED/);
    expect((await getLiveAgentControl(db, ownerId)).stopped).toBe(true);
    const expired = await resumeLiveAgent(db, ownerId, new Date(NOW.getTime() + 2 * 86_400_000), LIVE_ENV);
    expect(expired.resumed).toBe(false);
    expect((await resumeLiveAgent(db, ownerId, NOW, LIVE_ENV)).resumed).toBe(true);
    expect((await getLiveAgentControl(db, ownerId)).stopped).toBe(false);
    expect(grant.id).toBeTruthy();
  });

  it("authorizes and reserves one in-policy order, and replays the same decision without a second row", async () => {
    const { db, ownerId } = await setup();
    const grant = await readyToOrder(db, ownerId);
    const first = await reserveAuthorizedLiveAgentOrder(db, order(grant.id, ownerId));
    expect(first.checks.filter((c) => !c.ok)).toEqual([]);
    expect(first).toMatchObject({ allowed: true, replay: false });
    expect(first.request?.state).toBe("reserved");
    const replay = await reserveAuthorizedLiveAgentOrder(db, order(grant.id, ownerId));
    expect(replay).toMatchObject({ allowed: false, replay: true });
    expect(replay.request?.id).toBe(first.request?.id);
    expect(await listLiveAgentRequests(db, ownerId)).toHaveLength(1);
  });

  it("blocks every order when LIVE_TRADING_ENABLED is not true, whatever else is configured", async () => {
    const { db, ownerId } = await setup();
    const grant = await readyToOrder(db, ownerId);
    for (const env of [{}, { LIVE_TRADING_ENABLED: "false" }, { LIVE_TRADING_ENABLED: "1" }, { LIVE_TRADING_ENABLED: "TRUE" }]) {
      const result = await reserveAuthorizedLiveAgentOrder(db, order(grant.id, ownerId, "tick-flag", env));
      expect(result.allowed).toBe(false);
      expect(result.checks.find((c) => c.id === "live-flag")?.ok).toBe(false);
    }
    expect(await listLiveAgentRequests(db, ownerId)).toHaveLength(0);
  });

  it("blocks on the durable stop, a revoked grant, an expired grant and a process kill switch", async () => {
    const { db, ownerId } = await setup();
    const grant = await readyToOrder(db, ownerId);
    await stopLiveAgent(db, ownerId, "operator stop", NOW);
    const stopped = await reserveAuthorizedLiveAgentOrder(db, order(grant.id, ownerId, "t1"));
    expect(stopped.allowed).toBe(false);
    expect(stopped.checks.find((c) => c.id === "durable-stop")?.detail).toMatch(/operator stop/);
    expect((await resumeLiveAgent(db, ownerId, NOW, LIVE_ENV)).resumed).toBe(true);
    const killed = await reserveAuthorizedLiveAgentOrder(db, order(grant.id, ownerId, "t2", { ...LIVE_ENV, LIVE_AGENT_KILL_SWITCH: "true" }));
    expect(killed.allowed).toBe(false);
    expect(killed.checks.find((c) => c.id === "kill-switch")?.ok).toBe(false);
    const late = await reserveAuthorizedLiveAgentOrder(db, { ...order(grant.id, ownerId, "t3"), now: new Date(NOW.getTime() + 2 * 86_400_000) });
    expect(late.allowed).toBe(false);
    expect(late.checks.find((c) => c.id === "grant-live")?.ok).toBe(false);
    expect(await revokeLiveAgentGrant(db, ownerId, grant.id, NOW)).toBe(true);
    expect((await getLiveAgentControl(db, ownerId)).stopped).toBe(true);
    const revoked = await reserveAuthorizedLiveAgentOrder(db, order(grant.id, ownerId, "t4"));
    expect(revoked.allowed).toBe(false);
    expect(revoked.checks.find((c) => c.id === "grant-active")?.ok).toBe(false);
    expect(await listLiveAgentRequests(db, ownerId)).toHaveLength(0);
  });

  it("enforces single-flight: one lease holder, takeover only after expiry, release only by the holder", async () => {
    const { db, ownerId } = await setup();
    expect(await acquireLiveAgentLease(db, ownerId, "worker-1", 60_000, NOW)).toBe(true);
    expect(await acquireLiveAgentLease(db, ownerId, "worker-2", 60_000, NOW)).toBe(false);
    expect(await acquireLiveAgentLease(db, ownerId, "worker-1", 60_000, NOW)).toBe(true);
    expect(await releaseLiveAgentLease(db, ownerId, "worker-2")).toBe(false);
    expect(await acquireLiveAgentLease(db, ownerId, "worker-2", 60_000, new Date(NOW.getTime() + 60_000))).toBe(true);
    expect(await releaseLiveAgentLease(db, ownerId, "worker-2")).toBe(true);
    await expect(acquireLiveAgentLease(db, ownerId, "", 60_000, NOW)).rejects.toThrow();
    await expect(acquireLiveAgentLease(db, ownerId, "w", 11 * 60_000, NOW)).rejects.toThrow();
  });

  it("refuses an order from a caller without the lease", async () => {
    const { db, ownerId } = await setup();
    const grant = await readyToOrder(db, ownerId);
    const result = await reserveAuthorizedLiveAgentOrder(db, order(grant.id, ownerId, "tick-x", LIVE_ENV, "intruder"));
    expect(result.allowed).toBe(false);
    expect(result.checks.find((c) => c.id === "lease")?.ok).toBe(false);
  });

  it("never lets concurrent identical decisions create two requests", async () => {
    const { db, ownerId } = await setup();
    const grant = await readyToOrder(db, ownerId);
    const results = await Promise.all([1, 2, 3, 4].map(() => reserveAuthorizedLiveAgentOrder(db, order(grant.id, ownerId, "tick-race"))));
    expect(results.filter((r) => r.allowed)).toHaveLength(1);
    expect(await listLiveAgentRequests(db, ownerId)).toHaveLength(1);
  });

  it("holds the per-day order count and pending-request cap across different decisions", async () => {
    const { db, ownerId } = await setup();
    const grant = await readyToOrder(db, ownerId);
    const first = await reserveAuthorizedLiveAgentOrder(db, order(grant.id, ownerId, "tick-a"));
    expect(first.allowed).toBe(true);
    const second = await reserveAuthorizedLiveAgentOrder(db, order(grant.id, ownerId, "tick-b"));
    expect(second.allowed).toBe(false);
    expect(second.checks.find((c) => c.id === "pending-requests")?.ok).toBe(false);
    expect(await listLiveAgentRequests(db, ownerId)).toHaveLength(1);
  });

  it("allows only monotonic request transitions and never rewrites recorded evidence", async () => {
    const { db, ownerId } = await setup();
    const grant = await readyToOrder(db, ownerId);
    const reserved = (await reserveAuthorizedLiveAgentOrder(db, order(grant.id, ownerId))).request!;
    await expect(advanceLiveAgentRequest(db, ownerId, reserved.id, { state: "executed", requestKey: KEY_A }, NOW)).rejects.toThrow(/Illegal/);
    await expect(advanceLiveAgentRequest(db, ownerId, reserved.id, { state: "submitted" }, NOW)).rejects.toThrow(/transaction hash/);
    await advanceLiveAgentRequest(db, ownerId, reserved.id, { state: "submitted", transactionHash: HASH_A }, NOW);
    await expect(advanceLiveAgentRequest(db, ownerId, reserved.id, { state: "pending" }, NOW)).rejects.toThrow(/request key/);
    await expect(advanceLiveAgentRequest(db, ownerId, reserved.id, { state: "pending", requestKey: "0x12" }, NOW)).rejects.toThrow();
    await advanceLiveAgentRequest(db, ownerId, reserved.id, { state: "pending", requestKey: KEY_A }, NOW);
    await expect(advanceLiveAgentRequest(db, ownerId, reserved.id, { state: "executed", transactionHash: HASH_B }, NOW)).rejects.toThrow(/cannot change/);
    const executed = await advanceLiveAgentRequest(db, ownerId, reserved.id, { state: "executed" }, NOW);
    expect(executed).toMatchObject({ state: "executed", transactionHash: HASH_A, requestKey: KEY_A });
    await expect(advanceLiveAgentRequest(db, ownerId, reserved.id, { state: "pending" }, NOW)).rejects.toThrow(/Illegal/);
    await expect(advanceLiveAgentRequest(db, "00000000-0000-4000-8000-000000000000", reserved.id, { state: "closed" }, NOW)).rejects.toThrow(/not found/);
    const state = await loadLiveAgentState(db, ownerId, NOW, LIVE_ENV);
    expect(state.openCollateralRaw).toBe(plan().quote.amountInRaw);
    expect(state.pendingRequests).toBe(0);
  });

  it("halts durably when a tracked request is stale, and stays halted across a database reopen", async () => {
    rootDir = mkdtempSync(join(tmpdir(), "optra-live-agent-"));
    const dataDir = join(rootDir, "db");
    const first = await createDatabase({ dataDir, nodeEnv: "test" });
    open.push(first);
    const owner = await new DrizzleAuthRepository(first.db).findOrCreateUser(WALLET);
    const grant = await readyToOrder(first.db, owner.id);
    const reserved = (await reserveAuthorizedLiveAgentOrder(first.db, order(grant.id, owner.id))).request!;
    await advanceLiveAgentRequest(first.db, owner.id, reserved.id, { state: "submitted", transactionHash: HASH_A }, NOW);
    await advanceLiveAgentRequest(first.db, owner.id, reserved.id, { state: "pending", requestKey: KEY_A }, NOW);
    const submittedAt = BigInt(Math.floor(NOW.getTime() / 1000) - 3_600);
    const snapshot = { requestKey: KEY_A, kind: "open", status: "Pending", submittedAt } as unknown as CallPutRobinhoodRequestSnapshot;
    const result = await reconcileLiveAgentRequests(first.db, owner.id, [snapshot], NOW);
    expect(result).toEqual({ halted: true, changed: 1 });
    expect((await listLiveAgentRequests(first.db, owner.id))[0]?.state).toBe("stale");
    expect((await resumeLiveAgent(first.db, owner.id, NOW, LIVE_ENV)).reasons.join(" ")).toMatch(/stale or unknown/);
    await first.close();
    open.splice(open.indexOf(first), 1);

    const second = await createDatabase({ dataDir, nodeEnv: "test" });
    open.push(second);
    expect((await getLiveAgentControl(second.db, owner.id)).stopped).toBe(true);
    const blocked = await reserveAuthorizedLiveAgentOrder(second.db, order(grant.id, owner.id, "tick-after-restart"));
    expect(blocked.allowed).toBe(false);
    expect(blocked.checks.find((c) => c.id === "request-health")?.ok).toBe(false);
  });

  it("treats a tracked key with no on-chain snapshot, and a submitted transaction with no key, as unknown", async () => {
    const { db, ownerId } = await setup();
    const grant = await readyToOrder(db, ownerId);
    const reserved = (await reserveAuthorizedLiveAgentOrder(db, order(grant.id, ownerId))).request!;
    await advanceLiveAgentRequest(db, ownerId, reserved.id, { state: "submitted", transactionHash: HASH_A }, NOW);
    const lateNow = new Date(NOW.getTime() + LIVE_AGENT_HARD_CAPS.maxUnkeyedRequestAgeMs + 1);
    expect(await reconcileLiveAgentRequests(db, ownerId, [], lateNow)).toEqual({ halted: true, changed: 1 });
    expect((await listLiveAgentRequests(db, ownerId))[0]?.state).toBe("unknown");

    const executedSnapshot = { requestKey: KEY_A, kind: "open", status: "Executed", submittedAt: 1n } as unknown as CallPutRobinhoodRequestSnapshot;
    await advanceLiveAgentRequest(db, ownerId, reserved.id, { state: "pending", requestKey: KEY_A }, lateNow);
    expect(await reconcileLiveAgentRequests(db, ownerId, [executedSnapshot], lateNow)).toEqual({ halted: false, changed: 1 });
    expect((await listLiveAgentRequests(db, ownerId))[0]?.state).toBe("executed");
  });
});
