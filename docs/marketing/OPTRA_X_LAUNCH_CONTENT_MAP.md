# OPTRA — X Launch Content Map

Production: https://optraagent.cc · Evidence date: 23 Nov 2026 (UTC). Every claim below was checked on the live site. Re-check anything marked **Re-check before posting**.

## Claim rules for every post

**Safe to say**
- OPTRA runs four OPTRA-owned House Agents in public **paper** mode (virtual capital, modeled premiums).
- Tokenized-stock charts use real on-chain trade data (candles and volume) from Robinhood Chain.
- For 17 stock tokens with a real CallPut options market, you can build and sign an options order in your own wallet. Every transaction needs your confirmation.
- Every decision (including holds and skips) is recorded on a public Decision Tape.
- Verify separates what is available, what is under acceptance and what is roadmap.

**Never say**
- That OPTRA has executed or filled a Mainnet trade. None has. Verify says "Acceptance required".
- That agents trade real money, or that autonomous live trading is active. The engine is built and fork-tested (25 of 25 checks) but **not activated**.
- Profit, return or performance claims from paper results or backtests. The numbers are modeled with Black–Scholes premiums.
- That AI builds strategies. "AI composition" is marked planned in Forge.
- That OptraGuardHook protects funds. It is deployed, unaudited and uninitialized, and holds no funds.
- Any House Agent decision before it exists on the Tape.
- That backtests work for every stock. On 23 Nov 2026 only NVDA met the 1,441-consecutive-hour requirement.

Add "Not financial advice. Paper trading uses no real money." to posts that show strategies.

---

## Recommended 7-post sequence

### Post 1 — Launch: what OPTRA is
1. **Angle:** One clear product statement.
2. **Hook:** "No-code options agents on tokenized stocks. Real charts. Paper first. Your wallet signs everything."
3. **Feature:** Landing page and Launch app.
4. **Shot:** 10-second screen recording: landing hero, scroll to the four House Agents, press **Launch app**.
5. **Evidence:** Landing H1 "No-Code Options Trading Agents."; `/api/public/v1/agents` returns 4 running agents.
6. **CTA:** "Try it: optraagent.cc"
7. **Restrictions:** Say "paper" in the same post. No performance numbers.

### Post 2 — Real tokenized-stock charts
1. **Angle:** Tokenized stocks with serious charts.
2. **Hook:** "Tokenized NVDA, with real on-chain candles and volume. Drag, zoom, switch 15m to 1d."
3. **Feature:** Market detail chart: Candles/Line, timeframes, volume, Indicators menu (SMA, RSI, MACD), crosshair.
4. **Shot:** Screen recording of `/market/NVDA`: hover the crosshair, switch 1h to 4h, open Indicators, zoom.
5. **Evidence:** 500 candles at 15m, 1h and 4h and 145 at 1d for NVDA (Crius, 23 Nov). The page shows "Source Crius · Robinhood Chain token trades".
6. **CTA:** "Explore 205 tokenized stocks."
7. **Restrictions:** Say the prices come from on-chain token trades. Do not call them the NYSE or Nasdaq price. Thinly traded tokens show only the candles that exist.

### Post 3 — The four OPTRA House Agents
1. **Angle:** OPTRA runs its own agents, in public.
2. **Hook:** "Four OPTRA-owned agents run on paper in public: Covered Call, Cash-Secured Put, Protective Put, Earnings Straddle. Every decision gets logged."
3. **Feature:** Agents page, House Agents cards.
4. **Shot:** `/agents` scrolling past the four cards, ending on **Read its Tape**.
5. **Evidence:** Four agents with status running, mode Paper, launched 21 Nov, scheduler passes every 10 minutes.
6. **CTA:** "Watch them: optraagent.cc/agents"
7. **Restrictions:** Post only after the first decisions exist on the Tape. **Re-check before posting** (first eligible evaluation is after 15:05 UTC on a US trading day). Never present backtest numbers as results.

### Post 4 — Decision Tape: every decision explained
1. **Angle:** Transparency. Holds and skips count too.
2. **Hook:** "Most bots show trades. OPTRA's Tape shows why: the candle it read, the rule trace, the outcome, even when it did nothing."
3. **Feature:** House Agents Decision Tape.
4. **Shot:** `/tape`, open one real decision and its rule trace.
5. **Evidence:** Tape states "Holds and skips are first-class entries". Needs at least one real decision.
6. **CTA:** "Read the Tape."
7. **Restrictions:** **Do not post until a genuine decision exists.** At 15:12 UTC the Tape held four provenance-error skips caused by a since-fixed scheduler bug; they are not a showcase. Wait for decisions from the 16:00 UTC candle or later and read them first. An empty Tape before the open is expected, so do not screenshot it as the hero.

### Post 5 — No-code strategy building and backtesting
1. **Angle:** Build a strategy by clicking, then replay it.
2. **Hook:** "Pick a template, toggle rules, validate, replay 30 days of hourly candles. No code."
3. **Feature:** Forge (Validate recipe) then Lab (Run the draft).
4. **Shot:** `/forge` toggling hooks and **Validate recipe**, then `/lab` with NVDA coverage ready.
5. **Evidence:** 36 hooks cataloged and 26 with working evaluators (Verify). NVDA coverage 1,499 of 1,441 required candles.
6. **CTA:** "Build your first agent."
7. **Restrictions:** Use **NVDA** for the demo and check Lab's coverage line first (coverage changes with the provider feed; AAPL, SPY, MU stay blocked by a multiplier action). Say "modeled premiums". Do not mention AI composition.

### Post 6 — Wallet-signed CallPut options
1. **Angle:** Real options contracts, your wallet in control.
2. **Hook:** "Pick the contracts from a live option chain. Prepare. Review the exact transaction. Confirm in MetaMask. Nothing is signed for you."
3. **Feature:** Option chain, order form, funding preflight, request tracking.
4. **Shot:** `/market/NVDA`: pick two legs, press **Prepare order**, show the funding checks and review, stop before signing.
5. **Evidence:** 17 stock tokens have CallPut options. Verify: "Wallet-signed trading: Available". Tracker rule: submitted is not filled.
6. **CTA:** "See the option chain."
7. **Restrictions:** Do not show a signed transaction unless the owner really sent one. Never say "fill" or "executed" without venue evidence. Say "wallet-signed", never "automated".

### Post 7 — Verify: what is proven and what is not
1. **Angle:** Honesty as a feature.
2. **Hook:** "We separate what works today from what is built and what is coming. Contracts, evidence and gaps are all on one page."
3. **Feature:** Verify page, the autonomous engine as an upcoming milestone.
4. **Shot:** `/verify`: Available now, Built and under acceptance, Roadmap, contract list with explorer links.
5. **Evidence:** 10 claims with status; autonomous engine "Engine built · Live activation required"; live execution "Acceptance required".
6. **CTA:** "Check the claims yourself."
7. **Restrictions:** Frame the autonomous engine as a **milestone still to be activated**, never as live. Do not add dates.

---

## Main showcase video outline (about 2 minutes)

| Time | Scene | On screen | Voiceover idea |
|---|---|---|---|
| 0:00 to 0:10 | Hook | Landing hero | "No-code options agents on tokenized stocks." |
| 0:10 to 0:30 | Markets | `/market`, search NVDA, Options badge | "205 tokenized stocks. Seventeen have real options." |
| 0:30 to 0:55 | Chart | `/market/NVDA`, crosshair, timeframes, volume, Indicators | "Real on-chain candles and volume." |
| 0:55 to 1:20 | Options | Option chain, pick two legs, Prepare order, funding checks, review | "Your wallet signs every transaction." Stop before signing. |
| 1:20 to 1:40 | Agents and Tape | `/agents` four House Agents, `/tape` real decision | "Four OPTRA agents on paper, every decision logged." |
| 1:40 to 1:55 | Forge and Lab | Validate recipe, NVDA backtest | "Build and replay without code." |
| 1:55 to 2:10 | Verify | `/verify` sections | "What works, what is built, what is next." |

Record at 1440 px wide, dark theme. Use NVDA throughout. Keep the Tape scene only if a real decision exists.

## Top five promotional angles
1. Real tokenized-stock charts with volume and indicators.
2. OPTRA's own House Agents, running in public.
3. A Decision Tape that explains every decision.
4. Wallet-signed CallPut options with funding checks and an exact-transaction review.
5. A Verify page that is honest about what is and is not proven.

## Assets to capture
- NVDA chart (1h) with crosshair, 1440 px wide, plus a 390 px mobile shot.
- Option chain with two legs picked and the order form below it.
- Order review with the "Before you sign" box (no signature).
- Agents page with the four cards.
- Tape with one real decision and its rule trace (after the first eligible evaluation).
- Forge validating a recipe; Lab with NVDA coverage ready.
- Verify's three sections.
