# Market data: who provides what (traced from the code)

Read from the repository, not assumed. Nothing here was changed.

| What the UI can show | Provider and code | Notes |
|---|---|---|
| Asset list: symbol, name, token address, current multiplier | Robinhood token registry via `api.robinhood.com` (`lib/market/robinhood-feed.ts`, served by `GET /api/markets`) | 203 assets in the current list. No prices. |
| Official logo URL | The same registry, only when it passes the host and deployment-address checks | Optional. Most entries have none. |
| Token quote for one asset: token bid and ask, underlying bid and ask, `observedAt`, `receivedAt`, `stale`, `tradingHalt`, `pricingMethod` | Robinhood stock-token API, source literal `robinhood_stock_token_api` (`GET /api/markets/[symbol]`) | A token quote. It is not an executable options price. `pricingMethod` is `recorded`, `modeled` or `unavailable`. |
| Hourly candles (open, high, low, close, volume, trade count, pool count) | Crius, `api.crius.sh/v1/robinhood/token`, source literal `crius_robinhood_chain_candles` (`lib/market/crius-history.ts`) | Used by the backtest (`lib/backtest`). Not filled: `filled` is always false. Corporate-action dates come from Robinhood. |
| Candle coverage: available candles, start, end, ready, reason | `GET /api/backtests/coverage?symbol=` | A summary only. The candles themselves are not returned to the browser. |
| Option premiums in Lab and paper decisions | Black-Scholes in `lib/options/black-scholes.ts`, modeled | Modeled paper prices. There is no option chain, no implied volatility and no listed-contract data. |
| Ticker logos in the Market list | Third-party image service (`assets.parqet.com`), downloaded to `public/img/stocks/` | Presentation only. Not market data, not Crius, rights unverified (see `logo-assets.md`). |

## Consequence for the Market screen

The screen shows what the API returns: the list, the quote with its timestamps, and the coverage summary. It shows no price, 1h, 24h or 7d change, volume or sparkline in the list, because no UI-facing route returns candles or per-asset prices for all 203 assets. Showing them would need either invented numbers or a new read-only endpoint.

## What FLOW would need to expose for a Zolva-style table

A read-only route that returns, per symbol, the last N hourly candles it already holds (source, `startAt`, `endAt`, `receivedAt`, close in USD) so the browser can derive 1h, 24h and 7d changes and a seven-day line with the correct window and an honest "as of" time. The UI can consume it without further design work. It does not need option prices.

## Scheduler

`/api/cron/paper-evaluations` and `/api/cron/market-snapshots` exist and require `CRON_SECRET`. No production schedule is active, so the UI shows no next-run time anywhere.
