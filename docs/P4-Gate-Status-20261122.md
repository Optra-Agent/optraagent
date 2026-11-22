# P4 gate status, 2026-11-22

Source of the gates: PM brief section 16.1 (G1 to G7) and 16.2 (beta caps). The same evaluator
(`lib/live/gates.ts`) feeds the "Enable live" panel on the Tape page, `GET /api/live/gates`, and the scheduled worker.
The worker asks for no order plan unless all seven gates pass, and a gate that cannot be evaluated counts as failed.

| Gate | Status | Why | Owner or operator action |
|---|---|---|---|
| G1 Venue verified | NOT MET | V1 to V12: 3 verified, 5 partial or fork-only, 3 open, 1 blocked (V11). See `lib/live/venue-checklist.ts`. No owner sign-off recorded. | Close V9 (venue agreement), V10 (premium history), V12 (owner-signed Mainnet open, close, settle). V11 needs CallPut to allow Accounts for the owner wallet. Then set `LIVE_VENUE_SIGNOFF_REF`. |
| G2 Custody ready | NOT MET | No active callput-account grant. OPTRA holds no signer. The CallPut TradingAccountFactory reports `openToAll=false`, `safeMode=true`, and `canOpen=false` for the owner wallet (read from Mainnet, `docs/evidence/callput/trading-account-onchain-probe-20261122.json`). The Account implementation has no verified source. | CallPut must allow the owner wallet to open an Account; then the owner signs a scoped session grant on-chain and the venue, audit, owner and revocation evidence is recorded. |
| G3 Global kill switch | OFF (by design) | `LIVE_TRADING_ENABLED` is unset in production. | Operator switches it on manually after G1, G2 and G6. |
| G4 Wallet allowlist | NOT MET | Follows G2. | Owner adds the wallet to `LIVE_WALLET_ALLOWLIST` once G2 passes. |
| G5 Jurisdiction | CLOSED (fails safe) | Blocks US, CU, IR, KP, SY (provisional, counsel owns the final list). It needs a country the operator's edge sets and overwrites: `LIVE_GEO_HEADER` names the header. Railway sets none today, so the country is unknown and the gate stays closed. | Put an edge that overwrites a country header in front of the app, set `LIVE_GEO_HEADER`, and have counsel confirm the list (`LIVE_GEO_EXTRA_BLOCKED` extends it). |
| G6 Paper history | NOT MET | Needs one agent with at least 7 launched days and at least 1 settled expiry. Computed from the agent's real launch time and settlement counters; it cannot be set by hand. The four House Agents launched 2026-11-21 23:28 to 23:30 UTC, so their day 7 is 2026-11-28 (public API, read 2026-11-22). The gate is evaluated for the agent named in the owner's grant, so a House Agent's history does not count for an owner's own agent. | Time, then one settled expiry on that agent. |
| G7 Acknowledgement | AVAILABLE | Three statements, versioned, stored per owner. Satisfied by the owner on the Tape page. | Owner ticks the three statements. |

## Beta caps (PM 16.2)

| Cap | PM value | Engine enforcement |
|---|---|---|
| Per-position premium or collateral | $25 | Hard cap 10 USDG per order |
| New exposure per user per day | $300 | Hard cap 25 USDG per day, 5 orders |
| Open collateral per live agent | $100 | Hard cap 25 USDG |
| Live agents per user | 1 | Activation refuses a second active grant for the same owner |
| Open positions per agent | 3 | Guard check `open-positions` counts filled, unclosed requests |
| Short options | never naked | Only the four defined-risk spreads are integrated |
| Maximum slippage 1% | not enforceable on open | The venue fills a request at the keeper's price. OPTRA binds a minimum fill ratio (78% default) and the exact collateral, not a price. Close and settle bind a minimum amount out. |

The engine caps are below the PM caps, and `tests/live/gates.test.ts` fails if they ever exceed them.

## Real-wallet and Live Agent status

* Real-money Open to Fill: not performed. It needs the owner's wallet confirmation (a USDG approval, then the order).
  No MetaMask or Phantom extension exists in this machine's browser profiles.
* Close and Settle: fork lifecycle 23 of 23 against the real contracts. No live position exists, so no live close or
  settle has run.
* Autonomous Live Agent: the engine, guard, ledger, submitter and fork acceptance exist (25 of 25), but production has no
  signer, the flag is off, and the venue gates above block Account use.
