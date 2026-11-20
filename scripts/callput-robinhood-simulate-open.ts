/**
 * Safe simulation of the CallPut Robinhood open-spread call. eth_call only: nothing is signed or broadcast.
 * Usage: bun run scripts/callput-robinhood-simulate-open.ts [AAPL] [BuyPutSpread] [size]
 *
 * The simulated sender is a throwaway address. Its USDG balance and its allowance to the venue Controller are
 * injected with `stateOverride`, found by trying ERC-20 mapping slots, so the call exercises the real
 * PositionManager/Controller code path. A returned bytes32 means the calldata, caller model and approval
 * spender are accepted by the deployed contracts at the simulated block. It is NOT a fill.
 */
import { createPublicClient, encodeAbiParameters, http, keccak256, pad, toHex, type Address } from "viem";
import { robinhoodMainnet } from "../lib/chain/robinhood";
import {
  CALLPUT_ROBINHOOD_CONTRACTS as C,
  fetchCallPutRobinhoodMarketData,
} from "../lib/venue/callput-robinhood-readonly";
import { prepareCallPutOpenSpread, readCallPutWalletState, type CallPutSpreadStrategy } from "../lib/venue/callput-robinhood-write";

const [underlying = "AAPL", strategy = "BuyPutSpread", size = "1"] = process.argv.slice(2);
const sender = "0x00000000000000000000000000000000c0ffee01" as Address;
const client = createPublicClient({ chain: robinhoodMainnet, transport: http() });

const market = await fetchCallPutRobinhoodMarketData();
const side = strategy.includes("Call") ? "call" : "put";
const now = Date.now() / 1000;
const legs = market.options
  .filter((o) => o.underlyingSymbol === underlying && o.side === side && o.marketAvailable && o.expiryTimestamp - now > 3 * 86_400)
  .sort((a, b) => a.expiryTimestamp - b.expiryTimestamp || a.strikePriceRaw - b.strikePriceRaw);
const expiry = legs[0]?.expiryTimestamp;
const sameExpiry = legs.filter((o) => o.expiryTimestamp === expiry);
const spot = market.spotIndexRaw[underlying] ?? 0;
const nearest = [...sameExpiry].sort((a, b) => Math.abs(a.strikePriceRaw - spot) - Math.abs(b.strikePriceRaw - spot));
const [first, second] = nearest.slice(0, 2).sort((a, b) => a.strikePriceRaw - b.strikePriceRaw);
if (!first || !second) throw new Error("No two available legs found.");
const [long, short] = side === "put" ? [second, first] : [first, second];

const state = await readCallPutWalletState(client, sender);
const plan = prepareCallPutOpenSpread({
  strategy: strategy as CallPutSpreadStrategy, underlying, longOptionId: long.optionId, shortOptionId: short.optionId, size, market,
  wallet: { ...state, usdgBalanceRaw: 10n ** 9n, usdgAllowanceRaw: 10n ** 9n, nativeBalanceWei: 10n ** 18n }, nowMs: Date.now(),
});
const open = plan.transactions.at(-1)!;
console.log(`legs: long ${long.instrument}, short ${short.instrument}; estimated collateral ${plan.quote.amountInRaw} raw USDG; fee ${open.value} wei`);

const mapSlot = (holder: Address, slot: bigint) => keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [holder, slot]));
const nestedSlot = (owner: Address, spender: Address, slot: bigint) => keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [spender, mapSlot(owner, slot)]));
const big = pad(toHex(10n ** 12n), { size: 32 });
const call = (stateDiff: Array<{ slot: `0x${string}`; value: `0x${string}` }>) => client.call({
  account: sender, to: open.to, data: open.data, value: open.value,
  stateOverride: [{ address: sender, balance: 10n ** 18n }, { address: C.usdg as Address, stateDiff }],
});

try {
  await call([]);
  console.log("UNEXPECTED: simulation succeeded without funds/allowance");
} catch {
  console.log("control: reverts without USDG allowance, as expected");
}
// Discover the allowance slot first (the known holder-funded control), then the balance slot, independently.
const sims = async (balanceSlot: bigint, allowanceSlot: bigint) => call([
  { slot: mapSlot(sender, balanceSlot), value: big },
  { slot: nestedSlot(sender, C.controller as Address, allowanceSlot), value: big },
]);
for (let balanceSlot = 0n; balanceSlot < 24n; balanceSlot++) {
  for (let allowanceSlot = 0n; allowanceSlot < 24n; allowanceSlot++) {
    try {
      const out = await sims(balanceSlot, allowanceSlot);
      console.log(`PASS (ERC-20 balance slot ${balanceSlot}, allowance slot ${allowanceSlot}): PositionManager returned request key ${out.data}`);
      process.exit(0);
    } catch {
      // try the next slot pair
    }
  }
}
console.error("FAIL: no mapping slot made the simulation succeed.");
process.exit(1);
