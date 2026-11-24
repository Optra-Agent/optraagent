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
const UNRELATED = "0x0000000000000000000000000000000000000042" as Address;
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
    expect(withAccount).toMatchObject({ account: REGISTERED, ownerAccountCount: 1, ownerAccountMatch: true, accountRegistered: true, accountCanOpen: false, accountUsable: false });
    expect(await readCallPutAccountGates(stub(base), OWNER)).toMatchObject({ account: PREDICTED, ownerAccountCount: 0, ownerAccountMatch: true, accountCreated: false, accountRegistered: false });
  });

  it("reads the exact grant Account and records when the configured factory does not associate it with the owner", async () => {
    const asked: Array<[string, unknown]> = [];
    const facts = await readCallPutAccountGates(stub({ ...base, canOpen: true }, asked), OWNER, UNRELATED);
    expect(facts.account).toBe(UNRELATED);
    expect(facts.ownerAccountMatch).toBe(false);
    expect(facts.accountUsable).toBe(false);
    expect(asked.find(([fn]) => fn === "canOpen")?.[1]).toBe(UNRELATED);
    expect(accountBlockReason(facts)).toMatch(/owner Account association.*not verified/i);
  });

  it("does not equate a configured canOpen getter with verified account enforcement", async () => {
    const open = await readCallPutAccountGates(stub({ ...base, safeMode: false, accountsOf: [REGISTERED], isCreated: true, isAccount: true, isOpenAllowed: true, canOpen: true }), OWNER);
    expect(open.accountCanOpen).toBe(true);
    expect(open.accountUsable).toBe(false);
    expect(open).toMatchObject({ resolverMatchVerified: false, factorySourceVerified: false, accountSourceVerified: false, openPathEnforcementVerified: false });
    expect(accountBlockReason(open)).toMatch(/resolver match.*not verified/i);
    expect((await readCallPutAccountGates(stub({ ...base, safeMode: false, isOpenAllowed: true, canOpen: false }), OWNER)).accountUsable).toBe(false);
  });

  it("describes the observed account-gate values", async () => {
    const facts = (over: object) => ({ openToAll: false, safeMode: false, account: PREDICTED, accountCreated: true, accountRegistered: true, accountAllowed: true, accountCanOpen: false, ownerAccountCount: 1, accountUsable: false, ...over });
    expect(accountBlockReason(facts({ safeMode: true, accountRegistered: false, accountAllowed: false }))).toContain("safe mode");
    expect(accountBlockReason(facts({ accountCreated: false, accountRegistered: false, accountAllowed: true }))).toContain("does not exist yet");
    expect(accountBlockReason(facts({ accountRegistered: false, accountAllowed: false }))).toContain("not registered");
    expect(accountBlockReason(facts({ accountAllowed: false }))).toContain("allowlist");
    expect(accountBlockReason(facts({}))).toContain("Configured factory reports canOpen=false");
    expect(accountBlockReason(facts({}))).not.toMatch(/refuses|would refuse/i);
    expect(describeAccountGates(facts({ safeMode: true }))).toContain("safe mode on");
    expect(describeAccountGates(facts({ safeMode: true }))).toContain("canOpen no");
  });

  it("returns no enforcement block only after every resolver and source fact is verified", () => {
    const complete = { openToAll: true, safeMode: false, account: REGISTERED, accountCreated: true, accountRegistered: true, accountAllowed: true, accountCanOpen: true, ownerAccountCount: 1, accountUsable: true, ownerAccountMatch: true, resolverMatchVerified: true, factorySourceVerified: true, accountSourceVerified: true, openPathEnforcementVerified: true };
    expect(accountBlockReason(complete)).toBeNull();
    expect(accountBlockReason({ ...complete, openPathEnforcementVerified: false })).toMatch(/per-open enforcement/i);
  });

  it("does not infer funding or admin requirements from the unverified current factory source", () => {
    const safeMode = accountBlockReason({ openToAll: false, safeMode: true, account: PREDICTED, accountCreated: true, accountRegistered: false, accountAllowed: false, accountCanOpen: false, ownerAccountCount: 1, accountUsable: false }) ?? "";
    const uncreated = accountBlockReason({ openToAll: false, safeMode: false, account: PREDICTED, accountCreated: false, accountRegistered: false, accountAllowed: false, accountCanOpen: false, ownerAccountCount: 0, accountUsable: false }) ?? "";
    const unregistered = accountBlockReason({ openToAll: false, safeMode: false, account: PREDICTED, accountCreated: true, accountRegistered: false, accountAllowed: false, accountCanOpen: false, ownerAccountCount: 1, accountUsable: false }) ?? "";
    const notAllowed = accountBlockReason({ openToAll: false, safeMode: false, account: PREDICTED, accountCreated: true, accountRegistered: true, accountAllowed: false, accountCanOpen: false, ownerAccountCount: 1, accountUsable: false }) ?? "";

    expect(safeMode).toContain("canOpen=false");
    expect(safeMode).not.toMatch(/blocks funding|admin turns it off/i);
    expect(uncreated).toContain("re-read");
    expect(uncreated).not.toContain("permissionless");
    expect(unregistered).toMatch(/confirm/i);
    expect(unregistered).not.toContain("first deposit registers");
    expect(notAllowed).toMatch(/confirm/i);
    expect(notAllowed).not.toContain("admin must allowlist");
  });

  it("propagates a read failure so the status page shows 'unavailable' instead of a guess", async () => {
    await expect(readCallPutAccountGates({ readContract: async () => { throw new Error("rpc down"); } } as never, OWNER)).rejects.toThrow("rpc down");
  });
});
