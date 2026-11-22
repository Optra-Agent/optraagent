/**
 * Local-fork helpers shared by the CallPut fork scripts. NEVER point these at a real RPC: they write storage,
 * impersonate accounts and move time, all of which only exist on an anvil fork.
 */
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
  pad,
  parseAbi,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import { robinhoodMainnet } from "../lib/chain/robinhood";
import { CALLPUT_ROBINHOOD_CONTRACTS as C, fetchCallPutRobinhoodMarketData } from "../lib/venue/callput-robinhood-readonly";
import { CALLPUT_WRITE_ABIS, type CallPutSpreadStrategy } from "../lib/venue/callput-robinhood-write";

export const FORK_RPC = process.env.FORK_RPC ?? "http://127.0.0.1:8561";
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(FORK_RPC)) throw new Error("Refusing to run: FORK_RPC must be a local anvil fork.");

/** Venue-internal contracts used only for fork keeper rehearsal. */
export const KEEPER_ABI = parseAbi([
  "function executePositions(uint256 endIndex, address feeReceiver)",
  "function getRequestQueueLengths() view returns (uint256, uint256, uint256)",
  "function positionRequestKeys(uint256) view returns (bytes32)",
  "function positionRequestKeysStart() view returns (uint256)",
  "function positionRequestTypes(uint256) view returns (uint8)",
]);

export const chain = { ...robinhoodMainnet, rpcUrls: { default: { http: [FORK_RPC] } } };
// A cold fork fetches venue state from the upstream RPC on first use, so the first calls can take a while.
export const publicClient = createPublicClient({ chain, transport: http(FORK_RPC, { timeout: 180_000 }) });
export const usdg = C.usdg as Address;
export const rpcCall = (method: string, params: unknown[] = []) => publicClient.request({ method: method as never, params: params as never });

/** Public, well-known test mnemonic. Funds exist only on the local fork. */
export function forkAccount(addressIndex: number) {
  return mnemonicToAccount("test test test test test test test test test test test junk", { addressIndex });
}
/** A throwaway key that exists only in this process, for a fork-only signer that must have no code on chain. */
export function freshForkWallet() {
  const account = privateKeyToAccount(generatePrivateKey());
  return { account, wallet: createWalletClient({ account, chain, transport: http(FORK_RPC, { timeout: 180_000 }) }) };
}
export function forkWallet(addressIndex: number) {
  const account = forkAccount(addressIndex);
  return { account, wallet: createWalletClient({ account, chain, transport: http(FORK_RPC, { timeout: 180_000 }) }) };
}

const mapSlot = (holder: Address, slot: bigint) => keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [holder, slot]));

export async function assertForkChain() {
  const chainId = await publicClient.getChainId();
  if (chainId !== 4663) throw new Error(`Fork reports chain ${chainId}, expected 4663 (start anvil with --chain-id 4663).`);
  // Lifecycle runs warp the fork clock (market open, then past expiry). A fork that an earlier run already advanced
  // starts after the expiry of the options this script is about to open, which fails with "OptionsMarket: Invalid expiry".
  const skewSeconds = Number((await publicClient.getBlock()).timestamp) - Math.floor(Date.now() / 1000);
  if (skewSeconds > 2 * 3600) throw new Error(`Fork clock is ${Math.round(skewSeconds / 3600)} h ahead of real time: an earlier run already advanced it. Restart anvil for a fresh fork before running this script.`);
}

export async function fundWithUsdg(account: Address, raw: bigint, ethWei = 10n ** 18n) {
  await rpcCall("anvil_setBalance", [account, toHex(ethWei)]);
  for (let slot = 0n; slot < 24n; slot++) {
    await rpcCall("anvil_setStorageAt", [usdg, mapSlot(account, slot), pad(toHex(raw), { size: 32 })]);
    const balance = await publicClient.readContract({ address: usdg, abi: CALLPUT_WRITE_ABIS.erc20, functionName: "balanceOf", args: [account] });
    if (balance === raw) return slot;
    await rpcCall("anvil_setStorageAt", [usdg, mapSlot(account, slot), pad("0x0", { size: 32 })]);
  }
  throw new Error("Could not fund the fork account with USDG (no balance slot found).");
}

export async function pickSpreadLegs(underlying: string, strategy: CallPutSpreadStrategy, minDays: number) {
  const market = await fetchCallPutRobinhoodMarketData();
  const side = strategy.includes("Call") ? "call" : "put";
  const now = Date.now() / 1000;
  const legs = market.options
    .filter((o) => o.underlyingSymbol === underlying && o.side === side && o.marketAvailable && o.expiryTimestamp - now > minDays * 86_400)
    .sort((a, b) => a.expiryTimestamp - b.expiryTimestamp || a.strikePriceRaw - b.strikePriceRaw);
  const expiry = legs[0]?.expiryTimestamp;
  const spot = market.spotIndexRaw[underlying] ?? 0;
  const [first, second] = legs.filter((o) => o.expiryTimestamp === expiry)
    .sort((a, b) => Math.abs(a.strikePriceRaw - spot) - Math.abs(b.strikePriceRaw - spot)).slice(0, 2).sort((a, b) => a.strikePriceRaw - b.strikePriceRaw);
  if (!first || !second) throw new Error("No two available legs found.");
  const [long, short] = side === "put" ? [second, first] : [first, second];
  return { market, long, short };
}

/** Runs a call as an impersonated account on the fork (anvil_impersonateAccount). */
export async function sendAs(from: Address, to: Address, data: Hex, value = 0n) {
  await rpcCall("anvil_impersonateAccount", [from]);
  await rpcCall("anvil_setBalance", [from, toHex(10n ** 18n)]);
  const hash = (await rpcCall("eth_sendTransaction", [{ from, to, data, value: toHex(value), gas: toHex(8_000_000n) }])) as Hex;
  // Anvil's automine can leave an impersonated transaction pending right after evm_setNextBlockTimestamp. Mine it
  // explicitly when no receipt shows up; the extra block (if automine already worked) is harmless.
  let mined = false;
  for (let i = 0; i < 6 && !mined; i++) {
    mined = (await rpcCall("eth_getTransactionReceipt", [hash])) !== null;
    if (!mined) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!mined) await rpcCall("anvil_mine", ["0x1"]);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  await rpcCall("anvil_stopImpersonatingAccount", [from]);
  return { hash, receipt };
}

export const addr = (value: string) => getAddress(value);

// ---------------------------------------------------------------------------------------------------------------
// Keeper and time fixtures. These call the venue's real contracts as the real keeper address, on the fork only.
// ---------------------------------------------------------------------------------------------------------------

/** The EOA that sent the real mainnet keeper transaction 0xcd4e361b…5dfe (isKeeper on the venue authority). */
export const REAL_KEEPER = "0x0c05A845f1c20A763789caCEB6Eca703cF200BaA" as Address;

const FAST_FEED_ABI = parseAbi([
  "function setPricesAndRiskPremiumsWithBitsAndExecute(address positionManager, uint256[] markPriceBitArray, uint256[] riskPremiumBitArray, uint256[] optionTokenIds, uint256[] requestIndexes, uint256 timestamp, uint256 endIndexForPositions, uint256 maxPositions)",
]);
const SETTLE_FEED_ABI = parseAbi(["function feedSettlePrices(address[] tokens, uint256[] settlePrices, uint256 expiry)"]);
const MARKET_ABI = parseAbi(["function getUnderlyingAssetByIndex(uint16) view returns (address, uint8)"]);

export type KeeperRequest = { optionTokenId: bigint; requestIndex: bigint; markPriceUsd: number; riskPremiumUsd: number };

/** Server price units: 32-bit slots, 0.001 USD each, eight option tokens per word (FastPriceFeed._setPricesAndRiskPremiumsWithBits). */
export function packKeeperBits(values: number[]): bigint[] {
  const words: bigint[] = [];
  for (let i = 0; i < values.length; i += 8) {
    let word = 0n;
    values.slice(i, i + 8).forEach((value, j) => {
      const units = BigInt(Math.round(value * 1000));
      if (units < 0n || units > 0xffffffffn) throw new RangeError("keeper price does not fit 32 bits");
      word |= units << BigInt(32 * j);
    });
    words.push(word);
  }
  return words;
}

export async function latestTimestamp() {
  return Number((await publicClient.getBlock()).timestamp);
}

/** Sets the timestamp of the next mined block (anvil keeps later blocks on that clock). */
export async function setNextBlockTimestamp(timestamp: number) {
  await rpcCall("evm_setNextBlockTimestamp", [toHex(timestamp)]);
}

const SPOT_FEED_ABI = parseAbi([
  "function spotPrices(address token) view returns (uint256)",
  "function lastUpdatedAt() view returns (uint256)",
  "function feedSpotPrices(address[] tokens, uint256[] spotPrices, uint256 deadline)",
]);

/**
 * The venue refuses every fill when the spot feed is older than its updateDuration (5 minutes): the real spot keeper
 * pushes prices continuously, but the harness warps the fork clock to a market-hours timestamp that can be a day or
 * more ahead. Act as that keeper and republish the venue's own current spot prices one second before `timestamp`
 * (no price values are invented; only lastUpdatedAt advances). Called before every keeper pass, including the
 * deliberately stale one, so that scenario cancels because option prices are stale, not because the spot feed was.
 */
export async function refreshSpotFeed(timestamp: number) {
  const tokens: Address[] = [];
  const prices: bigint[] = [];
  // Venue asset indices start at 1 (index 0 reverts).
  for (let index = 1; index < 64; index++) {
    let token: Address;
    try {
      [token] = await publicClient.readContract({ address: C.optionsMarket as Address, abi: MARKET_ABI, functionName: "getUnderlyingAssetByIndex", args: [index] });
    } catch {
      break;
    }
    const price = await publicClient.readContract({ address: C.spotPriceFeed as Address, abi: SPOT_FEED_ABI, functionName: "spotPrices", args: [token] });
    if (price > 0n) { tokens.push(token); prices.push(price); }
  }
  if (!tokens.length) throw new Error("No spot prices found to refresh on the fork.");
  const at = timestamp - 1;
  if ((await latestTimestamp()) >= at) throw new Error(`Cannot refresh the spot feed at ${at}: the fork clock is already at ${await latestTimestamp()}.`);
  await setNextBlockTimestamp(at);
  const receipt = await sendAs(REAL_KEEPER, C.spotPriceFeed as Address, encodeFunctionData({ abi: SPOT_FEED_ABI, functionName: "feedSpotPrices", args: [tokens, prices, BigInt(at + 3600)] }));
  return receipt;
}

/** One keeper pass at `timestamp`: sets mark price and risk premium for the listed requests, then executes the queue. */
export async function keeperPass(requests: KeeperRequest[], timestamp: number) {
  const pm = C.positionManager as Address;
  const lens = await publicClient.readContract({ address: pm, abi: KEEPER_ABI, functionName: "getRequestQueueLengths" });
  const data = encodeFunctionData({
    abi: FAST_FEED_ABI,
    functionName: "setPricesAndRiskPremiumsWithBitsAndExecute",
    args: [pm, packKeeperBits(requests.map((r) => r.markPriceUsd)), packKeeperBits(requests.map((r) => r.riskPremiumUsd)), requests.map((r) => r.optionTokenId), requests.map((r) => r.requestIndex), BigInt(timestamp), lens[1], 12n],
  });
  await refreshSpotFeed(timestamp);
  await setNextBlockTimestamp(timestamp);
  return sendAs(REAL_KEEPER, C.fastPriceFeed as Address, data);
}

/** A keeper pass that executes the queue without publishing fresh prices: the venue cancels instead of filling. */
export async function staleKeeperPass(timestamp: number) {
  const pm = C.positionManager as Address;
  const lens = await publicClient.readContract({ address: pm, abi: KEEPER_ABI, functionName: "getRequestQueueLengths" });
  await refreshSpotFeed(timestamp);
  await setNextBlockTimestamp(timestamp);
  return sendAs(C.fastPriceFeed as Address, pm, encodeFunctionData({ abi: KEEPER_ABI, functionName: "executePositions", args: [lens[1], "0x000000000000000000000000000000000000dEaD"] }));
}

export async function queueIndexOfLastRequest() {
  const lens = await publicClient.readContract({ address: C.positionManager as Address, abi: KEEPER_ABI, functionName: "getRequestQueueLengths" });
  return lens[1] - 1n;
}

/** Feeds the expiry settle price (1e30 USD units) the way the venue keeper does after expiry. */
export async function feedSettlePrice(underlyingAssetIndex: number, expiry: number, priceUsd: number, timestamp: number) {
  const [asset] = await publicClient.readContract({ address: C.optionsMarket as Address, abi: MARKET_ABI, functionName: "getUnderlyingAssetByIndex", args: [underlyingAssetIndex] });
  await setNextBlockTimestamp(timestamp);
  const data = encodeFunctionData({ abi: SETTLE_FEED_ABI, functionName: "feedSettlePrices", args: [[asset], [BigInt(Math.round(priceUsd * 1e6)) * 10n ** 24n], BigInt(expiry)] });
  return sendAs(REAL_KEEPER, C.settlePriceFeed as Address, data);
}

const PRICE_ONLY_ABI = parseAbi([
  "function setPricesAndRiskPremiumsWithBits(uint256[] markPriceBitArray, uint256[] riskPremiumBitArray, uint256[] optionTokenIds, uint256[] requestIndexes, uint256 timestamp)",
]);

/** Publishes keeper prices without executing the queue, so the execution step can be simulated and debugged. */
export async function keeperPricesOnly(requests: KeeperRequest[], timestamp: number) {
  const data = encodeFunctionData({
    abi: PRICE_ONLY_ABI,
    functionName: "setPricesAndRiskPremiumsWithBits",
    args: [packKeeperBits(requests.map((r) => r.markPriceUsd)), packKeeperBits(requests.map((r) => r.riskPremiumUsd)), requests.map((r) => r.optionTokenId), requests.map((r) => r.requestIndex), BigInt(timestamp)],
  });
  await refreshSpotFeed(timestamp);
  await setNextBlockTimestamp(timestamp);
  return sendAs(REAL_KEEPER, C.fastPriceFeed as Address, data);
}
