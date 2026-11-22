/**
 * Prints one fresh, fully specified CallPut candidate order from live venue data. Read-only: nothing is signed,
 * sent or approved. The calldata does not depend on the signer's address (the signer is msg.sender), so the
 * owner can compare every field with the review screen in their own wallet.
 * Usage: bun run scripts/callput-candidate-order.ts [AAPL] [BuyPutSpread] [size] [minDaysToExpiry]
 */
import { createPublicClient, formatEther, http, type Address } from "viem";
import { robinhoodMainnet } from "../lib/chain/robinhood";
import { fetchCallPutRobinhoodMarketData } from "../lib/venue/callput-robinhood-readonly";
import { formatUsdgRaw, prepareCallPutOpenSpread, readCallPutWalletState, type CallPutSpreadStrategy } from "../lib/venue/callput-robinhood-write";

const [underlying = "AAPL", strategy = "BuyPutSpread", size = "0.1", minDays = "3"] = process.argv.slice(2);
const placeholder = "0x00000000000000000000000000000000c0ffee01" as Address;
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

const state = await readCallPutWalletState(client, placeholder);
const plan = prepareCallPutOpenSpread({
  strategy: strategy as CallPutSpreadStrategy, underlying, longOptionId: long.optionId, shortOptionId: short.optionId, size, market,
  wallet: { ...state, usdgBalanceRaw: 10n ** 9n, usdgAllowanceRaw: 0n, nativeBalanceWei: 10n ** 18n }, nowMs: Date.now(),
});
const failed = plan.checks.filter((c) => !c.ok && c.id !== "usdg-allowance");
const open = plan.transactions.at(-1)!;
const approve = plan.transactions[0]!;
const q = plan.quote;
console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  chainId: 4663,
  feedAgeNote: "Quote is an estimate and must be re-prepared if older than 60 seconds at signing time.",
  underlying, strategy,
  longLeg: { instrument: long.instrument, optionId: long.optionId, strikeUsd: long.strikePriceRaw, markUsd: long.markPriceRaw },
  shortLeg: { instrument: short.instrument, optionId: short.optionId, strikeUsd: short.strikePriceRaw, markUsd: short.markPriceRaw },
  expiryUtc: new Date(long.expiryTimestamp * 1000).toISOString(),
  spotUsd: spot,
  size,
  sizeRaw: plan.sizeRaw.toString(),
  minSizeRaw: plan.minSizeRaw.toString(),
  estimatedExecutionPricePerUnitUsdg: q.estimatedExecutionPrice,
  estimatedPremiumUsdg: q.estimatedExecutionPrice * Number(size),
  estimatedOpenFeeUsdg: q.estimatedOpenFeeUsdg,
  riskPremiumRate: q.riskPremiumRate,
  maxUsdgExposure: `${formatUsdgRaw(q.amountInRaw)} (${q.amountInRaw} raw)`,
  executionFeeEth: formatEther(open.value),
  failedChecks: failed,
  transactions: [
    { step: 1, kind: approve.kind, to: approve.to, valueWei: approve.value.toString(), data: approve.data },
    { step: 2, kind: open.kind, to: open.to, valueWei: open.value.toString(), data: open.data },
  ],
}, null, 2));
