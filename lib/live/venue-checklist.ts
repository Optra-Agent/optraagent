/**
 * PM brief §5.2 venue checklist V1–V12 for CallPut on Robinhood Mainnet (chain 4663).
 *
 * Each row is a recorded, dated finding with an evidence path, not a live probe. A row is `verified` only when the
 * evidence proves the whole item. Fork-only evidence is `partial`: the venue's contracts ran, the live keeper did not.
 * G1 passes only when every row is `verified` AND the owner has signed the result off (`LIVE_VENUE_SIGNOFF_REF`).
 */
export type VenueCheckStatus = "verified" | "partial" | "open" | "blocked";
export type VenueCheck = { id: string; item: string; status: VenueCheckStatus; finding: string; evidence: string };

export const VENUE_CHECKLIST_CHECKED_AT = "2026-11-22";

export const CALLPUT_VENUE_CHECKLIST: readonly VenueCheck[] = [
  { id: "V1", item: "Mainnet addresses, ABI and verified source", status: "partial", evidence: "docs/evidence/callput/trading-account-onchain-probe-20261122.json",
    finding: "Order, position and settle contracts are called on Mainnet and by ABI. The TradingAccount implementation has no verified source on Blockscout, so its session enforcement is inferred from its ABI and one real transaction." },
  { id: "V2", item: "Underlyings and their Robinhood stock-token mapping", status: "verified", evidence: "lib/venue/callput-robinhood-readonly.ts",
    finding: "Underlyings and asset indices are read from the venue and mapped to the configured set." },
  { id: "V3", item: "Supported sides (buy-to-open only, or also write)", status: "partial", evidence: "lib/venue/callput-robinhood-write.ts",
    finding: "Four defined-risk spreads are integrated (BuyCallSpread, BuyPutSpread, SellCallSpread, SellPutSpread). No naked short and no single-leg write is integrated, so the Covered Call and Cash-Secured Put House Agents have no live route yet." },
  { id: "V4", item: "Strike and expiry grid, minimum size", status: "verified", evidence: "docs/evidence/callput/candidate-order-preflight-20261122.json",
    finding: "Weekly expiry 27NOV26 (17:00 UTC) with a listed strike grid; the Controller accepted a 0.1 size candidate." },
  { id: "V5", item: "Quote and fill model (asynchronous request, time to fill)", status: "partial", evidence: "docs/evidence/callput/fork-lifecycle-20261122.log",
    finding: "Open is an asynchronous keeper request. The keeper fill, stale-cancel and partial-fill paths pass on a Mainnet fork with replayed keeper calls. The live keeper has not filled an OPTRA order." },
  { id: "V6", item: "Close before expiry, and its cost", status: "partial", evidence: "docs/evidence/callput/fork-lifecycle-20261122.log",
    finding: "Partial close with payout passes on a fork against the real contracts. No live close has run." },
  { id: "V7", item: "Settlement source, timing and currency", status: "partial", evidence: "docs/evidence/callput/fork-lifecycle-20261122.log",
    finding: "Settlement pays USDG net of a position fee (1.36% on the fork run) using a spot feed that must be under 5 minutes old. No live settlement has run." },
  { id: "V8", item: "Fees (open, close, settle)", status: "verified", evidence: "docs/evidence/callput/fork-lifecycle-20261122.log",
    finding: "Execution fee 0.00006 ETH per request, a combo fee on open, and a position fee on settle, each measured on the real contracts." },
  { id: "V9", item: "Programmatic access: terms, rate limits, API or contract", status: "open", evidence: "docs/CallPut-Robinhood-Live-Options-Integration.md",
    finding: "CallPut's public terms are silent on automated trading and prohibit scraping and interference. Its AI-agent docs describe unsigned payloads approved by an owner wallet. No agreement covers an OPTRA-operated signer." },
  { id: "V10", item: "Historical premium and IV data", status: "open", evidence: "(none recorded)",
    finding: "No historical premium or IV source for CallPut has been recorded. Paper uses a modeled Black-Scholes premium." },
  { id: "V11", item: "Positions owned by the user's wallet; callable from a smart account or session key", status: "blocked", evidence: "docs/evidence/callput/trading-account-onchain-probe-20261122.json",
    finding: "Options are ERC-1155 tokens held by the wallet that opened them. Delegated sessions run through a TradingAccount. Its factory (verified source) has safeMode=true, which blocks funding, registration and opens, and openToAll=false, so an Account also needs CallPut's admin to allowlist it. Creating an Account is permissionless. Both switches belong to the factory admin (0x23DB9f5fDde30853EC8eBd75E0492c09505a6D1d). The account implementation itself has no verified source." },
  { id: "V12", item: "Small Mainnet end-to-end: open, close, settle", status: "open", evidence: "(none: needs the owner's wallet)",
    finding: "No OPTRA-prepared order has been signed on Mainnet. The fork lifecycle (23 of 23) is not a substitute." },
];

export function summarizeVenueChecklist(rows: readonly VenueCheck[] = CALLPUT_VENUE_CHECKLIST) {
  const count = (status: VenueCheckStatus) => rows.filter((row) => row.status === status).length;
  return { total: rows.length, verified: count("verified"), partial: count("partial"), open: count("open"), blocked: count("blocked") };
}
