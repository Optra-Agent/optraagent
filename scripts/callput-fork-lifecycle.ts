/**
 * Fork lifecycle test for the CallPut direct-wallet flow: cancelled request -> open -> keeper fill -> partial close
 * -> keeper close -> expiry -> settlement, plus the venue's and the app's rejections. Everything runs against the
 * real forked venue contracts; only the keeper's inputs (mark price, risk premium, settle price) come from this
 * fixture, through the venue's own FastPriceFeed and SettlePriceFeed entrypoints called as the real keeper address.
 * Nothing here touches Mainnet.
 *
 * Usage: anvil --fork-url https://rpc.mainnet.chain.robinhood.com --chain-id 4663 --port 8561 --silent
 *        FORK_RPC=http://127.0.0.1:8561 bun run scripts/callput-fork-lifecycle.ts [AAPL] [BuyPutSpread] [size]
 * Exit code 0 only when every assertion passes.
 */
import { encodeFunctionData, getAddress, type Address } from "viem";
import { CALLPUT_ROBINHOOD_CONTRACTS as C } from "../lib/venue/callput-robinhood-readonly";
import { readCallPutRobinhoodRequest } from "../lib/venue/callput-robinhood-requests";
import {
  CALLPUT_LIMITS,
  CALLPUT_ROBINHOOD_UNDERLYINGS,
  CALLPUT_WRITE_ABIS,
  CallPutRiskError,
  extractCallPutRequestKey,
  extractCallPutSettlement,
  prepareCallPutClose,
  prepareCallPutOpenSpread,
  prepareCallPutSettle,
  readCallPutPositionState,
  readCallPutWalletState,
  reconcileCallPutClose,
  reconcileCallPutOpen,
  reconcileCallPutSettlement,
  type CallPutPreparedTransaction,
  type CallPutSpreadStrategy,
  type CallPutUnderlyingSymbol,
} from "../lib/venue/callput-robinhood-write";
import {
  assertForkChain,
  feedSettlePrice,
  forkAccount,
  freshForkWallet,
  fundWithUsdg,
  keeperPass,
  latestTimestamp,
  pickSpreadLegs,
  publicClient,
  queueIndexOfLastRequest,
  refreshSpotFeed,
  setNextBlockTimestamp,
  staleKeeperPass,
  usdg,
} from "./callput-fork-lib";

const [underlyingArg = "AAPL", strategyArg = "BuyPutSpread", size = "0.1"] = process.argv.slice(2);
const underlying = underlyingArg as CallPutUnderlyingSymbol;
const strategy = strategyArg as CallPutSpreadStrategy;
const meta = CALLPUT_ROBINHOOD_UNDERLYINGS[underlying];

const results: Array<{ label: string; ok: boolean; detail: string }> = [];
function check(label: string, ok: boolean, detail = "") {
  results.push({ label, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` (${detail})` : ""}`);
}

await assertForkChain();
const { account, wallet } = freshForkWallet();
if ((await publicClient.getCode({ address: account.address })) !== undefined) throw new Error("fresh fork signer unexpectedly has code");
await fundWithUsdg(account.address, 5_000_000n);
const usdgBalance = () => publicClient.readContract({ address: usdg, abi: CALLPUT_WRITE_ABIS.erc20, functionName: "balanceOf", args: [account.address] });

async function sendPlan(txs: CallPutPreparedTransaction[]) {
  const receipts = [];
  for (const tx of txs) {
    if (getAddress(tx.from) !== getAddress(account.address) || tx.chainId !== 4663) throw new Error("Prepared transaction is not bound to the signer and chain 4663.");
    const hash = await wallet.sendTransaction({ to: tx.to, data: tx.data, value: tx.value, account });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${tx.kind} reverted on the fork`);
    receipts.push({ tx, receipt });
  }
  return receipts;
}

// ---- Scenario 0: an account with contract code that cannot receive ERC-1155 is blocked before any transaction ----
{
  // The well-known test-mnemonic address #32 is an EIP-7702 delegated account on Robinhood Mainnet; its fallback returns
  // no ERC-1155 receiver value, which made every keeper fill revert on the fork.
  const delegated = forkAccount(32).address;
  const code = await publicClient.getCode({ address: delegated });
  const state = await readCallPutWalletState(publicClient, delegated);
  check("account with contract code and no ERC-1155 receiver is detected from chain data", !!code && code !== "0x" && state.accountAcceptsErc1155 === false, `code ${code?.slice(0, 12)}...`);
  const { market: m0, long: l0, short: s0 } = await pickSpreadLegs(underlying, strategy, 3);
  let blocked = "";
  try { prepareCallPutOpenSpread({ strategy, underlying, longOptionId: l0.optionId, shortOptionId: s0.optionId, size, market: m0, wallet: state, nowMs: Date.now() }); } catch (e) { blocked = e instanceof CallPutRiskError ? e.failed.map((c) => c.id).join(",") : String(e); }
  check("app refuses to prepare an open order for that account", blocked.includes("account-erc1155"), blocked);
}

// Live venue feed picks the spread; the fork clock is moved to a weekday US session before the request exists.
const { market, long, short } = await pickSpreadLegs(underlying, strategy, 3);
const expiry = long.expiryTimestamp;
const spreadMarkUsd = long.markPriceRaw - short.markPriceRaw;
const clock = await latestTimestamp();
const day = 86_400;
let openAt = clock + 120;
for (let d = 1; d <= 7; d++) {
  const candidate = Math.floor((clock + d * day) / day) * day + 16 * 3600;
  const weekday = new Date(candidate * 1000).getUTCDay();
  if (weekday >= 1 && weekday <= 5 && candidate < expiry - 2 * day) { openAt = candidate; break; }
}
console.log(`legs: long ${long.instrument} / short ${short.instrument}; spread mark ${spreadMarkUsd.toFixed(4)} USD; open at ${new Date(openAt * 1000).toISOString()}`);

async function openSpread() {
  const wal = await readCallPutWalletState(publicClient, account.address);
  const plan = prepareCallPutOpenSpread({ strategy, underlying, longOptionId: long.optionId, shortOptionId: short.optionId, size, market, wallet: wal, nowMs: Date.now() });
  const receipts = await sendPlan(plan.transactions);
  const openReceipt = receipts.at(-1)!.receipt;
  const requestKey = extractCallPutRequestKey(openReceipt, { account: account.address, isOpen: true });
  const requestIndex = await queueIndexOfLastRequest();
  return { plan, requestKey, requestIndex, intent: { ...plan.intent, txHash: openReceipt.transactionHash, requestKey } };
}

// ---- Scenario 1: stale keeper => the venue cancels, collateral is returned, and the app never reports a fill ----
{
  await setNextBlockTimestamp(openAt);
  const before = await usdgBalance();
  const a = await openSpread();
  const afterOpen = await usdgBalance();
  check("open request pulls the committed collateral into the venue", before - afterOpen === a.plan.quote.amountInRaw, `${before - afterOpen} raw`);
  const pending = reconcileCallPutOpen({ intent: a.intent, request: await readCallPutRobinhoodRequest(publicClient, "open", a.requestKey), optionTokenBalanceRaw: null, nowMs: (await latestTimestamp()) * 1000 });
  check("a Pending request is not a fill", pending.state === "pending" && !pending.fillConfirmed, pending.state);
  await staleKeeperPass((await latestTimestamp()) + 5);
  const request = await readCallPutRobinhoodRequest(publicClient, "open", a.requestKey);
  const cancelled = reconcileCallPutOpen({ intent: a.intent, request, optionTokenBalanceRaw: 0n, nowMs: (await latestTimestamp()) * 1000 });
  check("keeper without fresh prices cancels the request", request.status === "Cancelled" && cancelled.state === "cancelled" && !cancelled.fillConfirmed, `${request.status} / ${cancelled.state}`);
  check("cancelled open returns the collateral", (await usdgBalance()) === before, `balance ${await usdgBalance()} raw`);
}

// ---- Scenario 2: open filled by the keeper ----
const open = await openSpread();
const fillAt = (await latestTimestamp()) + 5;
const executionPremium = open.plan.quote.estimatedExecutionPrice - spreadMarkUsd;
const usdgBeforeFill = await usdgBalance();
const pendingOpen = await readCallPutRobinhoodRequest(publicClient, "open", open.requestKey);
const tokenId = pendingOpen.optionTokenId!;
await keeperPass([{ optionTokenId: tokenId, requestIndex: open.requestIndex, markPriceUsd: spreadMarkUsd, riskPremiumUsd: executionPremium }], fillAt);
const openRequest = await readCallPutRobinhoodRequest(publicClient, "open", open.requestKey);
const afterFillState = await readCallPutPositionState(publicClient, account.address, underlying, tokenId, "position");
const openRec = reconcileCallPutOpen({ intent: open.intent, request: openRequest, optionTokenBalanceRaw: afterFillState.positionBalanceRaw, nowMs: (await latestTimestamp()) * 1000 });
check("keeper fill: request Executed", openRequest.status === "Executed", `sizeOut ${openRequest.sizeOut}, amountOut(refund) ${openRequest.amountOut}, executionPrice ${openRequest.executionPrice}`);
check("fill confirmed only by option-token balance", openRec.state === "executed-balance-confirmed" && openRec.fillConfirmed && afterFillState.positionBalanceRaw === openRequest.sizeOut, `${afterFillState.positionBalanceRaw} raw`);
check("unused collateral is refunded as amountOut", (await usdgBalance()) - usdgBeforeFill === (openRequest.amountOut ?? 0n), `${(await usdgBalance()) - usdgBeforeFill} raw`);

// ---- App and venue rejections before the position is touched ----
{
  const now = await latestTimestamp();
  const pos = await readCallPutPositionState(publicClient, account.address, underlying, tokenId, "position");
  const tryPrepare = (fn: () => unknown) => { try { fn(); return null; } catch (e) { return e instanceof CallPutRiskError ? e.failed.map((c) => c.id) : [String(e)]; } };
  const tooBig = tryPrepare(() => prepareCallPutClose({ underlying, optionTokenId: tokenId, sizeRaw: pos.positionBalanceRaw + 1n, minAmountOutRaw: 1n, minOutWhenSwapRaw: 1n, position: pos, nowMs: now * 1000 }));
  check("app rejects a close larger than the wallet balance", !!tooBig?.includes("size"), String(tooBig));
  const noFloor = tryPrepare(() => prepareCallPutClose({ underlying, optionTokenId: tokenId, sizeRaw: 1n, minAmountOutRaw: 0n, minOutWhenSwapRaw: 1n, position: pos, nowMs: now * 1000 }));
  check("app rejects a close without a positive minAmountOut floor", !!noFloor?.includes("min-amount-out"), String(noFloor));
  const inBuffer = tryPrepare(() => prepareCallPutClose({ underlying, optionTokenId: tokenId, sizeRaw: 1n, minAmountOutRaw: 1n, minOutWhenSwapRaw: 1n, position: pos, nowMs: (expiry - 600) * 1000 }));
  check("app rejects a close inside the 30-minute pre-expiry buffer", !!inBuffer?.includes("close-before-expiry"), String(inBuffer));
  const early = tryPrepare(() => prepareCallPutSettle({ underlying, optionTokenId: tokenId, minOutWhenSwapRaw: 1n, position: pos, nowMs: now * 1000 }));
  check("app rejects settlement before expiry", !!early?.includes("settle-after-expiry"), String(early));
  const settleData = encodeFunctionData({ abi: CALLPUT_WRITE_ABIS.settleManager, functionName: "settlePosition", args: [[usdg], meta.index, tokenId, 1n, false] });
  let venueRevert = "";
  try { await publicClient.call({ account: account.address, to: C.settleManager as Address, data: settleData }); } catch (e) { venueRevert = String((e as Error).message); }
  check("venue itself reverts settlement before expiry", /not expired/i.test(venueRevert), venueRevert.split("\n")[0]?.slice(0, 120) ?? "");
}

// ---- Scenario 3: partial close, asynchronous, confirmed only after the keeper executes it ----
const fullBalance = (await readCallPutPositionState(publicClient, account.address, underlying, tokenId, "position")).positionBalanceRaw;
const closeSize = fullBalance / 2n;
{
  const pos = await readCallPutPositionState(publicClient, account.address, underlying, tokenId, "position");
  const expectedOutRaw = BigInt(Math.floor((Number(closeSize) / 1e18) * (spreadMarkUsd - 0.05) * 1e6));
  const plan = prepareCallPutClose({ underlying, optionTokenId: tokenId, sizeRaw: closeSize, minAmountOutRaw: expectedOutRaw / 2n, minOutWhenSwapRaw: 1n, position: pos, nowMs: (await latestTimestamp()) * 1000 });
  check("close plan asks for the Controller approval first, then the close request", plan.transactions.map((t) => t.kind).join(",") === "option-token-approval,close-position", plan.transactions.map((t) => t.kind).join(","));
  const usdgBefore = await usdgBalance();
  const receipts = await sendPlan(plan.transactions);
  const closeKey = extractCallPutRequestKey(receipts.at(-1)!.receipt, { account: account.address, isOpen: false });
  const closeIndex = await queueIndexOfLastRequest();
  const pendingRequest = await readCallPutRobinhoodRequest(publicClient, "close", closeKey);
  const balanceWhilePending = (await readCallPutPositionState(publicClient, account.address, underlying, tokenId, "position")).positionBalanceRaw;
  const pendingRec = reconcileCallPutClose({ request: pendingRequest, requestKey: closeKey, account: account.address, optionTokenId: tokenId, preBalanceRaw: fullBalance, balanceAfterRaw: balanceWhilePending, nowMs: (await latestTimestamp()) * 1000 });
  check("while Pending the tokens already left the wallet, yet the app reports no close", balanceWhilePending === fullBalance - closeSize && pendingRec.state === "pending" && !pendingRec.fillConfirmed, `balance ${balanceWhilePending}, state ${pendingRec.state}`);
  await keeperPass([{ optionTokenId: tokenId, requestIndex: closeIndex, markPriceUsd: spreadMarkUsd, riskPremiumUsd: 0.05 }], (await latestTimestamp()) + 5);
  const closeRequest = await readCallPutRobinhoodRequest(publicClient, "close", closeKey);
  const balanceAfter = (await readCallPutPositionState(publicClient, account.address, underlying, tokenId, "position")).positionBalanceRaw;
  const closeRec = reconcileCallPutClose({ request: closeRequest, requestKey: closeKey, account: account.address, optionTokenId: tokenId, preBalanceRaw: fullBalance, balanceAfterRaw: balanceAfter, nowMs: (await latestTimestamp()) * 1000 });
  const received = (await usdgBalance()) - usdgBefore;
  check("keeper executes the partial close", closeRequest.status === "Executed" && closeRec.state === "executed-position-confirmed" && closeRec.fillConfirmed, `${closeRec.state}`);
  check("close pays out the reported amountOut in USDG", received === (closeRequest.amountOut ?? -1n) && received > 0n && received >= expectedOutRaw / 2n, `${received} raw (floor ${expectedOutRaw / 2n})`);
  check("partial close leaves the remainder held", balanceAfter === fullBalance - closeSize && balanceAfter > 0n, `${balanceAfter} raw remain`);
}

// ---- Scenario 4: expiry and settlement of the remainder ----
{
  const remaining = (await readCallPutPositionState(publicClient, account.address, underlying, tokenId, "settle")).positionBalanceRaw;
  const settlePriceUsd = short.strikePriceRaw - 5; // below both strikes: the put spread is at maximum value
  await feedSettlePrice(meta.index, expiry, settlePriceUsd, expiry + 60);
  // SettleManager also reads the spot feed (for the USDG swap), and the venue rejects it once older than 5 minutes.
  await refreshSpotFeed(expiry + 120);
  await setNextBlockTimestamp(expiry + 120);
  const pos = await readCallPutPositionState(publicClient, account.address, underlying, tokenId, "settle");
  const plan = prepareCallPutSettle({ underlying, optionTokenId: tokenId, minOutWhenSwapRaw: 1n, position: pos, nowMs: (expiry + 120) * 1000 });
  const closeAfterExpiry = (() => { try { prepareCallPutClose({ underlying, optionTokenId: tokenId, sizeRaw: 1n, minAmountOutRaw: 1n, minOutWhenSwapRaw: 1n, position: pos, nowMs: (expiry + 120) * 1000 }); return null; } catch (e) { return e instanceof CallPutRiskError ? e.failed.map((c) => c.id) : [String(e)]; } })();
  check("app rejects a close after expiry and routes to settlement", !!closeAfterExpiry?.includes("close-before-expiry"), String(closeAfterExpiry));
  const usdgBefore = await usdgBalance();
  const receipts = await sendPlan(plan.transactions);
  const settleReceipt = receipts.at(-1)!.receipt;
  const settlement = extractCallPutSettlement(settleReceipt, { account: account.address, underlyingAssetIndex: meta.index, optionTokenId: tokenId });
  const after = (await readCallPutPositionState(publicClient, account.address, underlying, tokenId, "settle")).positionBalanceRaw;
  const rec = reconcileCallPutSettlement({ settlement, preBalanceRaw: remaining, balanceAfterRaw: after });
  const received = (await usdgBalance()) - usdgBefore;
  const widthUsd = long.strikePriceRaw - short.strikePriceRaw;
  const expectedPayoutRaw = BigInt(Math.round((Number(remaining) / 1e18) * Math.abs(widthUsd) * 1e6));
  check("settlement event matches the position and the balance reduction", rec.state === "settled-position-confirmed" && rec.fillConfirmed && after === 0n, rec.state);
  // The venue collects a position fee on buy-side settlement (Vault._collectPositionFees with isSettle), so the wallet
  // receives the maximum spread payoff minus that fee. The event reports only the net amount; the fee is the difference.
  const feeRaw = expectedPayoutRaw - received;
  check("settlement pays the maximum spread payoff in USDG, net of a venue fee", received === settlement.amountOut && received > 0n && feeRaw > 0n && feeRaw * 20n <= expectedPayoutRaw, `received ${received} raw = gross ${expectedPayoutRaw} - venue fee ${feeRaw} (${(Number(feeRaw) / Number(expectedPayoutRaw) * 100).toFixed(2)}%), settle price ${Number(settlement.settlePrice / 10n ** 24n) / 1e6} USD`);
  const again = await (async () => { try { await publicClient.call({ account: account.address, to: C.settleManager as Address, data: plan.transactions.at(-1)!.data }); return "no revert"; } catch (e) { return String((e as Error).message).split("\n")[0]!.slice(0, 100); } })();
  check("settling again is rejected by the venue (no position left)", /No position to settle/i.test(again), again);
}

void CALLPUT_LIMITS;
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} assertions passed`);
process.exit(failed.length === 0 ? 0 : 1);
