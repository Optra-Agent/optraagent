/**
 * Live, read-only reads of the CURRENT CallPut TradingAccountFactory (0x23DB9f5fDde30853EC8eBd75E0492c09505a6D1d, the
 * factory CallPut's own callput_account_resolve reports). It is a proxy whose implementation is not source-verified on
 * Blockscout, so the meaning below comes from the SUPERSEDED factory's verified source (0xbcaC62...1862) and from the
 * current factory answering the same ABI:
 *
 *   canOpen(account)    = !safeMode && isAccount[account] && (openToAll || allowlisted[account])
 *   createAccount(...)  = permissionless, works in safe mode, but does NOT register the account
 *   registration        = happens on the owner's funding or first deposit, and reverts while safeMode is on
 *   safeMode/openToAll/allowlist = set by the factory admin only
 *
 * `canOpen` and `isOpenAllowed` take an ACCOUNT address, never the owner's wallet. On 2026-11-22 the current factory
 * reports openToAll=true and safeMode=false; the superseded one still has safeMode=true. The account implementation
 * behind the beacon has no verified source, so whether it consults `canOpen` on every open is not proven here.
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
