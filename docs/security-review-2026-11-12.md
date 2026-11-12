# OPTRA Focused Security and Data-Integrity Review

Date: 2026-11-12 (Asia/Jakarta)

## Scope and method

Reviewed the paper tick handler and Drizzle repository, agent lifecycle transitions, EVM wallet challenge/session flow, owner-scoped APIs, public proof handlers, market provenance checks, premium model disclosures, backtest benchmark contract, and live-execution boundary. Compared the Codex backend/test diff with `HEAD`; Claude's concurrent frontend changes were read only and were not part of this backend review.

The review traced the tick request from authenticated owner and validated idempotency key through market/history acquisition, deterministic evaluation, persistence, lifecycle changes, and public/private read paths. Both findings below were reproduced in the captured-provider PGlite integration flow before the fix.

## Findings

### F-01 — Concurrent distinct ticks evaluated stale portfolio state

**Severity:** High paper-ledger integrity risk; the affected path is paper-only and does not move funds.

**Evidence:** Two simultaneous historical ticks with different canonical IDs both read the same flat account before persistence. Before the fix, one response was `200` and the other `500` when both attempted to open a position and the partial unique open-position index rejected the second insert. The second tick was not evaluated against the first tick's committed position/account state.

**Resolution:** `DrizzlePaperRepository.persistTick` now locks the owner-scoped agent row with `FOR UPDATE`, checks lifecycle status and retry identity under the lock, loads the latest account and open position, invokes the synchronous deterministic evaluator, then persists decision, trace, order, position, and account updates in the same transaction. Lifecycle updates contend on that agent row. The integration test now verifies concurrent distinct IDs resolve to one `open` and one `hold`, one order, and one position.

### F-02 — A new historical tick could be accepted before the latest persisted decision

**Severity:** High paper-ledger time-order integrity risk; paper-only.

**Evidence:** After a tick at a later captured candle, a distinct request for the immediately preceding candle returned `200` before the fix. That could mark/update current paper state using an earlier underlying observation.

**Resolution:** Under the same row lock, new tick timestamps are compared with the latest persisted decision. A new backdated event returns `409 CONFLICT` without adding a Tape row or mutating account/position state. An exact retry of an existing tick is checked first and remains idempotently readable.

## Boundary review

- **Wallet sessions:** The service normalizes EVM addresses/origin, issues a one-use five-minute origin-bound challenge, recovers and compares the signing address, stores only a SHA-256 hash of a random 32-byte session token, and uses a seven-day `HttpOnly`, `SameSite=Lax` cookie (`Secure` in production). Auth and signed paper-flow tests pass.
- **Ownership:** Private agent, tick, Tape, position, backtest, and launch access derives owner identity from the session. Cross-owner and missing agent IDs are both hidden as 404. The transaction repeats the owner condition while locking the agent row.
- **Request validation and errors:** Routes validate methods, UUIDs, body contracts, market inputs, timestamp format, and required bounded `Idempotency-Key` values. A lifecycle race maps to `409`; unexpected persistence errors remain generic 500 responses.
- **Public data:** Public hook/template/verification responses are capability/catalog data. Public agents and Tape return empty results and do not query private wallet/session/strategy/position records. Tests assert no `ownerId`, session, or token-hash fields leak.
- **Market provenance:** Historical execution requires exact provider candles, sufficient consecutive prior bars, verified multiplier continuity, and non-filled records. Backtests preserve the candle snapshot/hash/provider provenance and fail closed on insufficient or invalid windows.
- **Premium and benchmark claims:** Option premiums are explicitly modeled Black–Scholes values with documented RV30, zero rate/dividend assumptions, 30-day model tenor, 50 bp slippage, and no venue fees. Benchmark buy-and-hold uses verified share-normalized underlying closes; cash is flat USD/no yield. No USDG price path or recorded option quotes are claimed. Older backtest JSONB rows remain valid without the optional benchmark object.
- **Real-money execution:** Public verification declares `liveTradingEnabled: false`; `LIVE_TRADING_ENABLED=false` remains configured. No wallet transaction or live order submission route is present.

## Verification

- `bun run test -- tests/agents tests/auth tests/backtest tests/db tests/domain tests/engine tests/forge tests/hooks tests/integration tests/market tests/options tests/paper tests/public-api` — 31 files / 103 tests passed.
- `bunx tsc --noEmit --incremental false` — passed.
- `bun run lint` — passed.
- The concurrent-tick regression was observed red before the fix (`[200, 500]`); the backdated-tick regression was observed red before the guard (`200` instead of `409`). Both are covered by the passing integration flow after the fix.
- Full Playwright/E2E and production build were not rerun because Claude's frontend edits and the repository `.next` output are concurrent; the default Playwright target uses port 3000, owned by SENTERA. The UI benchmark component was inspected but browser behavior is not yet verified.

## Review status

The two confirmed backend integrity findings are addressed and tested. Remaining release work is coordinated full-suite/browser/build QA after frontend edits settle, plus the existing product limitations: one paper-ready House Agent, 15 implemented hooks, modeled option premiums, and symbol/window-specific verified history. No commit, push, or deployment was made.
