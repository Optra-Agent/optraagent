/**
 * Prints the exact-value approval packet for one minimal BuyPutSpread, from live Robinhood Mainnet reads.
 * Read-only: eth_call / eth_estimateGas with state overrides. Nothing is signed or broadcast.
 * Usage: bun run scripts/callput-robinhood-approval-packet.ts <signerAddress> [AAPL] [size]
 */
import { createPublicClient, encodeAbiParameters, getAddress, http, keccak256, pad, toHex, type Address } from "viem";
import { robinhoodMainnet } from "../lib/chain/robinhood";
import { CALLPUT_ROBINHOOD_CONTRACTS as C, fetchCallPutRobinhoodMarketData } from "../lib/venue/callput-robinhood-readonly";
import { CALLPUT_APPROVAL_SPENDER, formatUsdgRaw, prepareCallPutOpenSpread, readCallPutWalletState } from "../lib/venue/callput-robinhood-write";

const [signerArg, underlying = "AAPL", size = "0.1"] = process.argv.slice(2);
if (!signerArg) throw new Error("Usage: <signerAddress> [underlying] [size]");
const signer = getAddress(signerArg);
const client = createPublicClient({ chain: robinhoodMainnet, transport: http() });
const block = await client.getBlockNumber();
const gasPrice = await client.getGasPrice();
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
const [approve, open] = plan.transactions;

const mapSlot = (h: Address, s: bigint) => keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [h, s]));
const nested = (o: Address, sp: Address, s: bigint) => keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [sp, mapSlot(o, s)]));
const big = pad(toHex(10n ** 12n), { size: 32 });
const override = [{ address: signer, balance: 10n ** 18n }, { address: C.usdg as Address, stateDiff: [
  { slot: mapSlot(signer, 1n), value: big }, { slot: nested(signer, CALLPUT_APPROVAL_SPENDER as Address, 3n), value: big },
] }];
const approveGas = await client.estimateGas({ account: signer, to: approve.to, data: approve.data, value: 0n, stateOverride: override });
const openGas = await client.estimateGas({ account: signer, to: open.to, data: open.data, value: open.value, stateOverride: override });
const key = (await client.call({ account: signer, to: open.to, data: open.data, value: open.value, stateOverride: override })).data;
const ceil = (g: bigint) => (g * 13n) / 10n;
const eth = (w: bigint) => `${w} wei (${Number(w) / 1e18} ETH)`;

console.log(JSON.stringify({
  chainId: 4663, block: block.toString(), signer,
  signerState: { usdgRaw: real.usdgBalanceRaw.toString(), usdgAllowanceToController: real.usdgAllowanceRaw.toString(), ethWei: real.nativeBalanceWei.toString(), executionFeeWei: real.executionFeeWei.toString() },
  quoteStatus: { marketTimestampMs: market.timestampMs, marketAgeMs: Date.now() - market.timestampMs, quoteType: long.quoteType, longAvailable: long.marketAvailable, shortAvailable: short.marketAvailable, spotRaw: spot, longMarkRaw: long.markPriceRaw, shortMarkRaw: short.markPriceRaw, longRiskPremiumRate: long.riskPremiumRateForBuy, shortRiskPremiumRate: short.riskPremiumRateForBuy, executableVenueQuote: false, reason: "Feed marks are indicative; no executable order-specific quote was returned." },
  legs: { expiryUnix: expiry, long: { instrument: long.instrument, optionId: long.optionId }, short: { instrument: short.instrument, optionId: short.optionId } },
  size, sizeRaw: plan.sizeRaw.toString(), minSizeRaw: plan.minSizeRaw.toString(), amountInRaw: plan.quote.amountInRaw.toString(), amountInUsdg: formatUsdgRaw(plan.quote.amountInRaw),
  tx1: { to: approve.to, spender: CALLPUT_APPROVAL_SPENDER, value: "0", data: approve.data, gasEstimate: approveGas.toString(), gasCeiling: ceil(approveGas).toString() },
  tx2: { to: open.to, value: open.value.toString(), data: open.data, gasEstimate: openGas.toString(), gasCeiling: ceil(openGas).toString() },
  gasPriceWei: gasPrice.toString(),
  worstCaseGasCostWei: ((ceil(approveGas) + ceil(openGas)) * gasPrice).toString(),
  worstCaseEthNeeded: eth(open.value + (ceil(approveGas) + ceil(openGas)) * gasPrice),
  simulatedRequestKey: key,
}, null, 2));
