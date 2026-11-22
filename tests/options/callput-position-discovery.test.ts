import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Address, Hex, PublicClient } from "viem";

const mocks = vi.hoisted(() => ({ request: vi.fn(), position: vi.fn() }));
vi.mock("../../lib/venue/callput-robinhood-requests", () => ({ readCallPutRobinhoodRequest: mocks.request }));
vi.mock("../../lib/venue/callput-robinhood-write", async (original) => ({ ...(await original<typeof import("../../lib/venue/callput-robinhood-write")>()), readCallPutPositionState: mocks.position }));

import { discoverCallPutPositions, positionAction } from "../../lib/venue/callput-position-discovery";

const ACCOUNT = "0xAa8fDF2f96aFC037D50659CFd09fDF3Fac060bBf" as Address;
const OTHER = "0x000000000000000000000000000000000000dEaD" as Address;
const key = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const EXPIRY = 1_795_000_000;
const executed = (over: object = {}) => ({ status: "Executed", account: ACCOUNT, optionTokenId: 123n, expiry: BigInt(EXPIRY), ...over });
const client = {} as PublicClient;

describe("CallPut position discovery", () => {
  beforeEach(() => { mocks.request.mockReset(); mocks.position.mockReset(); mocks.position.mockResolvedValue({ positionBalanceRaw: 100_000_000_000_000_000n }); });

  it("lists only a request the chain says was Executed for this account with a positive balance", async () => {
    mocks.request.mockImplementation(async (_c: unknown, _k: string, requestKey: Hex) => ({
      [key(1)]: executed(), [key(2)]: executed({ status: "Pending" }), [key(3)]: executed({ status: "Cancelled" }), [key(4)]: executed({ account: OTHER }), [key(5)]: executed({ optionTokenId: null }),
    }[requestKey]));
    const refs = [1, 2, 3, 4, 5].map((n) => ({ requestKey: key(n), underlying: "AAPL" as const }));
    const found = await discoverCallPutPositions(client, ACCOUNT, refs, (EXPIRY - 5 * 86_400) * 1000);
    expect(found.map((position) => position.requestKey)).toEqual([key(1)]);
    expect(found[0]).toMatchObject({ optionTokenId: 123n, expiry: EXPIRY, action: "close", balanceRaw: 100_000_000_000_000_000n });
  });

  it("does not list a filled request whose token balance is already zero (closed or settled)", async () => {
    mocks.request.mockResolvedValue(executed());
    mocks.position.mockResolvedValue({ positionBalanceRaw: 0n });
    expect(await discoverCallPutPositions(client, ACCOUNT, [{ requestKey: key(1), underlying: "AAPL" }], 0)).toEqual([]);
  });

  it("de-duplicates request keys, orders by expiry, and skips an unreadable request without hiding the rest", async () => {
    mocks.request.mockImplementation(async (_c: unknown, _k: string, requestKey: Hex) => {
      if (requestKey === key(9)) throw new Error("rpc down");
      return executed({ expiry: BigInt(requestKey === key(1) ? EXPIRY + 100 : EXPIRY) });
    });
    const refs = [key(1), key(1), key(2), key(9)].map((requestKey) => ({ requestKey, underlying: "AAPL" as const }));
    const found = await discoverCallPutPositions(client, ACCOUNT, refs, 0);
    expect(found.map((position) => position.requestKey)).toEqual([key(2), key(1)]);
  });

  it("maps expiry to the one action the venue allows: close, nothing inside the last 30 minutes, then settle", () => {
    const expiryMs = EXPIRY * 1000;
    expect(positionAction(EXPIRY, expiryMs - 3_600_000).action).toBe("close");
    expect(positionAction(EXPIRY, expiryMs - 1_800_000).action).toBe("none");
    expect(positionAction(EXPIRY, expiryMs - 1).action).toBe("none");
    expect(positionAction(EXPIRY, expiryMs).action).toBe("settle");
    expect(positionAction(EXPIRY, expiryMs + 86_400_000).action).toBe("settle");
  });
});
