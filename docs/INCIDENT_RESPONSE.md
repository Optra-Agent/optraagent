# OPTRA Contract Incident Response

Updated: 2026-11-20

Status: This is a pre-deployment runbook for the experimental `OptraGuardHook`; no OPTRA contract is deployed on Robinhood Mainnet. It has not been rehearsed with a production Safe or operator. Do not treat these steps as authorization to send a transaction. Mainnet actions require a separately approved exact transaction and the owner-operated signer.

## Roles and operating assumptions

- Project Owner: approves scope and exact transactions.
- PM: separately approves product/architecture scope; current PM brief remains pending approval.
- Admin: intended to be a reviewed multisig contract. Its address, owners, threshold, and recovery contacts are unresolved.
- Keeper: publishes the single policy bit; it must remain distinct from admin on chain 4663. Operator and monitoring are unresolved.
- Deployer/pool creator: not selected. The hook has immutable manager, token pair, creator, admin, keeper, and policy-age configuration.
- Agent actions: never read, request, or expose private keys, keystore passwords, seed phrases, RPC credentials, or signer codes; never broadcast on the owner's behalf.

## Initial response

1. Record incident time in UTC, chain ID, observed block, exact contract/pool addresses, and the symptom. Preserve transaction hashes and public logs only; do not copy secrets or private user data into the report.
2. Confirm the chain ID from an owner-approved trusted RPC and read back code, `admin`, `keeper`, `entryPaused`, `policyPublished`, `policyUpdatedAt`, `maxPolicyAge`, `poolBound`, and `configuredPoolId`.
3. Do not change `LIVE_TRADING_ENABLED`, Railway Production, Paper Trading, or other OPTRA systems as part of this contract runbook.
4. Escalate any suspected exploit, compromised admin, ineligible asset, or loss of pool liquidity to the Project Owner and PM. Independent security/legal counsel may be required before recovery.

## Playbooks

### Keeper key compromise or incorrect allow policy

- Treat a fresh `entryPaused=false` policy as potentially compromised.
- The verified admin Safe operator should review and, if approved, call `revokeKeeper()`. This clears the policy and leaves risk-increasing swaps blocked; no agent broadcasts this action.
- Verify the transaction receipt and read back that the keeper is zero, policy is unpublished, entries are paused, and the policy is not fresh.
- After the incident is contained, independently verify a replacement keeper address and rotation approval. `setKeeper(newKeeper)` clears prior policy; the new keeper must then publish a pause policy before any later allow policy.
- Mainnet `setKeeper` rejects the admin address. Do not work around this check or use a shared admin/keeper key.

### Keeper outage, stale policy, or RPC outage

- Missing or expired policy blocks the configured underlying-buy direction. With a 300-second deployment setting, buys fail closed after that age; the contract hard-caps configured age at 900 seconds.
- Do not publish an allow policy from stale cached session/venue information. Wait for the approved provider and market/session source to recover, then verify the data's asset and timestamp.
- Underlying-out swaps remain allowed by contract, but that does not mean they are risk-reducing or guaranteed to succeed; token issuer restrictions, pool liquidity, and chain availability still apply.

### Admin/Safe compromise or unavailable quorum

- Notify all Safe owners through a separately authenticated channel and follow the Safe's own incident process. Do not submit unverified recovery transactions.
- The hook's admin is immutable. If a safe quorum cannot be trusted or recovered, there is no in-place admin transfer. A reviewed replacement deployment and new pool may be required; the old pool remains a separate permissionless venue and cannot be assumed disabled.
- No replacement deployment or migration is authorized by this runbook.

### Wrong asset, route, session, or pool configuration

- Stop publishing allow policies. The hook does not itself read asset availability, legal eligibility, session calendars, venue status, corporate actions, or price/liquidity conditions.
- Verify token identities, current eligibility, pool key, fee/tick spacing, initialization price, and router path from independent sources.
- Because these values are immutable or pool-bound, configuration errors generally require a reviewed replacement hook/pool; do not improvise onchain changes.

### Suspected contract defect or exploit

- Determine whether the issue is in the hook, PoolManager/router, token, keeper data, or offchain route; preserve block-pinned evidence.
- If the keeper/admin remain trusted, the admin can revoke the keeper to block buys. Do not claim this disables other pools or options routes.
- The hook is not upgradeable. A replacement requires a fresh review, new deployment, source verification, and separate approvals. Do not route users or liquidity into the replacement before those checks.
- Commission an independent review; internal tests and static analysis are not a substitute.

## Recovery evidence checklist

- [ ] Chain ID and block from trusted RPC
- [ ] Contract/pool addresses and runtime code hashes
- [ ] Role/policy/pool-binding getter values before and after response
- [ ] Incident timeline and relevant transaction hashes/receipts
- [ ] Safe decision record and confirmed signers/quorum (no passwords or keys)
- [ ] Asset/session/venue source snapshots and timestamps
- [ ] Independent security/legal review where applicable
- [ ] Owner and PM approval before any replacement batch or user-facing status change

See `docs/THREAT_MODEL.md`, `docs/KNOWN_LIMITATIONS.md`, and `docs/MAINNET_CHECKLIST.md`.