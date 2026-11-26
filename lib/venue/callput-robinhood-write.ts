/**
 * CallPut Robinhood Mainnet (chain 4663) — direct-wallet write preparation.
 *
 * Evidence (checked 2026-11-20):
 * - Official CallPut MCP source (github.com/ayggdrasil/callput-option-agent, src/core.ts) and the live
 *   Robinhood MCP profile (`callput_get_network_info`, `callput_execute_spread`) define the calls below.
 *   `execution: unsigned_only` — CallPut never signs for the user; the connected wallet is msg.sender and
 *   the position holder ("direct_wallet" route). Calldata produced here is byte-identical to the venue
 *   MCP's `callput_execute_spread` output for the same inputs (see tests).
 * - Supported opens are two-leg spreads only (BuyCall/SellCall/BuyPut/SellPut Spread). A naked single-leg
 *   open is NOT offered by the venue's own tooling and is intentionally not exported here.
 * - The "CallPut Account" (sponsored relay / session grant) route is a different custody and delegation
 *   model and is NOT implemented here.
 *
 * Nothing in this module signs, sends or simulates a transaction. It only validates, encodes and reconciles.
 * No Solidity is involved.
 */
import {
  decodeEventLog,
  encodeFunctionData,
  getAddress,
  isAddress,
  parseAbi,
  parseUnits,
  zeroAddress,
  zeroHash,
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import {
  CALLPUT_ROBINHOOD_CHAIN_ID,
  CALLPUT_ROBINHOOD_CONTRACTS,
  type CallPutRobinhoodMarketData,
  type CallPutRobinhoodOptionMark,
} from "./callput-robinhood-readonly";
import type { CallPutRobinhoodRequestSnapshot } from "./callput-robinhood-requests";

export const CALLPUT_USDG_DECIMALS = 6;
/** Approval spender for USDG and option tokens: the venue Controller (PositionManager.controller()). */
export const CALLPUT_APPROVAL_SPENDER = CALLPUT_ROBINHOOD_CONTRACTS.controller;

export const CALLPUT_SPREAD_STRATEGIES = ["BuyCallSpread", "SellCallSpread", "BuyPutSpread", "SellPutSpread"] as const;
export type CallPutSpreadStrategy = (typeof CALLPUT_SPREAD_STRATEGIES)[number];

/** Venue network profile (callput_get_network_info, robinhood). Index is `underlyingAssetIndex`. */
export const CALLPUT_ROBINHOOD_UNDERLYINGS = {
  BTC: { index: 1, decimals: 8, optionsToken: "0x080084D6A1e9b6657EDc8DBa071BAa9D15Fcc500" },
  ETH: { index: 2, decimals: 18, optionsToken: "0x84D4ef4062E00F78B0Ea5aaC06D7D08Ab1258B02" },
  TSLA: { index: 3, decimals: 18, optionsToken: "0x9C007762CBf1ABF0Bb3e1C67660023bD3Ad1734D" },
  QQQ: { index: 4, decimals: 18, optionsToken: "0x951D61C56CC4c3b79CF7078C371C474917480FDd" },
  SPY: { index: 5, decimals: 18, optionsToken: "0x334D4fbf590Cbc3553fBdd6f11a2C0d7C1221e8A" },
  EWY: { index: 6, decimals: 18, optionsToken: "0x35D2Cd90b6Ba62ea33F38A711DbB99C6C3D81Ba7" },
  NVDA: { index: 7, decimals: 18, optionsToken: "0xcA2bc103CD18EC0b7646969dcB383D64037cb5bB" },
  COIN: { index: 8, decimals: 18, optionsToken: "0x48E93EbC08ccaa3D3fC9E388bfEfD8209922D1cb" },
  SPCX: { index: 9, decimals: 18, optionsToken: "0x0EAe421365011aE66dfa8bb9D1E8Baee54e5402d" },
  MU: { index: 10, decimals: 18, optionsToken: "0x1868dB80a42E6D303E3A961886ba4534b6f56d40" },
  SKHY: { index: 11, decimals: 18, optionsToken: "0x0a750ABB292C902D9752C5f508Ec6f5ec9Be7FCd" },
  SNDK: { index: 12, decimals: 18, optionsToken: "0x5dBd79079fc1abA28F0a270beEcD855aCda98c88" },
  DRAM: { index: 13, decimals: 18, optionsToken: "0xC3827d938c96232b3a08E83D71D084965Eb7e3Fb" },
  META: { index: 14, decimals: 18, optionsToken: "0x778d648c02c8F521bE22f903Fd2edb8bD6F34DFB" },
  GOOGL: { index: 15, decimals: 18, optionsToken: "0x84d0040153e67618D49C49EDb3f50e6Ed8de0d7D" },
  AAPL: { index: 16, decimals: 18, optionsToken: "0xCa103C4D4bb8CEf8bf3A8622b0a3fCA58d835118" },
  CRCL: { index: 17, decimals: 18, optionsToken: "0x4A87676cbF3d0e725aeF3DaF8962Ea805Dda569e" },
  AMZN: { index: 18, decimals: 18, optionsToken: "0x53a0B4cB036BeCE074194171B3A6f885276d61C3" },
  MSFT: { index: 19, decimals: 18, optionsToken: "0x9AA5a975b26432730173AEeAa20E9DD1C999Ee99" },
  PLTR: { index: 20, decimals: 18, optionsToken: "0x3DbD73E6BE453E79D28968503bb88c6c5f7d12BA" },
} as const satisfies Record<string, { index: number; decimals: number; optionsToken: Address }>;
export type CallPutUnderlyingSymbol = keyof typeof CALLPUT_ROBINHOOD_UNDERLYINGS;

export const CALLPUT_WRITE_ABIS = {
  positionManager: parseAbi([
    "function createOpenPosition(uint16 _underlyingAssetIndex, uint8 _length, bool[4] _isBuys, bytes32[4] _optionIds, bool[4] _isCalls, uint256 _minSize, address[] _path, uint256 _amountIn, uint256 _minOutWhenSwap, address _leadTrader) payable returns (bytes32)",
    "function createClosePosition(uint16 _underlyingAssetIndex, uint256 _optionTokenId, uint256 _size, address[] _path, uint256 _minAmountOut, uint256 _minOutWhenSwap, bool _withdrawNAT) payable returns (bytes32)",
    "function controller() view returns (address)",
    "function executionFee() view returns (uint256)",
    "event GenerateRequestKey(address indexed account, bytes32 indexed key, bool indexed isOpen)",
  ]),
  settleManager: parseAbi([
    "function settlePosition(address[] _path, uint16 _underlyingAssetIndex, uint256 _optionTokenId, uint256 _minOutWhenSwap, bool _withdrawNAT) payable",
    "function controller() view returns (address)",
    "event SettlePosition(address indexed account, uint16 indexed underlyingAssetIndex, uint40 indexed expiry, uint256 optionTokenId, uint256 size, address[] path, uint256 amountOut, uint256 settlePrice)",
  ]),
  erc20: parseAbi([
    "function allowance(address owner, address spender) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)",
    "function balanceOf(address account) view returns (uint256)",
  ]),
  optionsToken: parseAbi([
    "function balanceOfBatch(address[] accounts, uint256[] ids) view returns (uint256[])",
    "function isApprovedForAll(address account, address operator) view returns (bool)",
    "function setApprovalForAll(address operator, bool approved)",
  ]),
} as const;

/** Venue-documented limits and the defaults of the venue's own tooling. */
export const CALLPUT_LIMITS = {
  /** `positionDeadlineBuffer`: no open/close inside the final 30 minutes before expiry. */
  deadlineBufferSeconds: 1_800,
  /** Venue `maxTimeDelay`; a request not processed within this window is stale (outcome still read on-chain). */
  maxTimeDelaySeconds: 180,
  /** Venue tooling refuses market data older than 5 minutes. */
  maxMarketAgeMs: 5 * 60_000,
  /** Venue tooling default minimum fill ratio for the open request (basis points). */
  defaultMinFillBps: 7_800,
  /** Venue tooling per-trade collateral cap (USDG raw, 6 decimals) = 100 USDG. */
  defaultMaxCollateralRaw: 100_000_000n,
  /** Venue tooling refuses an execution fee above 0.0003 ETH. */
  maxExecutionFeeWei: 300_000_000_000_000n,
  openComboFeeRate: 0.0003,
  tradeFeeCapRate: 0.125,
} as const;

export type CallPutPreparedTransaction = {
  kind: "usdg-approval" | "open-spread" | "option-token-approval" | "close-position" | "settle-position";
  label: string;
  chainId: typeof CALLPUT_ROBINHOOD_CHAIN_ID;
  from: Address;
  to: Address;
  data: Hex;
  /** Wei (native ETH). Non-zero only for the execution fee on open/close requests. */
  value: bigint;
};

export type CallPutRiskCheck = { id: string; ok: boolean; detail: string };
export class CallPutRiskError extends Error {
  readonly failed: CallPutRiskCheck[];
  constructor(failed: CallPutRiskCheck[]) {
    super(`CallPut order blocked: ${failed.map((check) => check.detail).join(" ")}`);
    this.name = "CallPutRiskError";
    this.failed = failed;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Option identifiers
// ---------------------------------------------------------------------------------------------------------------

export type DecodedOptionId = { underlyingAssetIndex: number; expiry: number; strike: number };

/** Decodes the leg-level `optionId` layout used by the venue feed (index[255:240], expiry[239:200], strike[199:152]). */
export function decodeCallPutOptionId(optionId: string): DecodedOptionId {
  if (!/^0x[\da-fA-F]{64}$/.test(optionId)) throw new TypeError("CallPut optionId must be bytes32.");
  const id = BigInt(optionId);
  return {
    underlyingAssetIndex: Number((id >> 240n) & 0xffffn),
    expiry: Number((id >> 200n) & 0xffffffffffn),
    // Leg-level optionId stores the USD strike unscaled (the packed optionTokenId, not this id, shifts it by 3 bits).
    strike: Number((id >> 152n) & 0xffffffffffffn),
  };
}

export function callPutUnderlyingByIndex(index: number): CallPutUnderlyingSymbol | null {
  const hit = (Object.keys(CALLPUT_ROBINHOOD_UNDERLYINGS) as CallPutUnderlyingSymbol[])
    .find((symbol) => CALLPUT_ROBINHOOD_UNDERLYINGS[symbol].index === index);
  return hit ?? null;
}

export function isCallPutUnderlying(symbol: string): symbol is CallPutUnderlyingSymbol {
  return Object.prototype.hasOwnProperty.call(CALLPUT_ROBINHOOD_UNDERLYINGS, symbol);
}

// ---------------------------------------------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------------------------------------------

/** Exact decimal string -> raw integer. Rejects excess precision instead of rounding a user's size. */
export function parseCallPutSize(sizeText: string, decimals: number): bigint {
  const text = sizeText.trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) throw new TypeError("Size must be a positive decimal number.");
  const fraction = text.split(".")[1] ?? "";
  if (fraction.length > decimals) throw new RangeError(`Size supports at most ${decimals} decimal places.`);
  const raw = parseUnits(text, decimals);
  if (raw <= 0n) throw new RangeError("Size must be greater than zero.");
  return raw;
}

function usdgToRaw(value: number): bigint {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError("Collateral amount must be positive.");
  const raw = parseUnits(value.toFixed(CALLPUT_USDG_DECIMALS), CALLPUT_USDG_DECIMALS);
  if (raw <= 0n) throw new RangeError("Collateral amount is too small after USDG scaling.");
  return raw;
}

export function formatUsdgRaw(raw: bigint): string {
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const text = abs.toString().padStart(CALLPUT_USDG_DECIMALS + 1, "0");
  const whole = text.slice(0, -CALLPUT_USDG_DECIMALS);
  const fraction = text.slice(-CALLPUT_USDG_DECIMALS);
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Open spread quote (estimate only — the keeper recomputes the execution price)
// ---------------------------------------------------------------------------------------------------------------

export type CallPutSpreadQuote = {
  quoteType: "estimate";
  pricingModel: "spread-risk-premium-plus-protocol-fee-v1";
  strategy: CallPutSpreadStrategy;
  riskPremiumRate: number;
  /** Per underlying unit, in USDG. */
  estimatedExecutionPrice: number;
  estimatedOpenFeeUsdg: number;
  /** Collateral the wallet commits: buys = premium + fee, sells = strike width * size + fee. */
  amountInUsdg: number;
  amountInRaw: bigint;
};

export function estimateCallPutSpreadOpen(params: {
  strategy: CallPutSpreadStrategy;
  /** Underlying units as a plain number, used only for the estimate. */
  sizeUnits: number;
  spotPrice: number;
  long: Pick<CallPutRobinhoodOptionMark, "markPriceRaw" | "strikePriceRaw" | "riskPremiumRateForBuy" | "riskPremiumRateForSell">;
  short: Pick<CallPutRobinhoodOptionMark, "markPriceRaw" | "strikePriceRaw" | "riskPremiumRateForBuy" | "riskPremiumRateForSell">;
}): CallPutSpreadQuote {
  const { strategy, sizeUnits, spotPrice, long, short } = params;
  const isBuy = strategy.startsWith("Buy");
  const spreadMarkPrice = long.markPriceRaw - short.markPriceRaw;
  const strikeDiff = Math.abs(long.strikePriceRaw - short.strikePriceRaw);
  for (const [name, value] of Object.entries({ sizeUnits, spotPrice, spreadMarkPrice, strikeDiff })) {
    if (!Number.isFinite(value) || value <= 0) throw new RangeError(`CallPut quote input ${name} must be positive.`);
  }
  const riskPremiumRate = isBuy
    ? Math.max(long.riskPremiumRateForBuy, short.riskPremiumRateForSell)
    : Math.max(long.riskPremiumRateForSell, short.riskPremiumRateForBuy);
  const estimatedExecutionPrice = spreadMarkPrice * Math.max(0, isBuy ? 1 + riskPremiumRate : 1 - riskPremiumRate);
  const executionPremium = estimatedExecutionPrice * sizeUnits;
  const notionalFee = spotPrice * sizeUnits * CALLPUT_LIMITS.openComboFeeRate;
  const estimatedOpenFeeUsdg = Math.min(notionalFee, executionPremium * CALLPUT_LIMITS.tradeFeeCapRate);
  const amountInUsdg = (isBuy ? executionPremium : strikeDiff * sizeUnits) + estimatedOpenFeeUsdg;
  return {
    quoteType: "estimate",
    pricingModel: "spread-risk-premium-plus-protocol-fee-v1",
    strategy,
    riskPremiumRate,
    estimatedExecutionPrice,
    estimatedOpenFeeUsdg,
    amountInUsdg,
    amountInRaw: usdgToRaw(amountInUsdg),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Open spread plan
// ---------------------------------------------------------------------------------------------------------------

export type CallPutWalletState = {
  chainId: number;
  /** Wallet that signs and will own the position. */
  account: Address;
  usdgBalanceRaw: bigint;
  usdgAllowanceRaw: bigint;
  nativeBalanceWei: bigint;
  executionFeeWei: bigint;
  /**
   * True for an EOA with no receiver code. Contract-wallet behavior is undefined until CallPut's deployed callback path
   * is verified; open preparation must fail closed while it remains unknown.
   */
  accountAcceptsErc1155?: boolean;
};

export type CallPutOpenSpreadInput = {
  strategy: CallPutSpreadStrategy;
  underlying: string;
  longOptionId: Hex;
  shortOptionId: Hex;
  /** Decimal underlying units, e.g. "0.5". Parsed exactly; never rounded. */
  size: string;
  /** Basis points of `size` the keeper must fill at least (1–10000). */
  minFillBps?: number;
  /** Hard ceiling for collateral committed (USDG raw). */
  maxCollateralRaw?: bigint;
  /**
   * Skip the USDG-balance and ETH-balance throws so the caller can show exact shortfalls from
   * `evaluateOrderPreflight` and keep signing disabled, instead of an error with no transaction details.
   * Every other check still throws. The live-agent path never sets this.
   */
  deferFundingChecks?: boolean;
  market: CallPutRobinhoodMarketData;
  wallet: CallPutWalletState;
  nowMs: number;
};

export type CallPutOpenSpreadPlan = {
  intent: CallPutOrderIntent;
  quote: CallPutSpreadQuote;
  sizeRaw: bigint;
  minSizeRaw: bigint;
  legs: { long: CallPutRobinhoodOptionMark; short: CallPutRobinhoodOptionMark };
  checks: CallPutRiskCheck[];
  /** Ordered. Wallet signs each only after explicit per-transaction review. */
  transactions: CallPutPreparedTransaction[];
};

function findLeg(market: CallPutRobinhoodMarketData, optionId: Hex, side: "call" | "put") {
  const target = BigInt(optionId);
  return market.options.find((option) => option.side === side && BigInt(option.optionId) === target) ?? null;
}

export function prepareCallPutOpenSpread(input: CallPutOpenSpreadInput): CallPutOpenSpreadPlan {
  const symbol = input.underlying.trim().toUpperCase();
  if (!isCallPutUnderlying(symbol)) throw new CallPutRiskError([{ id: "underlying", ok: false, detail: `${input.underlying} is not a configured CallPut Robinhood underlying.` }]);
  if (!CALLPUT_SPREAD_STRATEGIES.includes(input.strategy)) throw new CallPutRiskError([{ id: "strategy", ok: false, detail: `${String(input.strategy)} is not a supported open strategy.` }]);

  const meta = CALLPUT_ROBINHOOD_UNDERLYINGS[symbol];
  const isBuy = input.strategy.startsWith("Buy");
  const side = input.strategy.includes("Call") ? "call" : "put";
  const isCall = side === "call";
  const checks: CallPutRiskCheck[] = [];
  const add = (id: string, ok: boolean, detail: string) => checks.push({ id, ok, detail });

  add("chain", input.wallet.chainId === CALLPUT_ROBINHOOD_CHAIN_ID, `Wallet must be on Robinhood Mainnet (${CALLPUT_ROBINHOOD_CHAIN_ID}); connected chain is ${input.wallet.chainId}.`);
  const receiverCompatibility = input.wallet.accountAcceptsErc1155;
  add(
    "account-erc1155",
    receiverCompatibility === true,
    receiverCompatibility === false
      ? "The account's CallPut position-token receiver check failed; ERC-1155 option-token delivery may revert. Use a plain wallet account."
      : "CallPut contract-wallet receiver compatibility is unverified; use a plain wallet account until the deployed token callback path is verified.",
  );
  add("feed-chain", input.market.chainId === CALLPUT_ROBINHOOD_CHAIN_ID, "Market feed must be tagged for Robinhood Mainnet.");
  const age = input.nowMs - input.market.timestampMs;
  add("feed-fresh", age >= 0 && age <= CALLPUT_LIMITS.maxMarketAgeMs, `Market data is ${Math.round(age / 1000)}s old; the maximum is ${CALLPUT_LIMITS.maxMarketAgeMs / 1000}s.`);

  const long = findLeg(input.market, input.longOptionId, side);
  const short = findLeg(input.market, input.shortOptionId, side);
  add("legs-listed", Boolean(long && short), `Both legs must be ${side} options present in the current feed.`);
  if (!long || !short) throw new CallPutRiskError(checks.filter((check) => !check.ok));

  add("legs-available", long.marketAvailable && short.marketAvailable, "Both legs must currently be available (isOptionAvailable).");
  const longId = decodeCallPutOptionId(long.optionId);
  const shortId = decodeCallPutOptionId(short.optionId);
  add("legs-underlying", longId.underlyingAssetIndex === meta.index && shortId.underlyingAssetIndex === meta.index && long.underlyingSymbol === symbol && short.underlyingSymbol === symbol, `Both legs must belong to ${symbol} (index ${meta.index}).`);
  add("legs-expiry", longId.expiry === shortId.expiry && longId.expiry === long.expiryTimestamp && shortId.expiry === short.expiryTimestamp, "Both legs must share the feed expiry encoded in their optionId.");
  add("legs-strike-id", longId.strike === long.strikePriceRaw && shortId.strike === short.strikePriceRaw, "Feed strikes must match the strikes encoded in the optionIds.");
  add("strike-order", isCall ? long.strikePriceRaw < short.strikePriceRaw : long.strikePriceRaw > short.strikePriceRaw, isCall ? "A call spread needs long strike < short strike." : "A put spread needs long strike > short strike.");
  const nowSeconds = Math.floor(input.nowMs / 1000);
  add("expiry-buffer", longId.expiry - nowSeconds > CALLPUT_LIMITS.deadlineBufferSeconds, "The venue rejects new requests inside the final 30 minutes before expiry.");
  const spreadCost = long.markPriceRaw - short.markPriceRaw;
  const minSpread = symbol === "BTC" ? 60 : symbol === "ETH" ? 3 : 0.01;
  add("spread-min", spreadCost >= minSpread, `Spread mark ${spreadCost.toFixed(4)} is below the venue minimum ${minSpread}.`);

  let sizeRaw = 0n;
  try {
    sizeRaw = parseCallPutSize(input.size, meta.decimals);
    add("size", true, "");
  } catch (reason) {
    add("size", false, reason instanceof Error ? reason.message : "Invalid size.");
  }
  const minFillBps = input.minFillBps ?? CALLPUT_LIMITS.defaultMinFillBps;
  add("min-fill", Number.isInteger(minFillBps) && minFillBps >= 100 && minFillBps <= 10_000, "Minimum fill must be an integer between 100 and 10000 basis points.");
  const spot = input.market.spotIndexRaw[symbol];
  add("spot", typeof spot === "number" && spot > 0, `No positive spot index for ${symbol} in the feed.`);
  add("account", isAddress(input.wallet.account, { strict: false }), "Wallet account is not a valid EVM address.");

  if (checks.some((check) => !check.ok)) throw new CallPutRiskError(checks.filter((check) => !check.ok));

  const sizeUnits = Number(input.size);
  const quote = estimateCallPutSpreadOpen({ strategy: input.strategy, sizeUnits, spotPrice: spot as number, long, short });
  const minSizeRaw = (sizeRaw * BigInt(minFillBps)) / 10_000n;

  const maxCollateral = input.maxCollateralRaw ?? CALLPUT_LIMITS.defaultMaxCollateralRaw;
  add("collateral-cap", quote.amountInRaw <= maxCollateral, `Estimated collateral ${formatUsdgRaw(quote.amountInRaw)} USDG exceeds the ${formatUsdgRaw(maxCollateral)} USDG cap.`);
  add("execution-fee", input.wallet.executionFeeWei > 0n && input.wallet.executionFeeWei <= CALLPUT_LIMITS.maxExecutionFeeWei, `Execution fee ${input.wallet.executionFeeWei} wei is zero or above the ${CALLPUT_LIMITS.maxExecutionFeeWei} wei ceiling.`);
  if (!input.deferFundingChecks) add("usdg-balance", input.wallet.usdgBalanceRaw >= quote.amountInRaw, `USDG balance ${formatUsdgRaw(input.wallet.usdgBalanceRaw)} is below the required ${formatUsdgRaw(quote.amountInRaw)}.`);
  if (!input.deferFundingChecks) add("native-balance", input.wallet.nativeBalanceWei > input.wallet.executionFeeWei, "Native ETH must cover the execution fee plus gas.");
  if (checks.some((check) => !check.ok)) throw new CallPutRiskError(checks.filter((check) => !check.ok));

  const from = getAddress(input.wallet.account);
  const transactions: CallPutPreparedTransaction[] = [];
  if (input.wallet.usdgAllowanceRaw < quote.amountInRaw) {
    transactions.push({
      kind: "usdg-approval",
      label: `Approve exactly ${formatUsdgRaw(quote.amountInRaw)} USDG to the CallPut Controller`,
      chainId: CALLPUT_ROBINHOOD_CHAIN_ID,
      from,
      to: CALLPUT_ROBINHOOD_CONTRACTS.usdg,
      data: encodeFunctionData({ abi: CALLPUT_WRITE_ABIS.erc20, functionName: "approve", args: [CALLPUT_APPROVAL_SPENDER, quote.amountInRaw] }),
      value: 0n,
    });
  }
  const optionIds = [input.longOptionId, input.shortOptionId, zeroHash, zeroHash] as const;
  transactions.push({
    kind: "open-spread",
    label: `${input.strategy} ${input.size} ${symbol}`,
    chainId: CALLPUT_ROBINHOOD_CHAIN_ID,
    from,
    to: CALLPUT_ROBINHOOD_CONTRACTS.positionManager,
    data: encodeFunctionData({
      abi: CALLPUT_WRITE_ABIS.positionManager,
      functionName: "createOpenPosition",
      args: [
        meta.index,
        2,
        [isBuy, !isBuy, false, false],
        optionIds,
        [isCall, isCall, false, false],
        minSizeRaw,
        [CALLPUT_ROBINHOOD_CONTRACTS.usdg],
        quote.amountInRaw,
        0n,
        zeroAddress,
      ],
    }),
    value: input.wallet.executionFeeWei,
  });

  return {
    intent: {
      version: 1,
      chainId: CALLPUT_ROBINHOOD_CHAIN_ID,
      account: from,
      kind: "open",
      strategy: input.strategy,
      underlying: symbol,
      underlyingAssetIndex: meta.index,
      longOptionId: input.longOptionId,
      shortOptionId: input.shortOptionId,
      expiry: longId.expiry,
      sizeRaw: sizeRaw.toString(),
      minSizeRaw: minSizeRaw.toString(),
      amountInRaw: quote.amountInRaw.toString(),
      createdAtMs: input.nowMs,
      txHash: null,
      requestKey: null,
    },
    quote,
    sizeRaw,
    minSizeRaw,
    legs: { long, short },
    checks,
    transactions,
  };
}

/**
 * Builds an unsigned candidate preview when the real wallet is short on funds. Only funding facts are substituted;
 * chain, feed, signer and receiver-compatibility checks remain those of the supplied wallet state.
 */
export function prepareCallPutCandidatePlan(input: CallPutOpenSpreadInput): CallPutOpenSpreadPlan {
  return prepareCallPutOpenSpread({
    ...input,
    wallet: {
      ...input.wallet,
      usdgBalanceRaw: 10n ** 9n,
      usdgAllowanceRaw: 0n,
      nativeBalanceWei: 10n ** 18n,
    },
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Close / settle
// ---------------------------------------------------------------------------------------------------------------

export type CallPutPositionState = {
  chainId: number;
  account: Address;
  /** ERC-1155 balance of `optionTokenId` held by the wallet (raw, underlying decimals). */
  positionBalanceRaw: bigint;
  /** isApprovedForAll(account, operator) on the underlying's options token, with operator = controller read on-chain. */
  operatorApproved: boolean;
  operator: Address;
  nativeBalanceWei: bigint;
  executionFeeWei: bigint;
};

export type CallPutCloseInput = {
  underlying: string;
  optionTokenId: bigint;
  sizeRaw: bigint;
  /** Both floors are required and must be positive raw values derived from the user's approved slippage. */
  minAmountOutRaw: bigint;
  minOutWhenSwapRaw: bigint;
  position: CallPutPositionState;
  nowMs: number;
};

function decodeOptionTokenExpiry(optionTokenId: bigint): { underlyingAssetIndex: number; expiry: number } {
  const hex = optionTokenId.toString(16).padStart(64, "0");
  return { underlyingAssetIndex: Number.parseInt(hex.slice(0, 4), 16), expiry: Number.parseInt(hex.slice(4, 14), 16) };
}

function positionChecks(
  kind: "close" | "settle",
  input: { underlying: string; optionTokenId: bigint; position: CallPutPositionState; nowMs: number },
  extra: (add: (id: string, ok: boolean, detail: string) => void) => void,
) {
  const checks: CallPutRiskCheck[] = [];
  const add = (id: string, ok: boolean, detail: string) => checks.push({ id, ok, detail });
  const symbol = input.underlying.trim().toUpperCase();
  add("underlying", isCallPutUnderlying(symbol), `${input.underlying} is not a configured CallPut Robinhood underlying.`);
  add("chain", input.position.chainId === CALLPUT_ROBINHOOD_CHAIN_ID, `Wallet must be on Robinhood Mainnet (${CALLPUT_ROBINHOOD_CHAIN_ID}).`);
  add("token-id", input.optionTokenId > 0n, "optionTokenId must be positive.");
  if (isCallPutUnderlying(symbol) && input.optionTokenId > 0n) {
    const decoded = decodeOptionTokenExpiry(input.optionTokenId);
    add("token-underlying", decoded.underlyingAssetIndex === CALLPUT_ROBINHOOD_UNDERLYINGS[symbol].index, `optionTokenId does not belong to ${symbol}.`);
    const now = Math.floor(input.nowMs / 1000);
    if (kind === "close") {
      add("close-before-expiry", decoded.expiry - now > CALLPUT_LIMITS.deadlineBufferSeconds, "Close requests are rejected inside the final 30 minutes before expiry or after expiry; use settlement after expiry.");
    } else {
      add("settle-after-expiry", decoded.expiry <= now, "Settlement is only available after expiry.");
    }
  }
  extra(add);
  return { checks, symbol };
}

export function prepareCallPutClose(input: CallPutCloseInput): { checks: CallPutRiskCheck[]; transactions: CallPutPreparedTransaction[] } {
  const { checks, symbol } = positionChecks("close", input, (add) => {
    add("size", input.sizeRaw > 0n && input.sizeRaw <= input.position.positionBalanceRaw, `Close size must be positive and not exceed the wallet balance ${input.position.positionBalanceRaw}.`);
    add("min-amount-out", input.minAmountOutRaw > 0n, "minAmountOut must be a positive raw USDG value.");
    add("min-out-swap", input.minOutWhenSwapRaw > 0n, "minOutWhenSwap must be a positive raw value (the venue rejects zero).");
    add("execution-fee", input.position.executionFeeWei > 0n && input.position.executionFeeWei <= CALLPUT_LIMITS.maxExecutionFeeWei, "Execution fee is zero or above the venue-tool ceiling.");
    add("native-balance", input.position.nativeBalanceWei > input.position.executionFeeWei, "Native ETH must cover the execution fee plus gas.");
  });
  const failed = checks.filter((check) => !check.ok);
  if (failed.length) throw new CallPutRiskError(failed);

  const meta = CALLPUT_ROBINHOOD_UNDERLYINGS[symbol as CallPutUnderlyingSymbol];
  const from = getAddress(input.position.account);
  const transactions: CallPutPreparedTransaction[] = [];
  if (!input.position.operatorApproved) {
    transactions.push({
      kind: "option-token-approval",
      label: `Let the CallPut Controller move your ${symbol} option tokens (setApprovalForAll — covers every ${symbol} option token you hold; revocable)`,
      chainId: CALLPUT_ROBINHOOD_CHAIN_ID,
      from,
      to: getAddress(meta.optionsToken),
      data: encodeFunctionData({ abi: CALLPUT_WRITE_ABIS.optionsToken, functionName: "setApprovalForAll", args: [input.position.operator, true] }),
      value: 0n,
    });
  }
  transactions.push({
    kind: "close-position",
    label: `Close ${input.sizeRaw} raw units of ${symbol} option token`,
    chainId: CALLPUT_ROBINHOOD_CHAIN_ID,
    from,
    to: CALLPUT_ROBINHOOD_CONTRACTS.positionManager,
    data: encodeFunctionData({
      abi: CALLPUT_WRITE_ABIS.positionManager,
      functionName: "createClosePosition",
      args: [meta.index, input.optionTokenId, input.sizeRaw, [CALLPUT_ROBINHOOD_CONTRACTS.usdg], input.minAmountOutRaw, input.minOutWhenSwapRaw, false],
    }),
    value: input.position.executionFeeWei,
  });
  return { checks, transactions };
}

export function prepareCallPutSettle(input: Omit<CallPutCloseInput, "sizeRaw" | "minAmountOutRaw">): { checks: CallPutRiskCheck[]; transactions: CallPutPreparedTransaction[] } {
  const { checks, symbol } = positionChecks("settle", input, (add) => {
    add("balance", input.position.positionBalanceRaw > 0n, "Wallet does not hold this option token.");
    add("min-out-swap", input.minOutWhenSwapRaw > 0n, "minOutWhenSwap must be a positive raw value (the venue rejects zero).");
  });
  const failed = checks.filter((check) => !check.ok);
  if (failed.length) throw new CallPutRiskError(failed);

  const meta = CALLPUT_ROBINHOOD_UNDERLYINGS[symbol as CallPutUnderlyingSymbol];
  const from = getAddress(input.position.account);
  const transactions: CallPutPreparedTransaction[] = [];
  if (!input.position.operatorApproved) {
    transactions.push({
      kind: "option-token-approval",
      label: `Let the CallPut settlement controller move your ${symbol} option tokens (setApprovalForAll; revocable)`,
      chainId: CALLPUT_ROBINHOOD_CHAIN_ID,
      from,
      to: getAddress(meta.optionsToken),
      data: encodeFunctionData({ abi: CALLPUT_WRITE_ABIS.optionsToken, functionName: "setApprovalForAll", args: [input.position.operator, true] }),
      value: 0n,
    });
  }
  transactions.push({
    kind: "settle-position",
    label: `Settle expired ${symbol} option token`,
    chainId: CALLPUT_ROBINHOOD_CHAIN_ID,
    from,
    to: CALLPUT_ROBINHOOD_CONTRACTS.settleManager,
    data: encodeFunctionData({
      abi: CALLPUT_WRITE_ABIS.settleManager,
      functionName: "settlePosition",
      args: [[CALLPUT_ROBINHOOD_CONTRACTS.usdg], meta.index, input.optionTokenId, input.minOutWhenSwapRaw, false],
    }),
    value: 0n,
  });
  return { checks, transactions };
}

// ---------------------------------------------------------------------------------------------------------------
// Pre-flight reads (no writes, no signing)
// ---------------------------------------------------------------------------------------------------------------

export async function readCallPutWalletState(client: PublicClient, account: Address): Promise<CallPutWalletState> {
  const chainId = await client.getChainId();
  if (chainId !== CALLPUT_ROBINHOOD_CHAIN_ID) {
    throw new Error(`CallPut reads require Robinhood Mainnet (chain ${CALLPUT_ROBINHOOD_CHAIN_ID}); connected chain is ${chainId}.`);
  }
  const [controller, executionFeeWei, usdgBalanceRaw, usdgAllowanceRaw, nativeBalanceWei] = await Promise.all([
    client.readContract({ address: CALLPUT_ROBINHOOD_CONTRACTS.positionManager, abi: CALLPUT_WRITE_ABIS.positionManager, functionName: "controller" }),
    client.readContract({ address: CALLPUT_ROBINHOOD_CONTRACTS.positionManager, abi: CALLPUT_WRITE_ABIS.positionManager, functionName: "executionFee" }),
    client.readContract({ address: CALLPUT_ROBINHOOD_CONTRACTS.usdg, abi: CALLPUT_WRITE_ABIS.erc20, functionName: "balanceOf", args: [account] }),
    client.readContract({ address: CALLPUT_ROBINHOOD_CONTRACTS.usdg, abi: CALLPUT_WRITE_ABIS.erc20, functionName: "allowance", args: [account, CALLPUT_APPROVAL_SPENDER] }),
    client.getBalance({ address: account }),
  ]);
  if (getAddress(controller) !== getAddress(CALLPUT_APPROVAL_SPENDER)) {
    throw new Error("PositionManager.controller() no longer matches the pinned approval spender; refusing to prepare approvals.");
  }
  return { chainId, account: getAddress(account), usdgBalanceRaw, usdgAllowanceRaw, nativeBalanceWei, executionFeeWei, accountAcceptsErc1155: await readAccountAcceptsErc1155(client, account) };
}

/**
 * EOAs have no receiver code and can receive position tokens directly. Contract-wallet compatibility remains unverified:
 * CallPut's OptionsToken reports false for ERC-165/ERC-1155 support, and available transfer events do not prove callback
 * msg.sender semantics. Do not simulate a callback from a guessed caller; leave this unknown so order preparation blocks.
 */
export async function readAccountAcceptsErc1155(client: PublicClient, account: Address): Promise<boolean | undefined> {
  const code = await client.getCode({ address: account });
  if (!code || code === "0x") return true;
  return undefined;
}

export async function readCallPutPositionState(
  client: PublicClient,
  account: Address,
  underlying: CallPutUnderlyingSymbol,
  optionTokenId: bigint,
  manager: "position" | "settle",
): Promise<CallPutPositionState> {
  const chainId = await client.getChainId();
  if (chainId !== CALLPUT_ROBINHOOD_CHAIN_ID) {
    throw new Error(`CallPut reads require Robinhood Mainnet (chain ${CALLPUT_ROBINHOOD_CHAIN_ID}); connected chain is ${chainId}.`);
  }
  const token = getAddress(CALLPUT_ROBINHOOD_UNDERLYINGS[underlying].optionsToken);
  const operator = manager === "position"
    ? await client.readContract({ address: CALLPUT_ROBINHOOD_CONTRACTS.positionManager, abi: CALLPUT_WRITE_ABIS.positionManager, functionName: "controller" })
    : await client.readContract({ address: CALLPUT_ROBINHOOD_CONTRACTS.settleManager, abi: CALLPUT_WRITE_ABIS.settleManager, functionName: "controller" });
  const [balances, operatorApproved, nativeBalanceWei, executionFeeWei] = await Promise.all([
    client.readContract({ address: token, abi: CALLPUT_WRITE_ABIS.optionsToken, functionName: "balanceOfBatch", args: [[account], [optionTokenId]] }),
    client.readContract({ address: token, abi: CALLPUT_WRITE_ABIS.optionsToken, functionName: "isApprovedForAll", args: [account, operator] }),
    client.getBalance({ address: account }),
    client.readContract({ address: CALLPUT_ROBINHOOD_CONTRACTS.positionManager, abi: CALLPUT_WRITE_ABIS.positionManager, functionName: "executionFee" }),
  ]);
  return {
    chainId,
    account: getAddress(account),
    positionBalanceRaw: balances[0] ?? 0n,
    operatorApproved,
    operator: getAddress(operator),
    nativeBalanceWei,
    executionFeeWei,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Request tracking and reconciliation
// ---------------------------------------------------------------------------------------------------------------

export type CallPutOrderIntent = {
  version: 1;
  chainId: typeof CALLPUT_ROBINHOOD_CHAIN_ID;
  account: Address;
  kind: "open";
  strategy: CallPutSpreadStrategy;
  underlying: CallPutUnderlyingSymbol;
  underlyingAssetIndex: number;
  longOptionId: Hex;
  shortOptionId: Hex;
  expiry: number;
  sizeRaw: string;
  minSizeRaw: string;
  amountInRaw: string;
  createdAtMs: number;
  txHash: Hex | null;
  requestKey: Hex | null;
};

/** Extracts the canonical request key from a mined PositionManager receipt. Never trusts the tx hash alone. */
export function extractCallPutRequestKey(
  receipt: Pick<TransactionReceipt, "status" | "logs">,
  expected: { account: Address; isOpen: boolean },
): Hex {
  if (receipt.status !== "success") throw new Error("Transaction reverted; no CallPut request was created.");
  const matches: Hex[] = [];
  for (const log of receipt.logs) {
    if (getAddress(log.address) !== getAddress(CALLPUT_ROBINHOOD_CONTRACTS.positionManager)) continue;
    try {
      const event = decodeEventLog({ abi: CALLPUT_WRITE_ABIS.positionManager, data: log.data, topics: log.topics });
      if (event.eventName !== "GenerateRequestKey") continue;
      const args = event.args as { account: Address; key: Hex; isOpen: boolean };
      if (getAddress(args.account) === getAddress(expected.account) && args.isOpen === expected.isOpen) matches.push(args.key);
    } catch {
      // Not a PositionManager event we know.
    }
  }
  const unique = [...new Set(matches.map((key) => key.toLowerCase()))];
  if (unique.length === 0) throw new Error("No GenerateRequestKey event for this account in the receipt.");
  if (unique.length > 1) throw new Error("Receipt contains several request keys; refusing to pick one.");
  return unique[0] as Hex;
}

export type CallPutSettlementEvent = {
  account: Address;
  underlyingAssetIndex: number;
  optionTokenId: bigint;
  size: bigint;
  amountOut: bigint;
  settlePrice: bigint;
};

/** Extracts only a matching SettlePosition event from the pinned Settlement Manager. */
export function extractCallPutSettlement(
  receipt: Pick<TransactionReceipt, "status" | "logs">,
  expected: { account: Address; underlyingAssetIndex: number; optionTokenId: bigint },
): CallPutSettlementEvent {
  if (receipt.status !== "success") throw new Error("Transaction reverted; no CallPut settlement was created.");
  const matches: CallPutSettlementEvent[] = [];
  for (const log of receipt.logs) {
    if (getAddress(log.address) !== getAddress(CALLPUT_ROBINHOOD_CONTRACTS.settleManager)) continue;
    try {
      const event = decodeEventLog({ abi: CALLPUT_WRITE_ABIS.settleManager, data: log.data, topics: log.topics });
      if (event.eventName !== "SettlePosition") continue;
      const args = event.args as {
        account: Address;
        underlyingAssetIndex: number | bigint;
        optionTokenId: bigint;
        size: bigint;
        amountOut: bigint;
        settlePrice: bigint;
      };
      const underlyingAssetIndex = Number(args.underlyingAssetIndex);
      if (
        getAddress(args.account) === getAddress(expected.account) &&
        underlyingAssetIndex === expected.underlyingAssetIndex &&
        args.optionTokenId === expected.optionTokenId &&
        args.size > 0n
      ) {
        matches.push({
          account: getAddress(args.account),
          underlyingAssetIndex,
          optionTokenId: args.optionTokenId,
          size: args.size,
          amountOut: args.amountOut,
          settlePrice: args.settlePrice,
        });
      }
    } catch {
      // Ignore unrelated events from the Settlement Manager.
    }
  }
  if (matches.length === 0) throw new Error("No matching SettlePosition event for this account and option token.");
  if (matches.length > 1) throw new Error("Receipt contains several matching SettlePosition events; refusing to pick one.");
  return matches[0];
}

export type CallPutReconciliation = {
  state:
    | "awaiting-request-key"
    | "request-not-found"
    | "pending"
    | "pending-past-delay"
    | "cancelled"
    | "executed-balance-confirmed"
    | "executed-balance-unconfirmed";
  /** Plain statement of what is and is not proven. Never claims a fill without independent balance evidence. */
  evidence: string;
  fillConfirmed: boolean;
};

/**
 * Reconciles a stored open-spread intent with the on-chain request getter and the wallet's option-token balance.
 * `Executed` is only upgraded to a confirmed fill when the wallet balance of the resulting optionTokenId covers
 * the request's reported `sizeOut`; a request status or receipt alone is never reported as a fill.
 */
export function reconcileCallPutOpen(params: {
  intent: CallPutOrderIntent;
  request: CallPutRobinhoodRequestSnapshot | null;
  /** Wallet balance of request.optionTokenId, read after the request was Executed (null if not read). */
  optionTokenBalanceRaw: bigint | null;
  nowMs: number;
}): CallPutReconciliation {
  const { intent, request, optionTokenBalanceRaw, nowMs } = params;
  if (!intent.requestKey || !request) {
    return { state: "awaiting-request-key", evidence: "No request key captured yet. A transaction hash alone does not establish an order.", fillConfirmed: false };
  }
  if (request.kind !== "open" || request.requestKey.toLowerCase() !== intent.requestKey.toLowerCase()) {
    throw new Error("Request snapshot does not match the stored intent.");
  }
  if (request.status === "Not found") {
    return { state: "request-not-found", evidence: "PositionManager has no record for this key (blockTime = 0).", fillConfirmed: false };
  }
  if (request.account && getAddress(request.account) !== getAddress(intent.account)) {
    throw new Error("Request account differs from the intent account.");
  }
  if (request.status === "Cancelled") {
    return { state: "cancelled", evidence: "Keeper outcome: Cancelled. No fill. The native execution fee is not assumed refundable.", fillConfirmed: false };
  }
  if (request.status === "Pending") {
    const submitted = request.submittedAt === null ? null : Number(request.submittedAt);
    const stale = submitted !== null && nowMs / 1000 > submitted + CALLPUT_LIMITS.maxTimeDelaySeconds;
    return stale
      ? { state: "pending-past-delay", evidence: "Still Pending beyond the 180s maxTimeDelay. The venue exposes no user cancel; keep polling and do not resubmit blindly.", fillConfirmed: false }
      : { state: "pending", evidence: "Pending in the keeper queue. No fill is claimed.", fillConfirmed: false };
  }
  const sizeOut = request.sizeOut ?? 0n;
  if (optionTokenBalanceRaw !== null && sizeOut > 0n && optionTokenBalanceRaw >= sizeOut) {
    return { state: "executed-balance-confirmed", evidence: `Request Executed and the wallet holds ${optionTokenBalanceRaw} raw units of option token ${request.optionTokenId} (reported sizeOut ${sizeOut}).`, fillConfirmed: true };
  }
  return { state: "executed-balance-unconfirmed", evidence: "Request reports Executed, but the wallet balance does not yet independently confirm the reported size. Not treated as a fill.", fillConfirmed: false };
}

export type CallPutCloseReconciliation = {
  state:
    | "awaiting-request-key"
    | "request-not-found"
    | "pending"
    | "pending-past-delay"
    | "cancelled"
    | "executed-position-confirmed"
    | "executed-position-unconfirmed";
  evidence: string;
  fillConfirmed: boolean;
};

/** A close is confirmed only when an Executed close request and matching option-token reduction agree. */
export function reconcileCallPutClose(params: {
  request: CallPutRobinhoodRequestSnapshot | null;
  requestKey: Hex | null;
  account: Address;
  optionTokenId: bigint;
  preBalanceRaw: bigint;
  balanceAfterRaw: bigint | null;
  nowMs: number;
}): CallPutCloseReconciliation {
  const { request, requestKey, account, optionTokenId, preBalanceRaw, balanceAfterRaw, nowMs } = params;
  if (!requestKey || !request) {
    return { state: "awaiting-request-key", evidence: "No close request key is available yet. A transaction hash alone does not establish a close.", fillConfirmed: false };
  }
  if (request.kind !== "close" || request.requestKey.toLowerCase() !== requestKey.toLowerCase()) {
    throw new Error("Close request snapshot does not match the stored request key.");
  }
  if (request.status === "Not found") {
    return { state: "request-not-found", evidence: "PositionManager has no close record for this key (blockTime = 0).", fillConfirmed: false };
  }
  if (request.account && getAddress(request.account) !== getAddress(account)) {
    throw new Error("Close request account differs from the tracked account.");
  }
  if (request.optionTokenId !== null && request.optionTokenId !== optionTokenId) {
    throw new Error("Close request position token differs from the tracked position token.");
  }
  if (request.status === "Cancelled") {
    return { state: "cancelled", evidence: "Keeper outcome: Cancelled. No close is confirmed.", fillConfirmed: false };
  }
  if (request.status === "Pending") {
    const submitted = request.submittedAt === null ? null : Number(request.submittedAt);
    const stale = submitted !== null && nowMs / 1000 > submitted + CALLPUT_LIMITS.maxTimeDelaySeconds;
    return stale
      ? { state: "pending-past-delay", evidence: "Still Pending beyond the 180s maxTimeDelay. Keep polling; do not resubmit blindly.", fillConfirmed: false }
      : { state: "pending", evidence: "Close is pending in the keeper queue. No position reduction is claimed.", fillConfirmed: false };
  }
  const requestedSize = request.size ?? 0n;
  const reduction = balanceAfterRaw === null || balanceAfterRaw > preBalanceRaw ? 0n : preBalanceRaw - balanceAfterRaw;
  if (requestedSize > 0n && reduction >= requestedSize) {
    return { state: "executed-position-confirmed", evidence: `Close request Executed and the wallet's option-token balance decreased by ${reduction} raw units (request size ${requestedSize}).`, fillConfirmed: true };
  }
  return { state: "executed-position-unconfirmed", evidence: "Close request reports Executed, but the matching wallet balance reduction is not independently confirmed.", fillConfirmed: false };
}

export type CallPutSettlementReconciliation = {
  state: "awaiting-settlement-event" | "settled-position-confirmed" | "settled-position-unconfirmed";
  evidence: string;
  fillConfirmed: boolean;
};

/** A settlement is confirmed only when its matching event and position-token reduction agree. */
export function reconcileCallPutSettlement(params: {
  settlement: CallPutSettlementEvent | null;
  preBalanceRaw: bigint;
  balanceAfterRaw: bigint | null;
}): CallPutSettlementReconciliation {
  const { settlement, preBalanceRaw, balanceAfterRaw } = params;
  if (!settlement) {
    return { state: "awaiting-settlement-event", evidence: "No matching SettlePosition event has been recovered yet.", fillConfirmed: false };
  }
  const reduction = balanceAfterRaw === null || balanceAfterRaw > preBalanceRaw ? 0n : preBalanceRaw - balanceAfterRaw;
  if (settlement.size > 0n && reduction >= settlement.size) {
    return { state: "settled-position-confirmed", evidence: `Matching SettlePosition event reports ${settlement.size} raw units and the wallet's balance decreased by ${reduction} raw units.`, fillConfirmed: true };
  }
  return { state: "settled-position-unconfirmed", evidence: "SettlePosition event is present, but the corresponding wallet balance reduction is not independently confirmed.", fillConfirmed: false };
}
