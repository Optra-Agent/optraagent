# Optra Core API Contracts

Runtime schemas are defined in `lib/domain/contracts.ts`. Import the inferred TypeScript types rather than duplicating response shapes. Timestamps are ISO-8601 UTC strings; money, quantities, premiums, and prices are decimal strings. Error bodies use `{ error: { code, message, retryable, details? } }`. Responses are `no-store` unless noted otherwise.

## Shared TypeScript interfaces

Use the Zod-inferred contracts: `AuthenticatedWalletUser`, `Session`, `ApiError`, `MarketAsset`, `MarketList`, `MarketSnapshot`, `MarketCandle`, `MarketHistoryCoverage`, `HookDefinition`, `HookCatalogResponse`, `HookResult`, `RecipeV1`, `RecipeValidationResult`, `Agent`, `AgentDetail`, `AgentListResponse`, `AgentDecision`, `PaperOrder`, `PaperPosition`, `PaperTickResponse`, `TapeResponse`, `PaperPositionsResponse`, `BacktestCoverage`, `BacktestRun`, `BacktestMetrics`, `BacktestBenchmarks`, `HouseAgentTemplate`, `HouseAgentTemplateCatalogResponse`, `PublicAgentsResponse`, `PublicTapeResponse`, `PublicClaim`, and `PublicVerification`.

Important discriminators:

- Every paper execution response is labeled `executionMode: "PAPER"`.
- Paper orders and positions use `instrumentType: "modeled_option"`, `optionType: "put"`, `modelName: "black_scholes_european_put"`, and `premiumSource: "modeled"`.
- Hook availability is `implemented` or `catalog_only`. Hook results retain the core `pass|block|select|size|action|noop|error` trace statuses (the shared schema also accepts legacy `skip`).
- `BacktestRun.metrics` is null unless actual verified source history produces at least one modeled entry. New completed runs include same-window benchmark fields; older persisted metrics may omit them.

## Wallet authentication

| Method and path | Access | Contract |
|---|---|---|
| `POST /api/auth/challenge` | Public, same-origin | `{ address }` → `{ nonce, message, expiresAt }`; challenge is origin/address-bound and expires in five minutes. |
| `POST /api/auth/verify` | Public, same-origin | `{ address, nonce, signature }` → `Session`; consumes the nonce once, recovers signer server-side, and sets the `optra_session` cookie. |
| `GET /api/me` | Session | Returns `{ user: { id, address }, expiresAt }`; absent/expired/revoked session is `401 UNAUTHORIZED`. |
| `POST /api/auth/logout` | Session optional | Revokes the session and clears the cookie; returns 204. |

The wallet login signature is not a transaction authorization. Cookie authentication uses `HttpOnly`, `SameSite=Lax`, `Path=/`, production `Secure`, and a seven-day lifetime. Owner identity is always read from the validated session; request-supplied owner IDs have no authority.

## Read-only market and hook APIs

| Method and path | Access | Contract |
|---|---|---|
| `GET /api/markets` | Public | `{ markets: MarketAsset[] }` for current active Robinhood Chain assets. |
| `GET /api/markets/{symbol}` | Public | A timestamped `MarketSnapshot` with underlying bid/ask, stock-token quote, multiplier, stale/halt status, and source. It is a read-only spot quote, not an option premium. |
| `GET /api/hooks` | Public | `HookCatalogResponse`: 36 PM entries and expected stage counts `10/7/4/7/3/5`; 15 entries have deterministic evaluator paths and 21 remain `catalog_only`. |
| `POST /api/recipes/validate` | Public, no persistence | Accepts `RecipeV1` and returns `{ valid, recipeHash, issues }`. Protective Put is the only currently executable recipe; other templates/compositions fail closed. |
| `GET /api/agents/templates` | Public | `HouseAgentTemplateCatalogResponse`: Protective Put is `paper_ready`; Covered Call, Cash-Secured Put, and Earnings Straddle are `preview`. |

## History, backtest, and launch

The runtime historical adapter uses Crius Robinhood Chain hourly token OHLCV, not `/api/markets` spot quotes. It requests `fill=false` and `continuous=false`, drops incomplete bars, verifies token mapping/current multiplier and corporate-action continuity, and converts token prices into share-equivalent prices only when that conversion is justified. Coverage is per symbol and returned data; no missing bars are synthesized.

| Method and path | Access | Contract |
|---|---|---|
| `GET /api/backtests/coverage?symbol={symbol}` | Public, read-only | `BacktestCoverage` with available/required candle counts, consecutive hours, window, source and blocking reason. A complete run needs 1,441 consecutive closed candles: 721 warmup candles plus 720 decision candles. |
| `POST /api/backtests` | Session | `{ recipe: RecipeV1 }` → persisted owner-scoped `BacktestRun`. It runs the same deterministic `runTick` evaluator as a paper tick. Insufficient history returns `insufficient_data` and null metrics. A complete window with no modeled entry is `failed` and has null metrics. |
| `POST /api/agents/{agentId}/launch` | Session + owner | `{ backtestRunId }`; launches only a draft agent whose recipe hash matches a complete run with >=720 decisions, >=1 entry, source/history hash, provenance, pricing assumptions, and metrics. A missing/invalid proof returns a blocked response. |

The persisted backtest retains its exact normalized candle snapshot, SHA-256 history hash (excluding local `receivedAt`), provider provenance, corporate-action dates, pricing assumptions, and entry/exit counts. A launch verifies the stored snapshot against the hash before changing agent status.

`BacktestMetrics.benchmarks` is optional for backwards compatibility with historical JSONB rows. New completed runs include:

```ts
type BacktestBenchmarks = {
  window: { startAt: string; endAt: string; decisionSamples: number };
  underlying: {
    symbol: string;
    startingValueUsd: string;
    endingValueUsd: string;
    returnPct: string;
    method: "buy_and_hold_price_only";
    dividendsIncluded: false;
    feesIncluded: false;
  };
  cash: {
    startingValueUsd: string;
    endingValueUsd: string;
    returnPct: string;
    denomination: "USD";
    method: "flat_no_yield";
    usdGPricePath: "not_modeled";
  };
  vsHoldingPct: string;
  vsCashPct: string;
}
```

Both comparisons use the exact 720 decision candles after the 721-candle warmup. Buy-and-hold invests the initial capital at the first decision candle's verified share-normalized close and values it at the last decision close; it is price-only, with no dividends, fees, or slippage. Cash holds the same initial USD amount flat with zero yield. `vsCashPct` therefore compares the agent with a USD accounting baseline; it is **not** a measured USDG return because no USDG/USD price path is modeled. The benchmark is omitted when decision-window endpoint closes are non-finite or nonpositive; such a run fails closed with null metrics and cannot launch. Do not calculate missing benchmark values in the client. No database migration is needed because metrics are already stored as JSONB; existing rows remain valid without `benchmarks`.

## Agents and paper execution

| Method and path | Access | Contract |
|---|---|---|
| `GET /api/agents` | Session | `{ agents: Agent[] }` for the current owner; recipe bodies are not included in summaries. |
| `POST /api/agents`, `POST /api/recipes` | Session | `{ recipe: RecipeV1 }`; creates a draft only after strict PM recipe/hook validation. |
| `GET /api/agents/{agentId}` | Session + owner | `AgentDetail`, including the immutable recipe; missing and cross-owner IDs both return 404. |
| `POST /api/agents/{agentId}/lifecycle` | Session + owner | `{ action: "pause" | "resume" | "stop" }`; resume requires the attached matching complete backtest. |
| `POST /api/agents/{agentId}/fork` | Session + owner | `{}` or `{ name }`; creates a separate draft without copied backtest, Tape, orders, or positions. |
| `POST /api/agents/{agentId}/tick` | Session + owner | Requires `Idempotency-Key` and a running agent. Normal ticks fetch current quote and verified history. Returns `PaperTickResponse` with persisted decision, order count, PAPER label, and duplicate flag. |
| `POST /api/agents/{agentId}/tick?asOf={closedCandleEndAt}` | Session + owner | Deterministic historical paper replay at an exact provider candle end time; requires 721 preceding candles. The canonical timestamp is the replay tick ID, so retries do not create duplicate fills. The `Idempotency-Key` header is still required. |
| `GET /api/agents/{agentId}/tape` | Session + owner | `TapeResponse` with newest persisted decisions and associated paper orders (up to the requested limit, maximum 200). |
| `GET /api/agents/{agentId}/positions` | Session + owner | `PaperPositionsResponse` with persisted modeled option positions. |

Paper ticks persist the decision, full hook trace and model/history context, order(s), position mutation, and paper account cash/realized/peak state atomically. The unique `(agentId,tickId)` decision key plus per-tick order sequence provides idempotency. No API submits a wallet transaction.

## Public proof APIs

These are read-only and do not reveal owner records:

| Method and path | Response |
|---|---|
| `GET /api/public/v1/hooks` | The current `HookCatalogResponse`. |
| `GET /api/public/v1/templates` | The current `HouseAgentTemplateCatalogResponse`. |
| `GET /api/public/v1/agents` | `{ agents: [] }` until public visibility exists. |
| `GET /api/public/v1/tape` | `{ decisions: [], orders: [], executionMode: "PAPER" }` until public visibility exists. |
| `GET /api/public/v1/verify` | `PublicVerification` with server-generated claim rows, `v4ClaimLevel: "L0"`, and `liveTradingEnabled: false`. It reports 36 cataloged hook entries, 15 evaluator paths, 21 catalog-only entries, one paper-ready template, and modeled backtest limitations. |

## Collector and environment

`POST /api/cron/market-snapshots` is a separate bearer-protected collector for configured quote snapshots. It does not create historical Crius candles or option prices; no external scheduler is configured. Historical backtest/tick routes fetch the Crius candle feed directly.

Production requires `DATABASE_URL` for PostgreSQL and `APP_BASE_URL` for origin-bound wallet challenges. Local development uses PGlite under `.local/optra-db` (configurable with `PGLITE_DATA_DIR`). Apply migrations with `bun run db:migrate`. Keep `LIVE_TRADING_ENABLED=false` and `V4_CLAIM_LEVEL=L0`.

## Error codes

`UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_ERROR`, `DATA_MISSING`, `STALE_MARKET_DATA`, `UNSUPPORTED_HOOK`, `BACKTEST_REQUIRED`, `CONFLICT`, `UPSTREAM_UNAVAILABLE`, `RATE_LIMITED`, `INTERNAL_ERROR`.
