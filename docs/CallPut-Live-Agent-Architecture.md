# CallPut Live Agent — Execution Architecture and Authorization Boundary

Status: pure safety guard, request classifiers and a durable store (grants, stop, lease, request ledger) implemented and tested; autonomous submission DISABLED. Current CallPut MCP confirms a supported Account/session route, but OPTRA has no owner-specific CallPut Account, session grant, persistent monitor, or integrated execution worker.

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

- No key custody, signing, session-key issuance, or submission path: `submitter` is intentionally unimplemented because CallPut has not confirmed a delegation model for OPTRA agents. Production keeps `LIVE_TRADING_ENABLED=false`, so every authorization fails closed there. Standalone Protective Put execution stays disabled.
- No CallPut Account workflow client. The grant's `route` field records the owner's choice (`direct-wallet` or `callput-account`); the venue-side account, device signer and session terms remain unverified until the owner and CallPut supply them.

## Gates before enabling (owner/venue actions)

1. Owner supplies the actual trading owner address and decides whether to use direct-wallet EOA execution or a CallPut Account. Do not assume the deployment EOA is the trading owner.
2. For automation, the owner configures a CallPut Account workflow with the exact asset, strategy, deposit amount, maximum total collateral, session mode, and deposit gas cap; the distinct device signer and account address must be verified from venue workflow state. No grant, deposit, or signature has been made by this agent.
3. Independently review/audit the account/session contracts and obtain owner approval of the exact permissions, spend caps, expiry and revocation. Rehearse revocation before enabling.
4. Complete one owner-authorized order from the selected trading-account type and reconcile its open, close and settlement lifecycle and position ownership. The 2026-11-20 AAPL 350/345 put-spread scan estimated USDG 2.345 per underlying unit (about USDG 0.2345 for size 0.1); this is not an executable quote. The supplied deployment EOA's 0.45027 USDG would cover that estimate if and only if the owner designates it as the trading wallet, but no such designation or fresh order-specific quote exists. Do not move funds before exact packet review and approval.
5. The database-backed lease, stop and ledger exist. Build the submission worker, API routes and scheduler only after the account and authorization model above is accepted, and keep `LIVE_TRADING_ENABLED=false` until then.
