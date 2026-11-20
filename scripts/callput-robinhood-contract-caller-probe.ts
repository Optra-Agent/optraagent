/**
 * Read-only probe: does CallPut's Controller accept a CONTRACT as msg.sender (smart-account / session-key path)?
 * Simulates createOpenPosition from the same address twice (as an EOA, then with contract code injected).
 * Read-only: eth_call / eth_estimateGas with state overrides. Nothing is signed or broadcast.
 * Usage: bun run scripts/callput-robinhood-contract-caller-probe.ts <address> [AAPL] [size]
 */
import { createPublicClient, encodeAbiParameters, getAddress, http, keccak256, pad, toHex, type Address } from "viem";
import { robinhoodMainnet } from "../lib/chain/robinhood";
import { CALLPUT_ROBINHOOD_CONTRACTS as C, fetchCallPutRobinhoodMarketData } from "../lib/venue/callput-robinhood-readonly";
import { CALLPUT_APPROVAL_SPENDER, prepareCallPutOpenSpread, readCallPutWalletState } from "../lib/venue/callput-robinhood-write";

const [signerArg, underlying = "AAPL", size = "0.1"] = process.argv.slice(2);
if (!signerArg) throw new Error("Usage: <signerAddress> [underlying] [size]");
const signer = getAddress(signerArg);
const client = createPublicClient({ chain: robinhoodMainnet, transport: http() });
const block = await client.getBlockNumber();
const market = await fetchCallPutRobinhoodMarketData();
const now = Date.now() / 1000;
const spot = market.spotIndexRaw[underlying] ?? 0;
const legs = market.options
  .filter((o) => o.underlyingSymbol === underlying && o.side === "put" && o.marketAvailable && o.expiryTimestamp - now > 3 * 86_400)
  .sort((a, b) => a.expiryTimestamp - b.expiryTimestamp);
const expiry = legs[0]?.expiryTimestamp;
const near = legs.filter((o) => o.expiryTimestamp === expiry).sort((a, b) => Math.abs(a.strikePriceRaw - spot) - Math.abs(b.strikePriceRaw - spot)).slice(0, 2).sort((a, b) => b.strikePriceRaw - a.strikePriceRaw);
const [long, short] = near;
if (!long || !short) throw new Error("No two available legs.");

const real = await readCallPutWalletState(client, signer);
// For gas estimation only, assume the signer is funded and approved so the call path is exercised.
const sim = { ...real, usdgBalanceRaw: 10n ** 9n, nativeBalanceWei: 10n ** 18n, usdgAllowanceRaw: 0n };
const plan = prepareCallPutOpenSpread({
  strategy: "BuyPutSpread", underlying, longOptionId: long.optionId, shortOptionId: short.optionId, size,
  maxCollateralRaw: 1_000_000n, market, wallet: sim, nowMs: Date.now(),
});
const open = plan.transactions[1];

const mapSlot = (h: Address, s: bigint) => keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [h, s]));
const nested = (o: Address, sp: Address, s: bigint) => keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [sp, mapSlot(o, s)]));
const big = pad(toHex(10n ** 12n), { size: 32 });
const base = [{ address: signer, balance: 10n ** 18n }];
const usdgDiff = { address: C.usdg as Address, stateDiff: [
  { slot: mapSlot(signer, 1n), value: big }, { slot: nested(signer, CALLPUT_APPROVAL_SPENDER as Address, 3n), value: big },
] };
async function attempt(label: string, withCode: boolean) {
  const override = [{ ...base[0], ...(withCode ? { code: "0x00" as `0x${string}` } : {}) }, usdgDiff];
  try {
    const key = (await client.call({ account: signer, to: open.to, data: open.data, value: open.value, stateOverride: override })).data;
    const gas = await client.estimateGas({ account: signer, to: open.to, data: open.data, value: open.value, stateOverride: override });
    return { label, accepted: true, requestKey: key, gas: gas.toString() };
  } catch (e) {
    return { label, accepted: false, error: String((e as Error).message).split("\n").slice(0, 3).join(" | ") };
  }
}
console.log(JSON.stringify({ chainId: 4663, block: block.toString(), address: signer, results: [await attempt("eoa", false), await attempt("contract-caller", true)] }, null, 2));
