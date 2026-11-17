# Optra Paper Core Recovery — Execution Ledger

Updated: 2026-11-15 (Asia/Jakarta)

This recovery record supersedes the earlier partial-only Step 01–10 status. Work continued in the existing Next.js repository; no second repository or Git worktree was created, and the approved palette and component architecture were preserved.

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

This was the 2026-11-12 status snapshot and is superseded by the current 2026-11-15 Step 01–10 reconciliation in the takeover recovery below. At the time, the Lab browser check and coordinated final E2E/build QA were still pending.

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
- The premium application UI is documented in `docs/final-ui-handoff.md`; the current pinned-story refinements and browser evidence are recorded in the 2026-11-15 takeover recovery below. Broader PM UI features remain partial. `docs/ui-handoff-contract.md` and `docs/final-core-handoff.md` record the shared interfaces; backend, safety, tests, migration, and verification paths remain protected there.

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

## 2026-11-15 initial takeover recovery — wallet, pinned stories, and release gates (superseded below)

The active connector bug was in the UI sequence, not a reason to replace Wagmi: `AuthSessionProvider` called `connectAsync` even when Wagmi's connected state already named the selected connector. The installed `@wagmi/core@3.6.9` rejects this repeated connect for its current connector UID. New provider tests confirm an already-connected MetaMask and Phantom EVM connector skip `connectAsync`, then use the selected connector to sign the server challenge. The server challenge, signature verification, cookie, and owner-isolation code were not changed.

Current source changes:

- `components/app/AuthSessionProvider.tsx` and `components/app/WalletSession.tsx`: current connector reuse, reconnect/wrong-chain distinction, expected account/chain checks around sign-in, duplicate prompt guard, and clearer server-session recovery states.
- `public/wallets/metamask.svg`, `public/wallets/phantom.svg`, and `docs/wallet-brand-assets.md`: locally served official wallet marks and provenance.
- `components/marketing/ForgeDemo.tsx` and `app/(marketing)/studio.css`: stop autoplay on manual interaction and show stage activity in the existing strategy summary.
- `components/marketing/FlowPath.tsx`: show the evaluation pulse when the active node is the first stage; reduced motion remains respected.
- `components/marketing/story.tsx` and `app/(marketing)/studio.css`: replace the arbitrary Lab market curve with an input/model/replay diagram and distinguish historical prices from modeled premiums.
- `components/app/lab/LabScreen.tsx`: keep the selected draft `Select` controlled during loading, removing the React uncontrolled-to-controlled warning.
- `lib/market/runtime.ts` and `scripts/optra-e2e-isolated-server.ts`: route the isolated browser server to a loopback market fixture, match `APP_BASE_URL` to its test origin, and keep PGlite inside the temporary source snapshot with inherited `DATABASE_URL` removed.
- `tests/app/auth-session-provider.test.ts`, `tests/e2e/graph.spec.ts`, and `tests/e2e/lab-benchmarks.spec.ts`: wallet lifecycle and current story/UI regressions.
- `tests/e2e/paper-flow-live-api.spec.ts`: browser-to-database journey with a test signer and real app routes; the stale test quote correctly yields a persisted zero-order skip, not a real extension test.
- `docs/contract-deployment-plan.md`: PM-bounded contract inventory and conditional deployment path.

Verification on current source:

| Command | Result |
|---|---|
| `bun run test` | 33 files / 122 tests passed. |
| `bun run test:e2e` | 75 / 75 passed in isolated Chromium. Runtime smoke confirmed hydration, `/api/me` signed-out 401, zero HMR errors, and permitted Strict Mode cancellation only. The live-route UI journey passed with no browser console or page errors. The focused Forge suite passed 3/3 again after the final phone-width anatomy-label adjustment. |
| `bun run typecheck` | Passed. |
| `bun run lint` | Passed. |
| `bun run test -- tests/integration/paper-flow.test.ts` | 1 test passed using temporary PGlite and captured history. |
| Temporary source snapshot + `OPTRA_E2E_DIST_DIR=.local/optra-next-build bun run build` | Passed on current source in isolated output; 14 static pages generated. |

That November 14 landing iteration used a data-derived isometric Protective Put anatomy: five real rule stages, 36 hook sockets (15 implemented and 21 catalog-only), Breaker rail, validator, and Tape printer. The owner later rejected that Forge visualization; the replacement is recorded in the November 15 final execution section below. Marketing demonstrations remain illustrative and issue no paper trade.

Real browser extension signing remains unverified: the live Chrome process exposed no CDP listener, and its extension installation state is unknown. Unit mocks prove connector/session state handling; E2E confirms the no-extension UI state in its isolated browser. Do not report real MetaMask/Phantom authentication as browser-verified. Web release remains a candidate pending the manual extension check and owner go/no-go.

OPTRA contract inventory is zero source contracts, zero deployed contracts, and zero OPTRA explorer-verified addresses. The original PM brief supports two conditional modules (`OptraGuardHook`, `GuardRegistry`) after feasibility review and explicit approval. It does not justify six independent contracts. The initial RPC attempt in this takeover returned an unrelated expired certificate; the subsequent read-only verification and updated readiness boundary are recorded in the on-chain addendum below. The paper MVP does not depend on these modules.

No commit, push, merge, deployment, server restart, or live-money action was performed. Existing ports 3000–3003 were left untouched; E2E used its isolated port 3100.

## 2026-11-15 final execution — Forge workflow and release gates

Replaced the owner-rejected Forge visualization with `ForgeWorkflowPreview`, a five-step product walkthrough inside the existing `PinnedStory`: agent selection, real Protective Put rule composition, validator feedback, Lab readiness, and a clearly illustrative decision route into private Tape. Its displayed rule counts/status come from the actual hook catalog; rule chips share selection state with the existing Forge demo editor. The existing `/forge` server validator and APIs were preserved. The marketing walkthrough performs no backtest, paper tick, or Tape write.

The walkthrough has five selectable states, keyboard controls, automatic progression, pause/resume/replay, reverse scroll, reduced-motion/Save-Data handling, and responsive 390/820/1440px layouts. Captured browser images are in ignored `.local/optra-e2e-results/`. No dependency or trading-engine change was made.

The `package.json` migration script pointed to a nonexistent `scripts/migrate.ts`. Reproducing `env -u DATABASE_URL bun run db:migrate` returned `ERR_MODULE_NOT_FOUND`. Added the missing entrypoint; it now refuses to run without an explicit PostgreSQL target, delegates to the existing Drizzle migration path, closes its connection, and redacts URL-shaped credentials in errors. `tests/db/migrate-script.test.ts` covers the no-target guard. No PostgreSQL connection or migration was attempted.

| Final gate on 2026-11-15 | Result |
|---|---|
| `bun run typecheck` | Passed. |
| `bun run lint` | Passed. |
| `bun run test` | 34 files / 123 tests passed. |
| `bun run test:e2e` | 78 / 78 isolated Chromium tests passed. Runtime smoke loaded 25 scripts, signed-out `/api/me` returned 401, and HMR socket errors were 0; one permitted Strict Mode template-fetch cancellation was observed. |
| Forge browser acceptance | All five workflow states, edits/validation, read-only boundary, keyboard, scroll/reverse, 390/820/1440px, and Pause/Resume/Replay passed. The five-stage demo completed in 13.7 seconds. |
| Isolated production build | Passed from a locked-dependency temporary source snapshot; 14 static pages and all dynamic API routes compiled. Next's generated type edits stayed inside the snapshot, not the checkout. |
| Migration safety guard | Passed with `DATABASE_URL` unset; no connection attempt. |
| Real MetaMask/Phantom extension prompt | Not verified. No extension-backed browser target was available; use the manual steps in the tracker. |

One intermediate full E2E run timed out on a single `/agents` navigation while the page still showed “Checking wallet session…”. That test passed when rerun alone, and the subsequent full suite passed 78/78; no source change was tied to the timeout.

**Web release readiness: ready for deployment preparation, not ready for controlled release.** Real-extension and owner visual acceptance, selected-host persistent PostgreSQL and migration verification, HTTPS/origin setup, backups/rollback, host logging/monitoring, cross-browser/device checks, and owner go/no-go remain. The repository has zero Solidity sources, deployments, or verified addresses; there are two conditional PM-backed contract candidates, with no basis for six distinct contracts. Contract deployment does not block the paper MVP.

No web/contract deployment, production migration, commit, push, merge, or server restart was performed. Ports 3000–3003 were left running; Playwright used isolated port 3100. The [tracker](tasks/optra-fullstack-progress.md) contains the original ten-step reconciliation and release checklists.

## 2026-11-15 on-chain takeover — read-only feasibility

### Current status

- No Solidity, Foundry workspace, ABI, deployment script, OPTRA contract test, OPTRA deployment, or OPTRA verified address was added or found. The paper application, database, auth, APIs, frontend, and live-execution flags were not changed.
- Two conditional modules remain the PM-supported upper bound: `GuardRegistry` and `OptraGuardHook`. Hook rules remain offchain except for the narrowly scoped future enforcement proposal on OPTRA-owned v4 spot pools. The v4 hook does not guard CallPut/Zeno options orders or third-party pools.
- `LIVE_TRADING_ENABLED=false` and `V4_CLAIM_LEVEL=L0` remain in force. No test suite was rerun because this pass changed documentation only; no source or behavioral code changed.

### Chain and protocol evidence

During read-only `curl` JSON-RPC requests with normal TLS verification, the testnet returned `eth_chainId=0xb626` (46630), `eth_blockNumber=0x9291abc`, and nonempty `eth_getCode` for `0x8366a39cc670b4001a1121b8f6a443a643e40951`. The testnet Blockscout v2 smart-contract endpoint for that address returned `file_path=src/PoolManager.sol` and `creation_status=success`.

## 2026-11-15 autonomous paper worker and PostgreSQL release readiness

### Implementation

- Added `POST /api/cron/paper-evaluations`, protected by a constant-time `CRON_SECRET` check before database initialization. It processes only running, hash-valid Protective Put agents and reuses the existing `runTick` and transactional `persistTick` path.
- A paper evaluation requires verified Crius one-hour data, a stable multiplier, no fill-forward, positive trade activity/close, 721 contiguous finalized prior candles, a regular US equity session, a five-minute finalization grace, and a maximum two-hour candle age. Data gaps, stale history, bad provenance and transient provider/persistence failures do not create synthetic ticks; failures return retryable 503 and the next host invocation may retry.
- The PostgreSQL worker lease uses session advisory lock namespace `OPTR/1` on a reserved backend connection. A competing worker returns 202; lifecycle state is filtered on selection and checked again under the existing agent-row lock before persistence. Resume `updatedAt` is combined with the latest Tape timestamp as the lower execution bound. PGlite intentionally has no scheduler-lock implementation and fails closed.
- Added `/api/health/live` and `/api/health/ready`. In production, readiness requires a PostgreSQL URL, canonical HTTPS origin, cron secret of at least 32 characters, `LIVE_TRADING_ENABLED=false`, and `V4_CLAIM_LEVEL=L0`; it then performs `SELECT 1`. Scheduler events are compact JSON to stdout/stderr, without owner IDs or credentials.

### Verification on November 15

- `bun run test` passed twice: 38 files passed / 2 optional PostgreSQL files skipped, 132 tests passed / 2 skipped per run.
- `OPTRA_TEST_POSTGRES_URL=... bun run test -- tests/db/postgres-paper-persistence.test.ts tests/db/postgres-scheduler-lock.test.ts` passed both cases on the disposable PostgreSQL 17 cluster. It verified transaction rollback, owner-scoped PAPER Tape persistence/idempotent replay, and cross-connection exclusion/release of the scheduler lease.
- The full scheduled-flow integration passed with a real signed EVM test challenge and disposable PGlite: draft validation, complete 720-decision backtest, matching launch, scheduled modeled order/position, and Tape. Additional scheduler integration covers a risk-gated `skip` with no order, pause/resume/stop eligibility, missing cron credentials and overlapping invocation.
- A fresh disposable PostgreSQL database accepted all four checked-in migrations; repeating `bun run db:migrate` succeeded. The migrated database had four migration records and 11 public application tables. The entrypoint applies migrations rather than checking configuration only.
- A `pg_dump -Fc` backup restored into a second disposable database; the restored database retained all four migration records, 11 application tables, and a seeded row. The production readiness route returned 200 against the migrated disposable database. No production connection was used.
- `bun run typecheck`, `bun run lint`, `bun run test:e2e` (78/78 isolated Chromium), and a locked-dependency source-snapshot `bun run build` passed. E2E used port 3100 and did not restart the existing development processes.

### Release boundary

No host-specific staging database, external scheduler, DNS/HTTPS origin, log retention/alerts, backup service, rollback owner, or deployment environment is configured in this repository. The host must call `POST $APP_BASE_URL/api/cron/paper-evaluations` with bearer `CRON_SECRET` every 15 minutes (recommended schedule `5,20,35,50 * * * *`) and support persistent PostgreSQL session advisory locks. The endpoint is implemented and tested; real wall-clock scheduling in staging remains unverified until that host configuration exists. Real MetaMask/Phantom extension acceptance and the owner's visual/release approval also remain open.

The final current E2E list has 78 cases. The previously reported 80 cases belonged to the pre-replacement Forge/Core suite: its file had eight cases before the workflow redesign and six afterward. The two-case net difference is explained by replacing the rejected Core-specific behavior tests; Playwright `--list` and the final run agree on 78. No change to the unrelated test files was involved.

Mainnet returned `eth_chainId=0x1237` (4663), `eth_blockNumber=0x6dbbd2f`, and nonempty bytecode at the same PoolManager address. The official Uniswap v4 deployment page maps that address to Robinhood Chain mainnet and lists its periphery, including Universal Router 2.1.2 at `0x204FAca1764B154221e35c0d20aBb3c525710498`. The official list's testnet section does not list Robinhood Chain Testnet. A testnet PoolManager source record does not by itself verify a supported testnet router, usable stock-token pool, OPTRA hook, or integration path.

Robinhood's current Stock Token documentation says these are standard ERC-20s that can be transferred and composed, while also describing them as tokenised debt securities and restricting primary issuance to authorised participants. This supports generic interface feasibility, not the suitability or availability of a specific token/pair. Asset-specific tradability, legal/geographic eligibility, quote asset, existing pools, and liquidity remain unresolved.

After the successful responses, repeat RPC and explorer requests intermittently reset (`curl` error 35). The official public RPC docs mark these endpoints rate-limited and recommend a provider for production. No verification bypass was used. Mainnet explorer API returned HTTP 403 in this environment; mainnet bytecode evidence came from JSON-RPC, and the official address mapping from Uniswap's deployment page.

### Conditional architecture and tests

```text
Offchain market data + private agent/rule/Tape state
                  |
          authorized keeper
                  v
 GuardRegistry (only if state must be shared)
                  ^ otherwise guard state stays in Hook
                  |
Wallet -> v4 router -> PoolManager -> OptraGuardHook -> OPTRA spot pool
                                        |
                         allow/deny entry swaps

Options venues and third-party pools are outside the hook boundary.
```

The updated `docs/contract-deployment-plan.md` contains the approval-gated interface/state proposal, role boundaries, fail-closed entry and permitted reducing swaps, unresolved schedule-proof and stale-state decisions, events/errors/invariants, Foundry compiler/dependency pinning, unit/fuzz/property tests, and testnet/mainnet release gates. The spec flags caller-provided `hookData` as untrusted and requires direction verification. No gas estimate was invented: measure it only after reviewed code exists against the chosen RPC.

### Readiness and next milestone

- **Mainnet:** protocol-level v4 PoolManager and periphery are documented, and PoolManager bytecode was read. OPTRA is not ready to deploy: no approved spec, code, test/audit, selected asset/pool, deployer, measured gas, or explicit authorization.
- **Testnet:** the chain responds and the PoolManager address has a verified source record. OPTRA is not ready to deploy: router support, an approved test asset/pool, hook, test suite, operator, and gas plan remain unverified. Testnet deployment still requires explicit authorization.
- **Next milestone:** owner approves or rejects future spot-pool enforcement, selects one self-contained hook versus a shared registry, and resolves the target asset/quote pair, session schedule representation, state freshness, entry/exit semantics, and admin/keeper controls. After spec approval, implement and test in the existing repository. Request separate explicit authorization before any testnet signing; mainnet requires a later independent gate after testnet evidence, audit, asset/legal review, and gas assessment.

No RPC signing, token approval, transaction, deployment, migration, commit, push, or live-money action occurred.
