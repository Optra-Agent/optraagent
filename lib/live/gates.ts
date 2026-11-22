/**
 * PM brief §16 live-trading gates G1–G7 and §16.2 beta caps, as one pure evaluator.
 *
 * Every gate fails closed: missing, unknown or unparseable input is a failure, never a pass. Nothing here reads a
 * request, a database or the environment; callers pass facts in. The evaluator is the single place the same answer
 * is computed for the "Enable live" screen and for the scheduled worker, so the screen cannot show green while the
 * worker would refuse, or the reverse.
 */
import { autonomyBlockers, LIVE_BETA_MAX_OPEN_POSITIONS, type AutonomyEvidence } from "../venue/callput-live-agent-guard";
import { CALLPUT_VENUE_CHECKLIST, type VenueCheck } from "./venue-checklist";

export const GATE_IDS = ["G1", "G2", "G3", "G4", "G5", "G6", "G7"] as const;
export type GateId = (typeof GATE_IDS)[number];
export type GateResult = { id: GateId; title: string; pass: boolean; detail: string; remediation: string | null };
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

/**
 * Provisional jurisdiction block list: the United States plus comprehensively embargoed countries. The PM brief
 * assigns the final list to counsel; this is not legal advice. Sub-national embargoed regions cannot be told apart
 * by country code and are not covered. Extend with LIVE_GEO_EXTRA_BLOCKED (comma-separated ISO 3166-1 alpha-2).
 */
export const DEFAULT_BLOCKED_COUNTRIES = ["US", "CU", "IR", "KP", "SY"] as const;

export type GateInput = {
  now: Date;
  /** Venue checklist rows and the owner's recorded sign-off reference. */
  venue?: { rows: readonly VenueCheck[]; ownerSignoffRef: string | null };
  /** The owner's active grant evidence for the CallPut Account route, or null when there is none. */
  custody: { activeGrant: boolean; route: string | null; evidence: AutonomyEvidence | null };
  /** True only when the operator has manually set LIVE_TRADING_ENABLED=true and no kill switch is set. */
  globalSwitchOn: boolean;
  wallet: { address: string | null; allowlist: readonly string[] };
  /** ISO 3166-1 alpha-2 from the edge, or null when it could not be determined. */
  country: string | null;
  blockedCountries?: readonly string[];
  paper: { launchedAt: Date | null; expiryCycles: number; agentLabel: string | null };
  acknowledgement: { version: string; acceptedAt: Date; statementIds: readonly string[] } | null;
};

const result = (id: GateId, title: string, pass: boolean, detail: string, remediation: string | null): GateResult => ({ id, title, pass, detail, remediation: pass ? null : remediation });

function evaluateG1(input: GateInput): GateResult {
  const rows = input.venue?.rows ?? CALLPUT_VENUE_CHECKLIST;
  const open = rows.filter((row) => row.status !== "verified");
  const signoff = input.venue?.ownerSignoffRef?.trim() || null;
  if (open.length === 0 && signoff) return result("G1", "Venue verified", true, `V1–V${rows.length} verified and signed off (${signoff}).`, null);
  const list = open.map((row) => `${row.id} ${row.status}`).join(", ");
  const detail = open.length > 0 ? `${rows.length - open.length} of ${rows.length} verified; not verified: ${list}.` : "All items verified, but the owner has not signed the result.";
  return result("G1", "Venue verified", false, detail, "Close each open V item with Mainnet or venue evidence, then record the owner sign-off reference in LIVE_VENUE_SIGNOFF_REF. V11 and V12 need the owner's wallet and a venue-enabled account.");
}

function evaluateG2(input: GateInput): GateResult {
  const { activeGrant, route, evidence } = input.custody;
  if (!activeGrant || !evidence) return result("G2", "Custody ready", false, "No active scoped grant. OPTRA holds no signer and no session key.", "Create and fund a CallPut Account, sign a scoped session grant on-chain, and record the venue, on-chain, audit, owner and revocation evidence. The venue must first allow the account (see V11).");
  if (route !== "callput-account") return result("G2", "Custody ready", false, `Grant route is ${route ?? "unknown"}; scoped delegated custody needs the callput-account route.`, "Use a CallPut Account session grant. A direct-wallet route can only be used with per-transaction owner signing.");
  const missing = autonomyBlockers(evidence);
  if (missing.length > 0) return result("G2", "Custody ready", false, `Missing evidence: ${missing.map((blocker) => blocker.id).join(", ")}.`, missing.map((blocker) => blocker.detail).join(" "));
  return result("G2", "Custody ready", true, "Active callput-account grant with venue, on-chain, audit, owner and revocation evidence recorded.", null);
}

function evaluateG3(input: GateInput): GateResult {
  return result("G3", "Global kill switch", input.globalSwitchOn, input.globalSwitchOn ? "The operator has switched live trading on. The owner stop and the process kill switch still override it." : "Live trading is not open yet. Your agent keeps running on paper.", "The operator turns it on manually (LIVE_TRADING_ENABLED=true) after G1, G2 and G6 are satisfied. It stays off by default.");
}

const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function evaluateG4(input: GateInput, g2: GateResult): GateResult {
  const address = input.wallet.address;
  if (!address) return result("G4", "Wallet allowlist", false, "No wallet is connected.", "Connect a wallet.");
  if (!g2.pass) return result("G4", "Wallet allowlist", false, "Allowlisting follows a verified custody setup (G2), which is not met.", "Satisfy G2 first; the owner then adds the wallet to LIVE_WALLET_ALLOWLIST.");
  const listed = input.wallet.allowlist.some((entry) => sameAddress(entry, address));
  return result("G4", "Wallet allowlist", listed, listed ? "Wallet is allowlisted." : "Wallet is not on the allowlist.", "The owner adds this wallet to LIVE_WALLET_ALLOWLIST.");
}

function evaluateG5(input: GateInput): GateResult {
  const blocked = new Set((input.blockedCountries ?? DEFAULT_BLOCKED_COUNTRIES).map((code) => code.toUpperCase()));
  const country = input.country?.trim().toUpperCase() || null;
  if (!country || !/^[A-Z]{2}$/.test(country) || country === "XX" || country === "T1") return result("G5", "Jurisdiction", false, "Your country could not be determined, so live trading stays closed.", "Retry without a VPN or proxy. Live trading is only offered where the location is known.");
  if (blocked.has(country)) return result("G5", "Jurisdiction", false, `Live trading is not available in ${country}.`, "Not available from this location. Paper trading is unaffected.");
  return result("G5", "Jurisdiction", true, `Detected ${country}; not on the provisional block list. Counsel has not approved the final list.`, null);
}

function evaluateG6(input: GateInput): GateResult {
  const { launchedAt, expiryCycles, agentLabel } = input.paper;
  const days = launchedAt ? Math.floor((input.now.getTime() - launchedAt.getTime()) / 86_400_000) : 0;
  const pass = launchedAt !== null && days >= MIN_PAPER_DAYS && expiryCycles >= MIN_EXPIRY_CYCLES;
  const who = agentLabel ? `${agentLabel}: ` : "";
  const detail = launchedAt === null ? "No launched paper agent." : `${who}${days} of ${MIN_PAPER_DAYS} paper days, ${expiryCycles} of ${MIN_EXPIRY_CYCLES} settled expiry cycle.`;
  return result("G6", "Paper history", pass, detail, `Keep the agent on paper for at least ${MIN_PAPER_DAYS} days and through one expiry settlement. This cannot be sped up.`);
}

function evaluateG7(input: GateInput): GateResult {
  const ack = input.acknowledgement;
  const needed = RISK_ACK_STATEMENTS.map((statement) => statement.id);
  const ok = ack !== null && ack.version === RISK_ACK_VERSION && needed.every((id) => ack.statementIds.includes(id));
  return result("G7", "Risk acknowledgement", ok, ok ? `Acknowledged on ${ack.acceptedAt.toISOString().slice(0, 10)}.` : ack ? "The acknowledgement is for an older version or is incomplete." : "The three risk statements have not been acknowledged.", "Tick all three risk statements on the Enable live screen.");
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
  };
}

/**
 * Country from ONE operator-named header (LIVE_GEO_HEADER, e.g. `cf-ipcountry`). A client can send any header, so
 * a country header is only trustworthy when the operator's edge overwrites it. With no header configured this
 * returns null and G5 stays closed; it never guesses from a header it was not told to trust.
 */
export function countryFromHeaders(headers: Headers, env: Record<string, string | undefined>): string | null {
  const name = env.LIVE_GEO_HEADER?.trim();
  if (!name) return null;
  const code = headers.get(name)?.trim().toUpperCase() ?? "";
  return /^[A-Z]{2}$/.test(code) ? code : null;
}
