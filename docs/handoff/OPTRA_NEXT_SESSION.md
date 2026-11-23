# OPTRA — Next Session Continuation

Written Monday 23 November 2026, about 15:30 UTC (22:30 WIB), at the end of the final PM acceptance. Read this first after `/new`. Longer reference: `OPTRA_V2_FINAL_HANDOFF.md` (contracts, gates, hygiene), `OPTRA_PM_PRODUCT_WALKTHROUGH.md` (PM tour), `../marketing/OPTRA_X_LAUNCH_CONTENT_MAP.md` (posts, video).

Not transaction authorization. Nothing here signs, approves or broadcasts anything.

## 1. Git and deployment state

| Item | Value |
|---|---|
| Branch | `codex/callput-erc1155-guard-lifecycle` |
| Production and remote `main` | `ee17ccf0be04bbb37f3d0c2259e3cbb695541931` (fast-forward from `7ad5ed5`; CI run 45203641187 success on that SHA, tag `ci/optra-release-ee17ccf`, `publish=false`; Railway deployment `ed258081-9f1e-403a-affb-b4fa105a72a9` SUCCESS, `meta.commitHash` equal) |
| Included commits | `f590196` (House Agent detail configuration panel, Lab draft summary and route back; CI run 45197405716 also passed on it) and `ee17ccf` (scheduler receipt-time fix with regression test) |
| Local HEAD | `ee17ccf` plus one local docs-only commit (the four handoff/marketing files). **Not pushed, not deployed**, by instruction; `git log origin/main..HEAD` shows only it |
| Working tree | `next-env.d.ts`, `tsconfig.json`, `tsconfig.tsbuildinfo` modified by builds (generated, never commit). Nothing else |
| Release script | `~/.hermes/cache/scratch/optra-release.sh <run-id> <sha> <parent-sha>` |
| Safety flags | `LIVE_TRADING_ENABLED=false`, `V4_CLAIM_LEVEL=L0`, unchanged |

Deployed UI verified after the release in a real browser: all four `/house/<id>` pages show the Configuration panel ("Last evaluation 23 Nov 2026 · 15:00 UTC · skip") with no horizontal overflow; `/lab` loads.

## 2. Production health (read from https://optraagent.cc)

- `/api/health/live` 200, `/api/health/ready` `{"status":"ready","checks":{"database":"ok"}}`.
- `/api/public/v1/verify`: `liveTradingEnabled: false`, `v4ClaimLevel: L0`.
- Routes 200: `/`, `/market`, `/market/NVDA`, `/agents`, `/forge`, `/lab`, `/tape`, `/verify`, `/hooks`, `/house/<id>`. `/api/venue/callput/orders` without a session = 401.
- `railway.app` host `opetra-production.up.railway.app` is the second domain.

## 3. Module status

| Module | Status | Evidence this session |
|---|---|---|
| Landing, Markets, charts (Candles/Line, volume, indicators, real Crius data) | PASS, unchanged | NVDA page: 21 chart elements, no overflow, Live badge, quote and chain loaded |
| CallPut options chain + manual wallet-signed order flow | Available; **no Mainnet fill yet** | `/market/NVDA` shows "Pick long leg / Pick short leg", Prepare order, Read request, Prepare close; market feed 200 |
| Forge → Lab → Backtest | PASS locally with a test signer on live candles (not on production, see 5) | section 5 |
| House Agent detail pages (4) | PASS on production (`f590196`) | section 6 |
| Scheduler | Running (heartbeat every 10 min). **Defect found, fixed and deployed (`ee17ccf`), see 4** | section 4 |
| Decision Tape | 4 persisted records, all `skip` with a provider-provenance error, not trading decisions | section 4 |
| Verify / claims | `liveTradingEnabled=false`, L0, wallet-signed "Available", engine "Engine built · Live activation required" | public API |
| Autonomous Live Agent | **Inactive** | section 8 |

## 4. House Agents, scheduler and Decision Tape

Four OPTRA House Agents, all `running`, `executionMode PAPER`, launched 21 Nov 2026 23:28–23:30 UTC, virtual capital only:

| Agent | Underlying | Launch backtest (modeled, 720 h) |
|---|---|---|
| Covered Call | NVDA | return −30.66%, versus holding +4.55 pts, max drawdown 34.70%, 7 entries / 7 exits |
| Cash-Secured Put | TSLA | +1.12%, versus holding +6.02 pts, drawdown 0.73%, 2 / 2 |
| Protective Put | NVDA | +0.68%, versus holding +39.21 pts, drawdown 0.60%, 2 / 1 |
| Earnings Straddle | NVDA | +1.86%, versus holding +40.39 pts, drawdown 1.84%, 2 / 2 |

Scheduler evidence (public `/api/public/v1/tape`):
- Heartbeat started 14:20:30 UTC. Passes complete every 10 minutes with 0 failures. A fifth non-House agent (MSFT test agent) is considered and deferred.
- Pass at 15:02:47 UTC ran before the 15:05 finalization grace: nothing eligible, correct.
- Pass at 15:12:55 UTC (the first after 15:05) recorded **4 persisted `skip` decisions** for the 15:00 UTC candle, one per House Agent, `hookResults` = `system.market_data` status `error`, reason "the 14:00–15:00 candle is missing, synthetic, has no trades or fails provenance checks". `decisionCount` is 1 per agent, `orders` is 0, no paper account changed, `latestDecision.createdAt` 2026-11-23T15:00:00Z.
- **Root cause (reproduced):** `lib/paper/scheduler.ts` validated every candle with `receivedAt <= pass start`, but the history is fetched after the pass starts, so every fresh candle is stamped about 4 seconds later (probe: `receivedAfterPassStartMs: 4055`). The candle was in fact valid (53,983 trades, `stable_verified`, `filled false`). The record is an honest data-error outcome from a defective check, not a market judgement.
- **Fix:** compare against the clock read after the fetch. Regression test `tests/integration/paper-scheduler.test.ts` ("evaluates a fresh candle when the history is fetched after the pass starts") fails before and passes after (dataErrors 1 to 0). Included in the release in section 1.
- The 15:00 candle is permanently recorded (idempotent tick). **Do not delete, edit or re-run it**; production data changes need separate explicit owner approval. Do not call these four records evidence of strategy behaviour.
- **Post-deploy evidence (Railway logs, deployment `ed258081`, passes 15:53, 16:03, 16:13 UTC):** all 5 agents `deferred` with reason `market_history_provenance_unverified`, 0 evaluated, 0 data errors, 0 failures. At 16:16 UTC the public coverage for NVDA, TSLA and MSFT read `multiplierStatus: unverified`, 0 candles, and `/api/markets/NVDA/candles` returned `UPSTREAM_UNAVAILABLE`: the Crius candle provider is failing, and the scheduler correctly refuses to evaluate on unverified data. This is a provider outage, not a decision, and nothing was invented. Whether the 16:00 UTC candle is still evaluated depends on the provider recovering before the scheduler's stale-candle limit (`maxCandleAgeMs` in `lib/paper/scheduler.ts`); otherwise it is logged `finalized_candle_stale` and skipped. **The scheduler fix is therefore proven by the unit test and the reproduced probe, not yet by a production evaluation.**
- Public claim to review: Verify's `decision_tape` claim now reads "verified: 4 House Agent decisions are persisted ... Each stores its hourly candle, rule trace and data hash." The 4 records are provenance-error skips with no candle snapshot, so that wording overstates them. Not changed (it needs a release); fix the wording or count only non-error decisions in a later release.
- First candle that can produce a genuine decision: **16:00 UTC, evaluated by the first pass after 16:05 UTC** (about 16:13). Possible legitimate outcomes: open, hold, skip with a rule trace (for example `calmo` blocking), or a real data error. Next sessions must read `/api/public/v1/tape` after that and report what is there.

## 5. Forge → Lab → Backtest acceptance

Production needs a wallet session (a persistent production write the owner must approve), so the run was done on a local dev server (throwaway PGlite database, scheduler off, no production writes) against the **live Crius feed**, driven in a real browser with the repository's test signer. This validates the code path and data, not the owner's MetaMask.

Result for NVDA: Forge UI (name, NVDA, 6.5% OTM, 28 days, 1.5% premium cap) → Validate recipe "Recipe valid" → Save draft → `/agents/<id>` (draft, NVDA, parameters persisted exactly) → "Backtest in Lab" → `/lab?agent=<id>` with the symbol pinned to NVDA, coverage 1,499 / 1,441 candles ready (24 Sep 13:00 to 23 Nov 14:00 UTC, multiplier stable and verified, source `crius_robinhood_chain_candles`) → Run paper backtest → **Backtest complete**: 720 decisions replayed, 2 entries / 1 exit, total return +0.06%, max drawdown −0.07%, window 22 Sep 03:00 to 23 Nov 14:00 UTC, history hash shown, versus buy-and-hold NVDA −24.55%. The agent stayed `draft` afterwards: nothing is launched or promoted automatically, and no real-money path exists in this flow.

Insufficient history: Lab blocks with the exact reason and does not run (production today: AAPL, SPY, MU "multiplier action in window"; COIN 960 of 1,441 candles). Coverage is dynamic: one NVDA read at about 14:41 UTC returned 0 candles and the next read 1,499 (provider flapping). Re-check coverage right before a recording.

Gap found and closed (`f590196`, deployed): Lab did not show the saved draft's settings and had no link back to the draft before launch. It now shows strategy, underlying, reference shares, capital, strike distance, expiry, premium cap, and a "Back to this draft" link; after launch it already links to the agent and Tape.

Existing specs rerun: forge, lab, lab-benchmarks, paper-flow-live-api (custom Protective Put forged, backtested, launched, ticked, read from Tape) 6 of 6; House journeys (`OPTRA_E2E_HOUSE=1`) 4 of 4.

## 6. Agent detail evidence

`/house/<id>` (public, read-only) now has a "Configuration and status" panel built from the stored recipe: strategy type, underlying, execution mode, status, launched time, last evaluation (or "None recorded yet" with the reason), and every configured and risk parameter value (Capra, Daylo, Haltr, Drawra, Exposa and the rest), plus the stored launch-backtest report (return, versus holding and cash, drawdown, decisions replayed, entries and exits, data source, history hash), strategy counters, positions, orders and the Decision Tape. Checked with each agent's real production JSON for all four agents: no horizontal overflow, no page errors, nothing invented (ROI shown only from the stored backtest, Tape lists only persisted records). Equity is `n/a` for Covered Call, as the API reports `null`.

## 7. Manual CallPut trading

Prepared and signed by the owner in MetaMask; OPTRA never signs. `/market/NVDA` leads from the chain to the order form (Pick long/short leg, Prepare order, funding preflight, review, Sign, Read request, Prepare close). Fork lifecycle passed 23 of 23; **no Mainnet fill has happened**. Owner steps for the recording are in section 10.

## 8. Autonomous Live Agent restrictions

Engine built and fork-tested (25 of 25). Inactive in production: `LIVE_TRADING_ENABLED=false`, no signer, no owner grant, G1–G7 unmet (details in the final handoff, section E). Never describe it as live, never enable it, never provision a signer from an agent session.

## 9. Remaining genuine defects and blockers

1. Scheduler provenance defect: fixed and deployed; the four 15:00 UTC error records stay as history. The fix is proven by a unit test, not yet by a production decision.
2. No genuine strategy decision exists. The Crius provider was failing from about 15:50 to at least 16:16 UTC, so the fixed scheduler deferred every agent. Re-check the provider before blaming code.
2b. Verify `decision_tape` claim wording overstates the four error records (section 4).
3. Owner-dependent: MetaMask connection, funding, any Mainnet transaction, production wallet sign-in for a production Forge → Lab run.
4. Provider flapping of Crius coverage (see section 5). Not a code defect; re-check before recording.
5. AAPL, SPY, MU blocked by a stock-token multiplier action in the window; do not bypass.
6. Local hygiene from the previous handoff (`optra-e2e-*` snapshots, `optra-house-*` leaks) is still unfixed; clean gate copies after releases.

## 10. Single showcase video: workflow and owner steps

Recommendation is in the final report. Order: Landing, Markets, NVDA chart, option chain and Prepare order (stop before Sign unless the owner really trades), Agents (four cards, one detail page with the configuration panel), Tape (only show a decision once a genuine one exists from the 16:00 UTC candle on), Forge to Lab NVDA (owner signs in with MetaMask; the login message is not a transaction; get approval for the draft and backtest records first), Verify.

What the owner must do for a real-money segment, and what must not be claimed otherwise:
1. Connect MetaMask on Robinhood Chain (4663), fund a little ETH and USDG.
2. Re-run Prepare order in the panel at or after 21:30 WIB (US options open; before that the keeper leaves it Pending), read the review, tick the confirmation, sign each wallet prompt personally.
3. Treat it as a fill only when Read request shows Executed and the wallet holds the option tokens. Only then record it in `lib/public/mainnet-acceptance.ts` and release. The transaction hash comes from the wallet or the explorer, never from an agent.
4. Without that, say "wallet-signed trading is available", never "executed" or "filled". No simulated transaction may be labelled a real-money fill.

## 11. Exact next actions

1. `git status`, `git log --oneline -5`, `git fetch`, compare `origin/main` with the SHA in section 1.
2. Read `/api/backtests/coverage?symbol=NVDA` (provider health), `/api/public/v1/tape` and `railway logs -d <deployment> --since 30m | grep paper_scheduler` (events `agent_deferred`, `error_recorded`, `run_completed`). Report the outcome of the next eligible candle per agent (open, hold, skip with trace, deferred or error) and confirm Landing, Verify and Agents show the same counts.
3. If the 16:00 UTC records are again data errors, read the scheduler log lines (`paper_scheduler.error_recorded`) before changing code.
4. Update the PM walkthrough (section 4) and X Post 4 with the genuine decision, then give the owner GO for the recording segment that needs it.
5. Do not add House Agents, do not enable Live, do not touch production data.
