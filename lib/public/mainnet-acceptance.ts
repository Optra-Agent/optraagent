/**
 * Verified Mainnet execution acceptance records. Empty until a real owner-confirmed order has been reconciled.
 *
 * A record is added by an engineer only after reading the venue's own state for the transaction: the keeper request
 * reads Executed (for open and close) and the owner's wallet holds the option tokens (open) or the position is gone
 * (close and settle). A submitted transaction hash alone is never a record. Fork runs are integration evidence and
 * never belong here.
 */
export type MainnetAcceptanceKind = "open" | "close" | "settle";

export type MainnetAcceptanceRecord = {
  kind: MainnetAcceptanceKind;
  /** Robinhood Chain Mainnet transaction that was verified. */
  transactionHash: `0x${string}`;
  /** Keeper request key read back from the venue, when the action is a keeper request. */
  requestKey: `0x${string}` | null;
  /** ISO timestamp of the verification, not of the broadcast. */
  verifiedAt: string;
  /** What was read to verify it, as a repository path or explorer URL. */
  evidence: string;
};

export const MAINNET_EXECUTION_ACCEPTANCE: readonly MainnetAcceptanceRecord[] = [];

export type MainnetAcceptanceSummary = { verified: readonly MainnetAcceptanceKind[]; missing: readonly MainnetAcceptanceKind[] };

export function summarizeMainnetAcceptance(records: readonly MainnetAcceptanceRecord[] = MAINNET_EXECUTION_ACCEPTANCE): MainnetAcceptanceSummary {
  const kinds: readonly MainnetAcceptanceKind[] = ["open", "close", "settle"];
  const done = new Set(records.map((record) => record.kind));
  return { verified: kinds.filter((kind) => done.has(kind)), missing: kinds.filter((kind) => !done.has(kind)) };
}
