import { getAddress, isAddress, type Address, type Hex, type PublicClient } from "viem";
import {
  CALLPUT_ROBINHOOD_CHAIN_ID,
  CALLPUT_ROBINHOOD_CONTRACTS,
  CALLPUT_ROBINHOOD_READ_ABIS,
  parseCallPutRequestStatus,
} from "./callput-robinhood-readonly";

export type CallPutRobinhoodRequestKind = "open" | "close";
export type CallPutRobinhoodRequestStatus = "Not found" | "Pending" | "Cancelled" | "Executed";

export type CallPutRobinhoodRequestSnapshot = {
  requestKey: Hex;
  kind: CallPutRobinhoodRequestKind;
  status: CallPutRobinhoodRequestStatus;
  account: Address | null;
  underlyingAssetIndex: number | null;
  expiry: bigint | null;
  optionTokenId: bigint | null;
  minSize: bigint | null;
  amountIn: bigint | null;
  minOutWhenSwap: bigint | null;
  size: bigint | null;
  minAmountOut: bigint | null;
  sizeOut: bigint | null;
  amountOut: bigint | null;
  executionPrice: bigint | null;
  submittedAt: bigint | null;
  processedAt: bigint | null;
  nativeTokenHandling: boolean | null;
};

const REQUEST_KEY_PATTERN = /^0x[\da-fA-F]{64}$/;

export function parseCallPutRequestKey(value: string): Hex {
  const key = value.trim();
  if (!REQUEST_KEY_PATTERN.test(key)) {
    throw new TypeError("CallPut request key must be a 32-byte hex value (bytes32).");
  }
  return key as Hex;
}

function asUint(value: unknown, field: string): bigint {
  let parsed: bigint;
  if (typeof value === "bigint") parsed = value;
  else if (typeof value === "number" && Number.isSafeInteger(value)) parsed = BigInt(value);
  else if (typeof value === "string" && /^(?:\d+|0x[\da-fA-F]+)$/.test(value)) parsed = BigInt(value);
  else throw new TypeError(`Invalid CallPut request record: ${field} is not an unsigned integer.`);

  if (parsed < 0n) throw new TypeError(`Invalid CallPut request record: ${field} cannot be negative.`);
  return parsed;
}

function asSafeNumber(value: unknown, field: string): number {
  const parsed = asUint(value, field);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`Invalid CallPut request record: ${field} exceeds the safe integer range.`);
  }
  return Number(parsed);
}

function asAccount(value: unknown): Address {
  if (typeof value !== "string" || !isAddress(value, { strict: false })) {
    throw new TypeError("Invalid CallPut request record: account is not an EVM address.");
  }
  return getAddress(value);
}

function emptySnapshot(
  kind: CallPutRobinhoodRequestKind,
  requestKey: Hex,
): CallPutRobinhoodRequestSnapshot {
  return {
    requestKey,
    kind,
    status: "Not found",
    account: null,
    underlyingAssetIndex: null,
    expiry: null,
    optionTokenId: null,
    minSize: null,
    amountIn: null,
    minOutWhenSwap: null,
    size: null,
    minAmountOut: null,
    sizeOut: null,
    amountOut: null,
    executionPrice: null,
    submittedAt: null,
    processedAt: null,
    nativeTokenHandling: null,
  };
}

export function parseCallPutRobinhoodRequest(
  kind: CallPutRobinhoodRequestKind,
  rawRequestKey: string,
  rawRecord: unknown,
): CallPutRobinhoodRequestSnapshot {
  const requestKey = parseCallPutRequestKey(rawRequestKey);
  const expectedLength = kind === "open" ? 14 : 13;
  if (!Array.isArray(rawRecord) || rawRecord.length !== expectedLength) {
    throw new TypeError(`Invalid CallPut ${kind} request tuple: expected ${expectedLength} fields.`);
  }

  const submittedAt = asUint(rawRecord[8], "blockTime");
  if (submittedAt === 0n) return emptySnapshot(kind, requestKey);

  const statusValue = asSafeNumber(rawRecord[9], "status");
  const status = parseCallPutRequestStatus(statusValue);
  const common = {
    requestKey,
    kind,
    status,
    account: asAccount(rawRecord[0]),
    underlyingAssetIndex: asSafeNumber(rawRecord[1], "underlyingAssetIndex"),
    expiry: asUint(rawRecord[2], "expiry"),
    optionTokenId: asUint(rawRecord[3], "optionTokenId"),
    submittedAt,
    nativeTokenHandling: typeof rawRecord[7] === "boolean" ? rawRecord[7] : null,
  };
  if (common.nativeTokenHandling === null) {
    throw new TypeError("Invalid CallPut request record: native-token flag is not boolean.");
  }

  if (kind === "open") {
    const processedAt = asUint(rawRecord[12], "processBlockTime");
    return {
      ...common,
      minSize: asUint(rawRecord[4], "minSize"),
      amountIn: asUint(rawRecord[5], "amountIn"),
      minOutWhenSwap: asUint(rawRecord[6], "minOutWhenSwap"),
      size: null,
      minAmountOut: null,
      sizeOut: asUint(rawRecord[10], "sizeOut"),
      amountOut: asUint(rawRecord[13], "amountOut"),
      executionPrice: asUint(rawRecord[11], "executionPrice"),
      processedAt,
    };
  }

  return {
    ...common,
    minSize: null,
    amountIn: null,
    minOutWhenSwap: asUint(rawRecord[6], "minOutWhenSwap"),
    size: asUint(rawRecord[4], "size"),
    minAmountOut: asUint(rawRecord[5], "minAmountOut"),
    sizeOut: null,
    amountOut: asUint(rawRecord[10], "amountOut"),
    executionPrice: asUint(rawRecord[11], "executionPrice"),
    processedAt: asUint(rawRecord[12], "processBlockTime"),
  };
}

export async function readCallPutRobinhoodRequest(
  client: PublicClient,
  kind: CallPutRobinhoodRequestKind,
  rawRequestKey: string,
): Promise<CallPutRobinhoodRequestSnapshot> {
  const requestKey = parseCallPutRequestKey(rawRequestKey);
  const chainId = await client.getChainId();
  if (chainId !== CALLPUT_ROBINHOOD_CHAIN_ID) {
    throw new Error(`CallPut request reads require Robinhood Mainnet (chain ${CALLPUT_ROBINHOOD_CHAIN_ID}); connected chain is ${chainId}.`);
  }

  const rawRecord = kind === "open"
    ? await client.readContract({
      address: CALLPUT_ROBINHOOD_CONTRACTS.positionManager,
      abi: CALLPUT_ROBINHOOD_READ_ABIS.positionManager,
      functionName: "openPositionRequests",
      args: [requestKey],
    })
    : await client.readContract({
      address: CALLPUT_ROBINHOOD_CONTRACTS.positionManager,
      abi: CALLPUT_ROBINHOOD_READ_ABIS.positionManager,
      functionName: "closePositionRequests",
      args: [requestKey],
    });

  return parseCallPutRobinhoodRequest(kind, requestKey, rawRecord);
}
