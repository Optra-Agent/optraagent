import { parseAbi } from "viem";

export const CALLPUT_ROBINHOOD_CHAIN_ID = 4663;
export const CALLPUT_ROBINHOOD_RPC_URL = "https://rpc.mainnet.chain.robinhood.com";
export const CALLPUT_ROBINHOOD_MARKET_FEED_URL = "https://app-data-robinhood.s3.ap-southeast-1.amazonaws.com/market-data.json";

export const CALLPUT_ROBINHOOD_CONTRACTS = {
  optionsMarket: "0x3271d35afAc70C0D4989F984Abb2d918bf672C7e",
  optionsAuthority: "0x85e00a193d5E340339484336dd9EA09f942A0b7B",
  controller: "0x0D240c1EbEeE7F74B40d6611326f5df98AB00e1B",
  positionManager: "0x426a6b482893557E58cF38de635fEbB30Fd6a3C3",
  settleManager: "0xd328D581f3Fb1Ca86D28D573bA1f17409e5112EF",
  viewAggregator: "0xf277D41cc8093667bf1A023f4FBbeB8328900bb7",
  vaultPriceFeed: "0x2666ce652b1929D4F5a2dBBf094E5DfD38d1b9f1",
  fastPriceFeed: "0xA936FCaD3C5CDda9106F72499729877E9dF5918a",
  spotPriceFeed: "0x2318040e26791777d675cFeF87FE25BDcE36439A",
  settlePriceFeed: "0xB51EC03d51e8880FDc2A24f918072694516FB626",
  positionValueFeed: "0x32847298142A9E692EfE1c259aADe4f260bDe94C",
  usdg: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  weth: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  btcOptionsToken: "0x080084D6A1e9b6657EDc8DBa071BAa9D15Fcc500",
  ethOptionsToken: "0x84D4ef4062E00F78B0Ea5aaC06D7D08Ab1258B02",
  tradingAccountFactory: "0xbcaC622Bb396B2f868b37D7C41F34695c9be1862",
  tradingAccountBeacon: "0x5685d4DD5114c74C805322d4612CA5D73EAcdc62",
  sVault: "0x21bA39e9394657A6196f6948C2701D9fD9612289",
} as const;

export const CALLPUT_ROBINHOOD_READ_ABIS = {
  positionManager: parseAbi([
    "function optionsMarket() view returns (address)",
    "function controller() view returns (address)",
    "function executionFee() view returns (uint256)",
    "function maxTimeDelay() view returns (uint256)",
    "function openPositionRequests(bytes32 key) view returns (address account, uint16 underlyingAssetIndex, uint40 expiry, uint256 optionTokenId, uint256 minSize, uint256 amountIn, uint256 minOutWhenSwap, bool isDepositedInNAT, uint40 blockTime, uint8 status, uint256 sizeOut, uint256 executionPrice, uint40 processBlockTime, uint256 amountOut)",
    "function closePositionRequests(bytes32 key) view returns (address account, uint16 underlyingAssetIndex, uint40 expiry, uint256 optionTokenId, uint256 size, uint256 minAmountOut, uint256 minOutWhenSwap, bool withdrawNAT, uint40 blockTime, uint8 status, uint256 amountOut, uint256 executionPrice, uint40 processBlockTime)",
    "function getOpenPositionRequestPath(bytes32 key) view returns (address[])",
    "function getClosePositionRequestPath(bytes32 key) view returns (address[])",
  ]),
  optionsMarket: parseAbi([
    "function mainStableAsset() view returns (address)",
  ]),
  tradingAccountBeacon: parseAbi([
    "function implementation() view returns (address)",
  ]),
} as const;

export type CallPutOptionSide = "call" | "put";

export type CallPutRobinhoodOptionMark = {
  underlyingSymbol: string;
  side: CallPutOptionSide;
  instrument: string;
  optionId: `0x${string}`;
  expiryTimestamp: number;
  strikePriceRaw: number;
  markPriceRaw: number;
  markIvRaw: number;
  riskPremiumRateForBuy: number;
  riskPremiumRateForSell: number;
  delta: number;
  gamma: number;
  vega: number;
  theta: number;
  marketAvailable: boolean;
  quoteType: "indicative";
};

export type CallPutRobinhoodMarketData = {
  venue: "callput";
  network: "robinhood";
  chainId: typeof CALLPUT_ROBINHOOD_CHAIN_ID;
  sourceUrl: typeof CALLPUT_ROBINHOOD_MARKET_FEED_URL;
  timestampMs: number;
  lastUpdatedAt: string;
  feedVersion: number | null;
  spotIndexRaw: Record<string, number>;
  futuresIndexRaw: Record<string, number>;
  options: CallPutRobinhoodOptionMark[];
};

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`Invalid CallPut Robinhood market feed: ${label} must be a finite number.`);
  }
  return value;
}

function positiveNumber(value: unknown, label: string): number {
  const parsed = finiteNumber(value, label);
  if (parsed <= 0) throw new TypeError(`Invalid CallPut Robinhood market feed: ${label} must be positive.`);
  return parsed;
}

function numberMap(value: unknown): Record<string, number> {
  const input = record(value);
  if (!input) return {};
  return Object.fromEntries(
    Object.entries(input).flatMap(([symbol, entry]) =>
      typeof entry === "number" && Number.isFinite(entry) ? [[symbol, entry]] : []),
  );
}

function parseOptionMark(
  value: unknown,
  underlyingSymbol: string,
  side: CallPutOptionSide,
  expiryKey: number,
): CallPutRobinhoodOptionMark {
  const row = record(value);
  if (!row) throw new TypeError("Invalid CallPut Robinhood market feed: option row must be an object.");
  const optionId = row.optionId;
  if (typeof optionId !== "string" || !/^0x[\da-fA-F]{64}$/.test(optionId)) {
    throw new TypeError("Invalid CallPut Robinhood market feed: optionId must be bytes32.");
  }
  if (typeof row.instrument !== "string" || row.instrument.length === 0) {
    throw new TypeError("Invalid CallPut Robinhood market feed: instrument is missing.");
  }
  if (typeof row.isOptionAvailable !== "boolean") {
    throw new TypeError("Invalid CallPut Robinhood market feed: isOptionAvailable must be boolean.");
  }
  const expiryTimestamp = positiveNumber(row.expiry, "option expiry");
  if (expiryTimestamp !== expiryKey) {
    throw new TypeError("Invalid CallPut Robinhood market feed: option expiry does not match its expiry group.");
  }

  return {
    underlyingSymbol,
    side,
    instrument: row.instrument,
    optionId: optionId as `0x${string}`,
    expiryTimestamp,
    strikePriceRaw: positiveNumber(row.strikePrice, "strikePrice"),
    markPriceRaw: finiteNumber(row.markPrice, "markPrice"),
    markIvRaw: finiteNumber(row.markIv, "markIv"),
    riskPremiumRateForBuy: finiteNumber(row.riskPremiumRateForBuy, "riskPremiumRateForBuy"),
    riskPremiumRateForSell: finiteNumber(row.riskPremiumRateForSell, "riskPremiumRateForSell"),
    delta: finiteNumber(row.delta, "delta"),
    gamma: finiteNumber(row.gamma, "gamma"),
    vega: finiteNumber(row.vega, "vega"),
    theta: finiteNumber(row.theta, "theta"),
    marketAvailable: row.isOptionAvailable,
    quoteType: "indicative",
  };
}

export function parseCallPutRobinhoodMarketData(input: unknown): CallPutRobinhoodMarketData {
  const payload = record(input);
  const data = record(payload?.data);
  const pvSource = record(data?.pvSource);
  if (!pvSource || pvSource.chainId !== CALLPUT_ROBINHOOD_CHAIN_ID) {
    throw new TypeError(`CallPut market feed chain mismatch: expected ${CALLPUT_ROBINHOOD_CHAIN_ID}.`);
  }

  const timestampMs = positiveNumber(payload?.timestamp, "timestamp");
  if (!Number.isInteger(timestampMs)) {
    throw new TypeError("Invalid CallPut Robinhood market feed: timestamp must be integer milliseconds.");
  }
  const lastUpdatedAt = payload?.lastUpdatedAt;
  if (typeof lastUpdatedAt !== "string" || !Number.isFinite(Date.parse(lastUpdatedAt))) {
    throw new TypeError("Invalid CallPut Robinhood market feed: lastUpdatedAt must be an ISO timestamp.");
  }

  const markets = record(data?.market);
  if (!markets) throw new TypeError("Invalid CallPut Robinhood market feed: data.market is missing.");

  const options: CallPutRobinhoodOptionMark[] = [];
  for (const [underlyingSymbol, marketValue] of Object.entries(markets)) {
    const market = record(marketValue);
    const expiries = market?.expiries;
    const expiryOptions = record(market?.options);
    if (!market || !Array.isArray(expiries) || !expiryOptions) {
      throw new TypeError(`Invalid CallPut Robinhood market feed: market data is malformed for ${underlyingSymbol}.`);
    }

    for (const expiryValue of expiries) {
      const expiry = positiveNumber(expiryValue, `${underlyingSymbol} expiry`);
      const group = record(expiryOptions[String(expiry)]);
      if (!group) continue;
      for (const side of ["call", "put"] as const) {
        const rows = group[side];
        if (rows === undefined) continue;
        if (!Array.isArray(rows)) {
          throw new TypeError(`Invalid CallPut Robinhood market feed: ${side} rows are malformed for ${underlyingSymbol}.`);
        }
        for (const row of rows) options.push(parseOptionMark(row, underlyingSymbol, side, expiry));
      }
    }
  }

  const feedVersion = pvSource.version;
  return {
    venue: "callput",
    network: "robinhood",
    chainId: CALLPUT_ROBINHOOD_CHAIN_ID,
    sourceUrl: CALLPUT_ROBINHOOD_MARKET_FEED_URL,
    timestampMs,
    lastUpdatedAt,
    feedVersion: typeof feedVersion === "number" && Number.isInteger(feedVersion) ? feedVersion : null,
    spotIndexRaw: numberMap(data?.spotIndices),
    futuresIndexRaw: numberMap(data?.futuresIndices),
    options,
  };
}

export function getCallPutRobinhoodOptions(
  snapshot: CallPutRobinhoodMarketData,
  underlyingSymbol: string,
  side: CallPutOptionSide,
  options: { availableOnly?: boolean } = {},
): CallPutRobinhoodOptionMark[] {
  const symbol = underlyingSymbol.trim().toUpperCase();
  return snapshot.options.filter((option) =>
    option.underlyingSymbol === symbol &&
    option.side === side &&
    (!options.availableOnly || option.marketAvailable),
  );
}

export function isCallPutMarketDataFresh(
  snapshot: CallPutRobinhoodMarketData,
  nowMs: number,
  maxAgeMs: number,
): boolean {
  if (!Number.isFinite(nowMs) || !Number.isFinite(maxAgeMs) || maxAgeMs < 0) return false;
  const age = nowMs - snapshot.timestampMs;
  return age >= 0 && age <= maxAgeMs;
}

export async function fetchCallPutRobinhoodMarketData(
  fetcher: typeof fetch = fetch,
): Promise<CallPutRobinhoodMarketData> {
  const response = await fetcher(CALLPUT_ROBINHOOD_MARKET_FEED_URL, {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`CallPut Robinhood market feed returned HTTP ${response.status}.`);
  }
  return parseCallPutRobinhoodMarketData(await response.json());
}

export function parseCallPutRequestStatus(value: number): "Pending" | "Cancelled" | "Executed" {
  if (value === 0) return "Pending";
  if (value === 1) return "Cancelled";
  if (value === 2) return "Executed";
  throw new RangeError(`Unknown CallPut request status: ${value}.`);
}
