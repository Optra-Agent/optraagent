import { describe, expect, it, vi } from "vitest";
import type { PublicClient } from "viem";
import {
  parseCallPutRobinhoodRequest,
  readCallPutRobinhoodRequest,
} from "../../lib/venue/callput-robinhood-requests";

const KEY = `0x${"ab".repeat(32)}` as const;
const ACCOUNT = "0x0000000000000000000000000000000000000011" as const;
const OPEN_PENDING = [
  ACCOUNT,
  16,
  1_800_000_000n,
  42n,
  100n,
  5_000_000n,
  0n,
  false,
  1_700_000_000n,
  0,
  0n,
  0n,
  0n,
  0n,
] as const;
const CLOSE_EXECUTED = [
  ACCOUNT,
  16,
  1_800_000_000n,
  42n,
  100n,
  4_000_000n,
  0n,
  false,
  1_700_000_000n,
  2,
  4_100_000n,
  123n,
  1_700_000_030n,
] as const;

describe("CallPut Robinhood request tracking", () => {
  it("rejects malformed request keys before any RPC call", () => {
    expect(() => parseCallPutRobinhoodRequest("open", "0x123", OPEN_PENDING)).toThrow(/bytes32/i);
  });

  it("treats an all-zero request record as not found, not Pending", () => {
    const record = [ACCOUNT, 0, 0n, 0n, 0n, 0n, 0n, false, 0n, 0, 0n, 0n, 0n, 0n];

    expect(parseCallPutRobinhoodRequest("open", KEY, record)).toMatchObject({
      requestKey: KEY,
      kind: "open",
      status: "Not found",
      account: null,
      amountIn: null,
    });
  });

  it("decodes pending opens without treating requested size as an executed fill", () => {
    expect(parseCallPutRobinhoodRequest("open", KEY, OPEN_PENDING)).toMatchObject({
      requestKey: KEY,
      kind: "open",
      status: "Pending",
      account: ACCOUNT,
      underlyingAssetIndex: 16,
      optionTokenId: 42n,
      minSize: 100n,
      amountIn: 5_000_000n,
      minOutWhenSwap: 0n,
      sizeOut: 0n,
      amountOut: 0n,
      submittedAt: 1_700_000_000n,
    });
  });

  it("decodes executed closes using the venue state and output fields", () => {
    expect(parseCallPutRobinhoodRequest("close", KEY, CLOSE_EXECUTED)).toMatchObject({
      requestKey: KEY,
      kind: "close",
      status: "Executed",
      size: 100n,
      minAmountOut: 4_000_000n,
      minOutWhenSwap: 0n,
      amountOut: 4_100_000n,
      executionPrice: 123n,
      processedAt: 1_700_000_030n,
    });
  });

  it("rejects malformed tuples and unknown venue status values", () => {
    expect(() => parseCallPutRobinhoodRequest("open", KEY, [ACCOUNT])).toThrow(/tuple/i);
    expect(() => parseCallPutRobinhoodRequest("open", KEY, [...OPEN_PENDING.slice(0, 9), 9, ...OPEN_PENDING.slice(10)])).toThrow(/unknown/i);
  });

  it("reads only the requested view getter on Robinhood Mainnet", async () => {
    const readContract = vi.fn().mockResolvedValue(OPEN_PENDING);
    const client = {
      getChainId: vi.fn().mockResolvedValue(4663),
      readContract,
    } as unknown as PublicClient;

    const result = await readCallPutRobinhoodRequest(client, "open", KEY);

    expect(result.status).toBe("Pending");
    expect(readContract).toHaveBeenCalledWith(expect.objectContaining({
      functionName: "openPositionRequests",
      args: [KEY],
    }));
  });

  it("refuses to read a request from a different chain", async () => {
    const readContract = vi.fn();
    const client = {
      getChainId: vi.fn().mockResolvedValue(1),
      readContract,
    } as unknown as PublicClient;

    await expect(readCallPutRobinhoodRequest(client, "open", KEY)).rejects.toThrow(/4663/);
    expect(readContract).not.toHaveBeenCalled();
  });
});
