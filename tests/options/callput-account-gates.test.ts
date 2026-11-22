import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { readCallPutAccountGates } from "../../lib/venue/callput-account-gates";
import { accountBlockReason, describeAccountGates } from "../../lib/venue/callput-account-gates-text";

const OWNER = "0xAa8fDF2f96aFC037D50659CFd09fDF3Fac060bBf" as Address;
const PREDICTED = "0x6b565373726fAA9217B07E067A28Ca81952fB9b3" as Address;
const REGISTERED = "0x9d2bDa3470C69681B212FFF7C02143D8afA2157e" as Address;
type Values = Record<string, unknown>;
/** Answers each factory read from a table and records which address the account-level reads were asked about. */
const stub = (values: Values, asked: Array<[string, unknown]> = []) => ({
  readContract: async ({ functionName, args }: { functionName: string; args?: unknown[] }) => {
    asked.push([functionName, args?.[0]]);
    if (!(functionName in values)) throw new Error(`unexpected ${functionName}`);
    return values[functionName];
  },
}) as never;
const base: Values = { openToAll: false, safeMode: true, accountsOf: [], computeAddress: PREDICTED, isCreated: false, isAccount: false, isOpenAllowed: false, canOpen: false };

describe("CallPut account factory gates", () => {
  it("asks account-level gates about the ACCOUNT address, never the owner wallet", async () => {
    const asked: Array<[string, unknown]> = [];
    await readCallPutAccountGates(stub(base, asked), OWNER);
    for (const name of ["isCreated", "isAccount", "isOpenAllowed", "canOpen"]) expect(asked.find(([fn]) => fn === name)?.[1]).toBe(PREDICTED);
    expect(asked.filter(([fn]) => ["canOpen", "isOpenAllowed", "isAccount"].includes(fn)).every(([, arg]) => arg !== OWNER)).toBe(true);
  });

  it("uses the owner's first registered Account when there is one, else the predicted address", async () => {
    const withAccount = await readCallPutAccountGates(stub({ ...base, accountsOf: [REGISTERED], isCreated: true, isAccount: true }), OWNER);
    expect(withAccount).toMatchObject({ account: REGISTERED, ownerAccountCount: 1, accountRegistered: true, accountCanOpen: false, accountUsable: false });
    expect(await readCallPutAccountGates(stub(base), OWNER)).toMatchObject({ account: PREDICTED, ownerAccountCount: 0, accountCreated: false, accountRegistered: false });
  });

  it("is usable only when the factory itself says the Account can open", async () => {
    const open = await readCallPutAccountGates(stub({ ...base, safeMode: false, accountsOf: [REGISTERED], isCreated: true, isAccount: true, isOpenAllowed: true, canOpen: true }), OWNER);
    expect(open.accountUsable).toBe(true);
    expect(accountBlockReason(open)).toBeNull();
    expect((await readCallPutAccountGates(stub({ ...base, safeMode: false, isOpenAllowed: true, canOpen: false }), OWNER)).accountUsable).toBe(false);
  });

  it("names the first reason the factory refuses, in the order the factory checks", async () => {
    const facts = (over: object) => ({ openToAll: false, safeMode: false, account: PREDICTED, accountCreated: true, accountRegistered: true, accountAllowed: true, accountCanOpen: false, ownerAccountCount: 1, accountUsable: false, ...over });
    expect(accountBlockReason(facts({ safeMode: true, accountRegistered: false, accountAllowed: false }))).toContain("safe mode");
    expect(accountBlockReason(facts({ accountCreated: false, accountRegistered: false, accountAllowed: true }))).toContain("does not exist yet");
    expect(accountBlockReason(facts({ accountRegistered: false, accountAllowed: false }))).toContain("not registered");
    expect(accountBlockReason(facts({ accountAllowed: false }))).toContain("allowlist");
    expect(accountBlockReason(facts({}))).toContain("refuses");
    expect(describeAccountGates(facts({ safeMode: true }))).toContain("safe mode on");
  });

  it("propagates a read failure so the status page shows 'unavailable' instead of a guess", async () => {
    await expect(readCallPutAccountGates({ readContract: async () => { throw new Error("rpc down"); } } as never, OWNER)).rejects.toThrow("rpc down");
  });
});
