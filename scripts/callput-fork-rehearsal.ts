/**
 * Local-fork rehearsal of the CallPut direct-wallet open flow. NEVER run against a real RPC.
 * Usage: anvil --fork-url https://rpc.mainnet.chain.robinhood.com --port 8548
 *        bun run scripts/callput-fork-rehearsal.ts [AAPL] [BuyPutSpread] [size]
 *
 * It signs with a public anvil/test-mnemonic key on the fork only, executes the exact transactions that
 * `prepareCallPutOpenSpread` builds (USDG approve, then createOpenPosition) against the real forked venue
 * contracts, then runs the app's request-key extraction and reconciliation. The keeper never runs on a fork,
 * so the expected end state is a Pending request: no fill is claimed.
 */
import { createPublicClient, createWalletClient, encodeAbiParameters, getAddress, http, keccak256, pad, toHex, type Address, type Hex } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { robinhoodMainnet } from "../lib/chain/robinhood";
import { CALLPUT_ROBINHOOD_CONTRACTS as C, fetchCallPutRobinhoodMarketData } from "../lib/venue/callput-robinhood-readonly";
import { readCallPutRobinhoodRequest } from "../lib/venue/callput-robinhood-requests";
import {
  CALLPUT_WRITE_ABIS,
  extractCallPutRequestKey,
  prepareCallPutOpenSpread,
  readCallPutWalletState,
  reconcileCallPutOpen,
  type CallPutSpreadStrategy,
} from "../lib/venue/callput-robinhood-write";

const rpc = process.env.FORK_RPC ?? "http://127.0.0.1:8548";
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(rpc)) throw new Error("Refusing to run: FORK_RPC must be a local anvil fork.");
const [underlying = "AAPL", strategy = "BuyPutSpread", size = "0.1"] = process.argv.slice(2);

// Public, well-known test mnemonic. Funds exist only on the local fork.
const account = mnemonicToAccount("test test test test test test test test test test test junk", { addressIndex: 7 });
const chain = { ...robinhoodMainnet, rpcUrls: { default: { http: [rpc] } } };
const publicClient = createPublicClient({ chain, transport: http(rpc) });
const wallet = createWalletClient({ account, chain, transport: http(rpc) });
const usdg = C.usdg as Address;

const mapSlot = (holder: Address, slot: bigint) => keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [holder, slot]));
const balanceOf = () => publicClient.readContract({ address: usdg, abi: CALLPUT_WRITE_ABIS.erc20, functionName: "balanceOf", args: [account.address] });
const rpcCall = (method: string, params: unknown[]) => publicClient.request({ method: method as never, params: params as never });

const chainId = await publicClient.getChainId();
if (chainId !== 4663) throw new Error(`Fork reports chain ${chainId}, expected 4663.`);
console.log(`signer ${account.address} (fork-only test key)`);

await rpcCall("anvil_setBalance", [account.address, toHex(10n ** 18n)]);
const funded = 5_000_000n;
let fundedSlot: bigint | null = null;
for (let slot = 0n; slot < 24n && fundedSlot === null; slot++) {
  await rpcCall("anvil_setStorageAt", [usdg, mapSlot(account.address, slot), pad(toHex(funded), { size: 32 })]);
  if ((await balanceOf()) === funded) fundedSlot = slot;
  else await rpcCall("anvil_setStorageAt", [usdg, mapSlot(account.address, slot), pad("0x0", { size: 32 })]);
}
if (fundedSlot === null) throw new Error("Could not fund the fork account with USDG (no balance slot found).");
console.log(`funded ${funded} raw USDG via balance slot ${fundedSlot}`);

const market = await fetchCallPutRobinhoodMarketData();
const side = strategy.includes("Call") ? "call" : "put";
const now = Date.now() / 1000;
const legs = market.options
  .filter((o) => o.underlyingSymbol === underlying && o.side === side && o.marketAvailable && o.expiryTimestamp - now > 3 * 86_400)
  .sort((a, b) => a.expiryTimestamp - b.expiryTimestamp || a.strikePriceRaw - b.strikePriceRaw);
const expiry = legs[0]?.expiryTimestamp;
const spot = market.spotIndexRaw[underlying] ?? 0;
const [first, second] = legs.filter((o) => o.expiryTimestamp === expiry)
  .sort((a, b) => Math.abs(a.strikePriceRaw - spot) - Math.abs(b.strikePriceRaw - spot)).slice(0, 2).sort((a, b) => a.strikePriceRaw - b.strikePriceRaw);
if (!first || !second) throw new Error("No two available legs found.");
const [long, short] = side === "put" ? [second, first] : [first, second];

const state = await readCallPutWalletState(publicClient, account.address);
const plan = prepareCallPutOpenSpread({
  strategy: strategy as CallPutSpreadStrategy, underlying, longOptionId: long.optionId, shortOptionId: short.optionId, size, market, wallet: state, nowMs: Date.now(),
});
console.log(`legs: long ${long.instrument} / short ${short.instrument}; collateral ${plan.quote.amountInRaw} raw USDG; ${plan.transactions.length} transactions`);
for (const check of plan.checks) if (!check.ok) throw new Error(`risk check failed: ${check.id}: ${check.detail}`);

const before = await balanceOf();
const receipts: Array<{ kind: string; hash: Hex; status: string; gas: bigint }> = [];
let openReceipt: Awaited<ReturnType<typeof publicClient.waitForTransactionReceipt>> | null = null;
for (const tx of plan.transactions) {
  if (getAddress(tx.from) !== getAddress(account.address) || tx.chainId !== 4663) throw new Error("Prepared transaction is not bound to the signer and chain 4663.");
  const hash = await wallet.sendTransaction({ to: tx.to, data: tx.data, value: tx.value, account });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  receipts.push({ kind: tx.kind, hash, status: receipt.status, gas: receipt.gasUsed });
  if (tx.kind === "open-spread") openReceipt = receipt;
}
console.table(receipts.map((r) => ({ ...r, gas: r.gas.toString() })));
if (!openReceipt || openReceipt.status !== "success") throw new Error("Open request transaction did not succeed on the fork.");

const requestKey = extractCallPutRequestKey(openReceipt, { account: account.address, isOpen: true });
const request = await readCallPutRobinhoodRequest(publicClient, "open", requestKey);
const after = await balanceOf();
const pullTo = await publicClient.readContract({ address: usdg, abi: CALLPUT_WRITE_ABIS.erc20, functionName: "balanceOf", args: [C.positionManager as Address] });
const block = await publicClient.getBlock();
const intent = { ...plan.intent, txHash: receipts.at(-1)!.hash, requestKey };
const fresh = reconcileCallPutOpen({ intent, request, optionTokenBalanceRaw: null, nowMs: Number(block.timestamp) * 1000 });
const late = reconcileCallPutOpen({ intent, request, optionTokenBalanceRaw: null, nowMs: (Number(block.timestamp) + 181) * 1000 });

console.log(`request key ${requestKey}`);
console.log(`request status ${request.status}; account ${request.account}; amountIn ${request.amountIn}; minSize ${request.minSize}`);
console.log(`USDG moved out of the signer: ${before - after} raw (quoted ${plan.quote.amountInRaw}); PositionManager USDG balance ${pullTo}`);
console.log(`reconcile now: ${fresh.state} fillConfirmed=${fresh.fillConfirmed}`);
console.log(`reconcile +181s: ${late.state} fillConfirmed=${late.fillConfirmed}`);

const checks = [
  ["open request mined with status success", openReceipt.status === "success"],
  ["request account equals signer", request.account !== null && getAddress(request.account) === getAddress(account.address)],
  ["request is Pending (keeper has not run on a fork)", request.status === "Pending"],
  ["Pending is never a confirmed fill", !fresh.fillConfirmed && !late.fillConfirmed],
  ["state moves to pending-past-delay after 180s", late.state === "pending-past-delay"],
  ["signer USDG fell by the committed amountIn", before - after === request.amountIn],
] as const;
let failed = 0;
for (const [label, ok] of checks) { console.log(`${ok ? "PASS" : "FAIL"}: ${label}`); if (!ok) failed++; }
process.exit(failed === 0 ? 0 : 1);
