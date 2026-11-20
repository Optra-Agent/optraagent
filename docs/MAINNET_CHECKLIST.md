# OPTRA Mainnet Contract Checklist

Updated: 2026-11-20

## Decision

NO-GO. Project Owner authorization covers P4 engineering only. PM approval is not formally recorded, owner asset/pool/Safe/keeper/signer decisions are missing, and no exact Mainnet transaction batch is eligible for owner approval. No OPTRA Mainnet contract has been deployed. This checklist does not authorize signing, broadcasting, liquidity provision, Live Trading, or movement of funds.

The consolidated decision record is `docs/MAINNET_OWNER_DECISIONS.md`; the owner/operator procedure is `docs/MAINNET_DEPLOYMENT_RUNBOOK.md`.

## Current evidence

| Gate | Status | Evidence / blocker |
|---|---|---|
| Project Owner P4 engineering authorization | RECORDED | `docs/execution-ledger.md`, 2026-11-20. |
| PM architecture/product approval | BLOCKED | `docs/OPTRA_PM_ORIGINAL_DEV_BRIEF.md` labels the brief a working brief awaiting PM approval; no formal PM sign-off recorded. |
| Candidate source and local Foundry suite | PASS, EXPERIMENTAL | One candidate, `OptraGuardHook`; accepted P4 results in `docs/contract-deployment-plan.md` and `docs/INTERNAL_AUDIT.md`. |
| Robinhood Mainnet chain and pinned infrastructure | VERIFIED, READ-ONLY | RPC returned chain ID 4663; PoolManager and CREATE2 factory size/SHA-256 fingerprints match `contracts/script/optra-mainnet-preflight.sh` on 2026-11-20. This is not production-provider approval or explorer source verification. |
| Robinhood Mainnet PoolManager fork simulation | PASS, LIMITED | Previously accepted fork test uses synthetic assets and local fork writes only; it does not test the owner-selected real pair/route. |
| Independent security audit | BLOCKED | Internal verification is not an external audit. |
| Asset, quote, jurisdiction, and issuer eligibility | BLOCKED | No approved token pair; product/legal review is required. |
| Pool/router/initializer route | BLOCKED | No approved production PoolKey, creator/caller, initializer, fee/tick spacing, initial price, or operational route. |
| Safe/admin, keeper, pool creator, deployer/signer | BLOCKED | No production addresses or signer-specific operator evidence recorded. |
| Mainnet deployment/preflight/postflight/source-preparation scripts | IMPLEMENTED, ESTIMATE PATH REHEARSED | `contracts/script/optra-mainnet-{preflight,deploy,postflight,verify-source}.sh`. `bash -n` passes. 2026-11-20: preflight and `deploy --estimate` ran on a local Robinhood Mainnet anvil fork with synthetic tokens and a mock Safe (measured `eth_estimateGas` 1,676,421; fork-test factory deploy 1,648,245). One defect found and fixed (CREATE2 address parse). `--strict`, `--prepare`, `--broadcast`, postflight not run end to end: they need real approval references. See `docs/INDEPENDENT_AUDIT_HANDOFF.md`. |
| Trusted production RPC | BLOCKED | Public dRPC endpoint used only for read-only verification; owner must select/approve a production provider. |
| Exact transaction batch and constructor calldata | NONE | No candidate asset/pool configuration, measured estimate, source packet, or predicted approved deployment exists. |
| Real-asset fork and signer-specific gas report | NONE | Current accepted fork uses synthetic assets; gas limit/fee ceilings are unset. |
| Final transaction approval | NOT REQUESTED | No hypothetical batch is presented for approval. |

## Known contract and deployment boundaries

Constructor shape: `(poolManager, underlyingToken, quoteToken, poolCreator, admin, keeper, maxPolicyAge)`.

- PoolManager is source-pinned at `0x8366a39CC670B4001A1121B8F6A443A643e40951` on chain ID `4663`; the preflight verifies its live code size and SHA-256 fingerprint.
- The CREATE2 factory is `0x4e59b44847b379578588920cA78FbF26c0B4956C`; the preflight verifies its pinned runtime fingerprint.
- Underlying, quote, pool creator, Safe/admin, keeper, fee, tick spacing, initial price, and Mainnet policy age remain owner decisions. `300` seconds is only the engineering default; contract maximum is `900` seconds.
- Mainnet constructor requires contract code at PoolManager, underlying, quote, pool creator, and admin; the designated deployer is an EOA and must be distinct from admin and keeper.
- The deploy-only transaction creates an unbound hook with entries paused and no published/fresh policy. Pool initialization and liquidity are separate owner-reviewed actions.

No signer, complete argument tuple, transaction sequence, gas ceiling, or exact approval hash is available. The prior Testnet Phase A packet is stale after the hook bytecode change and must not be reused.

## Gates before an exact packet

1. Record formal PM approval for P4 scope and acknowledge the spot-only/non-CallPut limitations.
2. Obtain product/legal confirmation for a specific token pair, users/jurisdiction, issuer restrictions, and asset-specific trading availability. Do not infer eligibility from a ticker or registry status.
3. Approve the exact pool route and initializer, including verified code, PoolKey, creator/caller, fee, spacing, initial price, liquidity plan, and operational ownership.
4. Select and verify the Safe/admin, owners/threshold/recovery, distinct keeper, pool creator, deployer, and key custody/incident response.
5. Complete the independent audit for the exact source and deployment scope; resolve findings. Internal checks are not an audit.
6. Run the selected-real-asset fork simulation and measured gas estimate against an owner-approved trusted provider. Record source/dependency hashes, compiler settings, exact calldata, estimate, max gas, fee price and total fee ceiling.
7. Prepare source-verification inputs for the exact build (Solidity 0.8.26, optimizer 44,444,444, via-IR, Cancun, metadata settings). Verify the chain-specific explorer route.
8. Only after all gates pass, generate the exact packet and request explicit Project Owner approval of its `approvalSha256`. PM/product approval and transaction approval remain separate gates.

## Post-broadcast verification plan

Only after separately approved operator broadcast:

- Verify the exact transaction receipt, sender, nonce, destination, calldata, gas used, block and transaction hash.
- Read deployed runtime code and fingerprint; verify exact source/compiler/settings on Sourcify and Robinhood Blockscout.
- Read back PoolManager, token pair, creator, Safe/admin, keeper, policy age, pool ID, hook permissions, `poolBound`, `entryPaused=true`, `policyPublished=false`, and `isPolicyFresh=false`.
- Confirm no pool initialization, liquidity, policy unpause, options order, Live Trading toggle, or fund transfer occurred unless separately scoped and approved.
- Update the execution ledger only from verified receipts and live readback; predicted addresses and fork state are not deployment evidence.

## Scope boundaries

- Do not deploy mock tokens or test routers on Mainnet.
- Do not deploy a separate `GuardRegistry` without a second real consumer requiring shared state.
- Do not claim the hook enables CallPut, Live Options, or general Live Trading.
- Preserve Railway Production, Paper Trading, `LIVE_TRADING_ENABLED=false`, and `V4_CLAIM_LEVEL=L0`.

See `docs/contract-deployment-plan.md`, `docs/INTERNAL_AUDIT.md`, `docs/THREAT_MODEL.md`, `docs/INCIDENT_RESPONSE.md`, and `docs/KNOWN_LIMITATIONS.md`.
