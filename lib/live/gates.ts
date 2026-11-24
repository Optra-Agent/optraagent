/**
 * PM brief §16 live-trading gates G1–G7 and §16.2 beta caps, as one pure evaluator.
 *
 * Every gate fails closed: missing, unknown or unparseable input is a failure, never a pass. Nothing here reads a
 * request, a database or the environment; callers pass facts in. The evaluator is the single place the same answer
 * is computed for the "Enable live" screen and for the scheduled worker, so the screen cannot show green while the
 * worker would refuse, or the reverse.
 */
import { autonomyBlockers, LIVE_BETA_MAX_OPEN_POSITIONS, type AutonomyEvidence } from "../venue/callput-live-agent-guard";
import type { OwnerJurisdictionEvidence } from "../venue/callput-live-agent-guard";
import { accountBlockReason, describeAccountGates, type AccountGateFacts } from "../venue/callput-account-gates-text";
import { CALLPUT_VENUE_CHECKLIST, type VenueCheck } from "./venue-checklist";
import { OWNER_JURISDICTION_PROOF_TTL_MS } from "./geo";

export const GATE_IDS = ["G1", "G2", "G3", "G4", "G5", "G6", "G7"] as const;
export type GateId = (typeof GATE_IDS)[number];
/** `evidence` is what was actually read or computed (never a claim): short factual lines the owner can check. */
export type GateResult = { id: GateId; title: string; pass: boolean; detail: string; remediation: string | null; evidence: string[] };
export type GateReport = { allPass: boolean; gates: GateResult[]; evaluatedAt: string };

/** PM §16.2 proposed beta caps. The engine's own hard caps (callput-live-agent-store) are stricter and still apply. */
export const BETA_CAPS = {
  capitalPerLiveAgentUsd: 100,
  newExposurePerUserPerDayUsd: 300,
  liveAgentsPerUser: 1,
  maxPremiumPerPositionUsd: 25,
  openPositionsPerAgent: LIVE_BETA_MAX_OPEN_POSITIONS,
  maxSlippagePercent: 1,
  nakedShorts: "never",
} as const;

export const MIN_PAPER_DAYS = 7;
export const MIN_EXPIRY_CYCLES = 1;
export const RISK_ACK_VERSION = "2026-11-22.1";
export const RISK_ACK_STATEMENTS = [
  { id: "total-loss", text: "A long option can lose 100% of the premium paid." },
  { id: "covered-call-cap", text: "A covered call gives up the upside above its strike." },
  { id: "not-the-stock", text: "A synthetic option is not the stock and carries no shareholder rights." },
] as const;
export const hasExactRiskAcknowledgement = (statementIds: readonly string[]) => {
  const required = RISK_ACK_STATEMENTS.map((statement) => statement.id);
  return statementIds.length === required.length
    && new Set(statementIds).size === required.length
    && required.every((id) => statementIds.includes(id));
};

/**
 * Provisional jurisdiction block list: the United States plus comprehensively embargoed countries. The PM brief
 * assigns the final list to counsel; this is not legal advice. Sub-national embargoed regions cannot be told apart
 * by country code and are not covered. Extend with LIVE_GEO_EXTRA_BLOCKED (comma-separated ISO 3166-1 alpha-2).
 */
export const DEFAULT_BLOCKED_COUNTRIES = ["US", "CU", "IR", "KP", "SY"] as const;

export type PaperCandidate = { label: string; kind: "house" | "user"; launchedAt: Date | null; expiryCycles: number; evaluatedDecisions: number };

export type GateInput = {
  now: Date;
  /** The scheduled worker has no owner's current request headers and must not inherit the cron caller's location. */
  evaluationContext?: "owner-request" | "scheduled-worker";
  /** Venue checklist rows and the owner's recorded sign-off reference. */
  venue?: { rows: readonly VenueCheck[]; ownerSignoffRef: string | null };
  /** The owner's active grant evidence for the CallPut Account route, or null when there is none. */
  custody: { activeGrant: boolean; route: string | null; tradingAddress?: string | null; evidence: AutonomyEvidence | null };
  /** True only when the operator has manually set LIVE_TRADING_ENABLED=true and no kill switch is set. */
  globalSwitchOn: boolean;
  /** Durable owner emergency-stop state; unknown/missing stop rows are stopped. */
  ownerStopActive: boolean;
  wallet: { address: string | null; allowlist: readonly string[] };
  /** ISO 3166-1 alpha-2 from a trusted source on this request, or null when it could not be determined. */
  country: string | null;
  blockedCountries?: readonly string[];
  /** Operator-recorded reference to counsel's current jurisdiction policy; absence keeps G5 closed. */
  jurisdictionPolicyApprovalRef?: string | null;
  /** Server-resolved proof captured from this authenticated owner's request and stored on their grant. */
  ownerJurisdictionEvidence?: OwnerJurisdictionEvidence | null;
  paper: { launchedAt: Date | null; expiryCycles: number; evaluatedDecisions: number; agentLabel: string | null; candidates?: PaperCandidate[] };
  /** How the country was obtained on this request; saved acknowledgement data is not trusted jurisdiction evidence. */
  geoSource?: "edge-header" | "ip-lookup" | null;
  /** Live read of the CallPut account factory for this wallet. Absent when it was not read. */
  accountGates?: AccountGateFacts | null;
  acknowledgement: { version: string; acceptedAt: Date; statementIds: readonly string[] } | null;
};

const result = (id: GateId, title: string, pass: boolean, detail: string, remediation: string | null, evidence: string[] = []): GateResult => ({ id, title, pass, detail, remediation: pass ? null : remediation, evidence });

function evaluateG1(input: GateInput): GateResult {
  const rows = input.venue?.rows ?? CALLPUT_VENUE_CHECKLIST;
  const open = rows.filter((row) => row.status !== "verified");
  const signoff = input.venue?.ownerSignoffRef?.trim() || null;
  const evidence = rows.map((row) => `${row.id} ${row.status}: ${row.evidence}`);
  if (open.length === 0 && signoff) return result("G1", "Venue verified", true, `V1–V${rows.length} verified and signed off (${signoff}).`, null, evidence);
  const list = open.map((row) => `${row.id} ${row.status}`).join(", ");
  const detail = open.length > 0 ? `${rows.length - open.length} of ${rows.length} verified; not verified: ${list}.` : "All items verified, but the owner has not signed the result.";
  return result("G1", "Venue verified", false, detail, "Close each open V item with Mainnet or venue evidence, then record the owner sign-off reference in LIVE_VENUE_SIGNOFF_REF. V11 and V12 need the owner's wallet and a venue-enabled account.", evidence);
}

function evaluateG2(input: GateInput): GateResult {
  const { activeGrant, route, evidence } = input.custody;
  const gates = input.accountGates;
  const facts = gates ? [`Configured CallPut factory getter results (live resolver match and contract source are unverified): ${describeAccountGates(gates)}.`] : [];
  const reason = gates ? accountBlockReason(gates) : null;
  const venueBlock = reason ? ` Observed configured-factory canOpen=${gates?.accountCanOpen ? "true" : "false"}: ${reason}` : "";
  if (!activeGrant || !evidence) return result("G2", "Custody ready", false, `No active scoped grant. OPTRA holds no signer and no session key.${venueBlock}`, "Create and fund your CallPut Account through the current owner workflow; obtain written CallPut confirmation of the exact delegated signer model and limits; read the resolver-selected gates for that exact Account; and record the owner-signed grant, independent audit, owner approval and revocation evidence. A historical global factory flag is not owner-specific authorization. The Account implementation has no verified source and no independent audit yet.", facts);
  if (route !== "callput-account") return result("G2", "Custody ready", false, `Grant route is ${route ?? "unknown"}; scoped delegated custody needs the callput-account route.`, "Use a CallPut Account session grant. A direct-wallet route can only be used with per-transaction owner signing.", facts);
  const missing = autonomyBlockers(evidence);
  if (missing.length > 0) return result("G2", "Custody ready", false, `Missing evidence: ${missing.map((blocker) => blocker.id).join(", ")}.${venueBlock}`, missing.map((blocker) => blocker.detail).join(" "), facts);
  if (!gates) return result("G2", "Custody ready", false, "The current CallPut account-factory state was not read; custody cannot be verified.", "Retry after a read-only factory check for this owner's Account succeeds. An unavailable or missing chain read stays blocked.", facts);
  const tradingAddress = input.custody.tradingAddress?.trim() || null;
  if (!tradingAddress || !sameAddress(gates.account, tradingAddress)) return result("G2", "Custody ready", false, `The factory read is for ${gates.account}, but the active grant targets ${tradingAddress ?? "no Account address"}.`, "Read the factory state for the exact Account named by the active grant. Never use another Account's eligibility as custody evidence.", facts);
  if (reason) return result("G2", "Custody ready", false, `Evidence is recorded.${venueBlock}`, "Resolve the factory refusal above, then re-check.", facts);
  return result("G2", "Custody ready", true, "Active callput-account grant with venue, on-chain, audit, owner and revocation evidence recorded.", null, facts);
}

function evaluateG3(input: GateInput): GateResult {
  const pass = input.globalSwitchOn && !input.ownerStopActive;
  const detail = pass
    ? "The operator switch is on and the owner's durable emergency stop is clear. The process kill switch remains an override."
    : `Live trading is not open yet.${input.ownerStopActive ? " The owner's durable emergency stop is active." : ""} Your agent keeps running on paper.`;
  const remediation = input.ownerStopActive
    ? "Leave the owner's stop in place until every outstanding request is reconciled and all gates are re-evaluated. Recovery is not exposed through the public API."
    : "The operator turns it on manually (LIVE_TRADING_ENABLED=true) after G1, G2 and G6 are satisfied. It stays off by default.";
  return result("G3", "Global kill switch", pass, detail, remediation, [
    `Operator switch is ${input.globalSwitchOn ? "on" : "off"}.`,
    `Owner emergency stop is ${input.ownerStopActive ? "active" : "clear"}.`,
  ]);
}

const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function evaluateG4(input: GateInput, g2: GateResult): GateResult {
  const address = input.wallet.address;
  if (!address) return result("G4", "Wallet allowlist", false, "No wallet is connected.", "Connect a wallet.");
  if (!g2.pass) return result("G4", "Wallet allowlist", false, "Allowlisting follows a verified custody setup (G2), which is not met.", "Satisfy G2 first; the owner then adds the wallet to LIVE_WALLET_ALLOWLIST.");
  const listed = input.wallet.allowlist.some((entry) => sameAddress(entry, address));
  return result("G4", "Wallet allowlist", listed, listed ? "Wallet is allowlisted." : "Wallet is not on the allowlist.", "The owner adds this wallet to LIVE_WALLET_ALLOWLIST.", [`Allowlist holds ${input.wallet.allowlist.length} wallet(s); G2 is met.`]);
}

function evaluateG5(input: GateInput): GateResult {
  const blocked = new Set((input.blockedCountries ?? DEFAULT_BLOCKED_COUNTRIES).map((code) => code.toUpperCase()));
  const country = input.country?.trim().toUpperCase() || null;
  const source = input.geoSource ?? null;
  const policyRef = input.jurisdictionPolicyApprovalRef?.trim() || null;
  const evidence = [
    `Configured block list: ${[...blocked].sort().join(", ")}.`,
    source ? `Country source: ${source}.` : input.evaluationContext === "scheduled-worker" ? "Cron caller location is ignored; scheduled execution requires fresh owner-bound evidence." : "No trusted country source is configured or it returned nothing.",
    policyRef ? `Counsel policy reference recorded: ${policyRef}.` : "No counsel policy reference is configured (LIVE_GEO_POLICY_APPROVAL_REF).",
  ];
  if (input.evaluationContext === "scheduled-worker") {
    const proof = input.ownerJurisdictionEvidence ?? null;
    const observedAtMs = proof ? Date.parse(proof.observedAt) : Number.NaN;
    const expiresAtMs = proof ? Date.parse(proof.expiresAt) : Number.NaN;
    const proofCountry = proof?.country?.trim().toUpperCase() || null;
    const proofValid = proof !== null
      && (proof.source === "edge-header" || proof.source === "ip-lookup")
      && proofCountry !== null
      && /^[A-Z]{2}$/.test(proofCountry)
      && proofCountry !== "XX"
      && proofCountry !== "T1"
      && Number.isFinite(observedAtMs)
      && Number.isFinite(expiresAtMs)
      && observedAtMs <= input.now.getTime()
      && expiresAtMs > input.now.getTime()
      && expiresAtMs > observedAtMs
      && expiresAtMs - observedAtMs <= OWNER_JURISDICTION_PROOF_TTL_MS
      && input.now.getTime() - observedAtMs <= OWNER_JURISDICTION_PROOF_TTL_MS
      && Boolean(policyRef)
      && proof.policyRef === policyRef;
    const workerEvidence = country
      ? [...evidence, `Scheduled caller country ${country} (${source ?? "unknown source"}) is not owner-bound and was not used as owner evidence.`]
      : evidence;
    if (!proofValid || !proofCountry || blocked.has(proofCountry)) {
      const detail = proof && proofCountry && blocked.has(proofCountry)
        ? `Owner-bound evidence detects ${proofCountry}, where live trading is not available.`
        : proof && proof.policyRef !== policyRef
          ? "The owner-bound jurisdiction proof was captured under a different counsel policy and is not valid."
          : proof && Number.isFinite(expiresAtMs) && expiresAtMs <= input.now.getTime()
            ? "The owner-bound jurisdiction proof has expired; live trading stays closed."
            : "The scheduled worker has no fresh trusted owner-location evidence bound to this owner, so live trading stays closed.";
      const proofFacts = proof
        ? [...workerEvidence, `Stored owner proof: ${proofCountry ?? "invalid country"}, ${proof.source}, observed ${proof.observedAt}, expires ${proof.expiresAt}, policy ${proof.policyRef}.`]
        : workerEvidence;
      return result("G5", "Jurisdiction", false, detail, "Use the authenticated Live Agent control to refresh owner-bound location proof from the configured trusted source. Counsel must approve the jurisdiction policy; the operator must record its current reference. Never use the cron caller's location or saved acknowledgement country.", proofFacts);
    }
    return result("G5", "Jurisdiction", true, `Fresh owner-bound evidence detects ${proofCountry}; it is not on the configured block list and matches the current counsel policy reference.`, null, [...workerEvidence, `Fresh owner-bound proof: ${proofCountry} from ${proof.source}, observed ${proof.observedAt}, expires ${proof.expiresAt}; policy ${proof.policyRef}.`]);
  }
  const trustedSource = source === "edge-header" || source === "ip-lookup";
  if (!country || !/^[A-Z]{2}$/.test(country) || country === "XX" || country === "T1" || !trustedSource) return result("G5", "Jurisdiction", false, "Your country could not be determined from a trusted source for this evaluation, so live trading stays closed.", "The operator configures a trusted server-side country source (an edge header that is overwritten at the edge, or a server-side IP lookup). Retry without a VPN or proxy.", evidence);
  if (blocked.has(country)) return result("G5", "Jurisdiction", false, `Live trading is not available in ${country}.`, "Not available from this location. Paper trading is unaffected.", [...evidence, `Detected ${country}.`]);
  if (!policyRef) return result("G5", "Jurisdiction", false, `Detected ${country}, but no counsel-approved jurisdiction policy reference is recorded; live trading stays closed.`, "Counsel must approve the final restricted-country/region policy; the operator then records its reference in LIVE_GEO_POLICY_APPROVAL_REF and configures the matching block list. A reference is only a pointer and must be reviewed, not treated as proof by itself.", [...evidence, `Detected ${country}.`]);
  return result("G5", "Jurisdiction", true, `Detected ${country}; not on the configured block list and a counsel policy reference is recorded.`, null, [...evidence, `Detected ${country}.`]);
}

const day = (date: Date) => date.toISOString().slice(0, 10);

function evaluateG6(input: GateInput): GateResult {
  const { launchedAt, expiryCycles, evaluatedDecisions, agentLabel } = input.paper;
  const days = launchedAt ? Math.floor((input.now.getTime() - launchedAt.getTime()) / 86_400_000) : 0;
  const pass = launchedAt !== null && days >= MIN_PAPER_DAYS && expiryCycles >= MIN_EXPIRY_CYCLES && evaluatedDecisions > 0;
  const who = agentLabel ? `${agentLabel}: ` : "";
  const detail = launchedAt === null
    ? "No launched Paper Agent."
    : `${who}${days} of ${MIN_PAPER_DAYS} paper days, ${expiryCycles} of ${MIN_EXPIRY_CYCLES} settled expiry cycle, and ${evaluatedDecisions} genuine evaluated decision${evaluatedDecisions === 1 ? "" : "s"}.`;
  const evidence = (input.paper.candidates ?? []).map((candidate) => {
    if (!candidate.launchedAt) return `${candidate.label} (${candidate.kind === "house" ? "House" : "yours"}): not launched; ${candidate.evaluatedDecisions} genuine evaluated decisions.`;
    const elapsed = Math.floor((input.now.getTime() - candidate.launchedAt.getTime()) / 86_400_000);
    const eligible = new Date(candidate.launchedAt.getTime() + MIN_PAPER_DAYS * 86_400_000);
    return `${candidate.label} (${candidate.kind === "house" ? "House" : "yours"}): launched ${day(candidate.launchedAt)}, ${elapsed} of ${MIN_PAPER_DAYS} days, ${candidate.expiryCycles} settled expiries, ${candidate.evaluatedDecisions} genuine evaluated decisions, earliest eligible ${day(eligible)}.`;
  });
  return result("G6", "Paper history", pass, detail, `Keep the agent on paper for at least ${MIN_PAPER_DAYS} days, through one expiry settlement, and accumulate genuine non-error evaluations. This cannot be sped up.`, evidence);
}

function evaluateG7(input: GateInput): GateResult {
  const ack = input.acknowledgement;
  const ok = ack !== null && ack.version === RISK_ACK_VERSION && hasExactRiskAcknowledgement(ack.statementIds);
  return result("G7", "Risk acknowledgement", ok, ok ? `Acknowledged on ${ack.acceptedAt.toISOString().slice(0, 10)}.` : ack ? "The acknowledgement is for an older version or is incomplete." : "The three risk statements have not been acknowledged.", "Tick all three risk statements on the Enable live screen.", ack ? [`Acknowledgement version ${ack.version}, recorded ${ack.acceptedAt.toISOString()}.`] : []);
}

export function evaluateLiveGates(input: GateInput): GateReport {
  const g1 = evaluateG1(input);
  const g2 = evaluateG2(input);
  const gates = [g1, g2, evaluateG3(input), evaluateG4(input, g2), evaluateG5(input), evaluateG6(input), evaluateG7(input)];
  return { allPass: gates.every((gate) => gate.pass), gates, evaluatedAt: input.now.toISOString() };
}

export const parseList = (value: string | undefined): string[] => (value ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);

/** Operator inputs read from the environment in one place so tests and the worker agree. */
export function readGateEnv(env: Record<string, string | undefined>) {
  const extra = parseList(env.LIVE_GEO_EXTRA_BLOCKED).map((code) => code.toUpperCase());
  return {
    globalSwitchOn: env.LIVE_TRADING_ENABLED === "true" && env.LIVE_AGENT_KILL_SWITCH !== "true",
    allowlist: parseList(env.LIVE_WALLET_ALLOWLIST),
    blockedCountries: [...new Set([...DEFAULT_BLOCKED_COUNTRIES, ...extra])],
    ownerSignoffRef: env.LIVE_VENUE_SIGNOFF_REF?.trim() || null,
    jurisdictionPolicyApprovalRef: env.LIVE_GEO_POLICY_APPROVAL_REF?.trim() || null,
  };
}
