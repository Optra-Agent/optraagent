/**
 * Read-only acceptance preflight for one CallPut open spread on Robinhood Mainnet. Signs and sends nothing.
 *
 * Usage: SIGNER=0x... bun run scripts/callput-candidate-order.ts [AAPL] [BuyPutSpread] [size] [minDaysToExpiry]
 * With SIGNER unset it uses a placeholder wallet (calldata does not depend on the signer: the signer is msg.sender).
 *
 * What it proves from live chain data: both legs are listed and available in the feed, the venue Controller itself
 * validates the exact spread structure (validateOpenPosition, an eth_call), the quote and exposure, the signer's
 * USDG, ETH and allowance. Plain EOAs have no receiver code; contract-wallet compatibility is fail-closed unless
 * the deployed CallPut token callback behavior has been verified.
 */
import { createPublicClient, decodeFunctionData, encodeFunctionData, formatEther, getAddress, http, parseAbi, type Address } from "viem";
import { robinhoodMainnet } from "../lib/chain/robinhood";
import { CALLPUT_ROBINHOOD_CONTRACTS as C, fetchCallPutRobinhoodMarketData } from "../lib/venue/callput-robinhood-readonly";
import { CALLPUT_WRITE_ABIS, formatUsdgRaw, prepareCallPutCandidatePlan, prepareCallPutOpenSpread, readCallPutWalletState, type CallPutSpreadStrategy } from "../lib/venue/callput-robinhood-write";

const [underlying = "AAPL", strategy = "BuyPutSpread", size = "0.1", minDays = "3"] = process.argv.slice(2);
const signerEnv = process.env.SIGNER;
const placeholder = "0x00000000000000000000000000000000c0ffee01" as Address;
const signer = signerEnv ? getAddress(signerEnv) : placeholder;
const client = createPublicClient({ chain: robinhoodMainnet, transport: http() });

const market = await fetchCallPutRobinhoodMarketData();
const side = strategy.includes("Call") ? "call" : "put";
const now = Date.now() / 1000;
const legs = market.options
  .filter((o) => o.underlyingSymbol === underlying && o.side === side && o.marketAvailable && o.expiryTimestamp - now > Number(minDays) * 86_400)
  .sort((a, b) => a.expiryTimestamp - b.expiryTimestamp || a.strikePriceRaw - b.strikePriceRaw);
const expiry = legs[0]?.expiryTimestamp;
const spot = market.spotIndexRaw[underlying] ?? 0;
const [first, second] = legs.filter((o) => o.expiryTimestamp === expiry)
  .sort((a, b) => Math.abs(a.strikePriceRaw - spot) - Math.abs(b.strikePriceRaw - spot)).slice(0, 2).sort((a, b) => a.strikePriceRaw - b.strikePriceRaw);
if (!first || !second) throw new Error("No two adjacent available legs found.");
const [long, short] = side === "put" ? [second, first] : [first, second];

const state = await readCallPutWalletState(client, signer);
const input = { strategy: strategy as CallPutSpreadStrategy, underlying, longOptionId: long.optionId, shortOptionId: short.optionId, size, market, nowMs: Date.now() };
// What the panel would do for this exact wallet.
let prepareResult: { ok: true; transactions: string[] } | { ok: false; blocked: string };
try {
  prepareResult = { ok: true, transactions: prepareCallPutOpenSpread({ ...input, wallet: state }).transactions.map((t) => t.kind) };
} catch (error) {
  prepareResult = { ok: false, blocked: error instanceof Error ? error.message : String(error) };
}
// Structure, quote and calldata with ample funds so they are shown even when the signer is short.
const structural = prepareCallPutCandidatePlan({ ...input, wallet: state });
const open = structural.transactions.at(-1)!;
const approve = structural.transactions[0]!;

// The venue Controller validates the exact spread (legs, expiry, strikes, listing) as PositionManager does at execution.
const decoded = decodeFunctionData({ abi: CALLPUT_WRITE_ABIS.positionManager, data: open.data });
const [assetIndex, length, isBuys, optionIds, isCalls] = decoded.args as unknown as [number, number, readonly boolean[], readonly `0x${string}`[], readonly boolean[]];
const validateAbi = parseAbi(["function validateOpenPosition(uint16,uint8,bool[4],bytes32[4],bool[4]) view returns (uint40,uint256,uint256)"]);
let controllerValidation: { ok: boolean; expiryUtc?: string; error?: string };
try {
  const result = await client.call({
    to: C.controller as Address,
    data: encodeFunctionData({ abi: validateAbi, functionName: "validateOpenPosition", args: [assetIndex, length, isBuys as never, optionIds as never, isCalls as never] }),
  });
  const expiryOnChain = Number(BigInt(result.data!.slice(0, 66)));
  controllerValidation = { ok: expiryOnChain === long.expiryTimestamp, expiryUtc: new Date(expiryOnChain * 1000).toISOString() };
} catch (error) {
  controllerValidation = { ok: false, error: String((error as Error).message).split("\n")[0] };
}
const block = await client.getBlock();

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  chainId: 4663,
  latestBlock: block.number.toString(),
  feedAgeNote: "Quote is an estimate and must be re-prepared in the panel if older than 60 seconds at signing time.",
  underlying, strategy,
  longLeg: { instrument: long.instrument, optionId: long.optionId, strikeUsd: long.strikePriceRaw, markUsd: long.markPriceRaw },
  shortLeg: { instrument: short.instrument, optionId: short.optionId, strikeUsd: short.strikePriceRaw, markUsd: short.markPriceRaw },
  expiryUtc: new Date(long.expiryTimestamp * 1000).toISOString(),
  spotUsd: spot,
  size, sizeRaw: structural.sizeRaw.toString(), minSizeRaw: structural.minSizeRaw.toString(),
  estimatedExecutionPricePerUnitUsdg: structural.quote.estimatedExecutionPrice,
  estimatedPremiumUsdg: structural.quote.estimatedExecutionPrice * Number(size),
  estimatedOpenFeeUsdg: structural.quote.estimatedOpenFeeUsdg,
  riskPremiumRate: structural.quote.riskPremiumRate,
  maxUsdgExposure: `${formatUsdgRaw(structural.quote.amountInRaw)} (${structural.quote.amountInRaw} raw)`,
  executionFeeEth: formatEther(open.value),
  venueValidation: { feedBothLegsAvailable: long.marketAvailable && short.marketAvailable, controllerValidateOpenPosition: controllerValidation },
  signer: signerEnv ? {
    address: signer,
    usdgBalance: formatUsdgRaw(state.usdgBalanceRaw),
    usdgAllowanceToController: formatUsdgRaw(state.usdgAllowanceRaw),
    ethBalance: formatEther(state.nativeBalanceWei),
    acceptsErc1155PositionTokens: state.accountAcceptsErc1155,
    coversMaxExposure: state.usdgBalanceRaw >= structural.quote.amountInRaw,
    coversExecutionFeePlusGas: state.nativeBalanceWei > open.value + 2_000_000_000_000n,
    approvalNeeded: state.usdgAllowanceRaw < structural.quote.amountInRaw,
    prepareResult,
  } : "not provided (set SIGNER=0x... to check a specific wallet)",
  transactions: [
    { step: 1, kind: approve.kind, to: approve.to, valueWei: approve.value.toString(), data: approve.data, note: "skipped by the panel when the allowance already covers the amount" },
    { step: 2, kind: open.kind, to: open.to, valueWei: open.value.toString(), data: open.data },
  ],
}, null, 2));
