# P4 gate status, 2026-11-22

Source of the gates: PM brief section 16.1 (G1 to G7) and 16.2 (beta caps). The same evaluator
(`lib/live/gates.ts`) feeds the "Enable live" panel on the Tape page, `GET /api/live/gates`, and the scheduled worker.
The worker asks for no order plan unless all seven gates pass, and a gate that cannot be evaluated counts as failed.

| Gate | Status | Why | Owner or operator action |
|---|---|---|---|
| G1 Venue verified | NOT MET | V1 to V12: 3 verified, 5 partial or fork-only, 3 open, 1 blocked (V11). See `lib/live/venue-checklist.ts`. No owner sign-off recorded. | Close V9 (venue agreement), V10 (premium history), V12 (owner-signed Mainnet open, close, settle). V11 needs CallPut to allow Accounts for the owner wallet. Then set `LIVE_VENUE_SIGNOFF_REF`. |
| G2 Custody ready | NOT MET | No active callput-account grant, and OPTRA holds no signer. CallPut's CURRENT factory is `0x23DB9f5fDde30853EC8eBd75E0492c09505a6D1d` (the one CallPut's own `callput_account_resolve` reports): `openToAll=true`, `safeMode=false`, 8 accounts, and the sample session account `0x9d2b…157e` has `canOpen=true`. So **no CallPut admin action is needed**; an owner wallet's Account is simply not created yet (for the deployer wallet: `0xC1B9970A69Ec2d630997A29fD54dD8E28C4dAA5c`; the connected owner wallet has its own, shown in the Wallet readiness panel). The earlier reading that safe mode blocks Accounts was about the SUPERSEDED factory `0xbcaC…1862` (safe mode on, 5 accounts) and was wrong for production. Still missing: the owner creates and funds the Account and signs a scoped session grant; CallPut's written confirmation that an operator-held device signer is supported; an audit (the factory proxy, its implementation `0x828e…C9ee` and the TradingAccount implementation have no verified source); a revocation test. Evidence: `docs/evidence/callput/trading-account-onchain-probe-20261122.json`. | Owner: create and fund the Account and sign the grant (CallPut's own account workflow, or OPTRA once its integration exists). CallPut: confirm the device-signer model for OPTRA in writing and publish source for the current factory and Account implementation. An independent audit. |
| G3 Global kill switch | OFF (by design) | `LIVE_TRADING_ENABLED` is unset in production. | Operator switches it on manually after G1, G2 and G6. |
| G4 Wallet allowlist | NOT MET | Follows G2. | Owner adds the wallet to `LIVE_WALLET_ALLOWLIST` once G2 passes. |
| G5 Jurisdiction | CLOSED (fails safe) | Blocks US, CU, IR, KP, SY (provisional; counsel owns the final list). The country must come from a trusted server-side source, never a header the client can set: either one header the operator names in `LIVE_GEO_HEADER` because their edge overwrites it, or a server-side lookup (`LIVE_GEO_LOOKUP_URL` with an `{ip}` placeholder, optional `LIVE_GEO_LOOKUP_TOKEN`) on the client IP the operator's own proxy appended (`LIVE_GEO_TRUSTED_HOPS`, default 1, or `LIVE_GEO_IP_HEADER`). Nothing is configured in production, so the country is unknown and the gate stays closed. | Choose a country provider, set `LIVE_GEO_LOOKUP_URL` and its token on Railway, confirm the trusted hop count for Railway's proxy, and have counsel confirm the list (`LIVE_GEO_EXTRA_BLOCKED` extends it). |
| G6 Paper history | NOT MET | Needs one agent with at least 7 launched days and at least 1 settled expiry, computed from `agents.launchedAt` and the paper account's settlement counters (nothing the owner can set). The earlier panel read 'no launched agent' because it looked only at the owner's own agents, while the Agents page shows the four running House Agents, which belong to the OPTRA house user. The candidates are now the owner's agents plus the House Agents, each listed as evidence with its earliest eligible date. The House Agents launched 2026-11-21 23:28 to 23:30 UTC, so day 7 is 2026-11-28. | Time, then one settled expiry on the agent named in the grant. |
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

## Added in this release

* Decision to order mapping (`lib/venue/callput-live-agent-signal.ts`): only Protective Put maps (to a BuyPutSpread at size 0.1). Covered Call and Cash-Secured Put need sell structures the plan builder refuses, and the Earnings Straddle needs a long call and a long put together, so none of them has a CallPut structure. Only an `open` decision starts an order; close, hold and skip send nothing. The mapping is inert until the owner records `LIVE_MAPPING_APPROVAL_REF`, and a decision id is the tick id, so one decision can never become two orders.
* Position discovery on the Tape page: a position is listed only when the chain says the wallet's open request was Executed and the wallet holds a positive token balance, with its close or settle eligibility. A submitted transaction is not a position.
* Live Agent configuration form with validation against the engine's hard caps; it proposes a grant scoped to the Account address, and the grant cannot trade until the evidence exists.

## CallPut Account path: what the venue documents, and what is proven

From CallPut's MCP tool descriptions (read 2026-11-22; venue documentation, not independently proven by OPTRA):

* An owner starts a durable account workflow, selects ONE underlying and ONE spread strategy, a deposit, a gas cap and a total trade-collateral cap (`max_user_amount_raw`), and signs a grant. Steps are login (SIWE), create, deposit, register, open, close, settle, revoke and withdraw. Withdraw and revoke always need the owner's signature.
* `session_mode` is `open_close` or `close_only` (close a held position after the grant ends, with no open allowance). Open and close are separate permissions in the venue's own model.
* An agent runs a separate device signer; opens are submitted through CallPut's relay ("sponsored open"), which cannot be reproduced on a fork.
* On chain: the current factory is open to all with safe mode off, and a real `closeWithSession` transaction exists (device signer `0xBd4a…1356`, 180-day grant, unbounded value caps), so session execution is real. OPTRA has not run an Account creation, a delegated open or a revocation.

## Safest scope for a Monday launch

* Paper Agents (four, running), Decision Tape, Mainnet Verify and the contract directory: operational.
* Manual, owner-confirmed CallPut open, close and settle from the owner's own wallet: shipped, fork-tested, never filled live. Offer it as a supervised beta with the owner placing the first minimal order during the US session.
* Autonomous Live Agent: not operational and must not be presented as launched. Blockers are listed under G1, G2 and G6 above.
