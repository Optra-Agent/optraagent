# Optra Paper Core Recovery — Execution Ledger

Updated: 2026-11-13 (Asia/Jakarta)

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

## 2026-11-12 continuation — benchmark and graph integration contract

### Step 05 benchmark decision

**Question:** The PM asks Lab to compare the agent with holding and cash/USDG. The verified input is underlying share-normalized candle history; there is no USDG/USD history and no option quote history.

**Decision:** Calculate buy-and-hold from the first to last of the 720 decision-candle `shareCloseUsd` values, investing the same initial USD capital and excluding dividends, fees, and slippage. Calculate cash as the same initial USD capital held flat with zero yield. Expose `cash.denomination: "USD"`, `cash.method: "flat_no_yield"`, and `cash.usdGPricePath: "not_modeled"`; `vsCashPct` is not a measured USDG return. These methods and the exact sample window are returned in `BacktestMetrics.benchmarks`.

**Reason:** This is reproducible from verified data and does not fabricate a USDG price/yield path. The agent's total return and both benchmark returns share the same decision window. Invalid/nonpositive benchmark endpoint closes withhold metrics and keep the run unlaunchable.

**Compatibility:** `benchmarks` is optional in `BacktestMetricsSchema` so previously persisted JSONB metrics remain parseable. No DB schema migration is required. At that backend-only change, UI integration was pending. Claude's current `BenchmarkComparison` now consumes server metrics and shows unavailable when an older row lacks the field; browser verification is still pending.

**Evidence added:** `lib/backtest/run.ts`; `lib/domain/contracts.ts`; `tests/backtest/run.test.ts`; contract updates in `docs/api-contracts.md`, `docs/ui-handoff-contract.md`, and `docs/final-core-handoff.md`. The backend pass did not edit UI files; the current Claude-owned Lab component later consumed this mapping.

### Agent graph contract

`docs/agent-graph-data-contract.md` defines a public capability adapter for the selected Protective Put template, six hook stages, 36 catalog entries, evaluator availability, five Breakers, paper-decision capability, and Tape destination. Existing endpoints and the shared `PAPER_PROTECTIVE_PUT_HOOK_IDS` constant are sufficient; no endpoint or backend change is called for. `/api/public/v1/tape` currently returns no decisions. Any authored sequence must remain visibly `Illustrative only`; public UI must never read owner Tape, strategies, positions, sessions, or user-specific agents. The landing graph source files are concurrently owned by Claude and were not changed in this pass.

### Original ten-step status reconciliation

See the detailed status/evidence matrix in `docs/tasks/optra-fullstack-progress.md`. Current statuses: Step 01 DONE; 02 PARTIAL; 03 PARTIAL; 04 DONE; 05 PARTIAL (benchmark API and current Lab component implemented, browser QA pending); 06 PARTIAL (manual ticks, no scheduler); 07 DONE for click-builder scope (AI is Planned); 08 PARTIAL; 09 PARTIAL; 10 PARTIAL pending coordinated final E2E/build QA.

### Verification and coordination record

- Focused benchmark test was red before implementation because `metrics.benchmarks` was absent; it passed after implementation. The invalid-zero-endpoint test was red before the guard, then passed after the guard.
- `bun run test -- tests/backtest` — passed 5 files / 17 tests after the endpoint guard.
- `bun run test -- tests/integration/paper-flow.test.ts` — passed 1 file / 1 test after the endpoint guard; now asserts the benchmark block survives the API response and JSONB persistence.
- `bun run test -- tests/domain/contracts.test.ts` — passed 1 file / 6 tests; confirms stored runs without the optional benchmark block remain valid.
- `bunx tsc --noEmit --incremental false` — passed without touching the concurrently modified `tsconfig.tsbuildinfo`.
- `bun run lint` — passed with no findings.
- An ad hoc Lab browser attempt against the isolated OPTRA dev server on port 3001 did not hydrate the current page and issued no API requests; browser logs showed an invalid HMR websocket response. No temporary E2E test remains in `tests/e2e/lab.spec.ts`. This is not evidence of a Lab feature failure; full E2E remains pending a coordinated stable dev server.
- Removed only this pass's temporary files under `/tmp`: `optra-lab-e2e.config.mjs`, `optra-lab-response.html`, and the `optra-lab-e2e-results` directory. No repository screenshots, fixtures, or Claude-owned artifacts were deleted.
- Do not run Playwright with the repository's default config: it reuses port 3000, which is currently owned by SENTERA (confirmed by the process working directory). Do not stop SENTERA. One OPTRA dev server is active on port 3001 and uses the repository `.next` directory; coordinate full Playwright/build verification after the concurrent landing edits settle.
- No commit, push, deployment, or repository cleanup was performed.

### 2026-11-12 continuation — serialized tick and focused security audit

**RED evidence:** The captured-provider integration regression synchronized two distinct historical tick requests after both had read the same flat portfolio. Before the fix, one request returned `200` and the other `500` when the partial unique index rejected a second open position. The same flow showed that a distinct historical tick earlier than the latest decision was accepted with `200`, allowing state to be evaluated backwards.

**Fix:** Paper persistence now locks the owner-scoped agent row with `FOR UPDATE`, rechecks the running state, checks existing tick identity while locked, compares the new event time with the latest persisted decision, loads current account/position state, and evaluates `runTick` before writing. The decision, trace, orders, position change, and account mutation remain atomic. A late/backdated new tick returns `409 CONFLICT`; same-tick retries still return the original decision/order count. Agent lifecycle updates take a conflicting lock on the same row.

**Verification:**

- `bun run test -- tests/agents tests/auth tests/backtest tests/db tests/domain tests/engine tests/forge tests/hooks tests/integration tests/market tests/options tests/paper tests/public-api` — passed 31 files / 103 tests.
- Included assertions cover the successful open + subsequent hold under concurrent distinct IDs, no duplicate order, a blocked off-session tick, same-key replay, 409 for a new backdated event, stop-state recheck, wallet signature/session, cross-owner 404, and public APIs returning no private agents/Tape.
- `bunx tsc --noEmit --incremental false` — passed. `bun run lint` — passed.
- Source inspection confirms Claude's current `BenchmarkComparison` consumes only server-returned `metrics.benchmarks`, labels the flat USD baseline without yield/USDG path, and renders old records without the optional field as unavailable. Browser behavior remains unverified.
- Full E2E/build remain coordinated final-QA work. Default Playwright port 3000 belongs to SENTERA; OPTRA shares `.next` with its active dev process. Neither was stopped or overwritten.
- Security findings and test scope are summarized in `docs/security-review-2026-11-12.md`.

## Remaining scope

- Implement and source-verify the remaining 21 hooks and three House Agent recipes before advertising broader automation.
- Obtain recorded options quotes/IV, venue contract specs, and fee schedules if venue-based pricing becomes required. Until then, retain modeled labels/assumptions and the simulated one-share limitation.
- Validate availability and multiplier/corporate-action continuity for each additional underlying before enabling its backtest.
- No scheduler is configured for unrelated hourly quote collection; the historical Crius feed is fetched directly by backtest/tick runtime.
- The premium application UI is documented in `docs/final-ui-handoff.md`; current marketing graph work is tracked as a separate in-progress UI integration. Claude Code may use `docs/ui-handoff-contract.md` and `docs/final-core-handoff.md`; backend, safety, tests, migration, and verification paths remain protected there.

## 2026-11-13 continuation — final engineering and browser integration check

**Worktree:** HEAD was `afe4fe3` (`origin/main` matched). Existing Claude staged UI, graph, browser-test, and shared TypeScript build-info changes were left untouched. This continuation changed documentation only; no backend or frontend source was changed.

**Backend verification:**

- `bun run test -- tests/agents tests/auth tests/backtest tests/db tests/domain tests/engine tests/forge tests/hooks tests/integration tests/market tests/options tests/paper tests/public-api` — passed, 31 files / 103 tests.
- `bun run test` — passed, full Vitest suite: 31 files / 103 tests.
- `bunx tsc --noEmit --incremental false` — passed without rewriting the staged `tsconfig.tsbuildinfo`.
- `bun run lint` — passed.
- Source review covered wallet challenge/session handling, owner-scoped API handlers, lifecycle transitions, transaction-level tick evaluation/persistence, backtest provenance/launch gating, public capability handlers, benchmark schema, and the live-execution boundary. No additional confirmed backend defect was found, so no code or regression-test change was made.

**Browser attempt and limitation:**

- Ran 50 existing Playwright tests with an external temporary config against the active OPTRA server at `http://127.0.0.1:3001`, with no `webServer` and output directed to `/tmp`. Result: 11 passed / 39 failed.
- Representative app pages loaded server HTML (`/agents`, `/lab`, `/hooks`, `/verify` returned 200), but client state remained “Checking wallet session…”. A browser probe captured invalid `/_next/hmr` WebSocket handshakes (`ERR_INVALID_HTTP_RESPONSE`) and no `/api/*` requests. Therefore this run cannot validate client/API integration and is not recorded as a product API failure.
- Port 3000 and 3002 were confirmed as SENTERA. OPTRA on 3001 had the active `.next/dev/lock` held by its Next server. The default Playwright config and `bun run build` were not run because they could hit SENTERA or overwrite the active `.next` directory. No process was stopped.
- No real wallet-extension signing prompt was verified. The signed wallet challenge and full supported paper flow remain covered by the passing backend integration suite using a test EVM signer and deterministic provider fixture.

**Next coordinated QA:** restore a healthy OPTRA client hydration/HMR path, then rerun the browser suite on a safe OPTRA target; verify new and legacy Lab benchmark states, the public graph and no-private-data requests; walk the browser wallet journey if an extension is available; coordinate a quiet `.next` before production build. Do not claim those checks passed until rerun.

See `docs/codex-final-engineering-handoff.md` for endpoint contracts, ownership boundaries, the exact Lab benchmark shape, and the Claude integration handoff.
