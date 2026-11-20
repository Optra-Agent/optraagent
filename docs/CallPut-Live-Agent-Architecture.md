# CallPut Live Agent — Execution Architecture and Authorization Boundary

Status: components implemented; autonomous submission DISABLED and not enableable from this repository.

## What the venue supports (verified)

- CallPut's documented model is unsigned-payload preparation plus external user signing. The MCP "does not hold private keys, sign or broadcast" (docs.callput.app/ai-agents/agent-quickstart). Execution is asynchronous: submission registers a request; only `Executed` is a fill.
- CallPut documents no delegation, session-key, operator allowlist, or automation permission terms. The questions in `docs/CallPut-Robinhood-Mainnet-Integration-Request.md` (caller matrix, delegation, automation) are unanswered. TradingAccountFactory/beacon exist on chain 4663, but OPTRA's account route is not implemented because its custody and delegation model is unconfirmed.
- Read-only probe (`scripts/callput-robinhood-contract-caller-probe.ts`, block 119,052,252): the Controller's `createOpenPosition` simulation succeeds identically from an EOA and from an address carrying contract code (same request key, 603,354 gas). So the Controller does not reject contract callers in simulation. This is not a fill and not proof that a smart account works end to end (fee refunds, position ownership on close, and settlement from a contract were not exercised).

## Architecture

1. Owner wallet is the only fund authority.
2. Automation requires a trading address (the owner's EOA, or an owner-controlled smart account) and a grant that the CHAIN enforces: allowed contracts (CallPut Controller, USDG), per-call and total spend caps, expiry, revocation. Robinhood Chain supports ERC-4337 and EIP-7702 session keys (docs.robinhood.com/chain/account-abstraction). Software limits alone are not accepted because a compromised worker could ignore them.
3. The agent worker holds only the restricted session key. OPTRA code proposes; `evaluateLiveAgentOrder` disposes; the account contract is the last wall.
4. Every order: Paper Agent decision -> `prepareCallPutOpenSpread` (fresh quote, venue checks) -> policy check -> idempotency key -> single-flight lease -> submit -> request-key capture from the receipt -> poll `Pending/Executed/Cancelled` -> reconcile.
5. Stale, unknown, or missing requests halt all new orders. Any failed check blocks. Kill switch defaults to stopped.

## Implemented (lib/venue/callput-live-agent-guard.ts, tests/options/callput-live-agent-guard.test.ts, 10 tests)

- `evaluateLiveAgentOrder`: kill switch, grant expiry, trading-address binding, underlying/strategy allowlists, per-order/open/daily collateral caps, order count, pending-request cap, execution-fee cap, expiry window, venue checks.
- `autonomyBlockers`: five evidence gates (venue delegation confirmation, on-chain grant, audit, owner approval, revocation rehearsal). All five must be evidenced; none can be satisfied by code.
- `liveAgentIdempotencyKey`, `classifyRequests` + `shouldHaltNewOrders`, `canAcquireLease`.
- Default policy: stopped, empty allowlist, BuyPutSpread only, 10 USDG per order, 25 USDG open/day, 2 orders/day, 1 pending request.

## Not implemented, by design

- No key custody, signing, session-key issuance, or submission path. No API route or scheduler calls this module yet; wiring it is blocked on the gates below. Standalone Protective Put execution stays disabled.

## Gates before enabling (owner/venue actions)

1. CallPut written confirmation that a user-owned smart account/session key may call the Controller and later close/settle, with fee-refund behavior. Alternative: CallPut's own TradingAccount delegation terms.
2. Choose and audit the account/session contracts (or provider: Alchemy/ZeroDev) and the exact permission set.
3. One manually signed CallPut order from that same trading address, reconciled to `Executed`, proving open, close and settle for that address type.
4. Owner approves the exact policy (caps, allowlists, expiry) and signs the on-chain grant. Revocation rehearsed.
5. Only then wire the guard to the scheduler and enable per agent.
