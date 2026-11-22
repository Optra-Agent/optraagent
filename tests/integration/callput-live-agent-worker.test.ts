import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import golden from "../options/fixtures/callput-robinhood-venue-prepared-open.json";
import { DrizzleAuthRepository } from "../../lib/auth/drizzle-repository";
import { createDatabase, type DatabaseConnection } from "../../lib/db/client";
import type { Session } from "../../lib/domain/contracts";
import { prepareCallPutOpenSpread, type CallPutOpenSpreadPlan, type CallPutWalletState } from "../../lib/venue/callput-robinhood-write";
import type { CallPutRobinhoodMarketData, CallPutRobinhoodOptionMark } from "../../lib/venue/callput-robinhood-readonly";
import type { CallPutRobinhoodRequestSnapshot } from "../../lib/venue/callput-robinhood-requests";
import {
  acquireLiveAgentLease,
  activateLiveAgentGrant,
  getLiveAgentControl,
  listLiveAgentRequests,
  proposeLiveAgentGrant,
  recordLiveAgentEvidence,
  resumeLiveAgent,
  revokeLiveAgentGrant,
  type ProposeLiveAgentGrantInput,
} from "../../lib/venue/callput-live-agent-store";
import { NotBroadcastError, runLiveAgentTick, type LiveAgentSubmitter } from "../../lib/venue/callput-live-agent-worker";
import { runLiveAgentSchedule } from "../../lib/venue/callput-live-agent-scheduler";
import { createPaperDecisionSource } from "../../lib/venue/callput-live-agent-signal";
import { agents, paperDecisions } from "../../db/schema";
import { createLiveAgentHandlers } from "../../lib/venue/callput-live-agent-handlers";

const WALLET = "0x000000000000000000000000000000000000dEaD" as Address;
const OTHER = "0xfa0426d7ad93f4f1e990bd4c1103c771344ada17" as Address;
const f = golden.feed;
const NOW = new Date(f.expiry * 1000 - 10 * 86_400_000);
const ENV = { LIVE_TRADING_ENABLED: "true" };
const HASH = `0x${"a1".repeat(32)}` as Hex;
const KEY = `0x${"c3".repeat(32)}` as Hex;
const EVIDENCE = {
  venueDelegationConfirmedRef: "CallPut written confirmation", onchainGrantRef: "0x" + "d4".repeat(32),
  auditRef: "Independent audit report", ownerApprovalRef: "Owner approval record", revocationTested: true,
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
  ownerAddress: WALLET, tradingAddress: WALLET, agentId: "agent-1", route: "direct-wallet", expiresAtMs: NOW.getTime() + 86_400_000,
  policy: {
    allowedUnderlyings: ["AAPL"], allowedStrategies: ["BuyPutSpread"],
    maxCollateralPerOrderRaw: "10000000", maxOpenCollateralRaw: "25000000", maxDailyCollateralRaw: "25000000",
    maxOrdersPerDay: 2, maxPendingRequests: 1, maxExecutionFeeWei: "300000000000000", minExpiryDays: 3, maxExpiryDays: 45,
  },
  ...overrides,
});

const pendingSnapshot = (ageSeconds = 10): CallPutRobinhoodRequestSnapshot =>
  ({ requestKey: KEY, kind: "open", status: "Pending", submittedAt: BigInt(Math.floor(NOW.getTime() / 1000) - ageSeconds) }) as unknown as CallPutRobinhoodRequestSnapshot;
const executedSnapshot = (): CallPutRobinhoodRequestSnapshot => ({ requestKey: KEY, kind: "open", status: "Executed", submittedAt: 1n }) as unknown as CallPutRobinhoodRequestSnapshot;

describe("CallPut Live Agent worker, scheduler and owner controls", () => {
  let rootDir: string | undefined;
  const open: DatabaseConnection[] = [];

  afterEach(async () => {
    for (const connection of open.splice(0)) await connection.close();
    if (rootDir) rmSync(rootDir, { recursive: true, force: true });
    rootDir = undefined;
  });

  async function setup(dataDir?: string) {
    rootDir = rootDir ?? mkdtempSync(join(tmpdir(), "optra-live-worker-"));
    const connection = await createDatabase({ dataDir: dataDir ?? join(rootDir, "db"), nodeEnv: "test" });
    open.push(connection);
    const auth = new DrizzleAuthRepository(connection.db);
    const owner = await auth.findOrCreateUser(WALLET);
    const stranger = await auth.findOrCreateUser(OTHER);
    return { connection, db: connection.db, ownerId: owner.id, strangerId: stranger.id };
  }

  async function armed(db: DatabaseConnection["db"], ownerId: string, overrides: Partial<ProposeLiveAgentGrantInput> = {}) {
    const grant = await proposeLiveAgentGrant(db, ownerId, proposal(overrides), NOW);
    await recordLiveAgentEvidence(db, ownerId, grant.id, EVIDENCE, NOW);
    expect((await activateLiveAgentGrant(db, ownerId, grant.id, NOW)).activated).toBe(true);
    expect((await resumeLiveAgent(db, ownerId, NOW, ENV)).resumed).toBe(true);
    return grant;
  }

  const GATES_PASS = { allPass: true, gates: [], evaluatedAt: NOW.toISOString() };

  const tick = (db: DatabaseConnection["db"], ownerId: string, grantId: string, extra: Partial<Parameters<typeof runLiveAgentTick>[0]> = {}) =>
    runLiveAgentTick({ db, ownerId, grantId, agentId: "agent-1", tickId: "tick-1", holder: "worker-1", now: NOW, env: ENV, preparePlan: async () => plan(), readSnapshots: async () => [], gates: async () => GATES_PASS, ...extra });

  const countingSubmitter = (behavior: () => Promise<{ transactionHash: Hex; requestKey?: Hex }>): LiveAgentSubmitter & { calls: number } => {
    const submitter = { calls: 0, submit: async () => { submitter.calls += 1; return behavior(); } };
    return submitter;
  };

  it("does no work at all while LIVE_TRADING_ENABLED is not true", async () => {
    const { db, ownerId } = await setup();
    const grant = await armed(db, ownerId);
    for (const env of [{}, { LIVE_TRADING_ENABLED: "false" }]) {
      const result = await tick(db, ownerId, grant.id, { env });
      expect(result.status).toBe("disabled");
    }
    expect(await listLiveAgentRequests(db, ownerId)).toHaveLength(0);
    expect(await acquireLiveAgentLease(db, ownerId, "someone-else", 1_000, NOW)).toBe(true);
  });

  it("reports no-trade without a plan, and releases the lease after every tick", async () => {
    const { db, ownerId } = await setup();
    const grant = await armed(db, ownerId);
    expect((await tick(db, ownerId, grant.id, { preparePlan: async () => null })).status).toBe("no-trade");
    expect(await acquireLiveAgentLease(db, ownerId, "someone-else", 1_000, NOW)).toBe(true);
  });

  it("scheduler: a decision becomes exactly one order, and the same decision an hour later is a replay, not a second order", async () => {
    const { db, ownerId } = await setup();
    const grant = await armed(db, ownerId);
    const submitter = countingSubmitter(async () => ({ transactionHash: `0x${"ab".repeat(32)}` as Hex, requestKey: `0x${"cd".repeat(32)}` as Hex }));
    const decisionSource = async () => ({ decisionId: "decision-1", prepare: async () => plan() });
    const common = { db, env: ENV, readSnapshots: async () => [], submitter, gates: async () => GATES_PASS, decisionSource };
    const first = await runLiveAgentSchedule({ ...common, now: NOW, runId: "run-1" });
    expect(first.results.map((r) => [r.grantId, r.status])).toEqual([[grant.id, "submitted"]]);
    // Request key is tracked and the chain snapshot says Pending, so the next pass reconciles it and does not halt.
    const pending = { requestKey: `0x${"cd".repeat(32)}` as Hex, kind: "open" as const, status: "Pending" as const, account: WALLET, underlyingAssetIndex: null, expiry: null, optionTokenId: null, minSize: null, amountIn: null, minOutWhenSwap: null, size: null, minAmountOut: null, sizeOut: null, amountOut: null, executionPrice: null, submittedAt: BigInt(Math.floor((NOW.getTime() + 3_600_000) / 1000) - 30), processedAt: null, nativeTokenHandling: null };
    const later = await runLiveAgentSchedule({ ...common, readSnapshots: async () => [pending], now: new Date(NOW.getTime() + 3_600_000), runId: "run-2" });
    expect(later.results[0]?.status).toBe("replayed");
    expect(submitter.calls).toBe(1);
  });

  it("scheduler: a decision source that throws means no decision this tick, never an order", async () => {
    const { db, ownerId } = await setup();
    await armed(db, ownerId);
    const submitter = countingSubmitter(async () => ({ transactionHash: `0x${"ab".repeat(32)}` as Hex }));
    const ran = await runLiveAgentSchedule({ db, now: NOW, env: ENV, readSnapshots: async () => [], submitter, gates: async () => GATES_PASS, decisionSource: async () => { throw new Error("db down"); } });
    expect(ran.results[0]?.status).toBe("no-trade");
    expect(submitter.calls).toBe(0);
  });

  describe("paper decision source", () => {
    async function seed(db: DatabaseConnection["db"], ownerId: string, template: string, actions: Array<{ action: string; ageMs: number }>) {
      const [agent] = await db.insert(agents).values({ ownerId, name: "Seeded", templateId: template, status: "running", recipe: { underlyingSymbol: "NVDA" } as never, recipeHash: `sha256:${"2".repeat(64)}`, launchedAt: NOW }).returning({ id: agents.id });
      for (const [index, entry] of actions.entries()) {
        await db.insert(paperDecisions).values({ id: `d-${index}-${agent!.id}`, agentId: agent!.id, tickId: `t-${index}`, action: entry.action, reason: "test", hookResults: [], snapshotSource: "test", recipeHash: `sha256:${"2".repeat(64)}`, createdAt: new Date(NOW.getTime() - entry.ageMs) });
      }
      return agent!.id;
    }

    it("is inert without the owner's approval reference, even when a mappable decision exists", async () => {
      const { db, ownerId } = await setup();
      const agentId = await seed(db, ownerId, "protective_put", [{ action: "open", ageMs: 60_000 }]);
      const grant = await armed(db, ownerId, { agentId });
      const source = (env: Record<string, string>) => createPaperDecisionSource({ db, client: {} as never, env });
      expect(await source({})(({ ownerId, agentId, grantId: grant.id }), NOW)).toBeNull();
      expect(await source({ LIVE_MAPPING_APPROVAL_REF: "  " })(({ ownerId, agentId, grantId: grant.id }), NOW)).toBeNull();
      const found = await source({ LIVE_MAPPING_APPROVAL_REF: "owner-2026-12-01" })({ ownerId, agentId, grantId: grant.id }, NOW);
      expect(found?.decisionId).toContain(`d-0-${agentId}`);
    });

    it("ignores stale, non-open and unmappable decisions", async () => {
      const { db, ownerId } = await setup();
      const env = { LIVE_MAPPING_APPROVAL_REF: "owner-ref" };
      const stale = await seed(db, ownerId, "protective_put", [{ action: "open", ageMs: 3 * 3_600_000 }]);
      const hold = await seed(db, ownerId, "protective_put", [{ action: "hold", ageMs: 60_000 }, { action: "close", ageMs: 30_000 }]);
      const covered = await seed(db, ownerId, "covered_call", [{ action: "open", ageMs: 60_000 }]);
      const grant = await armed(db, ownerId, { agentId: stale });
      const source = createPaperDecisionSource({ db, client: {} as never, env });
      for (const agentId of [stale, hold, covered]) expect(await source({ ownerId, agentId, grantId: grant.id }, NOW)).toBeNull();
    });
  });

  it("allows one live agent per owner: a second agent's grant cannot be activated while the first is active", async () => {
    const { db, ownerId } = await setup();
    await armed(db, ownerId);
    const second = await proposeLiveAgentGrant(db, ownerId, proposal({ agentId: "agent-2" }), NOW);
    await recordLiveAgentEvidence(db, ownerId, second.id, EVIDENCE, NOW);
    const result = await activateLiveAgentGrant(db, ownerId, second.id, NOW);
    expect(result.activated).toBe(false);
    expect(result.blockers.map((blocker) => blocker.id)).toEqual(["one-live-agent"]);
  });

  it("asks for no plan and sends nothing while any PM gate fails, or when the gates cannot be evaluated", async () => {
    const { db, ownerId } = await setup();
    const grant = await armed(db, ownerId);
    const submitter = countingSubmitter(async () => ({ transactionHash: `0x${"ab".repeat(32)}` as Hex }));
    let planAsked = 0;
    const preparePlan = async () => { planAsked += 1; return plan(); };
    const failing = { allPass: false, evaluatedAt: NOW.toISOString(), gates: [{ id: "G6" as const, title: "Paper history", pass: false, detail: "0 of 7 paper days", remediation: "wait", evidence: [] }] };
    const closed = await tick(db, ownerId, grant.id, { preparePlan, submitter, gates: async () => failing });
    expect(closed.status).toBe("gated");
    expect(closed.detail).toContain("G6");
    const unreadable = await tick(db, ownerId, grant.id, { preparePlan, submitter, gates: async () => { throw new Error("db down"); } });
    expect(unreadable.status).toBe("gated");
    expect(planAsked).toBe(0);
    expect(submitter.calls).toBe(0);
    expect((await listLiveAgentRequests(db, ownerId)).length).toBe(0);
  });

  it("authorizes but never submits without a verified route: the reservation is released", async () => {
    const { db, ownerId } = await setup();
    const grant = await armed(db, ownerId);
    const result = await tick(db, ownerId, grant.id);
    expect(result.status).toBe("no-submission-route");
    const requests = await listLiveAgentRequests(db, ownerId);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.state).toBe("cancelled");
    expect(requests[0]?.transactionHash).toBeNull();
  });

  it("submits through a supplied route, tracks the request key, and never double-submits a duplicate tick", async () => {
    const { db, ownerId } = await setup();
    const grant = await armed(db, ownerId);
    const submitter = countingSubmitter(async () => ({ transactionHash: HASH, requestKey: KEY }));
    const first = await tick(db, ownerId, grant.id, { submitter });
    expect(first.status).toBe("submitted");
    expect((await listLiveAgentRequests(db, ownerId))[0]).toMatchObject({ state: "pending", transactionHash: HASH, requestKey: KEY });
    const again = await tick(db, ownerId, grant.id, { submitter, readSnapshots: async () => [pendingSnapshot()] });
    expect(again.status).toBe("replayed");
    expect(submitter.calls).toBe(1);
    expect(await listLiveAgentRequests(db, ownerId)).toHaveLength(1);
  });

  it("treats an ambiguous submission failure as unknown and stops the agent", async () => {
    const { db, ownerId } = await setup();
    const grant = await armed(db, ownerId);
    const submitter = countingSubmitter(async () => { throw new Error("socket hang up after send"); });
    expect((await tick(db, ownerId, grant.id, { submitter })).status).toBe("submission-unknown");
    expect((await listLiveAgentRequests(db, ownerId))[0]?.state).toBe("unknown");
    expect((await getLiveAgentControl(db, ownerId)).stopped).toBe(true);
    const next = await tick(db, ownerId, grant.id, { tickId: "tick-2", submitter });
    expect(next.status).toBe("halted");
    expect(submitter.calls).toBe(1);
  });

  it("cancels cleanly, without stopping, when the route proves nothing was broadcast", async () => {
    const { db, ownerId } = await setup();
    const grant = await armed(db, ownerId);
    const submitter = countingSubmitter(async () => { throw new NotBroadcastError("signer refused"); });
    expect((await tick(db, ownerId, grant.id, { submitter })).status).toBe("blocked");
    expect((await listLiveAgentRequests(db, ownerId))[0]?.state).toBe("cancelled");
    expect((await getLiveAgentControl(db, ownerId)).stopped).toBe(false);
  });

  it("fails closed on RPC failures: no snapshot read and no quote means no order and no guessed state", async () => {
    const { db, ownerId } = await setup();
    const grant = await armed(db, ownerId);
    const submitter = countingSubmitter(async () => ({ transactionHash: HASH, requestKey: KEY }));
    expect((await tick(db, ownerId, grant.id, { submitter, preparePlan: async () => { throw new Error("quote RPC down"); } })).status).toBe("rpc-failure");
    expect(await tick(db, ownerId, grant.id, { submitter, tickId: "tick-ok" })).toMatchObject({ status: "submitted" });
    const failed = await tick(db, ownerId, grant.id, { submitter, tickId: "tick-3", readSnapshots: async () => { throw new Error("RPC down"); } });
    expect(failed.status).toBe("rpc-failure");
    expect(submitter.calls).toBe(1);
    expect((await listLiveAgentRequests(db, ownerId))[0]?.state).toBe("pending");
    expect((await getLiveAgentControl(db, ownerId)).stopped).toBe(false);
  });

  it("enforces the owner's risk limits at tick time", async () => {
    const { db, ownerId } = await setup();
    const base = proposal();
    const grant = await armed(db, ownerId, { policy: { ...base.policy, maxCollateralPerOrderRaw: "1" } });
    const submitter = countingSubmitter(async () => ({ transactionHash: HASH, requestKey: KEY }));
    const result = await tick(db, ownerId, grant.id, { submitter });
    expect(result.status).toBe("blocked");
    expect(result.checks?.find((c) => c.id === "per-order-collateral")?.ok).toBe(false);
    expect(submitter.calls).toBe(0);
    expect(await listLiveAgentRequests(db, ownerId)).toHaveLength(0);
  });

  it("stops trading when the owner authorization expires", async () => {
    const { db, ownerId } = await setup();
    const grant = await armed(db, ownerId);
    const submitter = countingSubmitter(async () => ({ transactionHash: HASH, requestKey: KEY }));
    const result = await tick(db, ownerId, grant.id, { submitter, now: new Date(NOW.getTime() + 2 * 86_400_000) });
    expect(result.status).toBe("blocked");
    expect(result.checks?.find((c) => c.id === "grant-live")?.ok).toBe(false);
    expect(submitter.calls).toBe(0);
  });

  it("stops at once after revocation and cannot be resumed without a new active grant", async () => {
    const { db, ownerId } = await setup();
    const grant = await armed(db, ownerId);
    expect(await revokeLiveAgentGrant(db, ownerId, grant.id, NOW)).toBe(true);
    const submitter = countingSubmitter(async () => ({ transactionHash: HASH, requestKey: KEY }));
    expect((await tick(db, ownerId, grant.id, { submitter })).status).toBe("stopped");
    expect((await resumeLiveAgent(db, ownerId, NOW, ENV)).resumed).toBe(false);
    expect(submitter.calls).toBe(0);
  });

  it("reports lease-busy when another worker is mid-tick", async () => {
    const { db, ownerId } = await setup();
    const grant = await armed(db, ownerId);
    expect(await acquireLiveAgentLease(db, ownerId, "other-worker", 60_000, NOW)).toBe(true);
    expect((await tick(db, ownerId, grant.id)).status).toBe("lease-busy");
  });

  it("recovers after a process restart: a pending request reconciles to executed, and a stale one halts", async () => {
    rootDir = mkdtempSync(join(tmpdir(), "optra-live-worker-"));
    const dataDir = join(rootDir, "db");
    const first = await setup(dataDir);
    const grant = await armed(first.db, first.ownerId);
    const submitter = countingSubmitter(async () => ({ transactionHash: HASH, requestKey: KEY }));
    expect((await tick(first.db, first.ownerId, grant.id, { submitter })).status).toBe("submitted");
    await first.connection.close();
    open.splice(open.indexOf(first.connection), 1);

    const second = await setup(dataDir);
    const later = new Date(NOW.getTime() + 60_000);
    const settled = await tick(second.db, second.ownerId, grant.id, { now: later, tickId: "tick-after-restart", preparePlan: async () => null, readSnapshots: async () => [executedSnapshot()] });
    expect(settled.status).toBe("no-trade");
    expect((await listLiveAgentRequests(second.db, second.ownerId))[0]?.state).toBe("executed");

    // A second order is allowed (one execution today, cap two), then never resolves and must halt the agent.
    const KEY2 = `0x${"e5".repeat(32)}` as Hex;
    const second2 = await tick(second.db, second.ownerId, grant.id, { now: later, tickId: "tick-b", readSnapshots: async () => [executedSnapshot()], submitter: countingSubmitter(async () => ({ transactionHash: `0x${"b2".repeat(32)}` as Hex, requestKey: KEY2 })) });
    expect(second2.status).toBe("submitted");
    const veryLate = new Date(later.getTime() + 3_600_000);
    const stalePending = { requestKey: KEY2, kind: "open", status: "Pending", submittedAt: BigInt(Math.floor(later.getTime() / 1000)) } as unknown as CallPutRobinhoodRequestSnapshot;
    const halted = await tick(second.db, second.ownerId, grant.id, { now: veryLate, tickId: "tick-c", readSnapshots: async () => [stalePending] });
    expect(halted.status).toBe("halted");
    expect((await getLiveAgentControl(second.db, second.ownerId)).stopped).toBe(true);
    expect((await listLiveAgentRequests(second.db, second.ownerId)).find((r) => r.requestKey === KEY2)?.state).toBe("stale");
  });

  it("scheduler: disabled by default, skips revoked and expired grants, and never submits without a route", async () => {
    const { db, ownerId, strangerId } = await setup();
    const grant = await armed(db, ownerId);
    expect(await runLiveAgentSchedule({ db, now: NOW, env: {} })).toEqual({ status: "disabled", results: [] });

    const revoked = await proposeLiveAgentGrant(db, strangerId, proposal({ ownerAddress: OTHER, tradingAddress: OTHER, agentId: "agent-2" }), NOW);
    await recordLiveAgentEvidence(db, strangerId, revoked.id, EVIDENCE, NOW);
    await activateLiveAgentGrant(db, strangerId, revoked.id, NOW);
    await revokeLiveAgentGrant(db, strangerId, revoked.id, NOW);

    // Production path: the real database-backed G1–G7 evaluation. Nothing is satisfied here, so no plan is even requested.
    let planAsked = 0;
    const real = await runLiveAgentSchedule({ db, now: NOW, env: ENV, readSnapshots: async () => [], preparePlan: async () => { planAsked += 1; return plan(); } });
    expect(real.results.map((r) => [r.grantId, r.status])).toEqual([[grant.id, "gated"]]);
    expect(real.results[0]?.detail).toMatch(/G1.*G4.*G5.*G6.*G7/);
    expect(planAsked).toBe(0);

    const ran = await runLiveAgentSchedule({ db, now: NOW, env: ENV, readSnapshots: async () => [], preparePlan: async () => plan(), gates: async () => GATES_PASS });
    expect(ran.status).toBe("completed");
    expect(ran.results.map((r) => r.grantId)).toEqual([grant.id]);
    expect(ran.results[0]?.status).toBe("no-submission-route");

    const expired = await runLiveAgentSchedule({ db, now: new Date(NOW.getTime() + 3 * 86_400_000), env: ENV, readSnapshots: async () => [] });
    expect(expired.results).toEqual([]);
  });

  describe("owner controls", () => {
    const session = (id: string, address: Address): Session => ({ user: { id, address }, expiresAt: "2027-01-01T00:00:00.000Z" });
    const req = (method: string, body?: unknown) => new Request("https://optra.invalid/api/venue/callput/live-agent", { method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });

    it("proposes only, enforces hard limits, isolates owners, and always allows stop and revoke", async () => {
      const { db, ownerId, strangerId } = await setup();
      const mine = createLiveAgentHandlers({ db, readSession: async () => session(ownerId, WALLET), now: () => NOW, env: {} });
      const theirs = createLiveAgentHandlers({ db, readSession: async () => session(strangerId, OTHER), now: () => NOW, env: {} });
      const body = proposal();
      const payload = { agentId: body.agentId, route: body.route, tradingAddress: WALLET, expiresAtMs: body.expiresAtMs, policy: body.policy };

      const created = await mine.propose(req("POST", payload));
      expect(created.status).toBe(201);
      const grant = (await created.json()).grant as { id: string; status: string; missingEvidence: string[] };
      expect(grant.status).toBe("proposed");
      expect(grant.missingEvidence).toHaveLength(5);

      const tooBig = await mine.propose(req("POST", { ...payload, policy: { ...body.policy, maxCollateralPerOrderRaw: "10000001" } }));
      expect(tooBig.status).toBe(400);
      expect((await mine.propose(req("POST", { ...payload, extra: true }))).status).toBe(400);

      const status = await (await mine.status(req("GET"))).json();
      expect(status).toMatchObject({ liveTradingEnabled: false, submissionRoute: "not-configured", control: { stopped: true } });
      expect(status.grants).toHaveLength(1);
      expect((await (await theirs.status(req("GET"))).json()).grants).toHaveLength(0);

      expect((await theirs.revoke(req("POST"), grant.id)).status).toBe(404);
      expect((await mine.revoke(req("POST"), "not-a-uuid")).status).toBe(400);
      expect((await mine.stop(req("POST"))).status).toBe(200);
      expect((await mine.revoke(req("POST"), grant.id)).status).toBe(200);
      expect((await (await mine.status(req("GET"))).json()).grants[0].status).toBe("revoked");
      expect((await mine.status(req("POST"))).status).toBe(405);
    });

    it("passes through an unauthenticated response unchanged", async () => {
      const { db } = await setup();
      const denied = createLiveAgentHandlers({ db, readSession: async () => Response.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 }) });
      expect((await denied.status(req("GET"))).status).toBe(401);
      expect((await denied.stop(req("POST"))).status).toBe(401);
    });

    it("reports the live CallPut account gates for the signed-in wallet and degrades to unavailable instead of failing the page", async () => {
      const { db, ownerId } = await setup();
      const base = { db, readSession: async () => session(ownerId, WALLET), now: () => NOW, env: {} };
      const gates = { openToAll: false, safeMode: true, account: "0x6b565373726fAA9217B07E067A28Ca81952fB9b3" as Address, accountCreated: false, accountRegistered: false, accountAllowed: false, accountCanOpen: false, ownerAccountCount: 0, accountUsable: false };
      expect((await (await createLiveAgentHandlers(base).status(req("GET"))).json()).accountGates).toEqual({ status: "not-configured" });
      let asked = "";
      const ok = await (await createLiveAgentHandlers({ ...base, readAccountGates: async (owner) => { asked = owner; return gates; } }).status(req("GET"))).json();
      expect(ok.accountGates).toEqual({ status: "ok", ...gates });
      expect(asked.toLowerCase()).toBe(WALLET.toLowerCase());
      const down = await createLiveAgentHandlers({ ...base, readAccountGates: async () => { throw new Error("rpc down"); } }).status(req("GET"));
      expect(down.status).toBe(200);
      expect((await down.json()).accountGates).toEqual({ status: "unavailable" });
    });

    it("reports venue delegation evidence on status and degrades to unavailable instead of failing the page", async () => {
      const { db, ownerId } = await setup();
      const base = { db, readSession: async () => session(ownerId, WALLET), now: () => NOW, env: {} };
      const findings = [{ id: "account-route", ok: true, detail: "execution route callput_account on robinhood, configured=true." }];

      const none = await (await createLiveAgentHandlers(base).status(req("GET"))).json();
      expect(none.venueDelegation).toEqual({ status: "not-configured" });

      const ok = await (await createLiveAgentHandlers({ ...base, readVenueDelegation: async () => ({ fetchedAt: "2026-11-22T06:00:00.000Z", findings }) }).status(req("GET"))).json();
      expect(ok.venueDelegation).toEqual({ status: "ok", fetchedAt: "2026-11-22T06:00:00.000Z", findings });

      const down = await createLiveAgentHandlers({ ...base, readVenueDelegation: async () => { throw new Error("MCP unreachable"); } }).status(req("GET"));
      expect(down.status).toBe(200);
      const downBody = await down.json();
      expect(downBody.venueDelegation).toEqual({ status: "unavailable" });
      // Venue evidence never turns autonomous submission on.
      expect(downBody.submissionRoute).toBe("not-configured");
      expect(downBody.liveTradingEnabled).toBe(false);
    });
  });
});
