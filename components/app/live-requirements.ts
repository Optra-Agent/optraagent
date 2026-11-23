/**
 * The autonomous Live Agent, split by what is true today. Nothing here can submit a real-money transaction.
 * LIVE_ENGINE_BUILT is implemented and exercised on a Mainnet fork (docs/evidence/callput/live-agent-fork-acceptance-20261122.log, 25 of 25).
 * LIVE_REQUIREMENTS is what must still be true in production before the engine may place an order.
 */
export const LIVE_ENGINE_BUILT: readonly string[] = [
  "Strategy evaluation and decision-to-order mapping",
  "Risk guards with hard spending limits",
  "Signer submitter and durable execution ledger",
  "Idempotent reconciliation against on-chain request state",
  "Emergency stop and grant revocation",
  "Gates G1 to G7 enforced by the worker",
];

export { LIVE_ENGINE_STATUS } from "../../lib/public/trading-capabilities";

export const LIVE_REQUIREMENTS: readonly { title: string; note: string }[] = [
  { title: "Owner account grant and confirmed signer model", note: "The owner must create a CallPut Account and session grant, and CallPut must confirm that an operator-held device signer is supported. Its public terms are silent on this." },
  { title: "Venue-enforced, revocable session limits", note: "Order scope, spend caps, expiry and revocation must be enforced by the venue account, not only by OPTRA." },
  { title: "All seven live gates passing", note: "Venue verified, custody, global switch, wallet allowlist, jurisdiction, paper history and risk acknowledgement are each evaluated by the same evaluator the worker uses." },
  { title: "Independent audit and legal approval", note: "The exact execution scope needs independent review and jurisdiction approval." },
  { title: "An authorized order-to-settlement trial", note: "Open, close and expiry settlement must be exercised and reconciled for the selected account type." },
];
