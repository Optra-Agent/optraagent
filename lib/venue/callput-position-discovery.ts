/**
 * Finds the connected wallet's own filled CallPut positions from its own persisted open orders and the chain.
 * A position is listed only when the chain says its open request was Executed for this account and the wallet holds a
 * positive ERC-1155 balance of the resulting token. A submitted transaction or a request key alone is never a position.
 * Nothing here signs or sends anything.
 */
import type { Address, Hex, PublicClient } from "viem";
import { getAddress } from "viem";
import { CALLPUT_LIMITS, readCallPutPositionState, type CallPutUnderlyingSymbol } from "./callput-robinhood-write";
import { readCallPutRobinhoodRequest } from "./callput-robinhood-requests";

export type DiscoveredPosition = {
  requestKey: Hex;
  underlying: CallPutUnderlyingSymbol;
  optionTokenId: bigint;
  expiry: number;
  balanceRaw: bigint;
  /** What the venue allows right now: close before the final window, settle at or after expiry, neither in between. */
  action: "close" | "settle" | "none";
  reason: string;
};

export type OpenRequestRef = { requestKey: Hex; underlying: CallPutUnderlyingSymbol };

export function positionAction(expiry: number, nowMs: number): Pick<DiscoveredPosition, "action" | "reason"> {
  const expiryMs = expiry * 1000;
  if (nowMs >= expiryMs) return { action: "settle", reason: "Expired: eligible to settle." };
  if (nowMs >= expiryMs - CALLPUT_LIMITS.deadlineBufferSeconds * 1000) return { action: "none", reason: "Inside the final 30 minutes before expiry: the venue accepts neither a close nor a settle yet." };
  return { action: "close", reason: "Before expiry: eligible to close." };
}

export async function discoverCallPutPositions(client: PublicClient, account: Address, refs: readonly OpenRequestRef[], nowMs: number): Promise<DiscoveredPosition[]> {
  const unique = [...new Map(refs.map((ref) => [ref.requestKey.toLowerCase(), ref])).values()];
  const found = await Promise.all(unique.map(async (ref): Promise<DiscoveredPosition | null> => {
    try {
      const snapshot = await readCallPutRobinhoodRequest(client, "open", ref.requestKey);
      if (snapshot.status !== "Executed" || snapshot.optionTokenId === null || snapshot.expiry === null || !snapshot.account) return null;
      if (getAddress(snapshot.account) !== getAddress(account)) return null;
      const position = await readCallPutPositionState(client, account, ref.underlying, snapshot.optionTokenId, "position");
      if (position.positionBalanceRaw <= 0n) return null;
      const expiry = Number(snapshot.expiry);
      return { requestKey: ref.requestKey, underlying: ref.underlying, optionTokenId: snapshot.optionTokenId, expiry, balanceRaw: position.positionBalanceRaw, ...positionAction(expiry, nowMs) };
    } catch {
      // One unreadable request must not hide the others; it simply is not listed.
      return null;
    }
  }));
  return found.filter((entry): entry is DiscoveredPosition => entry !== null).sort((a, b) => a.expiry - b.expiry);
}
