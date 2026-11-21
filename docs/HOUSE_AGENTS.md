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

## Tests

- `tests/engine/strategy-tick.test.ts`, `strategy-helpers.test.ts`: open, close, roll, settle, collateral, cover, earnings gating, breakers.
- `tests/engine/strategy-real-data.test.ts`: 30-day backtests on captured Robinhood Chain candles and earnings (`tests/fixtures/market-capture-20261121.json`).
- `tests/hooks/house-specs.test.ts`: recipe bounds, tamper cases.
- `tests/integration/house-agents.test.ts`: persisted tick = pure tick, restart recovery, idempotency, provisioning, public API isolation.
- `tests/e2e/house-agents-flow.spec.ts` (`OPTRA_E2E_HOUSE=1 bunx playwright test --project=house`): choose → configure → validate →
  backtest → launch → tick → position → Tape in a real browser against the real backend and the captured market data.

## Not claimed

No listed-option quotes, no venue fills, no early-exercise or assignment modeling (puts settle in cash at intrinsic value), no
dividends, no borrow costs. These are Paper results.
