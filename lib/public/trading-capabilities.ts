/**
 * The three trading capabilities, reported separately. Manual wallet-signed trading, the autonomous engine and a
 * demonstrated Mainnet execution are different facts; one switch never describes all three. The public verification
 * response, the landing page, Verify and Tape all render these claims, so they cannot disagree.
 */
import type { PublicClaim } from "../domain/contracts";
import { summarizeVenueChecklist } from "../live/venue-checklist";
import { summarizeMainnetAcceptance, type MainnetAcceptanceRecord } from "./mainnet-acceptance";

export const WALLET_SIGNED_TRADING_CLAIM = "wallet_signed_trading";
export const AUTONOMOUS_ENGINE_CLAIM = "autonomous_agent_engine";
export const LIVE_EXECUTION_ACCEPTANCE_CLAIM = "live_execution_acceptance";

export const TRADING_CAPABILITY_CLAIM_IDS: readonly string[] = [WALLET_SIGNED_TRADING_CLAIM, AUTONOMOUS_ENGINE_CLAIM, LIVE_EXECUTION_ACCEPTANCE_CLAIM];

export const TRADING_CAPABILITY_TITLES: Record<string, string> = {
  [WALLET_SIGNED_TRADING_CLAIM]: "Wallet-signed trading",
  [AUTONOMOUS_ENGINE_CLAIM]: "Autonomous Agent Engine",
  [LIVE_EXECUTION_ACCEPTANCE_CLAIM]: "Live execution",
};

export const LIVE_ENGINE_STATUS = "Engine built · Live activation required";

/** Which CallPut actions this build lets the owner sign. They are build-time flags, so the UI and this claim read the same values. */
export type SigningFlags = { open: boolean; close: boolean; settle: boolean };

export function readSigningFlags(): SigningFlags {
  return {
    open: process.env.NEXT_PUBLIC_CALLPUT_LIVE_ORDERS === "true",
    close: process.env.NEXT_PUBLIC_CALLPUT_CLOSE === "true",
    settle: process.env.NEXT_PUBLIC_CALLPUT_SETTLE === "true",
  };
}

export type TradingCapabilityInput = {
  signing: SigningFlags;
  /** True only when the operator switch is on and no kill switch is set. It says nothing about a signer or a grant. */
  autonomousSwitchOn: boolean;
  acceptance?: readonly MainnetAcceptanceRecord[];
};

export function buildTradingCapabilityClaims(input: TradingCapabilityInput): PublicClaim[] {
  const { open, close, settle } = input.signing;
  const enabled = [open && "Open", close && "Close", settle && "Settle"].filter((value): value is string => value !== false);
  const all = enabled.length === 3;

  const wallet: PublicClaim = {
    id: WALLET_SIGNED_TRADING_CLAIM,
    status: enabled.length > 0 ? "limited" : "preview",
    label: all ? "Available" : enabled.length > 0 ? `Partly available: ${enabled.join(", ")}` : "Signing not enabled",
    statement: all
      ? "Open, Close and Settle are prepared by OPTRA and signed in your own wallet. Each transaction needs your explicit confirmation, and a submitted transaction is not a fill until the venue's request reads Executed and your wallet holds the option tokens. The lifecycle passed 23 of 23 checks on a Mainnet fork; no Mainnet fill has been demonstrated yet."
      : enabled.length > 0
        ? `This build lets you sign ${enabled.join(", ")} only; the other actions stay preview-only. Each transaction needs your explicit confirmation in your own wallet. No Mainnet fill has been demonstrated yet.`
        : "This build prepares and reviews orders but cannot sign them. Nothing can be sent from OPTRA.",
    evidencePath: "/tape",
  };

  const checklist = summarizeVenueChecklist();
  const engine: PublicClaim = {
    id: AUTONOMOUS_ENGINE_CLAIM,
    status: "preview",
    label: LIVE_ENGINE_STATUS,
    statement: `Built and fork-tested (25 of 25 checks): strategy evaluation, decision-to-order mapping, risk guards, durable execution ledger, signer submitter, transaction reconciliation, emergency stop and gates G1–G7 enforced by the worker. Live activation is not granted: the operator switch is ${input.autonomousSwitchOn ? "on" : "off"}, no production signer is wired, owner-specific grant status is private and must be verified in the authenticated gate report, and ${checklist.verified} of ${checklist.total} venue checklist items are fully verified. No OPTRA agent places a real-money order.`,
    evidencePath: "/verify",
  };

  const acceptance = summarizeMainnetAcceptance(input.acceptance);
  const done = acceptance.verified.length;
  const live: PublicClaim = {
    id: LIVE_EXECUTION_ACCEPTANCE_CLAIM,
    status: done === 3 ? "verified" : done > 0 ? "limited" : "preview",
    label: done === 3 ? "Verified on Mainnet" : done > 0 ? `Partly verified: ${acceptance.verified.join(", ")}` : "Acceptance required",
    statement: done === 0
      ? "No OPTRA-prepared order has been filled on Mainnet yet. Fork runs are integration evidence, not a live trade. This changes only after an owner-confirmed open, close and settle each read back from the venue."
      : `${done} of 3 actions have been verified on Mainnet from the venue's own state (${acceptance.verified.join(", ")}). Still required: ${acceptance.missing.join(", ") || "none"}.`,
    evidencePath: "/verify",
  };

  return [wallet, engine, live];
}
