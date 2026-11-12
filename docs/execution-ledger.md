# Optra Paper Core Recovery — Execution Ledger

Updated: 2026-11-12 (Asia/Jakarta)

This recovery record supersedes the earlier partial-only Step 01–10 status. Work continued in the existing Next.js repository; no second repository, worktree, or premium redesign was created.

## Recovery objective and acceptance

Deliver one reproducible paper-only House Agent path using real, source-backed market candles, deterministic rules and modeled premiums, the same engine for backtest and paper ticks, persisted order/position/account state, owner isolation, idempotency, and complete Optra Tape evidence. Both a valid execution and fail-closed paths must be tested. Live trading remains disabled.

## Work record

| Recovery task | Result | Evidence |
|---|---|---|
| Restore the original PM source and map hooks | Implemented for catalog + supported recipe | `docs/OPTRA_PM_ORIGINAL_DEV_BRIEF.md` §7 confirms the 36-entry stage counts `10/7/4/7/3/5`. The registry exposes all 36 entries; 15 have deterministic evaluator paths, 21 remain `catalog_only`. Protective Put is the only paper-ready template and contains mandatory Haltr, Daylo, Drawra, Exposa, and Venux Breakers. |
| Verify market history and multiplier semantics | Implemented with source evidence | Captured Crius AAPL hourly OHLCV response in `tests/fixtures/aapl-crius-hourly-capture.json`; 1,500 provider bars returned, active bar excluded, 1,499 closed/nonempty bars retained. Requests set `fill=false` and `continuous=false`. Robinhood asset mapping and multiplier are checked; history is normalized to share units only when corporate-action continuity is verified. |
| Model option premium transparently | Implemented for the Protective Put model | `lib/options/black-scholes.ts` implements deterministic European put premium and RV30 × 1.1. Orders are `modeled_option`, `premiumSource: modeled`, use one-share units and 50 bp slippage; venue fees are excluded. No venue option quote or real fill is claimed. |
| Run the backtest through the paper engine | Implemented | `lib/backtest/run.ts` requires 1,441 consecutive closed candles (721 warmup plus 720 decisions), calls shared `runTick`, and persists metrics only after at least one modeled entry. History snapshot, provider provenance, assumptions, entry/exit counts, and content hash persist with the run. |
| Launch and paper tick | Implemented for valid supported runs | The integration test authenticates a wallet, creates a Protective Put draft, creates a full 720-decision backtest, passes the same recipe/hash launch gate, blocks an off-session tick, and opens one modeled paper position on an exact captured historical candle. |
| Persist and reconcile paper state | Implemented | The tick transaction stores decision, modeled order, position and account updates. Integration assertions compare persisted order price/quantity to position entry and reconcile cash debit. Duplicate replay returns the prior order count without adding a second order. |
| Complete Optra Tape | Implemented | Tape contains skip and open decisions, all 15 recipe hook results plus execution trace, source/context history hash, and modeled PAPER orders. Positions endpoint returns the persisted modeled put. Owner mismatch returns 404. |
| Connect minimal UI screens | Implemented | `/agents` creates supported Protective Put drafts from `/api/markets`; `/lab` consumes actual coverage/backtest/launch APIs; Agent Detail ticks a running agent; Tape renders persisted decisions, orders and positions. Presentation remains the existing minimal functional UI. |
| Preserve live boundary | Verified | `LIVE_TRADING_ENABLED=false`, `V4_CLAIM_LEVEL=L0`; there is no live order route, chain transaction, approval, custody, or deployment behavior. |

## Data and model evidence

- Fixture capture timestamp: `2026-11-12T08:10:04.500Z`.
- Provider: Crius Robinhood Chain token OHLCV, hourly USD candles, request options `fill=false`, `continuous=false`, limit 1,500. This is token DEX data, not a traditional equity or option exchange feed.
- AAPL token: `0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9`; current share-per-token multiplier: `1.001090616965388660`.
- Closed data window: `2026-09-10T21:00:00.000Z` through `2026-11-12T08:00:00.000Z`, 1,499 bars. There is no gap fill or synthetic flat candle.
- Normalization fails closed if token address/current multiplier/corporate-action evidence is missing, multiplier is pending, or an unresolved action falls inside the selected window.
- Backtest requires 1,441 consecutive closed bars: 721 historical warmup candles and 720 decision candles. Incomplete/gapped/action-affected history produces no metrics and cannot launch.
- Option premium model: Black–Scholes European put; annualized sample standard deviation of 720 hourly log returns × 1.1; 8,760 annualization hours; zero risk-free rate and dividend yield; 30 calendar days; $0.01 theoretical strike rounding; one underlying share per model unit; 50 bp slippage; no venue fees.
- The observed quote in the fixture is outside regular US hours. The integration test uses it only to verify the blocked live-quote path. The successful order uses an exact closed historical candle timestamp from the captured provider bars.

## Blocked and success path test record

| Condition | Observed result | Test evidence |
|---|---|---|
| Fewer than 1,441 verified candles | `insufficient_data`, zero samples reported as complete, null metrics; launch gate rejects. | `tests/backtest/run.test.ts`, `tests/backtest/launch-gate.test.ts`, `tests/backtest/handlers.test.ts` |
| Multiplier action inside window | Backtest coverage blocked; no normalized history is treated as valid. | `tests/market/crius-history.test.ts`, `tests/backtest/run.test.ts` |
| Off-session quote/tick | Persisted `skip`, `sessia:block`, `orderCount:0`. | `tests/integration/paper-flow.test.ts`, `tests/engine/us-market-session.test.ts` |
| In-session exact historical candle, valid recipe/history | `open`, one `filled` PAPER modeled order, one open modeled position, account cash debited by order fill. | `tests/engine/protective-put-replay.test.ts`, `tests/integration/paper-flow.test.ts` |
| Retry of successful tick | Original decision and order count returned; no duplicate order/position. | `tests/integration/paper-flow.test.ts`, `tests/paper/ledger.test.ts` |
| Cross-owner access | Agent/tick read rejected as 404. | `tests/integration/paper-flow.test.ts`, `tests/paper/ledger.test.ts` |
| Backtest with complete window but no modeled entry | Run fails without performance metrics and cannot launch. | `tests/backtest/run.test.ts`, `tests/backtest/launch-gate.test.ts` |

## Verification results

All commands run in the current workspace on 2026-11-12:

| Command | Result |
|---|---|
| `bun run test` | 29 files / 89 tests passed. |
| `bun run test:e2e` | 11 Playwright tests passed. |
| `bun run typecheck` | Passed. |
| `bun run lint` | Passed, no findings. |
| `bun run build` | Passed; Next.js 16 generated 13 static pages and compiled all API routes. |
| `bun run test -- tests/integration/paper-flow.test.ts` | Passed against temporary PGlite and captured provider response; verifies authentication, backtest, launch, blocked tick, successful PAPER order/position, account reconciliation, Tape, idempotency, and owner denial. |
| `bun run test -- tests/backtest/run.test.ts` | Passed; checks exact 1,499 source bars, 1,441 coverage requirement, multiplier-action block, and same-engine modeled replay. |
| `bun run db:generate` | Generated `drizzle/0003_numerous_annihilus.sql` for modeled paper orders/positions/accounts and history provenance. |

## Decisions and known deviations

- RecipeV1 remains the existing `hookIds` + `parameters` contract rather than replacing it with a new `{ hook, stage, params, enabled }` structure.
- V1 hook statuses remain supported and are extended with PM trace statuses (`pass`, `block`, `select`, `size`, `action`, `noop`, `error`).
- Nextra's PM recipe setting `respectGate:false` does not bypass mandatory Breakers; all five Breakers always gate new entries.
- Premiums and simulated fills are theoretical, one-share model units; no exchange-listed contract, expiry, option quote, or venue fee schedule was verified.
- The feed fixture proves one AAPL window only. Runtime coverage for every symbol/window remains dynamic and must be read from `/api/backtests/coverage`.
- Public agent and Tape endpoints remain empty until an explicit visibility model exists. The public claim manifest reports 36 catalog entries, 15 deterministic evaluators, 21 catalog-only entries, one paper-ready template, and L0/live-disabled status.

## Remaining scope

- Implement and source-verify the remaining 21 hooks and three House Agent recipes before advertising broader automation.
- Obtain recorded options quotes/IV, venue contract specs, and fee schedules if venue-based pricing becomes required. Until then, retain modeled labels/assumptions and the simulated one-share limitation.
- Validate availability and multiplier/corporate-action continuity for each additional underlying before enabling its backtest.
- No scheduler is configured for unrelated hourly quote collection; the historical Crius feed is fetched directly by backtest/tick runtime.
- No premium UI redesign has started. Claude Code may use `docs/ui-handoff-contract.md` and `docs/final-core-handoff.md`; backend, safety, tests, migration, and verification paths are protected there.
