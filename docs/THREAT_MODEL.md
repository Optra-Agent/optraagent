# OPTRA Onchain Threat Model

Updated: 2026-11-20

Status: Candidate design only. `OptraGuardHook` is experimental and has not been deployed to Robinhood Testnet or Mainnet. PM approval and all transaction approvals remain separate. This document is not an independent audit or legal opinion.

## Scope and boundary

The current candidate is one Uniswap v4 `OptraGuardHook` instance for one future OPTRA-owned spot pool. It stores a keeper-published `entryPaused` bit and timestamp, then gates only swaps that buy the configured underlying token. It has no token-transfer function and does not submit orders. The associated PoolManager/pool can hold swap liquidity if a pool is later created; therefore the hook's lack of custody does not mean the pool has no value at risk.

This contract does not control CallPut/Zeno options orders, third-party pools, other spot routes, wallet approvals, agent behavior, or portfolio exposure. It does not prove that selling the underlying reduces risk or closes an options position. It does not currently consume authenticated session calendars, corporate-action data, venue health, price oracles, or an options-position proof.

## Assets and security objectives

| Asset / objective | Desired property |
|---|---|
| Swap access to the configured OPTRA pool | Risk-increasing direction is blocked when policy is missing, paused, future-dated, or stale. |
| Pool initialization | Only the configured PoolManager, creator, pair, and one pool key can bind the hook. |
| Policy integrity | Only the configured keeper publishes policy; admin rotation/revocation invalidates old policy. On Mainnet, admin cannot be configured or rotated as keeper. |
| User liquidity and trade outcomes | Hook cannot transfer funds; users still face pool price, liquidity, token, router, and MEV risks. |
| Contract configuration and release integrity | Mainnet deployment must use approved addresses, exact source/build settings, audited code, a trusted provider, and a separately approved transaction packet. |
| Paper Trading and Railway Production | P4 contract work must not change either system or activate Live Trading. |

## Actors and trust boundaries

- Permissionless pool users and MEV/searcher bots can call the v4 router/PoolManager route and choose swap parameters.
- The PoolManager is an external dependency. The hook checks callback caller identity and, on chain ID `4663`, pins the constructor address to Robinhood's official PoolManager. The missing Mainnet deploy script must also re-check its runtime hash.
- The pool creator is trusted to choose the pool's fee, tick spacing, initial price, and initialization timing. The hook binds the first matching pool but does not validate those economics.
- The keeper is trusted to publish the correct pause bit. A compromised keeper can publish an allow policy until it expires or is revoked.
- The immutable admin is trusted to manage keeper rotation and revoke policy. Mainnet code-length checks do not prove that the admin is a correctly configured multisig or that its owners/threshold are safe.
- Token issuers control token-level transfer restrictions, eligibility, pauses, and metadata. The hook cannot override them.
- RPC/provider, deployment operator, source-verification service, and PM/owner approval records are separate trust boundaries.

## Threats, mitigations, and residual risk

| Threat | Mitigation in current candidate | Residual risk / status |
|---|---|---|
| Missing or stale keeper state accidentally permits buys | New instances start paused; missing, future-dated, stale, or paused policy reverts the buy direction; constructor caps age at 900 seconds. | A deployment should use the 300-second engineering default. Chain timestamps are not an independent clock; Slither's timestamp detector was excluded from the reported scan. |
| Keeper key compromise or incorrect allow publication | Admin can revoke keeper, which clears policy and returns to fail-closed state; rotation clears prior policy. | A false allow is usable while fresh. The admin/Safe and emergency operator have not been selected or rehearsed. |
| Admin becomes its own keeper after deployment | Mainnet constructor and `setKeeper` reject `keeper == admin`; a regression test covers the rotation path. | Admin can still appoint another compromised or colluding keeper. Safe governance and key custody are external controls. |
| Untrusted caller supplies `hookData` claiming a hedge/exit | Hook ignores `hookData`; direction is derived from configured tokens and swap direction. | Direction is only a token-flow proxy. Underlying-out swaps always pass and may not reduce portfolio/options risk. |
| User routes around the hook | Hook binds only to a pool whose key includes this hook. | Other pools, routers, direct venue orders, and wallet actions remain outside its control. This is not a global trading or Live Options permission layer. |
| Malicious or misconfigured pool initialization | PoolManager-only callback, configured creator and pair, one-pool binding, exact hook permission validation. | Creator still chooses fee, tick spacing, initial price, and timing. No production initializer or route has been approved. |
| Wrong or ineligible asset/quote pair | Constructor requires distinct deployed token contracts. | It does not verify token identity, Stock Token eligibility, jurisdiction, session availability, issuer controls, or liquidity. Asset selection is blocked pending legal/product review. |
| Mainnet manager/admin/creator misconfiguration | Mainnet constructor pins the manager address and requires code at manager/admin/creator plus distinct keeper/admin. | Constructor does not check manager runtime hash or Safe owners/threshold; a Mainnet deployment script with hard guards is absent. |
| Contract bug or immutable-configuration mistake | Foundry tests, fuzz/invariant tests, Slither, and fork simulation are recorded in the P4 report. | Hook configuration is immutable and there is no upgrade path. A replacement requires a new hook and pool; an independent audit is outstanding. |
| RPC, keeper service, or chain outage | Stale/missing policy fails closed for buys. | Underlying-out swaps remain permitted, and issuer restrictions may also prevent them. No production keeper/calendar service or trusted RPC is configured. |

## Required invariants and release gates

1. Only the configured PoolManager calls hook callbacks.
2. One hook binds at most one matching pool initialized by its configured creator.
3. No risk-increasing swap is allowed without a fresh, unpaused keeper policy.
4. Mainnet admin and keeper remain distinct after every keeper rotation.
5. Any allowed underlying-out swap is described only as token direction, never as a proven options exit or portfolio risk reduction.
6. Mainnet asset eligibility, route, Safe, keeper, creator, deployer, independent audit, signer-specific gas, and exact transaction approval are resolved before any broadcast.

See `docs/KNOWN_LIMITATIONS.md`, `docs/INCIDENT_RESPONSE.md`, and `docs/MAINNET_CHECKLIST.md`. The PM brief remains a working brief pending PM approval. Official Robinhood Stock Token documentation identifies asset-specific session availability and U.S.-person restrictions; neither is an engineering choice to infer.