# CallPut Live Agent — Execution Architecture and Authorization Boundary

Status: pure safety guard and request classifiers implemented; autonomous submission DISABLED. Current CallPut MCP confirms a supported Account/session route, but OPTRA has no owner-specific CallPut Account, session grant, persistent monitor, or integrated execution worker.

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

## Not implemented, by design

- No key custody, signing, session-key issuance, or submission path. No API route or scheduler calls this module yet. Persistent request storage/monitoring, database-backed leases, and durable emergency-stop state are not implemented. Standalone Protective Put execution stays disabled.

## Gates before enabling (owner/venue actions)

1. Owner supplies the actual trading owner address and decides whether to use direct-wallet EOA execution or a CallPut Account. Do not assume the deployment EOA is the trading owner.
2. For automation, the owner configures a CallPut Account workflow with the exact asset, strategy, deposit amount, maximum total collateral, session mode, and deposit gas cap; the distinct device signer and account address must be verified from venue workflow state. No grant, deposit, or signature has been made by this agent.
3. Independently review/audit the account/session contracts and obtain owner approval of the exact permissions, spend caps, expiry and revocation. Rehearse revocation before enabling.
4. Complete one owner-authorized order from the selected trading-account type and reconcile its open, close and settlement lifecycle and position ownership. The 2026-11-20 AAPL 350/345 put-spread scan estimated USDG 2.345 per underlying unit (about USDG 0.2345 for size 0.1); this is not an executable quote. The supplied deployment EOA's 0.45027 USDG would cover that estimate if and only if the owner designates it as the trading wallet, but no such designation or fresh order-specific quote exists. Do not move funds before exact packet review and approval.
5. Implement database-backed monitoring/lease/stop controls and wire the pure guard only after the above account and authorization model is accepted; keep `LIVE_TRADING_ENABLED=false` until then.
