# OPTRA — Next Session Continuation

Updated Tuesday 24 November 2026, 09:44 UTC (16:44 WIB), Batch 03 pre-release snapshot. Local verification is complete; this note predates the final commit, pinned-SHA CI and Railway release. The final completion report supplies those later facts. Read this first after `/new`. Longer reference: `OPTRA_V2_FINAL_HANDOFF.md` (contracts, gates, hygiene), `OPTRA_PM_PRODUCT_WALKTHROUGH.md` (PM tour), `../marketing/OPTRA_X_LAUNCH_CONTENT_MAP.md` (posts, video).

Not transaction authorization. Nothing here signs, approves or broadcasts anything.

## 1. Git and deployment state

| Item | Value |
|---|---|
| Branch | `codex/callput-erc1155-guard-lifecycle` |
| Production and remote `main` | Read-only baseline verified 24 Nov 2026 09:44 UTC: `4797eedd9ed27e1b66dafb3fa3953dd216a38ce8`; Railway deployment `d3695933-4069-4e7c-b3ae-266bf042d4a0` SUCCESS with matching full `meta.commitHash` |
| Local HEAD | Batch 02 `934533eb32330817e4f984da31b435c4d1d4c660`, directly above Batch 01 `125f7275786bde1ebe1dd0ca14c1e0eeb2b799ae`; Batch 03 changes are uncommitted at this snapshot |
| Working tree | Reviewed in-scope Live Agent test, workflow, evidence and handoff changes plus unrelated `.DS_Store` and generated build files. Commit only the reviewed task paths; preserve the rest |
| Local verification | 86 test files passed / 2 skipped; 643 tests passed / 2 skipped; lint, typecheck and production build passed on Node 26.12.1 / Bun 1.3.14; authenticated G7 browser test 1/1 against isolated local PGlite with a generated throwaway wallet |
| Fork acceptance | 25/25 on a fresh isolated Robinhood Chain fork pinned to block 122119407, hash `0x5e1b5ff78bbd7d98be5344ab2c6e69dc555b509a1751d49ec89a84271dbc47d9`; unpinned inconsistency traced to request/plan misassociation. Market-data inputs were live, not fixture-pinned. Block 122102881 could not be forked because required historical state was unavailable |
| Release process | `~/.hermes/cache/scratch/optra-release.sh <run-id> <full-sha> <parent-sha>`; unique tag pinned to the exact candidate, `publish=false`, then fast-forward `main` only after CI |
| Safety flags | Last confirmed production baseline: `LIVE_TRADING_ENABLED=false`, `V4_CLAIM_LEVEL=L0`; preserve both. No contract redeploy, production wallet action, or recording-session change |

Prior production UI notes below are historical evidence from the deployment preceding this candidate; they were not re-run at this pre-release snapshot. Keep the separate recording session and its port-8561 fork untouched.

## 2. Production baseline health (pre-release; fresh post-release result belongs in completion report)

- `/api/health/live` 200, `/api/health/ready` `{"status":"ready","checks":{"database":"ok"}}`.
- `/api/public/v1/verify`: `liveTradingEnabled: false`, `v4ClaimLevel: L0`.
- Routes 200: `/`, `/market`, `/market/NVDA`, `/agents`, `/forge`, `/lab`, `/tape`, `/verify`, `/hooks`, `/house/<id>`. `/api/venue/callput/orders` without a session = 401.
- `railway.app` host `opetra-production.up.railway.app` is the second domain.

## 3. Module status at the pre-release production baseline

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

## 8. Autonomous Live Agent restrictions and current engineering state

At the timestamp above, local verification passed: 86 test files passed / 2 skipped; 643 tests passed / 2 skipped; lint, typecheck and production build passed on Node 26.12.1 / Bun 1.3.14; the authenticated G7 browser flow passed 1/1 against the isolated local app/PGlite database using a generated throwaway key; and the Live Agent fork acceptance passed 25/25 at pinned block 122119407. That browser test validates persisted acknowledgement and gate reporting for its test identity; it is not the owner's production acknowledgement. The authenticated status endpoint and worker use the same G1–G7 evaluator. The proposed Paper decision source rejects foreign/private agents and stale, errored, unlaunched, or recipe-mismatched decisions. A prior unpinned acceptance varied because the harness chose the latest actor plan rather than the submitted request's plan; `fillLast` now receives the exact request-associated plan. A separate pinned attempt at block 122102881 stopped before assertions because the upstream RPC lacked required historical state. Production remains inactive (`LIVE_TRADING_ENABLED=false`, `V4_CLAIM_LEVEL=L0` at the verified baseline); no signer is wired, no owner grant is verified, and activation is not eligible. Pinned-SHA CI and Railway release had not run at this snapshot. See the activation checklist for the actual owner, CallPut, counsel, audit/custody, scheduler and time-dependent blockers.

## 9. Genuine Live Agent activation dependencies (engineering release does not satisfy these)

1. CallPut must answer in writing whether OPTRA automation and an operator-held session signer are permitted, and provide current grant, custody, cancellation, rate-limit, support, source/upgrade and audit evidence.
2. Independent review must verify the resolver-selected Account, exact bounded grant enforcement/revocation and signer custody. Only then may the owner create/fund the exact Account and sign its grant.
3. Counsel must approve the jurisdiction policy and the trusted production location source; the owner wallet must be identified/allowlisted by the authorized operator only after G2 passes.
4. G6 needs seven full genuine Paper days, at least one current-recipe evaluated decision and one settled expiry. The age-only earliest point is `2026-11-28T23:28:28.066Z`; no history may be seeded or backdated.
5. The owner must personally review the current G7 statements and, after all earlier conditions, the strategy mapping and any real CallPut lifecycle actions. The throwaway browser-test acknowledgement is not owner evidence; no production owner gate report was read.
6. An approved external scheduler, production `CRON_SECRET` and alert/monitoring destination are not verified. Configure these only after the activation requirements are genuinely met; keep the execution switch off until the operator's final authorized step.

Historical scheduler/provider and recording notes in sections 4–8 remain context only; do not treat them as Batch 03 blockers or as current production evidence.

## 10. Single showcase video: workflow and owner steps

Recommendation is in the final report. Order: Landing, Markets, NVDA chart, option chain and Prepare order (stop before Sign unless the owner really trades), Agents (four cards, one detail page with the configuration panel), Tape (only show a decision once a genuine one exists from the 16:00 UTC candle on), Forge to Lab NVDA (owner signs in with MetaMask; the login message is not a transaction; get approval for the draft and backtest records first), Verify.

What the owner must do for a real-money segment, and what must not be claimed otherwise:
1. Connect MetaMask on Robinhood Chain (4663), fund a little ETH and USDG.
2. Re-run Prepare order in the panel at or after 21:30 WIB (US options open; before that the keeper leaves it Pending), read the review, tick the confirmation, sign each wallet prompt personally.
3. Treat it as a fill only when Read request shows Executed and the wallet holds the option tokens. Only then record it in `lib/public/mainnet-acceptance.ts` and release. The transaction hash comes from the wallet or the explorer, never from an agent.
4. Without that, say "wallet-signed trading is available", never "executed" or "filled". No simulated transaction may be labelled a real-money fill.

## 11. Next session

1. Read the Batch 03 completion report for the exact final commit, pinned CI run, Railway deployment SHA, health and public smoke results. Do not repeat the full local suite if no code changed.
2. Keep `LIVE_TRADING_ENABLED=false` and `V4_CLAIM_LEVEL=L0`; do not create a production wallet session or touch production Paper data for this handoff.
3. Continue only the owner/CallPut/counsel/audit/scheduler items in section 9 and the activation checklist. Do not repeat gate implementation or claim activation eligibility from engineering tests.
4. Preserve the separate recording session and wallet state; no action on its port-8561 fork.
