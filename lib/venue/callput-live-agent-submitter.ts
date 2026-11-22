/**
 * Broadcasts one prepared CallPut open-spread plan through a signer that is INJECTED by the caller.
 *
 * This module holds no key and creates none. It is the execution logic that sits between the worker's authorization
 * (reservation, limits, lease) and a signer, and it is exercised end to end on a mainnet fork. Production wires no
 * signer, so nothing here runs against Robinhood Mainnet: see docs/CallPut-Live-Agent-Architecture.md for what an
 * autonomous signer would still need (owner-created CallPut Account grant, key custody decision, contract audit).
 *
 * Error contract with `runLiveAgentTick`: a `NotBroadcastError` means the ORDER provably was not created, so the
 * reservation is cancelled and the agent keeps running. Any other thrown error means the outcome is unknown, and the
 * worker stops the agent until the request is reconciled on-chain. A transaction hash alone is never a fill.
 */
import { BaseError, InsufficientFundsError, UserRejectedRequestError, ExecutionRevertedError, type Address, type Hex, type PublicClient } from "viem";
import { NotBroadcastError, type LiveAgentSubmission, type LiveAgentSubmitter } from "./callput-live-agent-worker";
import { CALLPUT_ROBINHOOD_CHAIN_ID } from "./callput-robinhood-readonly";
import { extractCallPutRequestKey, type CallPutOpenSpreadPlan } from "./callput-robinhood-write";

export type LiveAgentTransactionSigner = {
  /** The account the transactions are sent from. Must equal the plan's trading account. */
  address: Address;
  /** Signs and broadcasts one transaction and returns its hash. */
  sendTransaction: (tx: { to: Address; data: Hex; value: bigint }) => Promise<Hex>;
};

export type SignerSubmitterOptions = {
  publicClient: Pick<PublicClient, "call" | "waitForTransactionReceipt">;
  signer: LiveAgentTransactionSigner;
  /** How long to wait for each receipt before giving up on seeing it. Default 120 s. */
  receiptTimeoutMs?: number;
};

const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** True only for errors that prove the wallet or node refused the transaction before it could be broadcast. */
function provablyNotBroadcast(error: unknown): boolean {
  if (!(error instanceof BaseError)) return false;
  return Boolean(error.walk((e) => e instanceof UserRejectedRequestError || e instanceof InsufficientFundsError || e instanceof ExecutionRevertedError));
}

export function createSignerSubmitter(options: SignerSubmitterOptions): LiveAgentSubmitter {
  const { publicClient, signer } = options;
  const timeout = options.receiptTimeoutMs ?? 120_000;

  return {
    async submit(plan: CallPutOpenSpreadPlan): Promise<LiveAgentSubmission> {
      // Everything checkable before the first broadcast is checked first, so a bad plan sends nothing.
      if (!sameAddress(signer.address, plan.intent.account)) throw new NotBroadcastError("The signer is not the plan's trading account.");
      if (!plan.transactions.length || plan.transactions.at(-1)?.kind !== "open-spread") throw new NotBroadcastError("The plan has no open-spread transaction.");
      if (plan.transactions.some((tx) => tx.chainId !== CALLPUT_ROBINHOOD_CHAIN_ID || !sameAddress(tx.from, signer.address))) {
        throw new NotBroadcastError(`Every transaction must come from the signer on chain ${CALLPUT_ROBINHOOD_CHAIN_ID}.`);
      }

      for (const tx of plan.transactions) {
        const isOpen = tx.kind === "open-spread";

        // Simulate immediately before sending (an open cannot be simulated before its approval is mined).
        try {
          await publicClient.call({ account: signer.address, to: tx.to, data: tx.data, value: tx.value });
        } catch {
          throw new NotBroadcastError(`${tx.kind} failed simulation; nothing was ${isOpen ? "opened" : "sent"}.`);
        }

        let hash: Hex;
        try {
          hash = await signer.sendTransaction({ to: tx.to, data: tx.data, value: tx.value });
        } catch (error) {
          // A failed approval can never create an order, so the order was not broadcast either way.
          if (!isOpen || provablyNotBroadcast(error)) throw new NotBroadcastError(`${tx.kind} was not broadcast.`);
          throw error;
        }

        let receipt: Awaited<ReturnType<typeof publicClient.waitForTransactionReceipt>>;
        try {
          receipt = await publicClient.waitForTransactionReceipt({ hash, timeout });
        } catch {
          if (!isOpen) throw new NotBroadcastError("The approval receipt was not seen; no order was sent.");
          // The open was broadcast and its hash is known; its request key is read from the receipt later.
          return { transactionHash: hash };
        }
        if (receipt.status !== "success") throw new NotBroadcastError(`${tx.kind} reverted on-chain; no request was created.`);
        if (!isOpen) continue;

        try {
          return { transactionHash: hash, requestKey: extractCallPutRequestKey(receipt, { account: plan.intent.account, isOpen: true }) };
        } catch {
          return { transactionHash: hash };
        }
      }
      throw new NotBroadcastError("The plan has no open-spread transaction.");
    },
  };
}
