/**
 * Read-only getter results from the factory address statically configured in this app. This function does not ask
 * CallPut's live resolver. The configured proxy and Account implementation are not source-verified. Treat
 * `canOpen(account)` as an observed getter answer for that exact Account, not proof the live venue selects this factory
 * or that every open enforces it. Do not infer deposit, registration or admin remedies from these flags.
 *
 * `canOpen` and `isOpenAllowed` take an ACCOUNT address, never the owner's wallet. The 2026-11-22 probe is historical:
 * its global flags were resolver-selected then, but its per-account check used the deployer wallet's predicted Account.
 * Re-read CallPut's resolver and the owner's exact Account at activation time.
 */
import { parseAbi, type Address, type PublicClient } from "viem";
import type { AccountGateFacts } from "./callput-account-gates-text";
import { CALLPUT_ROBINHOOD_CONTRACTS } from "./callput-robinhood-readonly";

const factoryAbi = parseAbi([
  "function openToAll() view returns (bool)",
  "function safeMode() view returns (bool)",
  "function canOpen(address) view returns (bool)",
  "function isOpenAllowed(address) view returns (bool)",
  "function isAccount(address) view returns (bool)",
  "function isCreated(address) view returns (bool)",
  "function accountsOf(address) view returns (address[])",
  "function computeAddress(address,uint96) view returns (address)",
]);

export type CallPutAccountGates = AccountGateFacts;

export async function readCallPutAccountGates(client: Pick<PublicClient, "readContract">, owner: Address, expectedAccount?: Address): Promise<CallPutAccountGates> {
  const address = CALLPUT_ROBINHOOD_CONTRACTS.tradingAccountFactory as Address;
  const read = <T>(functionName: "openToAll" | "safeMode" | "canOpen" | "isOpenAllowed" | "isAccount" | "isCreated" | "accountsOf" | "computeAddress", args?: readonly unknown[]) =>
    client.readContract({ address, abi: factoryAbi, functionName, ...(args ? { args } : {}) } as never) as Promise<T>;
  const [openToAll, safeMode, accounts, predicted] = await Promise.all([read<boolean>("openToAll"), read<boolean>("safeMode"), read<readonly Address[]>("accountsOf", [owner]), read<Address>("computeAddress", [owner, 0n])]);
  const account: Address = expectedAccount ?? accounts[0] ?? predicted;
  const ownerAccountMatch = accounts.some((entry) => entry.toLowerCase() === account.toLowerCase()) || predicted.toLowerCase() === account.toLowerCase();
  const [accountCreated, accountRegistered, accountAllowed, accountCanOpen] = await Promise.all([read<boolean>("isCreated", [account]), read<boolean>("isAccount", [account]), read<boolean>("isOpenAllowed", [account]), read<boolean>("canOpen", [account])]);
  const verification = {
    resolverMatchVerified: false,
    factorySourceVerified: false,
    accountSourceVerified: false,
    openPathEnforcementVerified: false,
  } as const;
  return {
    factoryAddress: address,
    ownerAccountMatch,
    ...verification,
    openToAll,
    safeMode,
    account,
    accountCreated,
    accountRegistered,
    accountAllowed,
    accountCanOpen,
    ownerAccountCount: accounts.length,
    accountUsable: ownerAccountMatch && accountCanOpen && Object.values(verification).every(Boolean),
  };
}
