/**
 * Live, read-only reads of the CallPut TradingAccountFactory gates that decide whether an owner can create or open
 * an Account on Robinhood Mainnet. Names come from the factory's ABI; the contract source is not verified on
 * Blockscout, so these are reported as read values, not as a description of venue policy.
 */
import { parseAbi, type Address, type PublicClient } from "viem";
import { CALLPUT_ROBINHOOD_CONTRACTS } from "./callput-robinhood-readonly";

const factoryAbi = parseAbi([
  "function openToAll() view returns (bool)",
  "function safeMode() view returns (bool)",
  "function canOpen(address) view returns (bool)",
  "function accountsOf(address) view returns (address[])",
]);

export type CallPutAccountGates = {
  openToAll: boolean;
  safeMode: boolean;
  /** `canOpen(owner)` for the signed-in wallet. */
  ownerCanOpen: boolean;
  ownerAccountCount: number;
  /** True only when the factory would let this owner use an Account for opens today. */
  accountUsable: boolean;
};

export async function readCallPutAccountGates(client: Pick<PublicClient, "readContract">, owner: Address): Promise<CallPutAccountGates> {
  const address = CALLPUT_ROBINHOOD_CONTRACTS.tradingAccountFactory as Address;
  const read = <T>(functionName: "openToAll" | "safeMode" | "canOpen" | "accountsOf", args?: readonly [Address]) =>
    client.readContract({ address, abi: factoryAbi, functionName, ...(args ? { args } : {}) } as never) as Promise<T>;
  const [openToAll, safeMode, ownerCanOpen, accounts] = await Promise.all([read<boolean>("openToAll"), read<boolean>("safeMode"), read<boolean>("canOpen", [owner]), read<readonly Address[]>("accountsOf", [owner])]);
  return { openToAll, safeMode, ownerCanOpen, ownerAccountCount: accounts.length, accountUsable: ownerCanOpen && !safeMode };
}
