# Landing Content Contract

Copy and data claims for the later Claude Code UI phase. Preserve the exact boundaries below; do not imply that modeled paper fills are venue trades.

## Product description (shipped on `/`)

- Eyebrow: `AI OPTIONS AGENTS · ROBINHOOD CHAIN`
- Heading: `Let agents trade the strike.`
- Description: `Choose a House Agent or build your own rules for synthetic calls and puts on Robinhood Chain. Backtest the strategy, run it on paper, and read every decision on Optra Tape.`
- Gloss: `The strike is the price an option is struck at. Rules pick it, size it, and explain it.`
- Primary action: `Launch a paper agent` → `/agents`.
- Secondary action: `Read the Tape` → `#tape` (an in-page explainer; there is no public Tape, so no live feed is linked).
- Risk and provenance: `Paper first. Synthetic options on stock prices. Not shares. Not investment advice.`
- The hero card is a Protective Put recipe preview generated from `getHookCatalog()` and `buildProtectivePutRecipe()`. It contains no price, P/L, fill or performance figure.
- The Tape example on the landing page is labeled `Illustrative paper example. Not a recorded trade.`

Current supported scope: one of four House Agent templates (Protective Put) is paper-ready; 15 of 36 PM hook entries have deterministic evaluator paths; 21 remain catalog-only. A complete backtest needs 1,441 consecutive closed candles (721 warmup plus 720 decisions) and at least one modeled entry. Check `/api/backtests/coverage` for the requested symbol; the captured AAPL window does not establish history coverage for every asset or future date.

## Claims that must stay accurate

- This implementation is paper-only: `LIVE_TRADING_ENABLED=false`.
- `V4_CLAIM_LEVEL=L0`; do not claim deployed or on-chain v4 hooks.
- Robinhood Chain candles are token DEX prices. They are converted to share-equivalent history only after token mapping, multiplier, and corporate-action continuity checks.
- Black–Scholes premiums use RV30 × 1.1. They are modeled theoretical one-share units, not recorded option quotes, listed contracts, or real fills. The model uses 50 bp slippage and excludes venue fees.
- A backtest only displays metrics when source coverage is complete and at least one modeled entry occurred. Short windows, unresolved multiplier actions, and no-entry windows stay blocked or metric-free.
- Do not imply all 36 hooks are executable. Render the 21 catalog-only entries as unsupported and preserve their reasons.
- Do not render fake balances, option quotes, IV, fills, returns, public agents, public Tape rows, or AI output.
- Verify status against `/api/public/v1/verify`, hook definitions against `/api/public/v1/hooks`, template availability against `/api/public/v1/templates`, and runtime history against `/api/backtests/coverage`.

## Route and state expectations

- `/`: landing page (no longer a redirect). Section anchors: `#agents`, `#forge`, `#how`, `#tape`, `#status`, `#faq`.
- `/verify`: server claims from `/api/public/v1/verify` plus a labeled list of unshipped features.
- `/agents`: wallet status; owner-scoped records; connected-wallet Protective Put draft form with virtual shares/capital; one paper-ready template and three previews.
- `/agents/{agentId}`: recipe hash, paper lifecycle, positions and Tape; allow manual paper tick only for a running agent; preserve acknowledgement and error states.
- `/market`: current quote source/time/units, multiplier, stale/halt state; quote is not an option premium.
- `/lab`: real candle coverage, 1,441 requirement, modeled pricing assumptions, persisted backtest status/metrics, launch blocker or launch acknowledgement.
- `/forge`: generic RecipeV1 form; only the supported Protective Put composition can validate; generic unsupported recipes remain blocked. AI composition is Planned because no provider is configured.
- `/hooks`: all returned PM definitions, stage counts, implemented/catalog-only labels, parameter details and limitation reasons.
- `/tape?agentId={id}`: owner-only decisions, full hook/model trace, paper orders, and modeled position state. Public Tape stays empty.

Maintain semantic loading, signed-out, error, stale, halted, insufficient-data, blocked, empty, and success states. Keep API behavior and Zod types in `docs/ui-handoff-contract.md`; premium presentation work belongs to Claude Code.
