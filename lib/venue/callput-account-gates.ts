/**
 * Live, read-only reads of the CallPut TradingAccountFactory gates that decide whether an Account can open on Robinhood
 * Mainnet. The factory source is verified on Blockscout, and its meaning is (read from that source, 2026-11-22):
 *
 *   canOpen(account)    = !safeMode && isAccount[account] && (openToAll || allowlisted[account])
 *   createAccount(...)  = permissionless, works while safeMode is on, but does NOT register the account
 *   registration        = happens on the owner's funding or first deposit, and reverts while safeMode is on
 *   safeMode/openToAll/allowlist = set by the factory admin only (a guardian may switch safe mode ON, never off)
 *
 * `canOpen` and `isOpenAllowed` take an ACCOUNT address, never the owner's wallet. The account implementation behind the
 * beacon has no verified source, so whether it consults `canOpen` on every open is not proven here.
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

export async function readCallPutAccountGates(client: Pick<PublicClient, "readContract">, owner: Address): Promise<CallPutAccountGates> {
  const address = CALLPUT_ROBINHOOD_CONTRACTS.tradingAccountFactory as Address;
  const read = <T>(functionName: "openToAll" | "safeMode" | "canOpen" | "isOpenAllowed" | "isAccount" | "isCreated" | "accountsOf" | "computeAddress", args?: readonly unknown[]) =>
    client.readContract({ address, abi: factoryAbi, functionName, ...(args ? { args } : {}) } as never) as Promise<T>;
  const [openToAll, safeMode, accounts, predicted] = await Promise.all([read<boolean>("openToAll"), read<boolean>("safeMode"), read<readonly Address[]>("accountsOf", [owner]), read<Address>("computeAddress", [owner, 0n])]);
  const account: Address = accounts[0] ?? predicted;
  const [accountCreated, accountRegistered, accountAllowed, accountCanOpen] = await Promise.all([read<boolean>("isCreated", [account]), read<boolean>("isAccount", [account]), read<boolean>("isOpenAllowed", [account]), read<boolean>("canOpen", [account])]);
  return { openToAll, safeMode, account, accountCreated, accountRegistered, accountAllowed, accountCanOpen, ownerAccountCount: accounts.length, accountUsable: accountCanOpen };
}
