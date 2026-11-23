# OPTRA — PM Product Walkthrough

Production: https://optraagent.cc · Production commit `ee17ccf0be04bbb37f3d0c2259e3cbb695541931` (CI run 45203641187 success, Railway deployment `ed258081`; it carries the chart layout shipped in `7ad5ed5`) · Network: Robinhood Chain Mainnet (chain 4663) · Verified 23 Nov 2026 14:22 to 14:25 UTC.

This is a plain-language tour of what OPTRA does today, in the order a new user meets it. Every status below was checked on the production site, not on a developer machine. Where something needs the owner's wallet, it says so.

## 1. What OPTRA is, in one paragraph

OPTRA is a no-code place to design, test and watch options strategies on tokenized US stocks that live on Robinhood Chain. You can browse real tokenized-stock markets with real candlestick charts, build a strategy by clicking rules together, replay it against history, and run it on paper. For stocks that have a real options market on CallPut, you can also place an options order yourself, signing every transaction in your own wallet.

## 2. Three different things called "agent" — do not mix them up

| What | What it is | Real money? | Status today |
|---|---|---|---|
| **OPTRA House Agents** | Four OPTRA-owned strategies that run on paper with virtual capital: Covered Call NVDA, Cash-Secured Put TSLA, Protective Put NVDA, Earnings Straddle NVDA. | No | Running (see section 4) |
| **Your own agents** | Strategies you assemble in Forge, backtest in Lab and run on paper. | No | Working, needs a wallet sign-in (it proves ownership only and sends no transaction) |
| **Autonomous Live Agent** | An engine that could place real orders by itself. It is built and was tested on a Mainnet fork, but it is not switched on. | Only after owner authorization and all seven safety gates (G1 to G7) pass | **Not active.** Do not describe it as live. |

## 3. The journey, step by step

Each row says what you do, what happens, where the data comes from, and whether a wallet is involved.

| # | Page | What you do (button labels) | What happens | Data source | Wallet? |
|---|---|---|---|---|---|
| 1 | **Landing** `/` | Read the page, press **Launch app** | Explains the product; the live House Agents section shows the four agents. Launch goes to Agents. | OPTRA public API | No |
| 2 | **Connect wallet** (on Agents, Lab, Tape) | Press **Choose a wallet** (MetaMask or Phantom EVM) | A sign-in message proves you own the address. It never sends a transaction. | Your wallet | Yes (sign-in only) |
| 3 | **Markets** `/market` | Search, filter, sort; click a stock row, then **Open chart & options** | 205 tokenized stocks. Stocks with a real CallPut options market carry an **Options** badge (17 today). | Robinhood stock-token API | No |
| 4 | **Market detail** `/market/NVDA` | Switch **15 min / 1 hour / 4 hour / 1 day**, **Candles / Line**, open **Indicators** | Full-width candlestick and volume chart with a big last price, 24h change and stats. It refreshes while the tab is open and shows Live, Delayed or Stale. | Crius, from real on-chain token trades | No |
| 5 | **Option chain** (same page) | Pick an expiry, then **Pick long leg** / **Pick short leg** and click a mark | The two legs fill the real order form. Stocks without a CallPut market show a plain "no options market" message and no order controls. | CallPut venue feed | No |
| 6 | **Order form** (same page, below the chart) | **Load market**, enter size and max collateral, **Prepare order** | Funding checks run first: USDG balance, allowance, ETH for the fee. The exact transactions are shown (destination, amounts, spender). A short "Before you sign" box states the risks. | Your wallet + CallPut contracts | Reads only until you sign |
| 7 | **Confirm and track** | Tick **I reviewed this exact transaction**, press **Sign in wallet**; later **Read request** | MetaMask asks you to confirm each transaction. A submitted transaction is not a fill. The request is tracked until the venue reports Executed and your wallet holds the option tokens. | CallPut keeper + on-chain reads | **Yes: owner only** |
| 8 | **Agents** `/agents` | Read the four House Agents, press **Read its Tape**, or start your own | Each card shows strategy, Paper mode, status, decisions, open positions and a modeled 30-day backtest. | OPTRA database | No (to read) |
| 9 | **Forge** `/forge` | Choose a template and market, toggle hooks, press **Validate recipe** | Assemble a strategy from rule blocks. The server checks it and gives it a fingerprint. **Save draft** needs a signed-in wallet. | OPTRA server | Sign-in to save |
| 10 | **Lab** `/lab` | Pick a symbol, check coverage, **Run the draft** | Replays the strategy against 30 days of hourly candles with modeled option premiums. It is blocked when the candle history has gaps. | Crius candles + Black–Scholes model | Sign-in to run |
| 11 | **Tape** `/tape` | Open **House Agents Decision Tape** | Every decision the House Agents persist: the candle read, the rule trace, the outcome. Empty while the US market is closed, by design. | OPTRA database | No |
| 12 | **Hooks** `/hooks` | Browse the library | The rule blocks used in Forge (36 cataloged, 26 have working evaluators). | OPTRA catalog | No |
| 13 | **Verify** `/verify` | Read the three sections | Separates what is available now, what is built and under acceptance, and what is on the roadmap, with contract addresses and links. | OPTRA public API + on-chain | No |
| 14 | **Live Agent controls** (bottom of Tape) | Read the requirements | Shows exactly which owner or venue requirements are missing before the autonomous engine may run. Nothing activates by itself. | OPTRA gate checks | Sign-in to view |

## 4. The four House Agents, with evidence

Checked on production at 13:44 UTC on 23 Nov 2026 (public API `/api/public/v1/agents` and `/api/public/v1/tape`):

- All four exist and show `status: running`, `executionMode: PAPER`, created by "Optra", launched 21 Nov 2026.
- Virtual account: 2,000 USD each, nothing realized, no open positions.
- The scheduler runs every 10 minutes. Passes were logged at 12:50, 13:00, 13:11, 13:21 and 13:44 UTC, all `complete`, 0 failures.
- A fifth, non-House agent (MSFT) exists in the database. The scheduler skips it as `finalized_candle_stale`, which is expected before the market opens. It is not an OPTRA agent and is not shown publicly.
- **Update 15:12 UTC:** the first eligible evaluation recorded 4 `skip` entries (one per agent) with a data-provenance error, caused by a scheduler bug (a fresh candle was rejected because it was stamped a few seconds after the pass started). The bug is fixed in `ee17ccf`, deployed 15:4x UTC. Those four entries stay on the Tape as an honest error record, not a strategy decision. The first genuine decisions can appear for the 16:00 UTC candle, after about 16:13 UTC.
- **Before that update: decisions recorded 0.** That was correct. The US market opens at 09:30 ET (14:30 UTC). The first eligible candle closes at 15:00 UTC and is recorded by the first scheduler pass after 15:05 UTC. Nothing has been inserted artificially.
- The backtest numbers on each card (for example "+0.68% over 30 days") are modeled with Black–Scholes premiums, not real fills.

## 5. What is real, and what is modeled

| Real | Modeled or not yet done |
|---|---|
| Tokenized-stock candles and volume (Crius, from on-chain trades) | Paper-trading premiums and backtests (Black–Scholes model) |
| Stock and token quotes (Robinhood) | The Forge "AI composition" idea is only planned |
| CallPut option marks and instruments, contract addresses and explorer links | A Mainnet fill: **none has happened yet** |
| The wallet-signed order flow (prepare, review, sign, track) | The autonomous engine: built and fork-tested, not active |

## 6. The strongest capabilities to show

1. Real tokenized-stock candlestick and volume charts with live refresh.
2. A real CallPut option chain feeding a wallet-signed order flow with funding preflight.
3. Four OPTRA-owned House Agents running in public on paper, with a persistent Decision Tape.
4. No-code strategy building (Forge) with server-side validation.
5. A Verify page that states plainly what is proven and what is not.

## 7. Known limits to keep in mind

- Backtests need 1,441 consecutive hourly candles, and coverage changes with the provider feed. At 14:25 UTC only NVDA was ready; at about 15:10 UTC NVDA, TSLA, MSFT, AMZN, META, GOOGL, QQQ and PLTR were ready, while AAPL, SPY and MU were blocked by a stock-token multiplier action and COIN had 960 of 1,441 candles. Show backtests on NVDA and read Lab's coverage line right before recording.
- Some tokens trade rarely (AEIS has 12 hourly candles). The chart shows exactly what exists and nothing more.
- A stock without a CallPut market has a chart but no options and no order controls.
- The first Mainnet transaction will be done by the owner in MetaMask. Until then, say "wallet-signed trading is available", never "executed".

## 8. Owner actions still needed

1. Connect MetaMask on Robinhood Chain and fund it with a little ETH and USDG.
2. Rehearse: Market detail, pick two legs, **Prepare order**, read the review, stop before **Sign in wallet** unless you want a real transaction.
3. After 15:05 UTC on a US trading day, open Tape and confirm the first House Agent decisions appear before posting about them.

## 9. Final production verification log (7ad5ed5, 23 Nov 2026 14:25 UTC)

Run in a real browser against https://optraagent.cc.

| Check | Result |
|---|---|
| Chart layout | PASS: the chart is 1,084 px of a 1,128 px content area at 1440 px wide; there is no side panel; the trade steps sit in a strip below the chart |
| Default mode | PASS: Candles selected on NVDA, AMZN, AEIS and ADBE; Line switches to a line and back |
| Real data | PASS: NVDA 500 candles at 4h from Crius; hover shows real UTC time, OHLC, volume and trade count |
| Freshness | PASS: the chart shows Live and "Refreshed 1s ago · provider data as of 14:22 UTC" |
| Thin market | PASS: AEIS draws its 12 real candles and shows "No trades since…"; ADBE 63 candles |
| Options | PASS: NVDA and AMZN show a live chain and the order form; AEIS and ADBE show no options and no order controls |
| Leg selection | PASS: picking NVDA-23NOV26-165-P (long) and 160-P (short) fills the order form with a Buy Put Spread |
| Order panel | PASS: no orange warning box; "Connect a wallet to prepare an order." until a wallet is connected |
| Demo wording | PASS: no demo, simulated or ticket wording on any market page |
| Logos | PASS: 30 of 30 list logos load, none broken |
| Overflow | PASS: 45 route and width checks (320, 390, 768, 1280, 1440 px) with no horizontal overflow |
| Browser errors | PASS: no page errors; the only console noise is the signed-out 401 from the session check |
| Wallet connection and Prepare | **BLOCKED here**: this test browser has no wallet extension, so the owner must do it |
| House Agent decisions | **SUPERSEDED**: 0 at 14:25 UTC; at 15:12 UTC four provenance-error skips from a scheduler bug (fixed and deployed in `ee17ccf`); genuine decisions pending the 16:00 UTC candle |

### Final PM acceptance addendum (23 Nov 2026, evening)

| Check | Result |
|---|---|
| Forge to Lab to NVDA backtest | PASS on live candles through a local server with a test signer (draft saved and loaded with exact parameters, symbol pinned in Lab, 720 decisions, 2 entries / 1 exit, +0.06%, drawdown −0.07%, stays draft). Not run on production: it needs the owner's wallet session |
| Lab to draft route | Fixed in `f590196`: Lab shows the draft's saved settings and a Back to this draft link |
| House Agent detail pages | PASS on production: configuration, risk parameters, execution mode, launch time, last evaluation, stored backtest report, Tape; checked for all four agents, no overflow |
| Real-money fill | None. Wallet-signed trading is available; the owner must sign in MetaMask |
