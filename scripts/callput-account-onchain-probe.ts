/**
 * Read-only probe of the CallPut TradingAccount session model on Robinhood Mainnet (chain 4663). It sends nothing and holds
 * no key: it reads constants and gates, runs eth_call probes from an arbitrary address, and decodes a real on-chain
 * `closeWithSession` call to show the shape and values of a real session grant.
 *
 * Source status on Blockscout (read in a browser 2026-11-22): the SUPERSEDED factory 0xbcaC...1862 is fully verified and
 * defines every gate used below; the CURRENT factory (proxy 0x23DB...6D1d, implementation 0x828e...C9ee, the one CallPut's own
 * callput_account_resolve reports) is NOT verified, and neither is the TradingAccount implementation, so their session
 * enforcement is read only from its ABI surface, live state and one real transaction. Field NAMES in the decoded grant are
 * inferred from their types and values, and the enforcement behind each field is inferred, not proven.
 *
 * Factory semantics from its verified source: canOpen(account) = !safeMode && isAccount[account] && (openToAll ||
 * allowlisted[account]). It takes an ACCOUNT address, never an owner wallet. createAccount is permissionless and works in
 * safe mode; deposits, funding and registration revert while safeMode is on. The admin sets safeMode, openToAll and the
 * allowlist.
 *
 * Usage: bun run scripts/callput-account-onchain-probe.ts > docs/evidence/callput/trading-account-onchain-probe-20261122.json
 */
import { BaseError, createPublicClient, decodeFunctionData, encodeFunctionData, getAddress, http, parseAbi, type Address, type Hex } from "viem";
import { robinhoodMainnet } from "../lib/chain/robinhood";
import { CALLPUT_ROBINHOOD_CONTRACTS as C } from "../lib/venue/callput-robinhood-readonly";

const client = createPublicClient({ chain: robinhoodMainnet, transport: http() });
const FACTORY = C.tradingAccountFactory as Address; // CURRENT factory (proxy)
const LEGACY_FACTORY = C.legacyTradingAccountFactory as Address;
const OWNER_EOA = (process.env.OWNER ?? "0xAa8fDF2f96aFC037D50659CFd09fDF3Fac060bBf") as Address;
const PROBE = "0x1111111111111111111111111111111111111111" as Address;
const REAL_CLOSE_TX = "0xa509d69fe40222efc08c47e2d3afbdc3816ebdfcde3f904611ea95c32fd3c97d" as Hex;

const factoryAbi = parseAbi([
  "function openToAll() view returns (bool)", "function safeMode() view returns (bool)", "function guardian() view returns (address)", "function admin() view returns (address)",
  "function maxSubAccounts() view returns (uint96)", "function accountCount() view returns (uint256)", "function isOpenAllowed(address) view returns (bool)", "function canOpen(address) view returns (bool)",
  "function accountsOf(address) view returns (address[])", "function computeAddress(address,uint96) view returns (address)", "function isAccount(address) view returns (bool)", "function isCreated(address) view returns (bool)",
]);
const accountAbi = parseAbi([
  "function owner() view returns (address)", "function epoch() view returns (uint256)", "function SESSION_STRATEGIES() view returns (uint256)", "function MAX_SESSION_DURATION() view returns (uint256)", "function MAX_UNDERLYINGS() view returns (uint256)",
  "function settleExpired(uint256[] ids)", "function withdraw(address token, uint256 amount, address to)", "function revokeSession(bytes32 sessionId)",
]);
const closeWithSessionAbi = parseAbi([
  "function closeWithSession((address,uint256,uint256,uint48,uint48,uint16[],uint16,uint256,uint256,uint32,uint32,uint256,uint256) grant,(bytes32,uint256,uint256,uint48,uint8) meta,(uint16,uint256,uint256,uint256) params,bytes signature)",
]);

const read = async <T>(fn: () => Promise<T>): Promise<T | { error: string }> => { try { return await fn(); } catch (e) { return { error: String((e as Error).message).split("\n")[0]!.slice(0, 160) }; } };
// Custom errors seen in the account's selector table (4-byte selectors resolved against a public signature database).
const KNOWN_ERRORS: Record<string, string> = {
  "0x1f2a2005": "ZeroAmount()", "0x30cd7471": "NotOwner()", "0x8baa579f": "InvalidSignature()", "0x58fc497d": "SessionUnavailable()",
  "0x5bff3115": "OpenNotAllowed()", "0x50b2c4e1": "BudgetExceeded()", "0x1f6d5aef": "NonceUsed()", "0x0f05f5bf": "AuthorizationExpired()",
};
const revertOf = async (to: Address, data: Hex, from: Address) => {
  try {
    await client.call({ to, data, account: from });
    return "no revert";
  } catch (e) {
    const carrier = e instanceof BaseError ? (e.walk((x) => typeof (x as { data?: unknown }).data === "string" && /^0x[0-9a-f]{8}/i.test((x as { data: string }).data)) as { data?: string } | null) : null;
    const selector = carrier?.data?.slice(0, 10).toLowerCase();
    return selector ? (KNOWN_ERRORS[selector] ?? `unrecognised error ${selector}`) : String((e as Error).message).split("\n")[0]!.slice(0, 120);
  }
};

const tx = await client.getTransaction({ hash: REAL_CLOSE_TX });
const account = getAddress(tx.to as Address);
const decoded = decodeFunctionData({ abi: closeWithSessionAbi, data: tx.input });
const g = decoded.args[0] as readonly [Address, bigint, bigint, number, number, readonly number[], number, bigint, bigint, number, number, bigint, bigint];
const MAX_U256 = 2n ** 256n - 1n;

const impl = await client.readContract({ address: C.tradingAccountBeacon as Address, abi: parseAbi(["function implementation() view returns (address)"]), functionName: "implementation" });
const predicted = (await client.readContract({ address: FACTORY, abi: factoryAbi, functionName: "computeAddress", args: [OWNER_EOA, 0n] })) as Address;
const accountOwner = (await read(() => client.readContract({ address: account, abi: accountAbi, functionName: "owner" }))) as Address;
const encode = (abi: typeof accountAbi, functionName: "settleExpired" | "withdraw" | "revokeSession", args: readonly unknown[]) => encodeFunctionData({ abi, functionName, args } as never) as Hex;

const legacy = {
  address: LEGACY_FACTORY,
  openToAll: await read(() => client.readContract({ address: LEGACY_FACTORY, abi: factoryAbi, functionName: "openToAll" })),
  safeMode: await read(() => client.readContract({ address: LEGACY_FACTORY, abi: factoryAbi, functionName: "safeMode" })),
  accountCount: String(await read(() => client.readContract({ address: LEGACY_FACTORY, abi: factoryAbi, functionName: "accountCount" }))),
  note: "Superseded. Source verified on Blockscout. Not the factory CallPut's resolver reports.",
};
const venueResolver = await read(async () => {
  const response = await fetch("https://mcp.callput.app/api/mcp?network=robinhood", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "callput_account_resolve", arguments: { owner: OWNER_EOA, sub_index: "0" } } }) });
  const text = await response.text();
  const parsed = JSON.parse(/\{.*\}/s.exec(text)![0]) as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(parsed.result!.content![0]!.text!) as Record<string, unknown>;
});

const result = {
  generatedAt: new Date().toISOString(),
  chainId: 4663,
  note: "Read-only. Account implementation is not source-verified on Blockscout; behavior is inferred from the ABI surface, live state and one real transaction.",
  legacyFactory: legacy,
  venueResolver,
  contracts: { factory: FACTORY, beacon: C.tradingAccountBeacon, accountImplementation: impl, sampleAccount: account, sampleAccountOwner: accountOwner },
  factoryGates: {
    openToAll: await read(() => client.readContract({ address: FACTORY, abi: factoryAbi, functionName: "openToAll" })),
    safeMode: await read(() => client.readContract({ address: FACTORY, abi: factoryAbi, functionName: "safeMode" })),
    guardian: await read(() => client.readContract({ address: FACTORY, abi: factoryAbi, functionName: "guardian" })),
    admin: await read(() => client.readContract({ address: FACTORY, abi: factoryAbi, functionName: "admin" })),
    accountCount: String(await read(() => client.readContract({ address: FACTORY, abi: factoryAbi, functionName: "accountCount" }))),
    maxSubAccounts: String(await read(() => client.readContract({ address: FACTORY, abi: factoryAbi, functionName: "maxSubAccounts" }))),
  },
  ownerWallet: {
    address: OWNER_EOA,
    registeredAccounts: await read(() => client.readContract({ address: FACTORY, abi: factoryAbi, functionName: "accountsOf", args: [OWNER_EOA] })),
    predictedAccount0: predicted,
    predictedAccount0Created: await read(() => client.readContract({ address: FACTORY, abi: factoryAbi, functionName: "isCreated", args: [predicted] })),
    predictedAccount0Registered: await read(() => client.readContract({ address: FACTORY, abi: factoryAbi, functionName: "isAccount", args: [predicted] })),
    predictedAccount0OpenAllowed: await read(() => client.readContract({ address: FACTORY, abi: factoryAbi, functionName: "isOpenAllowed", args: [predicted] })),
    predictedAccount0CanOpen: await read(() => client.readContract({ address: FACTORY, abi: factoryAbi, functionName: "canOpen", args: [predicted] })),
    note: "canOpen and isOpenAllowed take an ACCOUNT address. The owner wallet itself is never asked.",
  },
  sampleAccountGate: {
    account,
    registered: await read(() => client.readContract({ address: FACTORY, abi: factoryAbi, functionName: "isAccount", args: [account] })),
    openAllowed: await read(() => client.readContract({ address: FACTORY, abi: factoryAbi, functionName: "isOpenAllowed", args: [account] })),
    canOpen: await read(() => client.readContract({ address: FACTORY, abi: factoryAbi, functionName: "canOpen", args: [account] })),
  },
  accountConstants: {
    SESSION_STRATEGIES: String(await read(() => client.readContract({ address: impl, abi: accountAbi, functionName: "SESSION_STRATEGIES" }))),
    MAX_SESSION_DURATION_seconds: String(await read(() => client.readContract({ address: impl, abi: accountAbi, functionName: "MAX_SESSION_DURATION" }))),
    MAX_UNDERLYINGS: String(await read(() => client.readContract({ address: impl, abi: accountAbi, functionName: "MAX_UNDERLYINGS" }))),
  },
  accessProbesFromArbitraryAddress: {
    settleExpiredEmpty: await revertOf(account, encode(accountAbi, "settleExpired", [[]]), PROBE),
    withdraw: await revertOf(account, encode(accountAbi, "withdraw", [C.usdg as Address, 1n, PROBE]), PROBE),
    revokeSession: await revertOf(account, encode(accountAbi, "revokeSession", [`0x${"00".repeat(32)}`]), PROBE),
    interpretation: "settleExpired reaches amount validation (not an owner check), so settlement is permissionless; withdraw and revokeSession are owner-only.",
  },
  realSessionGrant: {
    sourceTx: REAL_CLOSE_TX,
    relayer: tx.from,
    function: "closeWithSession (separate from openWithSession)",
    deviceSigner: g[0],
    validFromUtc: new Date(g[3] * 1000).toISOString(),
    validUntilUtc: new Date(g[4] * 1000).toISOString(),
    durationDays: (g[4] - g[3]) / 86_400,
    underlyings: g[5],
    strategyMask: g[6],
    field7: g[7] === MAX_U256 ? "max uint256 (unbounded)" : String(g[7]),
    field8: g[8] === MAX_U256 ? "max uint256 (unbounded)" : String(g[8]),
    field9: g[9] === 0xffffffff ? "max uint32 (unbounded)" : g[9],
    field10: g[10] === 0xffffffff ? "max uint32 (unbounded)" : g[10],
    field11: String(g[11]),
    field12: String(g[12]),
    interpretation: "A close-only grant with unbounded value caps: the venue enforces whatever the owner signs, so limits are only as tight as the grant the owner signs. Field names are inferred.",
  },
};
console.log(JSON.stringify(result, null, 2));
