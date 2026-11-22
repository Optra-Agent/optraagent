/**
 * Fork acceptance test for the CallPut Live Agent execution engine.
 *
 * Runs the REAL engine (scheduler, worker, durable store, policy guard, plan source and signer submitter) against the
 * real CallPut contracts on a local mainnet fork. Signers are throwaway keys that exist only in this process; nothing
 * here can reach Robinhood Mainnet (the fork helpers refuse non-local RPCs). It proves the engine's logic, limits and
 * recovery paths. It does NOT prove that CallPut will accept an OPTRA-operated key, and it enables nothing in production:
 * production wires no signer.
 *
 * Usage (fresh fork each time; the script refuses a fork whose clock an earlier run advanced):
 *   anvil --fork-url https://rpc.mainnet.chain.robinhood.com --chain-id 4663 --port 8561 --silent
 *   FORK_RPC=http://127.0.0.1:8561 bun run scripts/callput-live-agent-fork-acceptance.ts
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UserRejectedRequestError, type Address, type Hex } from "viem";
import { DrizzleAuthRepository } from "../lib/auth/drizzle-repository";
import { createDatabase } from "../lib/db/client";
import { prepareGrantBoundedPlan } from "../lib/venue/callput-live-agent-plan";
import { runLiveAgentSchedule } from "../lib/venue/callput-live-agent-scheduler";
import {
  activateLiveAgentGrant,
  getLiveAgentControl,
  getLiveAgentGrant,
  listLiveAgentRequests,
  proposeLiveAgentGrant,
  recordLiveAgentEvidence,
  resumeLiveAgent,
  revokeLiveAgentGrant,
  stopLiveAgent,
  toLiveAgentPolicy,
} from "../lib/venue/callput-live-agent-store";
import { createSignerSubmitter } from "../lib/venue/callput-live-agent-submitter";
import { runLiveAgentTick, type LiveAgentSubmitter } from "../lib/venue/callput-live-agent-worker";
import { CALLPUT_ROBINHOOD_CONTRACTS as C, fetchCallPutRobinhoodMarketData } from "../lib/venue/callput-robinhood-readonly";
import { readCallPutRobinhoodRequest } from "../lib/venue/callput-robinhood-requests";
import { CALLPUT_WRITE_ABIS, readCallPutPositionState, type CallPutOpenSpreadPlan } from "../lib/venue/callput-robinhood-write";
import {
  KEEPER_ABI,
  assertForkChain,
  freshForkWallet,
  fundWithUsdg,
  keeperPass,
  latestTimestamp,
  pickSpreadLegs,
  publicClient,
  queueIndexOfLastRequest,
  rpcCall,
  setNextBlockTimestamp,
  staleKeeperPass,
  usdg,
} from "./callput-fork-lib";

const ENV = { LIVE_TRADING_ENABLED: "true" };
const EVIDENCE = {
  venueDelegationConfirmedRef: "fork acceptance: test reference", onchainGrantRef: `0x${"d4".repeat(32)}`,
  auditRef: "fork acceptance: test reference", ownerApprovalRef: "fork acceptance: test reference", revocationTested: true,
};
const UNDERLYING = "AAPL" as const;
const results: Array<{ label: string; ok: boolean; detail: string }> = [];
function check(label: string, ok: boolean, detail = "") {
  results.push({ label, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` (${detail})` : ""}`);
}

await assertForkChain();
const root = mkdtempSync(join(tmpdir(), "optra-live-fork-"));
const connection = await createDatabase({ dataDir: join(root, "db"), nodeEnv: "test" });
const db = connection.db;
const auth = new DrizzleAuthRepository(db);

const chainNowMs = async () => (await latestTimestamp()) * 1000;
const mineAt = async (timestamp: number) => {
  await setNextBlockTimestamp(timestamp);
  await rpcCall("anvil_mine", ["0x1"]);
};
const queueLength = async () => (await publicClient.readContract({ address: C.positionManager as Address, abi: KEEPER_ABI, functionName: "getRequestQueueLengths" }))[1];
const readSnapshots = (keys: Hex[]) => Promise.all(keys.map((key) => readCallPutRobinhoodRequest(publicClient, "open", key)));

type Send = (tx: { to: Address; data: Hex; value: bigint }) => Promise<Hex>;
type Actor = { name: string; address: Address; wallet: ReturnType<typeof freshForkWallet>["wallet"]; account: ReturnType<typeof freshForkWallet>["account"]; ownerId: string; grantId: string; plans: CallPutOpenSpreadPlan[] };

async function makeActor(name: string): Promise<Actor> {
  const { account, wallet } = freshForkWallet();
  if ((await publicClient.getCode({ address: account.address })) !== undefined) throw new Error("fresh fork signer unexpectedly has code");
  await fundWithUsdg(account.address, 5_000_000n);
  const user = await auth.findOrCreateUser(account.address);
  return { name, address: account.address, wallet, account, ownerId: user.id, grantId: "", plans: [] };
}

async function arm(actor: Actor) {
  const now = new Date(await chainNowMs());
  const grant = await proposeLiveAgentGrant(db, actor.ownerId, {
    ownerAddress: actor.address, tradingAddress: actor.address, agentId: "agent-1", route: "direct-wallet", expiresAtMs: now.getTime() + 2 * 86_400_000,
    policy: {
      allowedUnderlyings: [UNDERLYING], allowedStrategies: ["BuyPutSpread"], maxCollateralPerOrderRaw: "10000000", maxOpenCollateralRaw: "25000000",
      maxDailyCollateralRaw: "25000000", maxOrdersPerDay: 2, maxPendingRequests: 1, maxExecutionFeeWei: "300000000000000", minExpiryDays: 1, maxExpiryDays: 45,
    },
  }, now);
  await recordLiveAgentEvidence(db, actor.ownerId, grant.id, EVIDENCE, now);
  const activated = await activateLiveAgentGrant(db, actor.ownerId, grant.id, now);
  const resumed = await resumeLiveAgent(db, actor.ownerId, now, ENV);
  actor.grantId = grant.id;
  return activated.activated && resumed.resumed;
}

async function buildPlan(actor: Actor): Promise<CallPutOpenSpreadPlan | null> {
  const grant = await getLiveAgentGrant(db, actor.ownerId, actor.grantId);
  const control = await getLiveAgentControl(db, actor.ownerId);
  const policy = toLiveAgentPolicy(grant!, control.stopped);
  // Legs are chosen against the real feed clock; the chain clock is warped separately.
  const plan = await prepareGrantBoundedPlan({ client: publicClient as never, policy: { ...policy, minExpiryDays: 3 }, underlying: UNDERLYING, strategy: "BuyPutSpread", size: "0.1", nowMs: Date.now() });
  if (plan) actor.plans.push(plan);
  return plan;
}

const submitterFor = (actor: Actor, wrap?: (send: Send) => Send): LiveAgentSubmitter => {
  const send: Send = (tx) => actor.wallet.sendTransaction({ ...tx, account: actor.account });
  return createSignerSubmitter({ publicClient, signer: { address: actor.address, sendTransaction: wrap ? wrap(send) : send } });
};

/** Harness only: the fork has no Paper history, edge country or operator allowlist, so gate evaluation is covered by tests/live. */
const GATES_GREEN = async () => ({ allPass: true, gates: [], evaluatedAt: new Date().toISOString() });

const tick = async (actor: Actor, tickId: string, options: { noPlan?: boolean; plan?: CallPutOpenSpreadPlan; submitter?: LiveAgentSubmitter; env?: Record<string, string | undefined> } = {}) =>
  runLiveAgentTick({
    db, ownerId: actor.ownerId, grantId: actor.grantId, agentId: "agent-1", tickId, holder: "fork-acceptance", now: new Date(await chainNowMs()), env: options.env ?? ENV,
    preparePlan: options.noPlan ? async () => null : options.plan ? async () => options.plan! : () => buildPlan(actor), readSnapshots, gates: GATES_GREEN,
    ...(options.submitter ? { submitter: options.submitter } : {}),
  });

const usdgOf = (who: Address) => publicClient.readContract({ address: usdg, abi: CALLPUT_WRITE_ABIS.erc20, functionName: "balanceOf", args: [who] });

/** Plays the real keeper for the most recent open request (it must be the last one in the queue). */
async function fillLast(actor: Actor, requestKey: Hex) {
  const plan = actor.plans.at(-1)!;
  const market = await fetchCallPutRobinhoodMarketData();
  // An option ID encodes strike and expiry but not the side, so the lookup must match the side too (a call shares the ID).
  const legOf = (id: Hex) => market.options.find((o) => o.side === "put" && o.underlyingSymbol === UNDERLYING && o.optionId.toLowerCase() === id.toLowerCase())!;
  const long = legOf(plan.intent.longOptionId);
  const short = legOf(plan.intent.shortOptionId);
  const spreadMark = long.markPriceRaw - short.markPriceRaw;
  if (!(spreadMark > 0)) throw new Error(`Unusable spread mark ${spreadMark} for the keeper fill.`);
  const snapshot = await readCallPutRobinhoodRequest(publicClient, "open", requestKey);
  await keeperPass([{ optionTokenId: snapshot.optionTokenId!, requestIndex: await queueIndexOfLastRequest(), markPriceUsd: spreadMark, riskPremiumUsd: plan.quote.estimatedExecutionPrice - spreadMark }], (await latestTimestamp()) + 5);
  return snapshot.optionTokenId!;
}

try {
  // Warp to the next weekday 16:00 UTC (market hours) that still leaves two days before the legs expire.
  const { long: pickedLong } = await pickSpreadLegs(UNDERLYING, "BuyPutSpread", 3);
  const day = 86_400;
  const clock = await latestTimestamp();
  let openAt = clock + 120;
  for (let d = 1; d <= 7; d++) {
    const candidate = Math.floor((clock + d * day) / day) * day + 16 * 3600;
    const weekday = new Date(candidate * 1000).getUTCDay();
    if (weekday >= 1 && weekday <= 5 && candidate < pickedLong.expiryTimestamp - 2 * day) { openAt = candidate; break; }
  }
  await mineAt(openAt);
  console.log(`legs expire ${new Date(pickedLong.expiryTimestamp * 1000).toISOString()}; fork clock ${new Date((await latestTimestamp()) * 1000).toISOString()}`);

  const A = await makeActor("owner A");
  check("grant proposed, evidenced, activated and the agent resumed for owner A", await arm(A));

  // ---- Disabled by default ----
  {
    const before = await queueLength();
    const r = await tick(A, "t-disabled", { submitter: submitterFor(A), env: {} });
    check("LIVE_TRADING_ENABLED unset: the tick does nothing at all", r.status === "disabled" && (await queueLength()) === before && (await listLiveAgentRequests(db, A.ownerId)).length === 0, r.status);
  }

  // ---- Scheduled pass submits one order through the signer ----
  const key1 = await (async () => {
    const queueBefore = await queueLength();
    const usdgBefore = await usdgOf(A.address);
    const now = new Date(await chainNowMs());
    const hourBucket = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000).toISOString();
    const outcome = await runLiveAgentSchedule({ db, now, env: ENV, readSnapshots, preparePlan: () => buildPlan(A), submitter: submitterFor(A), gates: GATES_GREEN });
    const result = outcome.results.find((r) => r.grantId === A.grantId);
    const requests = await listLiveAgentRequests(db, A.ownerId);
    const request = requests[0];
    const snapshot = request?.requestKey ? await readCallPutRobinhoodRequest(publicClient, "open", request.requestKey as Hex) : null;
    check("scheduled pass: authorized, signed and submitted exactly one order", result?.status === "submitted" && requests.length === 1 && (await queueLength()) === queueBefore + 1n, `${result?.status}, queue +${(await queueLength()) - queueBefore}`);
    check("the request key from the receipt is on the ledger in state pending, and the chain agrees", request?.state === "pending" && !!request.requestKey && snapshot?.status === "Pending" && snapshot.account?.toLowerCase() === A.address.toLowerCase(), `${request?.state}/${snapshot?.status}`);
    check("the committed collateral left the wallet and matches the ledger", usdgBefore - (await usdgOf(A.address)) === BigInt(request!.collateralRaw) && snapshot?.amountIn === BigInt(request!.collateralRaw), `${usdgBefore - (await usdgOf(A.address))} raw`);
    // Same decision, same tick id: idempotent replay, nothing new on chain.
    const replay = await runLiveAgentTick({ db, ownerId: A.ownerId, grantId: A.grantId, agentId: "agent-1", tickId: hourBucket, holder: "fork-acceptance", now, env: ENV, gates: GATES_GREEN, preparePlan: async () => A.plans[0]!, readSnapshots, submitter: submitterFor(A) });
    check("replaying the same decision is recognized and sends nothing", replay.status === "replayed" && (await queueLength()) === queueBefore + 1n, `${replay.status}`);
    return request!.requestKey as Hex;
  })();

  // ---- Pending cap ----
  {
    const queueBefore = await queueLength();
    const r = await tick(A, "t-2", { submitter: submitterFor(A) });
    check("a second order while one is pending is blocked by the pending-request limit", r.status === "blocked" && !!r.checks?.some((c) => c.id === "pending-requests" && !c.ok) && (await queueLength()) === queueBefore, `${r.status}`);
  }

  // ---- Keeper fill, reconciled from chain, confirmed independently by the option-token balance ----
  {
    const tokenId = await fillLast(A, key1);
    const r = await tick(A, "t-3", { noPlan: true });
    const request = (await listLiveAgentRequests(db, A.ownerId))[0]!;
    const position = await readCallPutPositionState(publicClient, A.address, UNDERLYING, tokenId, "position");
    const snapshot = await readCallPutRobinhoodRequest(publicClient, "open", key1);
    check("after the keeper fill the next tick reconciles the request to executed", r.status === "no-trade" && request.state === "executed" && snapshot.status === "Executed", `${request.state}`);
    check("the fill is confirmed by the wallet's option-token balance, not by the hash", position.positionBalanceRaw > 0n && position.positionBalanceRaw === snapshot.sizeOut, `${position.positionBalanceRaw} raw`);
  }

  // ---- A declined wallet signature cancels the reservation without stopping the agent ----
  {
    const queueBefore = await queueLength();
    const decline = submitterFor(A, () => async () => { throw new UserRejectedRequestError(new Error("declined")); });
    const r = await tick(A, "t-declined", { submitter: decline });
    const cancelled = (await listLiveAgentRequests(db, A.ownerId)).filter((x) => x.state === "cancelled");
    check("a declined signature is not-broadcast: the reservation is cancelled, nothing is sent, the agent keeps running", r.status === "blocked" && cancelled.length === 1 && (await queueLength()) === queueBefore && !(await getLiveAgentControl(db, A.ownerId)).stopped, `${r.status}/${cancelled.length} cancelled`);
  }

  // ---- Second order, filled; then the daily order limit ----
  {
    const r = await tick(A, "t-4", { submitter: submitterFor(A) });
    const request = (await listLiveAgentRequests(db, A.ownerId)).find((x) => x.state === "pending")!;
    check("with the first order filled and no pending request, the next order is allowed", r.status === "submitted" && !!request?.requestKey, r.status);
    await fillLast(A, request.requestKey as Hex);
    const rec = await tick(A, "t-5", { noPlan: true });
    const states = (await listLiveAgentRequests(db, A.ownerId)).filter((x) => x.state === "executed").length;
    check("the second order is reconciled to executed", rec.status === "no-trade" && states === 2, `${states} executed`);
    const queueBefore = await queueLength();
    const capped = await tick(A, "t-6", { submitter: submitterFor(A) });
    check("a third order is blocked by the daily order limit (two per day)", capped.status === "blocked" && !!capped.checks?.some((c) => c.id === "order-count" && !c.ok) && (await queueLength()) === queueBefore, `${capped.status}`);
  }

  // ---- Emergency stop and revocation ----
  {
    const queueBefore = await queueLength();
    await stopLiveAgent(db, A.ownerId, "fork acceptance: emergency stop", new Date(await chainNowMs()));
    const stopped = await tick(A, "t-stopped", { submitter: submitterFor(A) });
    check("the emergency stop blocks every order", stopped.status === "stopped" && (await queueLength()) === queueBefore, stopped.status);
    const resumed = await resumeLiveAgent(db, A.ownerId, new Date(await chainNowMs()), ENV);
    check("the owner can resume after a plain stop", resumed.resumed, resumed.reasons.join("; "));
    await revokeLiveAgentGrant(db, A.ownerId, A.grantId, new Date(await chainNowMs()));
    const revoked = await tick(A, "t-revoked", { submitter: submitterFor(A) });
    const afterRevoke = await resumeLiveAgent(db, A.ownerId, new Date(await chainNowMs()), ENV);
    check("a revoked grant sends nothing, stops the agent, and cannot be resumed", revoked.status !== "submitted" && (await queueLength()) === queueBefore && !afterRevoke.resumed && (await getLiveAgentControl(db, A.ownerId)).stopped, `${revoked.status}; ${afterRevoke.reasons.join("; ")}`);
  }

  // ---- A request that is never filled: stale, halts, then recovers from the chain ----
  {
    const B = await makeActor("owner B");
    check("owner B armed", await arm(B));
    const r = await tick(B, "b-1", { submitter: submitterFor(B) });
    const request = (await listLiveAgentRequests(db, B.ownerId))[0]!;
    const submittedAt = (await readCallPutRobinhoodRequest(publicClient, "open", request.requestKey as Hex)).submittedAt!;
    check("owner B's order is submitted and pending", r.status === "submitted" && request.state === "pending", r.status);
    await mineAt(Number(submittedAt) + 600);
    const queueBefore = await queueLength();
    const halted = await tick(B, "b-2", { submitter: submitterFor(B) });
    const after = (await listLiveAgentRequests(db, B.ownerId))[0]!;
    const resumeBlocked = await resumeLiveAgent(db, B.ownerId, new Date(await chainNowMs()), ENV);
    check("a request pending past the venue window goes stale and halts the agent; no new order is sent", halted.status === "halted" && after.state === "stale" && (await queueLength()) === queueBefore && (await getLiveAgentControl(db, B.ownerId)).stopped, `${halted.status}/${after.state}`);
    check("the agent cannot be resumed while a request is stale", !resumeBlocked.resumed, resumeBlocked.reasons.join("; "));
    const usdgBefore = await usdgOf(B.address);
    await staleKeeperPass((await latestTimestamp()) + 5);
    await tick(B, "b-3", { noPlan: true });
    const cancelled = (await listLiveAgentRequests(db, B.ownerId))[0]!;
    const resumedAfter = await resumeLiveAgent(db, B.ownerId, new Date(await chainNowMs()), ENV);
    check("once the chain shows the request cancelled, the ledger follows, the collateral is back, and the owner can resume", cancelled.state === "cancelled" && (await usdgOf(B.address)) - usdgBefore === BigInt(request.collateralRaw) && resumedAfter.resumed, `${cancelled.state}`);
  }

  // ---- An ambiguous submission: the order may exist, so the agent stops ----
  {
    const D = await makeActor("owner D");
    check("owner D armed", await arm(D));
    const queueBefore = await queueLength();
    const flaky = submitterFor(D, (send) => async (tx) => {
      const hash = await send(tx);
      if (tx.to.toLowerCase() === C.positionManager.toLowerCase()) throw new Error("socket hang up after broadcast");
      return hash;
    });
    const r = await tick(D, "d-1", { submitter: flaky });
    const request = (await listLiveAgentRequests(db, D.ownerId))[0]!;
    // The transaction was broadcast before the error, so it may be mined a moment after the submitter gave up.
    let orderExists = false;
    for (let i = 0; i < 20 && !orderExists; i++) {
      orderExists = (await queueLength()) === queueBefore + 1n;
      if (!orderExists) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    check("an error after broadcast is an unknown outcome: request marked unknown and the agent stopped", r.status === "submission-unknown" && request.state === "unknown" && (await getLiveAgentControl(db, D.ownerId)).stopped, `${r.status}/${request.state}`);
    check("the order really was created on chain, which is why the agent must not retry blindly", orderExists, `queue +${(await queueLength()) - queueBefore}`);
    const again = await tick(D, "d-2", { submitter: submitterFor(D) });
    const resume = await resumeLiveAgent(db, D.ownerId, new Date(await chainNowMs()), ENV);
    check("no further order is sent and the agent cannot be resumed until the unknown request is reconciled", again.status !== "submitted" && (await queueLength()) === queueBefore + 1n && !resume.resumed, `${again.status}; ${resume.reasons.join("; ")}`);
  }
} finally {
  await connection.close();
  rmSync(root, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} assertions passed`);
process.exit(failed.length === 0 ? 0 : 1);
