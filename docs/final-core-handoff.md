# Optra Paper Core — Claude Code UI Handoff

Updated: 2026-11-15 (Asia/Jakarta); core contract baseline first recorded 2026-11-12

## 2026-11-15 recovery addendum

Current-source verification on November 15 passed 123 unit/integration tests across 34 files, 78/78 isolated Chromium tests, typecheck, lint, and a production build from a locked-dependency temporary source snapshot. The final Forge browser checks cover five actual workflow screens, 390/820/1440px, keyboard/direct interaction, scroll, read-only behavior, and autoplay with pause/resume/replay. The browser journey uses a server-verified test-signer session, real UI/API handlers, captured market data, and disposable PGlite; its stale quote correctly creates a zero-order skip that remains in Tape after refresh. The separate PGlite integration test covers a successful modeled order, position persistence, replay, concurrency, and cross-owner denial. These tests do not represent a real wallet extension prompt.

The screenshot-reported wallet failure was caused by OPTRA calling `connectAsync` when Wagmi already held the selected connector as active. The client now reuses that connection and guards session/signature races; server nonce/signature verification, cookie issuance, and owner checks remain intact. Twelve lifecycle tests cover connector reuse and session transitions. Actual MetaMask/Phantom signing remains unverified: the live Chrome process had no exposed CDP listener, and extension installation state is unknown.

The owner-rejected Forge visualization was replaced with a five-screen app-like Protective Put workflow: agent selection, catalog-backed rule composition, validator feedback, Lab readiness, and a clearly illustrative Tape decision route. It reuses `PinnedStory`, synchronizes hook selection with the real demo editor, keeps the functional Forge route/validator unchanged, and makes no API mutation or paper write. Browser screenshots were inspected at 390px, 820px, and 1440px; all five states, direct selection, autoplay, reverse scroll, keyboard, reduced-motion, and no-horizontal-overflow checks passed. The owner has not yet accepted this replacement. The original 10-step status and wallet acceptance checklist are in `docs/tasks/optra-fullstack-progress.md`. Contract inventory remains zero actual/deployed/verified OPTRA contracts; the PM brief supports only two conditional future modules, and deployment is separate from the paper MVP. Live trading remains disabled.

Added the missing `scripts/migrate.ts` target for the existing `bun run db:migrate` package script. It fails closed without an explicit `DATABASE_URL`; its safety guard is covered by a regression test. No migration was applied to PostgreSQL. Production still requires a host-provided persistent PostgreSQL database, origin-bound HTTPS configuration, backup/rollback and logging/monitoring setup; no dedicated database health endpoint or centralized logging integration is present.

**Release readiness: ready for deployment preparation, not ready for controlled release.** Real MetaMask/Phantom acceptance, owner visual acceptance, cross-browser/physical-device checks, selected-host production configuration and operational sign-off remain outstanding. No web or contract deployment occurred.

## Core delivery baseline (recorded 2026-11-12)

**The constrained Protective Put paper core is ready for premium UI integration.** The broader product remains partial: one House Agent is paper-ready, 15 of 36 hook entries have deterministic evaluators, and option premiums are modeled rather than venue-recorded. The handoff does not claim listed option execution, exchange fills, or live trading.

The verified path is: wallet challenge/session → create Protective Put draft → fetch verified market history → replay a 720-decision backtest after warmup → persist source snapshot/hash/provenance/model assumptions → launch the matching recipe → run a paper tick → persist order, position, account and full Optra Tape trace. A valid historical candle path creates one modeled PAPER order. Concurrent tick IDs are serialized and evaluated from the locked latest state; retries do not duplicate fills, and backdated ticks conflict. A closed-session tick records a blocked `skip` or `hold` with zero orders. Incomplete, gapped, stale, multiplier-uncertain, or no-entry inputs do not unlock metrics/launch.

The premium application UI is documented in `docs/final-ui-handoff.md`. This core baseline predates the 2026-11-15 story refinements and browser QA recorded above. Preserve the single Next.js repository and backend/API contracts while working on presentation.

## Completed functionality

- EVM wallet challenge and server-side signature verification; opaque seven-day session cookie; logout/revocation; owner identity derived from session.
- Read-only Robinhood Chain market symbol/current quote APIs, with source timestamp, underlying/token units, multiplier, stale and halt status.
- Complete 36-entry PM hook catalog with expected 10/7/4/7/3/5 stage counts. Fifteen hooks have deterministic evaluator paths; 21 remain explicitly `catalog_only`.
- Strict Protective Put recipe builder/validator, immutable canonical hash, mandatory five Breakers, virtual reference shares, buy-put-only composition.
- Crius hourly Robinhood Chain candle adapter with real trades only (`fill=false`, `continuous=false`), active-candle exclusion, symbol/token mapping, multiplier/corporate-action checks, gap/coverage reporting, and no synthetic bars.
- Deterministic European Black–Scholes put premium using RV30 × 1.1. Every premium/order/position is marked `modeled`.
- One shared `runTick` evaluator for backtest and paper ticks. A full run needs 721 warmup candles plus 720 decision candles (1,441 consecutive closed bars) and at least one modeled entry.
- Persisted owner-scoped backtest history snapshots, normalized data hash, provider provenance, model assumptions, entry/exit counts, agent metrics, and new same-window benchmark metrics; launch verifies same recipe hash and stored history hash.
- Persisted paper decisions, full hook/model context, PAPER orders, modeled positions, and account balances in one transaction. Each tick locks the owner-scoped agent row, rechecks lifecycle status, loads current account/position state, evaluates the deterministic engine, and writes the ledger atomically. Same-tick retries return the original record; a new tick earlier than the latest persisted decision returns `409 CONFLICT`.
- Connected minimal screens at `/agents`, `/agents/{agentId}`, `/market`, `/lab`, `/forge`, `/hooks`, and `/tape`.
- Public read-only capability endpoints with truthful hook/template/live-execution statuses. Public agent/Tape lists remain empty because no visibility model exists.
- Live execution remains disabled (`LIVE_TRADING_ENABLED=false`, `V4_CLAIM_LEVEL=L0`); no transaction/order submission route exists.

## Source-backed data and model limits

The deterministic test capture is `tests/fixtures/aapl-crius-hourly-capture.json`, captured `2026-11-12T08:10:04.500Z`. It contains 1,500 Crius hourly bars; after dropping the active/incomplete bucket, 1,499 closed, nonempty bars remain from `2026-09-10T21:00:00.000Z` through `2026-11-12T08:00:00.000Z`. This proves only this AAPL window, not coverage for every current market or future fetch.

Crius candles are Robinhood Chain token DEX prices, not traditional-equity exchange candles or options prices. Token prices are converted to share-equivalent values using the current share-per-token multiplier only after mapping and corporate-action continuity checks. The AAPL capture uses token `0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9` and multiplier `1.001090616965388660`. Missing actions/mapping, unresolved actions in-window, multiplier instability, incomplete candles, and hourly gaps block the replay. Source references: [Crius OHLCV guide](https://docs.crius.sh/guides/get-ohlcv-candles/), [Robinhood Stock Token APIs](https://docs.robinhood.com/chain/stock-token-apis/), and [Robinhood Stock Tokens](https://docs.robinhood.com/chain/stock-tokens/).

Premium assumptions: European put; annualized standard deviation of 720 hourly log returns × 1.1; 8,760 annualization hours; zero risk-free rate and dividend yield; 30 calendar-day tenor; $0.01 theoretical strike increment; one model unit equals one underlying share (not a listed contract multiplier); 50 bp slippage; venue fees excluded. No historical option quotes/IV, venue contract availability, or fee schedule is present. These values are simulation assumptions, not market facts.

The captured current quote is outside regular US trading hours. It is used in the integration test to verify the blocked live-quote path, not to produce the successful paper order. The successful integration order comes from a specific in-session closed candle in the captured provider history.

### Backtest comparisons

New completed `BacktestRun.metrics` include optional `benchmarks` from `BacktestBenchmarksSchema` in `lib/domain/contracts.ts`; the exact response shape is in `docs/api-contracts.md`. Benchmark provenance is on the parent `BacktestRun`: `dataSource`, `historyDataHash`, `historyProvenance`, and `pricingAssumptions`. The buy-and-hold return invests the initial capital at the first decision candle's verified share-normalized close and values it at the final decision close across the same 720 decision samples; it is price-only and excludes dividends, fees, and slippage. Cash is a flat USD accounting balance with zero yield. No USDG/USD price path is present, so `vsCashPct` is **not** an observed USDG market return. Older persisted metrics may omit `benchmarks`; consumers must show unavailable in that case. Invalid or nonpositive benchmark endpoint closes fail the run with null metrics and keep launch blocked. `components/app/lab/BenchmarkComparison.tsx` reads this server field and shows an unavailable state for legacy rows; current browser cases cover both response states, using API fixtures. See `docs/ui-integration-requests.md`.

## Application routes and shared UI contracts

| Route | Purpose and behavior |
|---|---|
| `/` | Public marketing landing page. It uses public capability data and an explicitly illustrative decision story; see `docs/agent-graph-data-contract.md`. |
| `/agents` | Wallet-owned agent list; one Protective Put paper-ready template; three Preview templates; signed-in form creates a Protective Put draft using virtual share/capital inputs and market API symbols. |
| `/agents/{agentId}` | Owner recipe/status detail, persisted position/Tape summary, lifecycle controls, and manual paper tick for a running agent. |
| `/market` | Current read-only quote with source, timestamp, price units, multiplier, halt/stale state. |
| `/lab` | Source-backed candle coverage, backtest creation, modeled assumptions/metrics and launch for the selected draft. |
| `/forge` | Generic RecipeV1 builder. Unsupported compositions fail server validation; only the approved Protective Put composition is launchable. AI composition is not configured. |
| `/hooks` | PM stage catalog with implemented/catalog-only status and parameter details. |
| `/tape?agentId={id}` | Owner-scoped decisions, orders, and positions. |
| `/verify` | Public verification screen sourced from `/api/public/v1/verify`. |

Use Zod-inferred types from `lib/domain/contracts.ts`: `Session`, `AuthenticatedWalletUser`, `ApiError`, `MarketAsset`, `MarketList`, `MarketSnapshot`, `MarketCandle`, `MarketHistoryCoverage`, `HookDefinition`, `HookCatalogResponse`, `HookResult`, `RecipeV1`, `RecipeValidationResult`, `Agent`, `AgentDetail`, `AgentListResponse`, `AgentDecision`, `PaperOrder`, `PaperPosition`, `PaperTickResponse`, `TapeResponse`, `PaperPositionsResponse`, `BacktestCoverage`, `BacktestRun`, `BacktestMetrics`, `BacktestBenchmarks`, `HouseAgentTemplate`, `HouseAgentTemplateCatalogResponse`, `PublicAgentsResponse`, `PublicTapeResponse`, `PublicClaim`, and `PublicVerification`. Timestamps are ISO strings; decimal amounts are strings. API errors use `{ error: { code, message, retryable, details? } }`.

Preserve loading, signed-out, error, empty, stale, halted, insufficient-history, model-limited, blocked, and acknowledged-success states. Do not add demo values or substitute mock data into user-facing market/history/order/performance screens.

## API endpoint contracts

### Authentication

| Endpoint | Contract |
|---|---|
| `POST /api/auth/challenge` | `{ address }` → `{ nonce, message, expiresAt }`; origin/address-bound and five-minute expiry. |
| `POST /api/auth/verify` | `{ address, nonce, signature }` → `Session` plus `optra_session` cookie. Login signature does not authorize a transaction. |
| `GET /api/me` | Current `Session`; missing/expired/revoked returns 401. |
| `POST /api/auth/logout` | Revokes session and expires cookie; 204. |

### Markets, hooks, templates

| Endpoint | Contract |
|---|---|
| `GET /api/markets` | `{ markets: MarketAsset[] }` from current active Robinhood Chain registry. |
| `GET /api/markets/{symbol}` | `MarketSnapshot`; timestamped underlying/token quotes and multiplier, no inferred option premium. |
| `GET /api/hooks` | `HookCatalogResponse`; 36 PM rows, 15 deterministic evaluator paths, 21 catalog-only. |
| `POST /api/recipes/validate` | `RecipeV1` → `{ valid, recipeHash, issues }`; non-persisting. |
| `GET /api/agents/templates` | `HouseAgentTemplateCatalogResponse`; Protective Put paper-ready, three templates preview. |

### Agents, backtest, paper, Tape

| Endpoint | Contract |
|---|---|
| `GET /api/agents` | Session required; `{ agents: Agent[] }` for current owner. |
| `POST /api/agents`, `POST /api/recipes` | Session required; `{ recipe: RecipeV1 }`; strict validation creates only supported drafts. |
| `GET /api/agents/{id}` | Session + owner; `AgentDetail`; cross-owner/missing IDs return 404. |
| `POST /api/agents/{id}/lifecycle` | Session + owner; `{ action: "pause" | "resume" | "stop" }`; resume requires matching attached complete run. |
| `POST /api/agents/{id}/fork` | Session + owner; `{}` or `{ name }`; new draft carries no Tape, orders, positions, or backtest. |
| `GET /api/backtests/coverage?symbol={symbol}` | `BacktestCoverage`; runtime source-backed history and 1,441-candle gate. |
| `POST /api/backtests` | Session; `{ recipe }` → persisted `BacktestRun` with metrics only if complete and at least one modeled entry exists. New completed metrics include optional `benchmarks`; old JSONB rows remain valid without them. |
| `POST /api/agents/{id}/launch` | Session + owner; `{ backtestRunId }`; requires complete matching recipe/hash, verified stored history, provenance, assumptions, >=720 samples, >=1 entry and metrics. |
| `POST /api/agents/{id}/tick` | Session + owner; requires `Idempotency-Key`, running agent, server quote/history. Returns `PaperTickResponse`. Per-agent execution is serialized with the latest state read and deterministic evaluation inside the persistence transaction. A new tick earlier than the latest decision returns `409 CONFLICT`. |
| `POST /api/agents/{id}/tick?asOf={exactCandleEndAt}` | Historical paper replay of an exact closed provider candle with 721 preceding bars. Idempotency key remains required; timestamp determines replay ID. Existing tick retries return the original decision; an older new replay conflicts instead of rewinding account state. |
| `GET /api/agents/{id}/tape` | Session + owner; `TapeResponse` with newest decisions and persisted paper orders. |
| `GET /api/agents/{id}/positions` | Session + owner; `PaperPositionsResponse`. |

### Public proof

`GET /api/public/v1/hooks`, `/templates`, `/agents`, `/tape`, and `/verify` are read-only. Public agents and Tape remain empty. Verification reports the current catalog/evaluator counts, one paper-ready template, `V4` L0, and live execution disabled. Full payloads/statuses are in `docs/api-contracts.md`.

For the progressive public Agent Intelligence Graph, use [the graph data contract](agent-graph-data-contract.md). Existing public template/hook/Tape sources plus `PAPER_PROTECTIVE_PUT_HOOK_IDS` are sufficient; no new endpoint is required. The graph root is the Protective Put template, public Tape has no records, and public evaluation outcomes do not exist. Keep authored rule stories labeled `Illustrative only`; never read private wallet sessions, user strategies, owner Tape, positions, or agent instances into the landing graph.

## Authentication, database, and environment

- Wallet login uses EVM chain ID `4663`, a one-use five-minute origin-bound challenge, server-side signature recovery, and a random opaque token whose SHA-256 hash is stored server-side.
- Cookie: `optra_session`, `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` in production, seven-day lifetime. `/api/me` is the UI session source. Owner ID comes only from the session.
- Local development uses PGlite at `.local/optra-db`, configurable with `PGLITE_DATA_DIR`.
- Production requires PostgreSQL through `DATABASE_URL` and origin configuration through `APP_BASE_URL`. Apply Drizzle migrations with `bun run db:migrate`; current recovery schema migration is `drizzle/0003_numerous_annihilus.sql`.
- `CRON_SECRET` and `MARKET_HISTORY_SYMBOLS` apply to the separate quote snapshot collector; there is no external scheduler. Crius historical candles are read by the backtest/tick runtime directly.
- Keep `.env.example` safety settings `LIVE_TRADING_ENABLED=false` and `V4_CLAIM_LEVEL=L0`.

## Verification results

Verified in this workspace on 2026-11-12:

- `bun run test` — 29 files / 89 tests passed.
- `bun run test:e2e` — 11 Playwright tests passed.
- `bun run typecheck` — passed.
- `bun run lint` — passed with no findings.
- `bun run build` — passed; Next.js generated 13 static pages and compiled the API routes.
- `bun run test -- tests/integration/paper-flow.test.ts` — passed against temporary PGlite and the captured provider fixture; verifies wallet auth, backtest, launch, blocked session tick, one successful PAPER order/position, account reconciliation, Tape, idempotency, and cross-owner 404.
- `bun run test -- tests/backtest/run.test.ts` — passed; verifies 1,499 source candles, the 1,441 requirement, action-window blocking, successful modeled replay, and zero-entry/no-metrics path.
- `bun run db:generate` — migration generation completed for the current schema.

Browser Playwright cannot exercise the real extension signature prompt without an installed wallet extension. The integration test signs a genuine EVM challenge using a test account. E2E mocks only UI-level auth/market responses where required; the full paper order/performance path is verified with the captured source fixture in the database integration test.

Continuation verification on 2026-11-12: `bun run test -- tests/backtest` passed 5 files / 17 tests; `bun run test -- tests/integration/paper-flow.test.ts` passed 1 test and asserts benchmark metadata survives the API response and persisted JSONB row; `bun run test -- tests/domain/contracts.test.ts` passed 1 file / 6 tests and confirms old metrics remain valid. The paper-race audit first reproduced concurrent distinct ticks returning `[200, 500]` and a backdated new tick returning `200`; after the fix, the focused backend suite passed 31 files / 103 tests, including serialized concurrent ticks, a 409 backdated-tick conflict, same-tick idempotency, owner denial, and closed-session behavior. `bunx tsc --noEmit --incremental false` and `bun run lint` passed. Full E2E and production build remain unverified after the concurrent frontend work. The browser attempt against an active dev server did not hydrate or issue API calls. Follow the coordination and port restrictions in `docs/nov13-nov14-completion-report.md` before final QA.

## Claude Code file ownership

Claude Code may redesign presentation in `app/(app)/**/*.tsx`, `components/app/**`, `app/globals.css`, and `docs/landing-content-contract.md`, while preserving route paths, contracts, provenance, and safety states. Do not begin by adding mock metrics or changing data claims.

Claude Code must not modify these backend/safety/evidence modules during the premium UI pass:

- `app/api/**`
- `db/**`, `drizzle/**`, `lib/db/**`, `scripts/migrate.ts`
- `lib/auth/**`, `lib/chain/**`, `lib/domain/contracts.ts`
- `lib/market/**`, `lib/hooks/**`, `lib/engine/**`, `lib/options/**`, `lib/paper/**`, `lib/backtest/**`, `lib/public/**`
- `tests/**`
- `.env.example`, `next.config.ts`, `package.json`, `bun.lock`
- `docs/api-contracts.md`, `docs/execution-ledger.md`, `docs/tasks/optra-fullstack-progress.md`, `docs/final-core-handoff.md`, and this UI contract

If the visual work requires a backend field or route, record a separate backend contract request instead of changing protected code or adding UI-side values. See `docs/ui-handoff-contract.md` for the screen-level contracts.

See `docs/nov13-nov14-completion-report.md` for the remaining Nov 13 integration work and Nov 14 final QA checklist.
