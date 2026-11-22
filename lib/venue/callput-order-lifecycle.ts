import { getAddress, type Address, type Hex, type PublicClient } from "viem";
import type { PersistedCallPutOrder } from "./callput-order-ledger-client";
import { readCallPutRobinhoodRequest } from "./callput-robinhood-requests";
import {
  CALLPUT_ROBINHOOD_UNDERLYINGS,
  CALLPUT_WRITE_ABIS,
  extractCallPutRequestKey,
  reconcileCallPutClose,
  reconcileCallPutOpen,
  type CallPutOrderIntent,
} from "./callput-robinhood-write";

export type CallPutLifecycleState =
  | "intent-only"
  | "approval-confirmed"
  | "transaction-awaiting-receipt"
  | "transaction-reverted"
  | "request-awaiting-key"
  | "request-not-found"
  | "pending"
  | "pending-past-delay"
  | "cancelled"
  | "executed-unconfirmed"
  | "executed-confirmed"
  | "settlement-unconfirmed"
  | "settlement-confirmed"
  | "rpc-unavailable";

export type CallPutLifecycle = {
  state: CallPutLifecycleState;
  label: string;
  /** What was actually checked and what it does or does not prove. */
  evidence: string;
  tone: "neutral" | "azure" | "ember" | "gain" | "loss";
  /** No further on-chain polling is needed: the order reached an outcome that cannot change. */
  terminal: boolean;
  /** True only for a keeper-executed request whose option-token balance independently confirms it. A tx hash never sets this. */
  fillConfirmed: boolean;
  checkedAtMs: number;
};

function redact(error: unknown): string {
  const text = error instanceof Error ? error.message : "The read failed.";
  return text.replace(/https?:\/\/[^\s)]+/gi, "[endpoint]").slice(0, 200);
}

async function optionTokenBalance(client: PublicClient, underlying: keyof typeof CALLPUT_ROBINHOOD_UNDERLYINGS, account: Address, tokenId: bigint): Promise<bigint> {
  const balances = await client.readContract({
    address: getAddress(CALLPUT_ROBINHOOD_UNDERLYINGS[underlying].optionsToken),
    abi: CALLPUT_WRITE_ABIS.optionsToken,
    functionName: "balanceOfBatch",
    args: [[account], [tokenId]],
  });
  return balances[0] ?? 0n;
}

function make(state: CallPutLifecycleState, label: string, evidence: string, tone: CallPutLifecycle["tone"], terminal: boolean, fillConfirmed: boolean, checkedAtMs: number): CallPutLifecycle {
  return { state, label, evidence, tone, terminal, fillConfirmed, checkedAtMs };
}

function isReceiptNotFound(error: unknown): boolean {
  return error instanceof Error && (error.name === "TransactionReceiptNotFoundError" || /could not be found/i.test(error.message));
}

/**
 * Reconciles one persisted CallPut order against Robinhood Mainnet. The server ledger holds only references the browser
 * reported; every status here is read from the chain. A transaction hash proves inclusion, never an options fill: an
 * open is a fill only when the keeper marked its request Executed and the wallet's option-token balance covers it.
 */
export async function reconcileCallPutOrderLifecycle(params: { order: PersistedCallPutOrder; client: PublicClient; nowMs: number }): Promise<CallPutLifecycle> {
  const { order, client, nowMs } = params;
  const events = [...order.events].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const transactions = events.filter((event) => event.referenceKind === "transaction");
  const requestEvent = events.filter((event) => event.referenceKind === "request-key").at(-1);
  const lastTransaction = transactions.at(-1);

  if (!requestEvent && !lastTransaction) {
    return make("intent-only", "No transaction recorded", "The intent was saved but no transaction reference followed. If you approved a wallet prompt, check your wallet activity before preparing again: a signed transaction may not have been recorded here. Do not resubmit until you know.", "ember", false, false, nowMs);
  }

  try {
    const account = getAddress(order.account);
    let requestKey: Hex | null = (requestEvent?.requestKey as Hex | undefined) ?? null;
    const transactionHash: Hex | null = ((requestEvent ?? lastTransaction)?.transactionHash as Hex | undefined) ?? null;

    if (!requestKey && lastTransaction && transactionHash) {
      let receipt;
      try {
        receipt = await client.getTransactionReceipt({ hash: transactionHash });
      } catch (error) {
        if (isReceiptNotFound(error)) return make("transaction-awaiting-receipt", "Submitted, awaiting receipt", "The transaction hash was recorded but the chain has no receipt for it yet. It may still be pending or may have been dropped; keep checking and do not sign it again.", "azure", false, false, nowMs);
        throw error;
      }
      if (receipt.status !== "success") {
        return make("transaction-reverted", "Transaction reverted", `The ${lastTransaction.transactionKind} transaction reverted on-chain. ${order.kind === "open" && lastTransaction.transactionKind === "open-spread" ? "No CallPut request was created." : "Nothing was changed."} Prepare a new order to try again.`, "loss", true, false, nowMs);
      }
      if (lastTransaction.transactionKind === "usdg-approval" || lastTransaction.transactionKind === "option-token-approval") {
        return make("approval-confirmed", "Approval only", "The approval transaction succeeded. It is an allowance, not an order: no position was opened or changed. The allowance stays on-chain until you revoke it.", "neutral", true, false, nowMs);
      }
      if (lastTransaction.transactionKind === "settle-position") {
        if (order.intent.kind !== "settle") return make("settlement-unconfirmed", "Settlement unconfirmed", "A settlement receipt exists but the stored intent is not a settlement.", "ember", true, false, nowMs);
        const balance = await optionTokenBalance(client, order.intent.underlying, account, BigInt(order.intent.optionTokenId));
        const before = BigInt(order.intent.positionBalanceBeforeRaw);
        return balance < before
          ? make("settlement-confirmed", "Settled", `The settlement transaction succeeded and the wallet's option-token balance fell from ${before} to ${balance} raw units. The payout itself is not separately verified here.`, "gain", true, true, nowMs)
          : make("settlement-unconfirmed", "Settlement unconfirmed", "The settlement transaction succeeded but the option-token balance did not decrease. Not treated as settled.", "ember", true, false, nowMs);
      }
      // open-spread or close-position receipt with no request key stored: recover the key from the receipt log.
      try {
        requestKey = extractCallPutRequestKey(receipt, { account, isOpen: order.kind === "open" });
      } catch {
        return make("request-awaiting-key", "Mined, no request found", "The transaction succeeded but its receipt has no matching CallPut request log, so no order can be tracked from it. A transaction hash alone does not establish an order.", "ember", false, false, nowMs);
      }
    }

    if (!requestKey) return make("request-awaiting-key", "Awaiting request key", "No request key is available yet.", "ember", false, false, nowMs);

    if (order.intent.kind === "open") {
      const request = await readCallPutRobinhoodRequest(client, "open", requestKey);
      const balance = request.status === "Executed" && request.optionTokenId !== null ? await optionTokenBalance(client, order.intent.underlying, account, request.optionTokenId) : null;
      const stored: CallPutOrderIntent = { ...order.intent, account, longOptionId: order.intent.longOptionId as Hex, shortOptionId: order.intent.shortOptionId as Hex, txHash: transactionHash, requestKey };
      const result = reconcileCallPutOpen({ intent: stored, request, optionTokenBalanceRaw: balance, nowMs });
      switch (result.state) {
        case "pending": return make("pending", "Queued with keeper", result.evidence, "azure", false, false, nowMs);
        case "pending-past-delay": return make("pending-past-delay", "Pending past delay", result.evidence, "ember", false, false, nowMs);
        case "cancelled": return make("cancelled", "Cancelled by keeper", result.evidence, "ember", true, false, nowMs);
        case "request-not-found": return make("request-not-found", "Request not found", result.evidence, "ember", false, false, nowMs);
        case "executed-balance-confirmed": return make("executed-confirmed", "Position confirmed", result.evidence, "gain", true, true, nowMs);
        case "executed-balance-unconfirmed": return make("executed-unconfirmed", "Executed, balance unconfirmed", result.evidence, "ember", false, false, nowMs);
        default: return make("request-awaiting-key", "Awaiting request key", result.evidence, "ember", false, false, nowMs);
      }
    }

    if (order.intent.kind === "close") {
      const request = await readCallPutRobinhoodRequest(client, "close", requestKey);
      const tokenId = BigInt(order.intent.optionTokenId);
      const balanceAfter = request.status === "Executed" ? await optionTokenBalance(client, order.intent.underlying, account, tokenId) : null;
      const result = reconcileCallPutClose({ request, requestKey, account, optionTokenId: tokenId, preBalanceRaw: BigInt(order.intent.positionBalanceBeforeRaw), balanceAfterRaw: balanceAfter, nowMs });
      switch (result.state) {
        case "pending": return make("pending", "Close queued with keeper", result.evidence, "azure", false, false, nowMs);
        case "pending-past-delay": return make("pending-past-delay", "Close pending past delay", result.evidence, "ember", false, false, nowMs);
        case "cancelled": return make("cancelled", "Close cancelled by keeper", result.evidence, "ember", true, false, nowMs);
        case "request-not-found": return make("request-not-found", "Close request not found", result.evidence, "ember", false, false, nowMs);
        case "executed-position-confirmed": return make("executed-confirmed", "Close confirmed", result.evidence, "gain", true, true, nowMs);
        case "executed-position-unconfirmed": return make("executed-unconfirmed", "Close executed, unconfirmed", result.evidence, "ember", false, false, nowMs);
        default: return make("request-awaiting-key", "Awaiting close request key", result.evidence, "ember", false, false, nowMs);
      }
    }
    return make("request-awaiting-key", "Awaiting request key", "A settlement has no request key; its receipt is the evidence.", "neutral", false, false, nowMs);
  } catch (error) {
    return make("rpc-unavailable", "Chain read unavailable", `The Robinhood Mainnet read failed (${redact(error)}). The stored references are unchanged and nothing was inferred. It will be retried.`, "neutral", false, false, nowMs);
  }
}

/**
 * A new open request is blocked when an identical one (same wallet, strategy, legs and size) is still unresolved, so a
 * double click, a second tab or an ambiguous earlier submission cannot create two orders. The guard lifts once the
 * earlier order reached a terminal outcome, or after the window below with no result.
 */
export const CALLPUT_DUPLICATE_WINDOW_MS = 30 * 60 * 1000;

export type CallPutDuplicateCandidate = {
  clientIntentId?: string | undefined;
  account: string;
  strategy: string;
  longOptionId: string;
  shortOptionId: string;
  sizeRaw: string;
  createdAtMs: number;
  /** A transaction or request key was recorded for it. */
  submitted: boolean;
  /** The last reconciled outcome was terminal. */
  terminal: boolean;
};

export function findUnresolvedDuplicate(
  candidates: CallPutDuplicateCandidate[],
  current: { clientIntentId: string | null; account: string; strategy: string; longOptionId: string; shortOptionId: string; sizeRaw: string },
  nowMs: number,
): CallPutDuplicateCandidate | null {
  return candidates.find((candidate) =>
    candidate.clientIntentId !== current.clientIntentId &&
    candidate.account.toLowerCase() === current.account.toLowerCase() &&
    candidate.strategy === current.strategy &&
    candidate.longOptionId.toLowerCase() === current.longOptionId.toLowerCase() &&
    candidate.shortOptionId.toLowerCase() === current.shortOptionId.toLowerCase() &&
    candidate.sizeRaw === current.sizeRaw &&
    candidate.submitted && !candidate.terminal &&
    nowMs - candidate.createdAtMs < CALLPUT_DUPLICATE_WINDOW_MS,
  ) ?? null;
}
