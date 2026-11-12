# Optra Paper Core Implementation Plan

> **Historical initial plan — superseded by recovery.** The original PM brief and verified Crius AAPL history are now available, and the Protective Put paper path is implemented. Earlier checkboxes and source-gap notes below record the first execution phase; they are not the current task queue. Use `docs/OPTRA_CODEX_CORE_RECOVERY.md`, `docs/tasks/optra-fullstack-progress.md`, and `docs/final-core-handoff.md` for current scope/status.

> **For agentic workers:** Execute this plan task by task in this workspace. Write each behavior test first and verify its failure before implementation.

**Goal:** Build a verified Next.js paper-trading core with wallet sessions, real read-only market snapshots, deterministic rules, persisted paper state and Tape, honest backtest gating, and a UI contract for Claude Code.

**Architecture:** One Next.js App Router application serves pages, API routes, and the paper worker endpoint. Zod schemas define API and domain types; pure rule evaluation is shared by the Lab and paper execution. Drizzle persists owner-scoped records to PostgreSQL, with an embedded PostgreSQL-compatible local/test store when `DATABASE_URL` is absent outside production.

**Tech Stack:** Node 26 / Bun 1.3, Next.js 16, React, TypeScript strict, Tailwind CSS 4, wagmi + viem, Zod, PostgreSQL + Drizzle, Vitest, and Playwright where a browser is available.

**Spec:** `docs/OPTRA_CODEX_FULLSTACK_CORE_EXECUTION.md`, `docs/OPTRA_MASTER_EXECUTION_BRIEF_V2.md`, and `docs/OPTRA_00_DISCOVERY_PROMPT_V2.md`.

## Global Constraints

- Keep one Next.js repository and one lockfile; this supplied workspace has no existing application or `.git` directory.
- Preserve wallet-only MVP auth; do not add email, Google, Privy, live transactions, approvals, transfers, contract deployment, x402, or custody delegation.
- `LIVE_TRADING_ENABLED=false`; `V4_CLAIM_LEVEL=L0`; every executable transaction shown to a user must be labeled `PAPER`.
- Use Robinhood's documented read-only `/rhj/assets` and `/rhj/prices/{symbol}` endpoints; preserve raw underlying quote units and the corporate-action multiplier separately.
- Do not invent backtest samples, option premiums, PM hook names, fills, returns, or wallet balances. Insufficient history blocks launch.
- Keep all private data scoped by the authenticated owner on the server. Never accept `ownerId` from request JSON.
- Keep screens functional and plain; Claude Code owns premium UI styling after handoff.
- No commit, push, deployment, or live financial write is part of this plan.

## Review Focus

1. Expired, replayed, malformed, or wrong-origin wallet challenges never create sessions; test each rejection path.
2. A caller cannot read or mutate another owner's agent, recipe, backtest, position, or Tape; test cross-owner reads and writes.
3. Invalid or stale Robinhood quotes cannot be normalized into a usable entry snapshot; test missing, zero, malformed, halted, and stale quotes.
4. Duplicate `(agentId, tickId)` requests never create duplicate orders, positions, or decisions; test concurrent/repeated processing.
5. A backtest with less than 720 valid hourly samples or a mismatched recipe hash never unlocks paper launch; test both gates.

---

### Task 1: Next.js foundation, contracts, wallet session, and `/agents`

**Files:** `package.json`, `bun.lock`, `app/**`, `db/**`, `lib/auth/**`, `lib/domain/**`, `components/app/**`, `tests/auth/**`, `docs/phase-00-discovery.md`, `docs/adr/0001-core-stack.md`.

**Interfaces:** Produces inferred Zod types for `AuthenticatedWalletUser`, `Session`, `ApiError`, `MarketSnapshot`, `RecipeV1`, `HookDefinition`, `HookResult`, `Agent`, `AgentDecision`, `PaperPosition`, `PaperOrder`, and `BacktestRun`; auth API is `POST /api/auth/challenge`, `POST /api/auth/verify`, `POST /api/auth/logout`, and `GET /api/me`.

- [ ] Write tests `challenge_is_bound_to_origin_and_expires`, `verify_rejects_expired_or_replayed_nonce`, `verify_accepts_valid_signature_once`, `me_rejects_missing_session`, and `owner_from_session_ignores_request_body`.
- [ ] Run `bun run test -- tests/auth` and confirm expected failures before implementation.
- [ ] Implement normalized wallet challenge, signature recovery with viem, one-time nonce consumption, hashed opaque session cookie, and owner context from session.
- [ ] Connect MetaMask and Phantom EVM through wagmi EIP-1193 connectors; never call transaction or approval methods.
- [ ] Run auth tests, `bun run typecheck`, and `bun run lint`; record exact results.

### Task 2: Robinhood read-only market API and UI

**Files:** `lib/market/**`, `app/api/markets/**`, `app/(app)/market/**`, `components/app/market/**`, `tests/market/**`.

**Interfaces:** `GET /api/markets` lists current supported symbols; `GET /api/markets/[symbol]` returns one `MarketSnapshot` or a discriminated unavailable/stale error. The adapter returns official source, raw bid/ask, multiplier, token-equivalent bid/ask, and provider timestamp.

- [ ] Write tests `normalizes_official_quote_and_multiplier`, `rejects_zero_or_invalid_quote`, `marks_stale_quote_unavailable`, and `rejects_symbols_not_in_robinhood_asset_registry`.
- [ ] Run the market test file and verify it fails because the adapter/schema is absent.
- [ ] Implement the Robinhood HTTP adapter with timeouts, schema parsing, no fabricated fallback, and bounded freshness.
- [ ] Add server-connected market screens with explicit source/time/units and unavailable/error states.
- [ ] Verify AAPL asset and quote with the live read-only API; run market tests, typecheck, lint.

### Task 3: Recipe schema, truthful hook availability, and deterministic validator

**Files:** `lib/hooks/**`, `lib/domain/recipe.ts`, `app/api/hooks/**`, `app/api/recipes/**`, `tests/hooks/**`.

**Interfaces:** `GET /api/hooks` returns only definitions present in the checked-in source set, with `implemented|catalog_only` status and source coverage. `validateRecipe(recipe)` returns a stable error list and canonical SHA-256 recipe hash. No PM catalog name is inferred from the incomplete documents.

- [ ] Write tests `valid_core_recipe_gets_stable_hash`, `unsupported_hook_cannot_be_saved_or_launched`, `invalid_stage_composition_is_rejected`, and `unavailable_pm_catalog_is_reported_without_fake_rows`.
- [ ] Run the hook tests and observe expected missing-module failures.
- [ ] Implement strict Zod recipe validation, canonical JSON serialization/hash, and a small internal tested ruleset only where its behavior is explicit; mark PM catalog coverage partial.
- [ ] Add owner-scoped recipe draft APIs and a minimal hook/recipe screen.
- [ ] Run hook tests, typecheck, lint.

### Task 4: Pure decision engine, paper ledger, positions, and append-only Tape

**Files:** `lib/engine/**`, `lib/paper/**`, `db/schema.ts`, `db/migrations/**`, `app/api/agents/[agentId]/tick/**`, `app/api/agents/[agentId]/tape/**`, `app/api/agents/[agentId]/positions/**`, `tests/engine/**`, `tests/paper/**`.

**Interfaces:** `runTick(snapshot, recipe, state): AgentDecision`; `POST /api/agents/[agentId]/tick` uses a caller-supplied idempotency key and persisted state; `GET` Tape and positions endpoints return persisted, owner-scoped rows.

- [ ] Write tests `run_tick_is_deterministic`, `stale_data_skips_new_entry`, `duplicate_tick_returns_original_decision`, `paper_execution_never_calls_wallet_or_chain`, and `tape_decision_cannot_be_updated_or_deleted`.
- [ ] Run engine/paper tests and observe expected missing behavior.
- [ ] Implement pure engine and transactional persistence with unique `(agentId,tickId)`, append-only decisions, explicit PAPER order/position state, fee/slippage assumptions, and no chain-write dependency.
- [ ] Add functional position and Tape screens backed by API responses.
- [ ] Run engine/paper tests, DB migration tests, typecheck, lint.

### Task 5: Honest historical-data coverage, same-engine backtest, and launch gate

**Files:** `lib/backtest/**`, `app/api/backtests/**`, `app/api/agents/route.ts`, `app/api/agents/[agentId]/launch/**`, `app/(app)/lab/**`, `tests/backtest/**`.

**Interfaces:** `runBacktest(recipe, snapshots): BacktestRun` uses `runTick`; launch requires a completed run with at least 720 valid, time-ordered hourly samples, matching `recipeHash`, and explicit pricing provenance. Robinhood's published price endpoint is live-only, so current app launch remains blocked unless valid historical snapshots are accumulated or a separately verified history provider is configured.

- [ ] Write tests `backtest_reuses_run_tick`, `backtest_rejects_lookahead_and_gaps`, `backtest_requires_720_hourly_samples`, `changed_recipe_invalidates_backtest`, and `launch_requires_matching_valid_backtest`.
- [ ] Run the backtest tests and verify the missing behavior fails as expected.
- [ ] Implement data coverage checks, reproducible backtest summaries, visible premium methodology, backtest persistence, and fail-closed launch gating.
- [ ] Build a real Lab view that displays unavailable history honestly and never renders made-up performance.
- [ ] Run backtest tests and verify launch is disabled with today's insufficient history.

### Task 6: Agent list/detail and lifecycle management

**Files:** `lib/paper/agents.ts`, `app/api/agents/**`, `app/(app)/agents/**`, `tests/agents/**`.

**Interfaces:** owner-scoped list/detail/pause/resume/stop/fork routes; fork creates a new draft recipe version and never copies positions or tick identifiers.

- [ ] Write tests `owner_can_pause_resume_stop_and_fork`, `other_owner_cannot_access_agent`, `fork_has_new_recipe_hash_and_no_position`, and `stopped_agent_cannot_tick`.
- [ ] Observe expected failures before implementation.
- [ ] Implement allowed transitions and server authorization; connect the UI controls to API acknowledgements.
- [ ] Run lifecycle tests, typecheck, lint.

### Task 7: Functional Forge recipe builder (AI remains unavailable)

**Files:** `app/(app)/forge/**`, `components/app/forge/**`, `app/api/recipes/**`, `tests/forge/**`.

**Interfaces:** click-based builder reads `/api/hooks`, saves validated draft through `/api/recipes`, and links to Lab. No composer endpoint is exposed without a configured, verified provider.

- [ ] Write tests `forge_saves_only_schema_valid_drafts` and `forge_never_reports_ai_success_without_provider`.
- [ ] Observe failures before implementing the route action/UI.
- [ ] Implement functional builder states, backend validation feedback, and explicit planned AI status.
- [ ] Run Forge tests and browser smoke path where browser tooling is present.

### Task 8: House Agent and 36-hook catalog capability status

**Files:** `lib/hooks/catalog.ts`, `app/api/hooks/route.ts`, `app/(app)/hooks/**`, `app/(app)/agents/page.tsx`, `tests/hooks/catalog.test.ts`.

**Interfaces:** display Covered Call, Cash-Secured Put, Protective Put, and Earnings Straddle only as `Preview` until the PM recipe source, verified option-premium methodology, and working evaluators are present. Public and private hook responses use the same catalog source.

- [ ] Write tests `all_four_templates_are_preview_until_executable` and `catalog_exposes_missing_pm_source_instead_of_inventing_hooks`.
- [ ] Observe failures before implementation.
- [ ] Implement accurate capability flags and reasons; only elevate a template with complete tests/data/recipe evidence.
- [ ] Run hook/catalog tests and inspect UI claims.

### Task 9: Public proof APIs and Claude Code UI contract

**Files:** `app/api/public/**`, `app/(app)/**`, `docs/api-contracts.md`, `docs/ui-handoff-contract.md`, `docs/landing-content-contract.md`, `tests/public-api/**`.

**Interfaces:** public endpoints expose only verified hook capability metadata and claims status; private agents/Tape remain owner-scoped. UI contract documents routes, shared schemas, loading/empty/error states, auth/session behavior, styling ownership, and data claims.

- [ ] Write tests `public_api_never_exposes_private_owner_or_session_data` and `public_tape_excludes_private_agents`.
- [ ] Observe expected failures before implementation.
- [ ] Implement public read APIs with explicit capability values and complete handoff contracts; do not build marketing visuals.
- [ ] Run public API tests, typecheck, lint.

### Task 10: Core safety regression, browser integration, and final handoff

**Files:** `tests/integration/**`, `tests/e2e/**`, `docs/execution-ledger.md`, `docs/tasks/optra-fullstack-progress.md`, `docs/final-core-handoff.md`.

- [ ] Add an integration path for challenge → session → market read → recipe → backtest gate → paper APIs → Tape, using real database logic and external data only for the live market smoke check.
- [ ] Run `bun run test`, `bun run typecheck`, `bun run lint`, and `bun run build`; run Playwright if the installed browser is available.
- [ ] Check no live transaction APIs or UI actions exist, private APIs fail without a session, cross-owner calls fail, persisted Tape is append-only, and launch remains backtest-gated.
- [ ] Record exact command outputs, local/Postgres requirements, data blockers, route/schema contracts, and Claude ownership limits.

## Rulings and Known Input Gaps

- **Ruling:** execute in the supplied workspace rather than create a worktree because the workspace has only source documents, no `.git`, and the user explicitly requires one repository/no automatic worktrees. Cost if wrong: less isolation from workspace-level changes.
- **Ruling:** use a persistent PGlite database for local development/tests and PostgreSQL via `DATABASE_URL` for deployed operation. Cost if wrong: PGlite is single-process development storage and cannot replace a managed multi-instance PostgreSQL deployment.
- **Source gap:** `Teks yang ditempel (1)(20261111-195353).txt` and the original PM product brief are absent from this workspace; exact 36 hook names/parameters cannot be asserted.
- **Source gap:** Robinhood's official read API exposes current prices/metadata, not a published historical OHLC endpoint; 30-day/720-hour backtests and paper launch remain blocked until genuine history is available.

