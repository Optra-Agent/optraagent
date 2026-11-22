# CallPut Live Agent — Execution Architecture and Authorization Boundary

Status: pure safety guard, request classifiers, durable store, worker, scheduler, owner controls, a signer submitter and a grant-bounded plan source are implemented and tested, and the whole engine passed a 25-assertion acceptance run against the real CallPut contracts on a mainnet fork. Autonomous submission is DISABLED in production, which wires no signer and holds no key. The owner-confirmed path (wallet-signed open, close and settle on Tape) is the working real-money path.

## What the venue supports (verified)

- Current Robinhood Mainnet MCP (`callput_get_network_info`, chain 4663; deployment version `2026-11-08.1`) reports `execution=unsigned_only` for direct-wallet tools and a configured `callput_account` workflow. That workflow lists `open_close` and `close_only` session modes, supports resolve/create/deposit/register/open/close/settle/withdraw/revoke/recover, stores workflow state encrypted-persistently, and requires an external signer distinct from the owner; owner keys are not accepted and browser approval is unavailable through MCP. These are venue capability facts, not a grant to this OPTRA agent or proof of a specific account's permissions.
- Direct-wallet MCP calls require a separately funded external signer that owns positions. The current `callput_execute_spread` schema accepts size values from `1e-18` upward; there is no 1.0 minimum in the schema. A prior local 0.1-share approval packet is within that schema, but remains non-actionable because its feed marks are indicative, the trading signer has not been designated, and no fresh executable order quote was produced. The MCP's `callput_scan_spreads` values are estimated market parameters, not a transaction-specific executable quote.
- Execution remains asynchronous: submission registers a request; only `Executed` is a fill. Use the on-chain request key, and independently reconcile position/balance ownership. The Mainnet account-workflow and direct-wallet routes are distinct: never use an account relay UUID as an on-chain request key or substitute the account address for the external device signer.
- Read-only probe (`scripts/callput-robinhood-contract-caller-probe.ts`, block 119,052,252): the Controller's `createOpenPosition` simulation succeeds identically from an EOA and from an address carrying contract code (same request key, 603,354 gas). So the Controller does not reject contract callers in simulation. This is not a fill and not proof that a smart account works end to end (fee refunds, position ownership on close, and settlement from a contract were not exercised).

## Architecture

1. Owner wallet is the only fund authority.
2. The supported candidate automation route is a CallPut Account workflow with an owner-created, venue-enforced session grant and a distinct device signer. Before use, obtain the actual owner/account addresses, select the approved underlying/strategy, specify hard deposit and total-trade collateral caps, set `open_close` or `close_only`, review venue `next_actions`, and verify the deployed account/session constraints and revocation path. The `callput_workflow_start` tool only prepares a durable workflow and does not deposit or sign; subsequent owner approvals remain external.
3. The agent worker may hold only the restricted device/session signer after the owner grants it. OPTRA policy limits are an additional fail-closed layer, not a substitute for venue-enforced permissions. The current guard is not wired to that workflow or a persistent scheduler.
4. Every order: Paper Agent decision -> `prepareCallPutOpenSpread` (fresh quote, venue checks) -> policy check -> idempotency key -> single-flight lease -> submit -> request-key capture from the receipt -> poll `Pending/Executed/Cancelled` -> reconcile.
5. Stale, unknown, or missing requests halt all new orders. Any failed check blocks. Kill switch defaults to stopped.

## Implemented (lib/venue/callput-live-agent-guard.ts, tests/options/callput-live-agent-guard.test.ts, 10 tests)

- `evaluateLiveAgentOrder`: kill switch, grant expiry, trading-address binding, underlying/strategy allowlists, per-order/open/daily collateral caps, order count, pending-request cap, execution-fee cap, expiry window, venue checks.
- `autonomyBlockers`: five evidence gates (venue delegation confirmation, on-chain grant, audit, owner approval, revocation rehearsal). All five must be evidenced; none can be satisfied by code.
- `liveAgentIdempotencyKey`, `classifyRequests` + `shouldHaltNewOrders`, `canAcquireLease`.
- Default policy: stopped, empty allowlist, BuyPutSpread only, 10 USDG per order, 25 USDG open/day, 2 orders/day, 1 pending request.

## Durable store (lib/venue/callput-live-agent-store.ts, migration 0006, 15 integration tests)

- Tables: `live_agent_controls` (durable emergency stop; a missing row means stopped), `live_agent_grants` (owner grant; created `proposed`, `active` only with all five autonomy evidence references; one active grant per owner and agent), `live_agent_requests` (idempotency-keyed request ledger with monotonic states `reserved -> submitted -> pending -> executed|cancelled|stale|unknown -> closed`), `live_agent_leases` (one expiring single-flight lease per owner).
- Hard caps no grant row can exceed: 10 USDG per order, 25 USDG open and daily, 5 orders per day, 1 pending request, 0.0003 ETH execution fee, 30-day grant lifetime. Assets and strategies must come from the venue allowlists; unknown fields are rejected.
- `reserveAuthorizedLiveAgentOrder` reserves a request row only when `LIVE_TRADING_ENABLED` is exactly `true`, the grant is active for this agent with every evidence reference, the durable stop is clear, the caller holds the unexpired lease, no request is stale or unknown, and the pure policy in `callput-live-agent-guard` passes. Reserving is bookkeeping: it signs and submits nothing. A replayed decision returns the existing row.
- `reconcileLiveAgentRequests` maps on-chain snapshots to request states; a stale request, a tracked key with no snapshot, or a submitted transaction without a request key after 10 minutes trips the durable stop. The stop survives a database reopen (tested). `revokeLiveAgentGrant` also stops the agent. Every grant, evidence, lease and request call is scoped by owner id (cross-owner access tested).
- `resumeLiveAgent` refuses unless the flag is on, an unexpired active grant has full evidence, and no request is stale or unknown. Evidence values are recorded references; the code does not verify them against the venue or chain.

## Worker, scheduler and owner controls (integrated, 30 integration and component tests)

- `runLiveAgentTick` (lib/venue/callput-live-agent-worker.ts): acquire the lease; reconcile in-flight requests from on-chain snapshots; stop on stale or unknown; ask the plan source for a plan; run every gate and reserve idempotently; submit only through a supplied `LiveAgentSubmitter`. A failed RPC read or quote means no order and no guessed state. An ambiguous submission error marks the request `unknown` and trips the durable stop; only `NotBroadcastError` cancels cleanly.
- `runLiveAgentSchedule` and `POST /api/cron/live-agent` (bearer `CRON_SECRET`): disabled unless `LIVE_TRADING_ENABLED=true`. Enabled, it visits active unexpired grants. The default plan source returns no plan (no mapping from a Paper Agent decision to a CallPut order is approved) and there is no bundled submitter, so a pass reconciles and monitors only. The schedule is not enabled on Railway.
- Owner API (session-authenticated, owner-scoped): `GET /api/venue/callput/live-agent` (state, grants, requests), `POST .../stop`, `POST .../grants` (propose only; hard caps enforced), `POST .../grants/{id}/revoke` (also stops). Evidence recording, activation and resume are deliberately not exposed.
- Tape shows an "Agent controls" panel: state, grants, requests, Emergency stop and Revoke. It reports execution off and no submission route on this deployment.
- Tested: restart recovery, duplicate tick and idempotent replay, risk-limit enforcement, authorization expiry, RPC failures, ambiguous and proven-unsent submission failures, revocation, lease contention, owner isolation.

## Not implemented, by design

- No key custody, session-key issuance or production signer. `createSignerSubmitter` exists and is tested, but production never constructs one: it needs an injected signer, and no signer is provisioned. Production keeps `LIVE_TRADING_ENABLED=false`, so every authorization fails closed there. Standalone Protective Put execution stays disabled.
- No CallPut Account workflow client (no calls to `callput_workflow_start`, `callput_wallet_connect` or the action tools). The grant's `route` field records the owner's choice (`direct-wallet` or `callput-account`); the venue-side account, device signer and session terms remain unverified until the owner and CallPut supply them.

## Gates before enabling (owner/venue actions)

1. Owner supplies the actual trading owner address and decides whether to use direct-wallet EOA execution or a CallPut Account. Do not assume the deployment EOA is the trading owner.
2. For automation, the owner configures a CallPut Account workflow with the exact asset, strategy, deposit amount, maximum total collateral, session mode, and deposit gas cap; the distinct device signer and account address must be verified from venue workflow state. No grant, deposit, or signature has been made by this agent.
3. Independently review/audit the account/session contracts and obtain owner approval of the exact permissions, spend caps, expiry and revocation. Rehearse revocation before enabling.
4. Complete one owner-authorized order from the selected trading-account type and reconcile its open, close and settlement lifecycle and position ownership. The 2026-11-20 AAPL 350/345 put-spread scan estimated USDG 2.345 per underlying unit (about USDG 0.2345 for size 0.1); this is not an executable quote. The supplied deployment EOA's 0.45027 USDG would cover that estimate if and only if the owner designates it as the trading wallet, but no such designation or fresh order-specific quote exists. Do not move funds before exact packet review and approval.
5. The database-backed lease, stop and ledger exist. Build the submission worker, API routes and scheduler only after the account and authorization model above is accepted, and keep `LIVE_TRADING_ENABLED=false` until then.


## Execution engine and fork acceptance (2026-11-22)

New in this revision, all in `lib/venue` and covered by `tests/options/callput-live-agent-submitter.test.ts` (14 tests) plus the existing store, worker and control tests:

- `createSignerSubmitter` (`callput-live-agent-submitter.ts`): sends a plan's approval and open transactions through an injected signer, simulating each immediately before it is sent, and returns the request key read from the receipt. It holds no key. Its error contract with the worker: a failed simulation, a wallet rejection, a failed or reverted approval or a reverted open is `NotBroadcastError` (the order provably was not created: reservation cancelled, agent keeps running); any other error after the open is sent is an unknown outcome (request marked unknown, agent stopped); an unseen open receipt returns the hash without a key and is left to reconciliation.
- `prepareGrantBoundedPlan` (`callput-live-agent-plan.ts`): structure selection only (nearest eligible expiry, the two available strikes closest to spot, buy put or call spreads). It is not a trading signal, and no mapping from a Paper House Agent decision to an order is approved, so the scheduler does not use it.

Acceptance: `scripts/callput-live-agent-fork-acceptance.ts`, log `docs/evidence/callput/live-agent-fork-acceptance-20261122.log`, 25/25. It runs the real scheduler, worker, store, guard, plan source and submitter against the real contracts with throwaway signers and an in-process database, and shows: nothing happens while `LIVE_TRADING_ENABLED` is unset; a scheduled pass signs and submits exactly one order, whose request key is on the ledger and agrees with the chain, and whose collateral matches; replaying the same decision sends nothing; a second order while one is pending is blocked; after a keeper fill the next tick reconciles to executed and the option-token balance confirms it; a declined signature cancels the reservation without stopping the agent; the daily order cap and the emergency stop block orders; a revoked grant sends nothing and cannot be resumed; a request pending past the venue window goes stale, halts the agent and blocks resume until the chain shows it cancelled; an error after broadcast marks the request unknown and stops the agent, and the order really did land on chain, which is why a blind retry would be wrong.

What this does not show: that CallPut accepts an OPTRA-operated key, any behaviour of the venue's off-chain account relay or sponsor (not reproducible on a fork), or the live keeper's behaviour for an OPTRA order.

## Venue permission, re-read 2026-11-22

CallPut's public Terms of Use prohibit scraping and interfering with its systems and say nothing about automated trading or written permission. Its AI-agents documentation (agent quickstart, trading loop and recovery, CallPut MCP) describes the sanctioned model: the agent prepares unsigned payloads and an independent, user-approved wallet signs; the MCP never holds keys or signs. That is the model OPTRA ships for open, close and settle. The Account workflow is venue-published: one underlying and one strategy per grant, a deposit and total trade-collateral cap, a distinct device signer that must differ from the owner, session expiry, owner revoke and proof-based recover. An earlier version of this repository described the Terms as requiring written permission; that was not supported by the text and is corrected.

## Exact blockers to autonomous real-money execution

1. Owner action: create the CallPut Account, sign the grant (login, create, deposit, register) and fund it. These move real funds and only the owner can do them.
2. Key custody: the venue requires a separate local device signer. Running it on a server means OPTRA holds a session key. Whether that is acceptable, and whether CallPut supports an operator-held signer for OPTRA, are decisions for the owner and a question for CallPut.
3. On-chain limits not verified: the venue describes spend caps, expiry and revocation for a grant and reports "chain counters", but the account and session contracts have not been independently audited and their enforcement has not been verified here.
4. Decision source: no mapping from a Paper House Agent decision to a real order is approved. Without a decision source an engine that works has nothing to execute.
5. Not testable on a fork: the account relay and sponsor are off-chain venue services, so an end-to-end account-route trial needs real funds.
