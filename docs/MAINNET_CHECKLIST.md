# OPTRA Mainnet Contract Checklist

Updated: 2026-11-20

## Decision

NO-GO. Project Owner authorization covers P4 engineering only. PM approval is not formally recorded, and no exact Mainnet transaction batch is eligible for owner approval. No OPTRA Mainnet contract has been deployed. This checklist does not authorize signing, broadcasting, liquidity provision, Live Trading, or movement of funds.

## Current evidence

| Gate | Status | Evidence / blocker |
|---|---|---|
| Project Owner P4 engineering authorization | RECORDED | `docs/execution-ledger.md`, 2026-11-20. |
| PM architecture/product approval | BLOCKED | `docs/OPTRA_PM_ORIGINAL_DEV_BRIEF.md` labels the brief a working brief awaiting PM approval; no formal PM sign-off recorded. |
| Candidate source and local Foundry suite | PASS, EXPERIMENTAL | One candidate, `OptraGuardHook`; see `docs/INTERNAL_AUDIT.md`. |
| Robinhood Mainnet PoolManager fork simulation | PASS, LIMITED | Chain ID 4663, block 118774800; transient mock assets and local fork writes only. |
| Independent security audit | BLOCKED | Internal verification is not an external audit. |
| Asset, quote, jurisdiction, and issuer eligibility | BLOCKED | No approved token pair. Robinhood Stock Token restrictions and per-asset availability require legal/product review. |
| Pool/router/initializer route | BLOCKED | No approved production pool key, initializer contract, fee/tick spacing, initial price, or verified transaction route. |
| Safe/admin, distinct keeper, pool creator, deployer | BLOCKED | No production addresses or signer-specific operator evidence recorded. |
| Mainnet deployment script and hard guards | BLOCKED | Existing deployment script is Testnet-only (46630) and deploys synthetic test fixtures. |
| Trusted production RPC | BLOCKED | Public RPC was used for read-only fork simulation only; select and verify an owner-approved provider for production simulation. |
| Exact transaction batch and constructor calldata | NONE | Not prepared; key values are unresolved. |
| Measured signer-specific gas and explicit ceiling | NONE | Test gas and fork test gas are not deployment estimates. |
| Final transaction approval | NOT REQUESTED | No hypothetical batch is presented for approval. |

## Known constructor fields (not an approval packet)

Contract constructor shape: `(poolManager, underlyingToken, quoteToken, poolCreator, admin, keeper, maxPolicyAge)`.

- `poolManager`: source pins Robinhood Chain mainnet PoolManager `0x8366a39CC670B4001A1121B8F6A443A643e40951` on chain ID `4663`; a future deploy script must re-check its address and runtime hash.
- `underlyingToken`: unresolved.
- `quoteToken`: unresolved.
- `poolCreator`: unresolved; Mainnet constructor requires contract code.
- `admin`: unresolved; Mainnet constructor requires contract code, but code length alone does not establish Safe owners/threshold.
- `keeper`: unresolved; must be distinct from admin and operationally protected.
- `maxPolicyAge`: 300 seconds is the engineering default; source permits a hard maximum of 900 seconds. The Mainnet value is not approved.

No signer, complete argument tuple, transaction sequence, gas ceiling, or predicted address is available. The prior Testnet Phase A packet is stale after the hook bytecode change and must not be reused.

## Required gates before producing an exact packet

1. Record formal PM approval for the P4 contract architecture and acknowledge the exact limitations of the one-bit spot hook.
2. Obtain legal/product confirmation for a specific token pair, jurisdiction, users, issuer restrictions, and asset-specific trading availability. Robinhood's [official Stock Token documentation](https://docs.robinhood.com/chain/stock-tokens/) restricts Stock Tokens from being offered/sold/delivered in the U.S. or to/for U.S. persons; do not infer eligibility from engineering tests.
3. Approve a concrete pool route and initializer, including verified PoolManager/router code, pool fee, tick spacing, initial price, liquidity plan, slippage controls, and operational ownership.
4. Select the Safe/admin and verify owners/threshold; designate a distinct keeper, pool creator, and deployer; document key custody and incident response.
5. Complete the independent audit and address findings. Confirm the testnet source packet is regenerated from the current bytecode and separately approved if Testnet deployment is still required.
6. Add and test a Mainnet-only deployment/ops path: chain ID 4663, explicit opt-in and audit reference, verify the source-pinned manager address and exact runtime hash, contract admin, admin not broadcaster, no mock/example assets, and zero deployer roles. Add a read-only postflight and Safe batch generator that never signs/sends.
7. Use an owner-approved trusted provider (Robinhood's [network documentation](https://docs.robinhood.com/chain/connecting/) marks its public endpoints rate-limited and not for production use) and the exact signer address for chain/balance/nonce/fee checks and a non-broadcast dry run. Record transaction calldata, CREATE2 parameters if any, predicted addresses, measured gas, price assumptions, and an explicit gas/fee ceiling.
8. Prepare source-verification inputs from the exact build (Solidity 0.8.26, optimizer 44,444,444, via-IR, Cancun, metadata settings) and rehearse read-back of code, roles, permissions, pool binding, and paused/no-policy state.
9. Only then request final Project Owner approval for the exact transaction batch. PM approval and final transaction approval remain separate gates.

## Post-broadcast verification plan (future, only after approval)

- Read each receipt and require success; record sender, nonce, destination, calldata, gas used, block, and transaction hash.
- Read runtime bytecode and hash for every OPTRA contract; verify exact source/compiler/settings through the supported Robinhood Blockscout/Sourcify process.
- Independently read back PoolManager, token pair, creator, Safe/admin, keeper, `maxPolicyAge`, hook permissions/address bits, pool ID, `poolBound`, `entryPaused=true`, `policyPublished=false`, and `isPolicyFresh=false`.
- Confirm no token mint, approval, liquidity, policy unpause, options order, Live Trading toggle, or fund transfer was included unless separately scoped and approved.
- Update the execution ledger only from verified receipts and onchain readback; never claim a deployment from predicted addresses or fork state.

## Scope boundaries

- Do not deploy mock tokens or test routers on Mainnet.
- Do not deploy a separate `GuardRegistry` without a second real consumer requiring shared state.
- Do not claim the hook enables CallPut, Live Options, or general Live Trading.
- Preserve Railway Production, Paper Trading, `LIVE_TRADING_ENABLED=false`, and `V4_CLAIM_LEVEL=L0`.

See `docs/contract-deployment-plan.md`, `docs/THREAT_MODEL.md`, `docs/INCIDENT_RESPONSE.md`, and `docs/KNOWN_LIMITATIONS.md`.