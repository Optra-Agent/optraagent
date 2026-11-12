# OPTRA — CODEX CORE RECOVERY (12 NOVEMBER 2026)

## Mission
Continue the EXISTING Optra repository in place and resolve the core blockers reported in `docs/final-core-handoff.md`. This is not a rewrite, reboot, or new project. The highest-priority result is a **genuine, reproducible paper-only vertical slice** that validates one approved House Agent recipe, runs a defensible backtest, persists a paper position when conditions genuinely pass, and shows a traceable decision in Optra Tape. Do not launch live trading.

## Inputs — read before changing code
- `docs/OPTRA_PM_ORIGINAL_DEV_BRIEF.md` — the PM's original 25-section primary brief and all 36 hook definitions (provided by owner).
- `docs/OPTRA_MASTER_EXECUTION_BRIEF_V2.md` — 48-hour MVP scope and stack.
- `docs/OPTRA_00_DISCOVERY_PROMPT_V2.md` — earlier discovery instructions; do not repeat completed work.
- `docs/final-core-handoff.md` and `docs/ui-handoff-contract.md` — established code and API contracts.
- `docs/tasks/optra-fullstack-progress.md` and `docs/execution-ledger.md` — existing progress and issues.
- `tests/integration/paper-flow.test.ts` — integration behavior already under test.

Do a focused repository inventory and check existing implementations before editing. Do not declare work complete based solely on preexisting green tests.

## Priority A — restore the PM source of truth
1. Verify the PM file is complete and contains sections 7, 10, 11, 13, and 16, including 36 hooks in 10/7/4/7/3/5 categories.
2. Reconcile the code's hook registry and validators with the original definitions; explicitly document spec inconsistencies, do not silently invent semantics.
3. Choose ONE valid **paper-only** PM House Agent to complete end to end. Prefer the lowest-dependency recipe supported by actual data; do not invent collateral or earnings calendar. Document and implement all its required hooks and mandatory Breakers. Nonimplemented hooks must remain clearly marked as not yet supported, even if catalogued.

## Priority B — real, auditable history and pricing
1. Audit the currently configured data provider. The reported 1/720 AAPL hourly samples are not a 30-day history.
2. Research and test documented external sources with actual responses and timestamped coverage. Robinhood's `/rhj/prices/{symbol}` is a current price endpoint, not automatically an hourly historical feed. Candidate Robinhood Chain historical-token trade/candle APIs: https://docs.crius.sh/guides/get-ohlcv-candles/ and https://docs.bitquery.io/docs/blockchain/robinhood/robinhood-trades/ . Use them only if coverage, token mapping, semantics, rate limits, and access are verified. Do not confuse token DEX price with underlying-equity share price; normalize multiplier only after confirming correct direction and semantics.
3. Handle nontrading US equity hours, weekends, holidays, DST, sparse DEX trading, and missing candle buckets correctly. Do not turn a 1-point series into 720 fabricated points or treat flat-forward fills as recorded trades. Clearly report coverage and gaps.
4. Options **historical premium quotes** are separate from underlying price history. Where verified recorded premium quotes are absent, implement the PM-authorized **modeled premium** path (Black-Scholes / explicit RV proxy, deterministic calculation, documented assumptions and limitations) only when sufficient real underlying history and valid inputs exist. Use `premiumSource: modeled`, display source/provenance, IV assumptions, fee and slippage assumptions; never claim that modeled outputs are recorded venue quotes or real fills.
5. Fail closed if core inputs are unavailable. If the originally desired 30-day backtest is not defensible, clearly report supported lookback and block any misleading 30-day claim. Do not manufacture positive results to make the demo look active.

## Priority C — make one paper flow genuinely functional
1. Use the same pure deterministic rule engine across backtest and paper tick. Recipe hash/version must be immutable at launch.
2. Run one actual complete end-to-end integration case: authenticated user -> select House Agent -> valid recipe -> backtest metrics with documented provenance -> launch paper -> tick -> decision trace -> paper order and position **only if valid market conditions support an entry** -> persist and render in Tape/Book. Build deterministic fixtures for testing both pass and blocked conditions, clearly distinguish fixtures from live data.
3. The integration test must assert real decision/position accounting, idempotent tick handling, no duplicate fills, persistent book state, and reconciliation. One forced `skip` is not proof of an operational trading flow.
4. Add negative tests: missing/stale data, missing multiplier, no quote/model inputs, risk cap breach, duplicate ticks, wallet mismatch, order rejected, nontrading sessions, position exit unaffected by entry veto.
5. No Mainnet transactions, signatures for token approvals, contract deployments, custody delegation, or fictional financial performance.

## Priority D — verification and truthful handoff
1. Run `bun run test`, `bun run test:e2e`, `bun run typecheck`, `bun run lint`, `bun run build` (or actual existing package scripts). Validate real DB integration where available.
2. Update `docs/final-core-handoff.md`, `docs/ui-handoff-contract.md`, `docs/tasks/optra-fullstack-progress.md`, and `docs/execution-ledger.md` in place rather than creating competing reports.
3. Report a matrix for each capability: WORKING / PARTIAL / BLOCKED, evidence, test command, data provenance, and next step. Do not declare READY unless a reproducible paper agent flow works.
4. Keep the existing Next.js single repository and API contracts. Claude Code is next for UI polish ONLY once the paper core is usable. Do not redesign the landing in this recovery task.

## Operating method
Work autonomously through these priorities; use available global skills and MCP where genuinely relevant. Maintain a concise task ledger; no repeated repo audits or separate worktrees by default. If an external feed is unavailable or has insufficient history, isolate the blocker, preserve safety, and finish the verifiable portions instead of substituting fake data.
