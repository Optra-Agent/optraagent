import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { readCallPutAccountGates } from "../../lib/venue/callput-account-gates";

const OWNER = "0xAa8fDF2f96aFC037D50659CFd09fDF3Fac060bBf" as Address;
const stub = (values: Record<string, unknown>) => ({ readContract: async ({ functionName }: { functionName: string }) => { if (!(functionName in values)) throw new Error(`unexpected ${functionName}`); return values[functionName]; } }) as never;

describe("CallPut account factory gates", () => {
  it("reports an Account as unusable while safe mode is on or the wallet may not open", async () => {
    const closed = await readCallPutAccountGates(stub({ openToAll: false, safeMode: true, canOpen: false, accountsOf: [] }), OWNER);
    expect(closed).toEqual({ openToAll: false, safeMode: true, ownerCanOpen: false, ownerAccountCount: 0, accountUsable: false });
    expect((await readCallPutAccountGates(stub({ openToAll: true, safeMode: true, canOpen: true, accountsOf: [OWNER] }), OWNER)).accountUsable).toBe(false);
    expect((await readCallPutAccountGates(stub({ openToAll: false, safeMode: false, canOpen: false, accountsOf: [] }), OWNER)).accountUsable).toBe(false);
  });

  it("reports usable only when the wallet may open and safe mode is off", async () => {
    expect((await readCallPutAccountGates(stub({ openToAll: false, safeMode: false, canOpen: true, accountsOf: [OWNER, OWNER] }), OWNER))).toMatchObject({ accountUsable: true, ownerAccountCount: 2 });
  });

  it("propagates a read failure so the status page shows 'unavailable' instead of a guess", async () => {
    await expect(readCallPutAccountGates({ readContract: async () => { throw new Error("rpc down"); } } as never, OWNER)).rejects.toThrow("rpc down");
  });
});
