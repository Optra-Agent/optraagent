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
    finding: "The five order, position, settle, authority and controller proxies are fully source-verified on Blockscout. The current account factory proxy (0x23DB9f5fDde30853EC8eBd75E0492c09505a6D1d) and the TradingAccount implementation have no verified source, so session enforcement is inferred from their ABI and one real transaction." },
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
    finding: "CallPut Docs v3 Terms and AI-agent pages reviewed 2026-11-24 describe general user responsibility and unsigned payloads with external wallet approval, but do not answer whether OPTRA automation or an operator-held session signer is permitted. Written CallPut permission, applicable terms/jurisdiction, polling limits and support are absent." },
  { id: "V10", item: "Historical premium and IV data", status: "open", evidence: "(none recorded)",
    finding: "CallPut's MCP tool list (read 2026-11-22) exposes live option chains, spread scans, positions and settled P&L, and no historical premium or IV series. Paper uses a modeled Black-Scholes premium, and backtests label it as modeled." },
  { id: "V11", item: "Positions owned by the user's wallet; callable from a smart account or session key", status: "partial", evidence: "docs/evidence/callput/trading-account-onchain-probe-20261122.json",
    finding: "The resolver-based probe at block 120670889 (2026-11-22) reported global factory flags openToAll=true and safeMode=false. It probed the deployer wallet 0xAa8fDF2f96aFC037D50659CFd09fDF3Fac060bBf, not the owner's MetaMask wallet; that predicted Account was not created or registered and canOpen was false. A different sample Account was open-capable and one session-signed close transaction exists. These are historical capability/global-state observations, not this owner's eligibility or OPTRA authorization. The factory proxy and Account implementation lack verified source and an independent audit; no owner Account open, delegated open, or revocation has been accepted." },
  { id: "V12", item: "Small Mainnet end-to-end: open, close, settle", status: "open", evidence: "(none: needs the owner's wallet)",
    finding: "No OPTRA-prepared order has been signed on Mainnet. The fork lifecycle (23 of 23) is not a substitute." },
];

export function summarizeVenueChecklist(rows: readonly VenueCheck[] = CALLPUT_VENUE_CHECKLIST) {
  const count = (status: VenueCheckStatus) => rows.filter((row) => row.status === status).length;
  return { total: rows.length, verified: count("verified"), partial: count("partial"), open: count("open"), blocked: count("blocked") };
}
