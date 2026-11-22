# OPTRA House Agents

Four OPTRA-owned House Agents run on Paper Mode, plus the user-configurable templates behind them. Everything here is
simulation: virtual capital, modeled Black–Scholes premiums, no wallet access, no transaction. A House Agent has no code
path to CallPut, to a signer or to any live-trading flag.

## Agents

| Agent | Structure | Recipe module |
| --- | --- | --- |
| Protective Put | long put against virtual shares | `lib/hooks/catalog.ts`, `lib/engine/run-tick.ts` |
| Covered Call | short weekly call against uncommitted virtual shares | `lib/hooks/house-specs.ts`, `lib/engine/strategy/*` |
| Cash-Secured Put | short weekly put, strike × quantity of virtual USDG locked | same |
| Earnings Straddle | long call + long put at one strike around a confirmed earnings date | same |

Covered Call, Cash-Secured Put and Earnings Straddle share one strategy engine (`runStrategyTick`). The backtester
(`lib/backtest/run.ts`), the Paper scheduler and the manual tick route all call it, so a backtest and a Paper tick make the
same decision on the same candle (`tests/integration/house-agents.test.ts` replays the persisted path against the pure engine).

## Recipes are closed specifications

`lib/hooks/house-specs.ts` fixes the exact hook list per template, and each parameter is either pinned to the PM default or
limited to the range the PM brief allows. `validateHouseRecipe` rejects naked calls, uncollateralized puts, missing Breakers,
loosened Breakers, extra hooks and altered premium models. The canonical recipe hash identifies one validated behavior.
Postgres `jsonb` reorders object keys, so comparisons are key-order independent.

## Data and honesty rules

- Premiums are modeled (European Black–Scholes, volatility = RV30 × 1.1, 50 bp slippage, no venue fees). They are never shown as
  recorded venue quotes. No earnings volatility premium or IV crush is modeled; the Earnings Straddle's entry cost is likely understated.
- IV rank is a realized-volatility rank proxy over the 30-day window, not an option-chain IV.
- Earnings dates come from Robinhood's market-data endpoint (`lib/market/earnings.ts`). A date flagged `verified: false` can
  block an entry but can never open an earnings-only position. A missing calendar fails closed (`DATA_MISSING`).
- Fills happen only in the regular US equity session. Expiry settlement uses the first candle close after 16:00 America/New_York.
- A backtest with no modeled entry blocks launch. Nothing is invented to make an agent look active.

## Running them

`lib/house/house-agents.ts` provisions the four public agents under a reserved house user (`HOUSE_USER_ADDRESS`, no key exists
for it). For each agent it walks `HOUSE_SYMBOL_PRIORITY` starting at the symbol its PM recipe names and launches the first symbol
whose verified 30-day backtest passes the same launch gate as any user's agent. Blocked results are recorded as backtest runs and
create no agent. `lib/paper/background.ts` (started from `instrumentation.ts` in production) runs provisioning and then the Paper
scheduler every ten minutes, guarded by a Postgres advisory lock and idempotent per candle. Set `PAPER_SCHEDULER_ENABLED=false` to
turn it off. `POST /api/cron/house-agents` (bearer `CRON_SECRET`) runs provisioning on demand.

Public read API: `GET /api/public/v1/agents`, `GET /api/public/v1/agents/{id}`, `GET /api/public/v1/tape`. Only agents with
`kind = 'house'` and `visibility = 'public'` are returned. UI: the "Live House Agents" panel on `/agents` and `/house/{id}`.

## Decision Tape: when it is empty, when it fills, what is recorded

An agent evaluates a candle only when all of these hold (`lib/paper/scheduler.ts`): the candle ends inside the regular US session
(09:30–16:00 ET, early closes and holidays honored, so the in-session candle ends are 10:00–15:00 ET, six a day), it ended more than five
minutes ago, it is no more than two hours old, it is newer than the agent's last decision or launch, and the previous 721 hourly candles
are all present, non-synthetic and contiguous. The ten-minute in-process pass therefore records a decision for each in-session hour
shortly after that hour's candle closes. A House Agent launched on a Saturday has nothing to evaluate until the next session: **an empty
Tape on a weekend, a holiday or outside 09:30–16:00 ET is expected, not a fault.**

Outcomes persisted per evaluation: `OPEN`, `CLOSE`, `HOLD`, `SKIP` (the stored `action`) and `ERROR`. ERROR is a skip whose trace carries
a hook with status `error`: the engine's own integrity failures (`system.recipe_hash`, `system.paper_account`) and the scheduler's
data-integrity failure (`system.market_data`), recorded when a fresh in-session candle cannot be evaluated because its 722-candle window
is incomplete, synthetic or non-contiguous. It creates no order and changes no position or account. A candle that is stale because the
process was down is logged once per agent and candle and is not recorded as a decision.

`GET /api/public/v1/tape` also returns `scheduler`: whether the market is open and why not, the next eligible candle end and the earliest
instant it is finalized, and this server instance's last pass (null after a restart until the first pass finishes; the decisions
themselves are the persisted evidence). Public responses drop the raw 721-candle array stored inside a Protective Put decision and keep
the history hash, window and observed candle. The Tape page (`/tape`, signed out) renders this record with agent, strategy, UTC
timestamp, outcome, rule trace, source, history hash and recipe hash.

Evidence without waiting for a session: `tests/integration/house-tape-persistence.test.ts` provisions the four agents in an isolated
PGlite database, steps the real scheduler across every in-session hour of the archived real 2026-11-21 capture, injects one synthetic
candle to produce ERROR records, closes and reopens the data directory (a process restart) and asserts the public Tape is identical and
the scheduler resumes without duplicates. Those rows live in a throwaway directory; none is a production record.

## Tests

- `tests/engine/strategy-tick.test.ts`, `strategy-helpers.test.ts`: open, close, roll, settle, collateral, cover, earnings gating, breakers.
- `tests/engine/strategy-real-data.test.ts`: 30-day backtests on captured Robinhood Chain candles and earnings (`tests/fixtures/market-capture-20261121.json`).
- `tests/hooks/house-specs.test.ts`: recipe bounds, tamper cases.
- `tests/integration/house-agents.test.ts`: persisted tick = pure tick, restart recovery, idempotency, provisioning, public API isolation.
- `tests/integration/house-tape-persistence.test.ts`: isolated-database Tape persistence, ERROR outcome, restart consistency, scheduler status.
- `tests/e2e/house-agents-flow.spec.ts` (`OPTRA_E2E_HOUSE=1 bunx playwright test --project=house`): choose → configure → validate →
  backtest → launch → tick → position → Tape in a real browser against the real backend and the captured market data.

## Not claimed

No listed-option quotes, no venue fills, no early-exercise or assignment modeling (puts settle in cash at intrinsic value), no
dividends, no borrow costs. These are Paper results.
