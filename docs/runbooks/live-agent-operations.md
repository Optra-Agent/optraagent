# OPTRA Live Agent — operator runbook

Status: the Live Agent is not activated. This runbook authorizes no production change, wallet signature, funding, or trade. Keep `LIVE_TRADING_ENABLED=false` and `V4_CLAIM_LEVEL=L0` until the owner, CallPut, counsel, security, and operator gates below are independently satisfied.

## Non-negotiable stop conditions

Do not enable the Live Agent if any G1–G7 gate is blocked, stale, or unverified. A recorded reference is not proof by itself. Fork results, UI success, a transaction hash, a pending request, and Paper positions are not Mainnet fills or settlements.

Never put a private key, seed phrase, wallet signature, or 2FA code in OPTRA configuration or chat. Do not use the owner's login wallet as an autonomous device signer. Do not use saved acknowledgement location as current jurisdiction evidence. Do not retry, cancel, or replace a CallPut request whose outcome is unknown.

The production scheduler route has no signer wired into it. A successful scheduler response is not proof that an order can be submitted.

## Activation evidence checklist

Record evidence references and dates outside secrets. The live evaluator is `lib/live/gates.ts`; verify the same result in the authenticated Enable-live panel and in the worker before any final operator action.

- [ ] G1 — Venue verified: every V1–V12 row in `lib/live/venue-checklist.ts` is verified with current evidence, and the owner has signed off. Fork-only evidence remains partial. Record `LIVE_VENUE_SIGNOFF_REF` only after that review.
- [ ] G2 — Custody ready: the owner's exact CallPut Account is read from the current factory and matches the active grant's `tradingAddress`; the account is eligible to open; the owner created/funded it and signed the bounded session grant; CallPut permission, independent audit, owner approval, key custody, and a tested on-chain revocation path are documented. A read for a different Account does not count.
- [ ] G3 — Global switch: keep off during all preparation. The operator sets `LIVE_TRADING_ENABLED=true` only as the final activation step after every other gate is met and rechecked. The process kill switch and owner stop remain independent overrides.
- [ ] G4 — Wallet allowlist: the exact owner wallet shown by the connected-wallet UI is allowlisted only after G2 passes. Do not infer the owner wallet from the deployer address or paste it into a command from memory.
- [ ] G5 — Jurisdiction: counsel approves the final restricted-country/region policy. The Enable-live request must resolve the owner through an operator-trusted edge header or server-side lookup. The autonomous worker currently has no trusted view of the owner's current location and therefore fails G5 closed; an old acknowledgement country is not a substitute. Do not use the cron caller's location as the owner's location.
- [ ] G6 — Paper history: wait at least seven full days from a genuine agent `launchedAt` and require a genuinely settled expiry cycle on the agent named by the grant. Confirm evaluated Paper decisions and settlement counters from the real database evidence; exclude `system.market_data` errors. Do not seed, edit, or backdate records.
- [ ] G7 — Risk acknowledgement: the owner personally acknowledges every current-version risk statement in the authenticated panel. This does not substitute for any other gate.

If any gate fails or cannot be read, stop. The worker must independently re-evaluate the gates on every pass; a green panel alone is insufficient.

## Owner and CallPut actions still required

Owner actions are performed by the owner in their own wallet, not by the OPTRA agent:

1. Connect the owner's wallet to OPTRA and confirm the displayed address and Robinhood Chain (4663). Use the Wallet readiness panel to identify the owner's Account; never assume it is the deployer Account.
2. Only after CallPut confirms the current Account workflow and applicable terms, create the Account, fund it with the owner-approved USDG and required native gas, and confirm registration. Review the exact values in the wallet before signing or sending.
3. Before signing anything, obtain CallPut's current exact grant schema and written confirmation of how each scope, amount/gas cap, expiry, signer and revocation field is enforced. A 2026-11-22 observed close-only session had several maximum-value fields and inferred field names; do not copy it or sign a grant based on that sample. Only after CallPut and an independent auditor verify the bounded grant, the owner may sign it in CallPut's flow. The device signer must be separate from the owner wallet; OPTRA must not receive or generate its key until the custody design is approved and audited.
4. For V12, the owner performs the specifically approved minimal manual Mainnet open, then a real venue-confirmed close and settlement, using their wallet and recording the venue request/fill plus independent position-balance evidence. This is not part of this runbook's current execution.
5. The owner records the current-version risk acknowledgements and separately confirms the approval reference for the strategy-to-order mapping.
6. For emergency revocation or a close-only transition, the owner uses CallPut's owner-signed workflow and verifies the resulting session state. OPTRA's database grant revocation is not proof that the CallPut on-chain/session grant was revoked.

Before any autonomous signer integration, obtain written CallPut answers for: whether an OPTRA-operated external device signer is permitted; the applicable terms, rate limits, and support/escalation process; exact session enforcement and revocation semantics; pending/partial-open behavior and cancellation (the current MCP reports manual cancellation unsupported); and contract/source/audit status for the current factory proxy and Account implementation. A venue capability or tool description is not an OPTRA-specific authorization.

Copy/paste request to CallPut:

> Subject: OPTRA automation authorization and current CallPut Account controls
>
> We are evaluating a narrowly scoped, owner-authorized automation integration on Robinhood Chain (4663). Before we connect any signer or submit an automated order, please answer each item in writing and link the current official documentation or contract evidence:
>
> 1. Does CallPut explicitly permit OPTRA to automate opening, closing and settling options for an owner's CallPut Account? Is an operator-hosted, restricted device/session signer supported, or must each transaction be signed by the owner? Please identify the applicable terms, jurisdictions, account requirements and any written authorization we must obtain.
> 2. What is the current resolver-selected factory/proxy, implementation/beacon and Account implementation for Robinhood Chain? Please provide the resolver method/address, verified source and upgrade path, and the current exact session-grant schema (including typed-data fields and units).
> 3. Which limits are enforced on-chain for every open/close/settle: Account and signer scope, underlying and strategy, per-order and aggregate collateral, gas/execution fee, expiry, and open-versus-close permissions? How are those limits checked at the actual execution entry point?
> 4. What are the exact owner creation, funding, registration, grant, revoke, recovery and close-only workflows? Which owner signatures are required, how can the owner independently verify that a grant is revoked, and what happens to Account funds and positions during recovery?
> 5. For open requests, how are pending, partial, failed and unknown outcomes represented? Can an owner cancel a pending request, when can the keeper still fill it, and what source is canonical for request status and position ownership?
> 6. What API/contract polling and scheduler rates are permitted, what data is available for historical option premiums/IV, and what support/escalation route should be used for an ambiguous request?
>
> Please distinguish documented capability from permission for OPTRA specifically. We will not provision a signer or enable autonomous execution until the exact answers, current contracts and revocation controls have been independently reviewed.

## Scheduler and monitoring

`POST /api/cron/live-agent` is the only Live Agent worker entry point. It requires `CRON_SECRET`; with the process switch off it returns `disabled` and does no Live Agent work. Configure neither the secret nor an external caller as part of this runbook until activation is authorized. A monitor must not send an authenticated request to an unapproved production deployment.

When the scheduler is eventually approved and configured, its caller/monitor must:

- check HTTP status and the JSON `status`, `monitoring.status`, `monitoring.statusCounts`, and per-grant `results` on every invocation;
- alert immediately on unexpected HTTP 5xx, `monitoring.status=critical`, `halted`, `submission-unknown`, or `rpc-failure`; alert on persistent `monitoring.status=attention` / `gated` results; treat `no-submission-route` as non-operational, not success;
- distinguish expected `disabled` while the global switch is intentionally off from an unexpected disabled result after activation;
- treat `pendingReconciliationCount` as outstanding tracked work, not a fill; do not treat `no-trade` or a completed pass as proof of a fill;
- retain redacted run timestamps and status summaries, never authorization headers, secrets, signatures, or private keys.

No external scheduler or alert destination is currently verified. This requires an operator-owned scheduler/monitor and production configuration; it is not completed by local tests.

## Emergency stop and incident handling

1. In Tape → Live Agent controls, use **Emergency stop**. It durably stops OPTRA's agent and waits up to three seconds for the worker lease to drain. HTTP 202 / “worker lease remains” means quiescence is unconfirmed: keep the scheduler disabled, switch live execution off, and reconcile the active request before treating the stop as complete. Even a confirmed stop does not cancel an already-submitted CallPut request.
2. Set `LIVE_TRADING_ENABLED=false` through the authorized production operator workflow and disable the external scheduler caller. Keep `V4_CLAIM_LEVEL=L0`.
3. Use the owner-scoped controls to revoke the OPTRA grant. Separately revoke the CallPut session with the owner's signature and verify the venue reports it revoked. Do not assume the OPTRA database action revoked the venue session.
4. Inspect each tracked request in the owner panel and reconcile its canonical request key against CallPut. Pending requests may still be filled; the venue currently reports no manual cancellation. If a request is missing, stale, or ambiguous, leave the agent stopped and contact CallPut; do not submit a replacement.
5. Preserve timestamps, request keys, transaction hashes, redacted scheduler results, and the exact gate report. Do not label a request `Executed` as a fill without independent position-token balance evidence; do not label a receipt as settlement.
6. Resume only after the incident is understood, any venue session is safely revoked or re-authorized by the owner, all gates are re-evaluated, and the operator records a fresh approval. Any unresolved ambiguity keeps the agent stopped.

## Read-only post-checks

After any authorized configuration change, verify the public `/api/public/v1/verify` response, `/api/health/live`, and `/api/health/ready`. Confirm the public execution flag matches the approved state and `v4ClaimLevel` remains `L0`. Use the authenticated owner panel for private grants, acknowledgements, and per-wallet account state. Never use an unauthenticated 401 as evidence that a private gate passed.
