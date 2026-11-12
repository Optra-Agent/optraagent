# Claude Code UI Handoff Contract

The backend core now supports one complete paper-only House Agent workflow: Protective Put. This contract is the boundary for the later premium UI phase. Keep this one Next.js application, preserve the route/API semantics below, and do not add fictional financial values or live trading controls.

## Capability status to show accurately

- 36 PM hook entries are cataloged in the PM stage groups `10/7/4/7/3/5`.
- 15 entries have deterministic evaluator paths; 21 remain `catalog_only` and must not be presented as executable.
- Protective Put is the only `paper_ready` House Agent. Covered Call, Cash-Secured Put, and Earnings Straddle remain `preview`.
- The runtime needs 1,441 consecutive closed hourly candles (721 warmup plus 720 decisions); check coverage for the selected symbol at run time.
- Black–Scholes premiums are `modeled`, use RV30 × 1.1, one-share model units, 50 bp slippage, and exclude venue fees. There is no historical option chain/IV, listed contract guarantee, or real fill.
- Live execution stays disabled (`LIVE_TRADING_ENABLED=false`, `V4_CLAIM_LEVEL=L0`).

## Application routes and required states

| Route | Connected behavior | States the UI must preserve |
|---|---|---|
| `/` | Redirects to `/agents`. | Keep route behavior. |
| `/agents` | Lists session owner's agents; loads template catalog; signed-in Protective Put form reads `/api/markets` and creates a draft through `/api/agents`. Reference shares are virtual simulation inputs. | Session loading/error/signed-out; list loading/error/empty; market loading/error; create pending/error/success; one paper-ready template and three previews. |
| `/agents/{agentId}` | Loads owner detail, recipe, Tape, positions; pause/resume/stop/fork; paper tick for running agent. | Loading/not-found/forbidden; lifecycle acknowledgement; tick pending/error/skip/open/hold/close; modeled position and order labels. |
| `/market` | Current Robinhood Chain quote. | Source/time/unit/multiplier; current, stale, halted, and unavailable; never label quote as option premium. |
| `/lab` | Reads actual historical coverage; creates/persists backtest; launches matching draft after complete proof. | Coverage loading/error/block/ready; insufficient or invalid data; no metrics when run is incomplete or no entry occurs; model assumptions; launch pending/blocked/acknowledged. |
| `/forge` | Generic RecipeV1 editor; validates through `/api/recipes/validate`, saves through `/api/recipes` only if valid. | Catalog-only hooks disabled, unsupported recipes blocked, canonical hash and errors, save disabled until valid; AI composition stays Planned. |
| `/hooks` | Loads the PM catalog and shows stage filters/parameters. | 36 catalog entries; `implemented` versus `catalog_only`; unavailable reasons and loading/error states. Filtering cannot change capability status. |
| `/tape?agentId={id}` | Owner-scoped persisted decisions, orders, and positions. | Session error, not-found, empty state, PAPER label, hook trace/context, modeled premium and fill assumptions. |
| `/verify` | Not implemented as a page; server claim payload is `/api/public/v1/verify`. | If designed later, render only server-returned claims and evidence links. |

The backend has no public visibility model. `/api/public/v1/agents` and `/api/public/v1/tape` return empty data; do not infer public access from user ownership.

## Shared TypeScript contracts

Canonical Zod schemas and inferred types are in `lib/domain/contracts.ts`. Reuse `Session`, `AuthenticatedWalletUser`, `ApiError`, `MarketAsset`, `MarketList`, `MarketSnapshot`, `MarketCandle`, `MarketHistoryCoverage`, `HookDefinition`, `HookCatalogResponse`, `HookResult`, `RecipeV1`, `RecipeValidationResult`, `Agent`, `AgentDetail`, `AgentListResponse`, `AgentDecision`, `PaperOrder`, `PaperPosition`, `PaperTickResponse`, `TapeResponse`, `PaperPositionsResponse`, `BacktestCoverage`, `BacktestRun`, `BacktestMetrics`, `HouseAgentTemplate`, `HouseAgentTemplateCatalogResponse`, `PublicAgentsResponse`, `PublicTapeResponse`, `PublicClaim`, and `PublicVerification`.

Timestamps are ISO UTC strings. Decimal money and quantities are strings. API errors are `{ error: { code, message, retryable, details? } }`. For paper orders/positions, show `instrumentType: modeled_option`, `modelName: black_scholes_european_put`, `premiumSource: modeled`, and `executionMode: PAPER` as applicable.

## API endpoint map

### Wallet

- `POST /api/auth/challenge` — `{ address }` → one-use `{ nonce, message, expiresAt }`.
- `POST /api/auth/verify` — `{ address, nonce, signature }` → `Session` and `optra_session` cookie. Signature is login proof only, not transaction approval.
- `GET /api/me` — current session or 401.
- `POST /api/auth/logout` — revoke session and clear cookie.

### Markets and capabilities

- `GET /api/markets` → `{ markets: MarketAsset[] }`.
- `GET /api/markets/{symbol}` → timestamped `MarketSnapshot` with underlying and token quote units, multiplier, stale/halt flags.
- `GET /api/hooks` → `HookCatalogResponse` (36 entries; 15 evaluator paths; 21 catalog-only).
- `POST /api/recipes/validate` — `RecipeV1` → `{ valid, recipeHash, issues }`, no persistence.
- `GET /api/agents/templates` → `HouseAgentTemplateCatalogResponse` (one ready, three Preview).

### Agent, backtest, and paper

- `GET /api/agents` → current owner's `{ agents: Agent[] }`.
- `POST /api/agents` or `POST /api/recipes` — `{ recipe }`, authenticated; creates supported draft only.
- `GET /api/agents/{id}` → owner-scoped `AgentDetail`.
- `POST /api/agents/{id}/lifecycle` — `{ action: pause | resume | stop }`; resume requires the attached matching backtest.
- `POST /api/agents/{id}/fork` — `{}` or `{ name }`; new draft has no copied paper state.
- `GET /api/backtests/coverage?symbol={symbol}` → source-backed `BacktestCoverage`, 1,441-candle requirement and blocking reason.
- `POST /api/backtests` — `{ recipe }`, authenticated; persisted `BacktestRun`. Same `runTick` engine as paper execution.
- `POST /api/agents/{id}/launch` — `{ backtestRunId }`; requires complete matching recipe/data proof, >=720 decisions, >=1 entry, and metrics.
- `POST /api/agents/{id}/tick` — requires `Idempotency-Key`; server market/history; running owned agent only. Returns `PaperTickResponse`.
- `POST /api/agents/{id}/tick?asOf={exactClosedCandleEndAt}` — reproducible exact historical paper replay; 721 prior bars required; canonical timestamp is idempotency identity.
- `GET /api/agents/{id}/tape` → `TapeResponse`, decisions plus associated PAPER orders.
- `GET /api/agents/{id}/positions` → `PaperPositionsResponse`.

Private requests use same-origin cookies with `credentials: "include"`; owner identity comes from session state on the server. Cross-owner and missing IDs return 404. Decision and order persistence is idempotent by agent/tick/order sequence.

### Public read-only proof

- `GET /api/public/v1/hooks`
- `GET /api/public/v1/templates`
- `GET /api/public/v1/agents` → empty list
- `GET /api/public/v1/tape` → empty decisions/orders
- `GET /api/public/v1/verify` → claims, `v4ClaimLevel: L0`, `liveTradingEnabled: false`

## Authentication and sessions

Wallet chain ID is `4663`. Server verifies an origin/address-bound five-minute, one-use challenge. The server stores only a SHA-256 hash of the random session token. Cookie `optra_session` is `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` in production, and lasts seven days. `/api/me` is the UI session source. The UI clears session state when wallet/network changes and revokes on logout. No owner ID supplied by the client is trusted.

The browser tests do not have a wallet extension. The signed challenge/session path is exercised by the integration test using a real EVM test key.

## Database and environment

- Local: PGlite at `.local/optra-db`, configurable with `PGLITE_DATA_DIR`.
- Production: PostgreSQL via `DATABASE_URL`; `APP_BASE_URL` required for origin-bound challenges.
- Apply schema changes with `bun run db:migrate`; current recovery migration is `drizzle/0003_numerous_annihilus.sql`.
- `CRON_SECRET` and `MARKET_HISTORY_SYMBOLS` configure only the separate quote snapshot collector. No scheduler is configured. Backtest/tick history uses Crius directly.
- Preserve `LIVE_TRADING_ENABLED=false` and `V4_CLAIM_LEVEL=L0`.

## File ownership boundary

Claude Code owns premium presentation only. It may modify `app/(app)/**/*.tsx`, `components/app/**`, `app/globals.css`, and `docs/landing-content-contract.md`, while keeping route paths, accessible behavior, data provenance, and model/safety claims intact.

Claude Code must not modify:

- `app/api/**`
- `db/**`, `drizzle/**`, `lib/db/**`, `scripts/migrate.ts`
- `lib/auth/**`, `lib/chain/**`, `lib/domain/contracts.ts`
- `lib/market/**`, `lib/hooks/**`, `lib/engine/**`, `lib/options/**`, `lib/paper/**`, `lib/backtest/**`, `lib/public/**`
- `tests/**`, `.env.example`, `next.config.ts`, `package.json`, `bun.lock`
- `docs/api-contracts.md`, `docs/execution-ledger.md`, `docs/tasks/optra-fullstack-progress.md`, `docs/final-core-handoff.md`, and this contract

If the UI needs a backend field or behavior, record the request for backend review. Do not invent response fields or add screen-side performance/order data.

## Verification snapshot

Verified 2026-11-12: `bun run test` — 29 files/89 tests passed; `bun run test:e2e` — 11 passed; `bun run typecheck`, `bun run lint`, and `bun run build` passed. The fixture-backed integration test verifies the complete authenticated backtest-to-paper-order/Tape workflow and a blocked off-session path. See `docs/tasks/optra-fullstack-progress.md` for the full matrix and `docs/execution-ledger.md` for decisions/limitations.
