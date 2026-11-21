# OPTRA P4 Mainnet Owner Decision Sheet

Status: NO-GO — P4 engineering configuration is selected and real-asset fork-tested; Safe/keeper candidates are supplied and read-only checked, but authorization, external approvals, audit, and owner-approved gas ceilings remain unresolved.
Date: 2026-11-21
Baseline: owner authorized P4 engineering and confirmed PM scope alignment. This sheet does not authorize signing, broadcasting, pool initialization, liquidity, or live trading.

## Scope acknowledgement

`OptraGuardHook` is an experimental one-pool Uniswap v4 spot swap-direction gate. It can gate risk-increasing swaps in a pool initialized with this hook and permit configured-underlying sells. It does not identify options orders or user exposure, close an options position, execute CallPut orders, manage a general portfolio, or move funds. Native ETH is represented by `address(0)` as currency0; quote USDG remains an ERC-20. The proposed deployment transaction creates only the hook; it does not create or initialize a pool.

The Project Owner directly confirmed P4 scope alignment, so no further routine PM confirmation is required. This does not replace legal/jurisdiction review, independent audit, Safe configuration, or approval of the exact transaction packet.

## Decisions required

| Decision | Owner must provide/approve | Evidence required by the preflight | Current state |
|---|---|---|---|
| PM scope and limitations | Confirm P4 spot-only architecture, one-bit policy semantics, and non-CallPut scope | Owner authorization in this session; `OPTRA_MAINNET_PM_APPROVAL_REF` | Confirmed by Project Owner for P4 engineering scope; not approval of any transaction. |
| Underlying and quote assets | Verified chain-4663 pair, decimals, and transfer behavior | `OPTRA_MAINNET_UNDERLYING=0x0000000000000000000000000000000000000000` (native ETH); `OPTRA_MAINNET_QUOTE=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` (USDG, 6 decimals) | Engineering recommendation selected. RPC read at block `119140085`: USDG proxy code 170 bytes, symbol/name `USDG`/`Global Dollar`, decimals 6. Native ETH is not an ERC-20. |
| Asset/jurisdiction eligibility | Product/legal determination for intended users, jurisdiction, issuer restrictions, and asset-specific availability | `OPTRA_MAINNET_JURISDICTION_APPROVAL_REF` | External approval remains required; engineering does not infer legal eligibility. |
| Pool and operating route | New hook-specific ETH/USDG PoolKey; static fee 3000 (0.30%), tick spacing 60, max policy age 300 seconds; initialize by Safe calling PoolManager directly; derive initial price from the live reference pool immediately before a separately approved initialization | `OPTRA_MAINNET_POOL_FEE=3000`, `OPTRA_MAINNET_TICK_SPACING=60`, `OPTRA_MAINNET_MAX_POLICY_AGE=300`; `OPTRA_MAINNET_POOL_ROUTE_APPROVAL_REF` | Engineering recommendation selected. It is a new, separate pool; the existing dynamic-fee ETH/USDG pool cannot be retrofitted with this hook. No OPTRA liquidity is created by hook deployment. |
| Pool creator | Exact contract that calls `PoolManager.initialize`; Safe is the selected candidate creator/admin | `OPTRA_MAINNET_POOL_CREATOR` | Supplied Safe candidate and runtime were read-only verified; the candidate tuple uses the same Safe for `adminSafe` and `poolCreator`. Cross-project authorization remains unconfirmed. |
| Safe/admin | Confirm cross-project authorization, Safe owner control/recovery, and exact use as admin and pool creator | `OPTRA_MAINNET_ADMIN_SAFE`; preflight reads `getOwners()` and `getThreshold()` | Supplied candidate `0xf9C76ef996C5cbC73E4E23927D6EecB3295c8d45`; Safe L2 v1.5.0/no enabled modules observed at block `119433484`; latest `getOwners()`/`getThreshold()` at block `119556696` returned 3 owners/threshold 2. The supplied keeper and deployer are not among those owners. This does not establish cross-project authorization or authorize a Safe transaction. |
| Keeper | Separate keeper EOA, protected operator/key custody, monitoring, incident response and revocation/rotation procedure; policy age 300 seconds | `OPTRA_MAINNET_KEEPER`, `OPTRA_MAINNET_KEEPER_RUNBOOK_REF` | Supplied candidate `0x23439a41eDC01D58d3Aaa0C75E9dFEE0C0196848`; read-only code/role checks passed at the candidate-estimate block, and it is not one of the Safe's 3 owners or the deployer at Safe owner-read block `119556696`. Operator identity, key custody authorization, and runbook approval remain outstanding. Keeper must differ from Safe/admin and deployer. |
| Deployer/signer | EOA and local Foundry keystore label; never share key/password | `OPTRA_MAINNET_DEPLOYER`, `OPTRA_MAINNET_SIGNER_ACCOUNT` | Supplied EOA `0xAa8fDF2f96aFC037D50659CFd09fDF3Fac060bBf`, label `optra-mainnet-deployer`. Read-only at block `119617306`: `0.00042 ETH`, nonce `0`, gas price `20,432,000 wei`. No keystore material was accessed. The balance observation is not approval of a fee ceiling. |
| Trusted RPC | Owner-approved provider/endpoint; verify chain ID 4663 at prepare/broadcast | `OPTRA_MAINNET_PROVIDER_APPROVAL_REF`; `OPTRA_MAINNET_RPC_URL` | External dependency: public endpoint was used read-only; production provider not approved. |
| Gas and fee ceiling | Measured gas, gas-unit ceiling, max/priority fee, total fee ceiling and funding request | `OPTRA_MAINNET_GAS_LIMIT`, `OPTRA_MAINNET_GAS_LIMIT_CEILING`, `OPTRA_MAINNET_MAX_FEE_PER_GAS_WEI`, `OPTRA_MAINNET_MAX_PRIORITY_FEE_PER_GAS_WEI`, `OPTRA_MAINNET_TOTAL_FEE_CEILING_WEI` | Read-only candidate estimate at block `119617126`: 1,676,133 gas. Candidate 130% gas limit: 2,178,973. At block `119617306`, observed gas price was 20,432,000 wei; an illustrative 2x max-fee candidate with zero priority fee yields max cost 89,041,552,672,000 wei (0.000089041552672 ETH). None of these ceilings are owner-approved. |
| Real-asset fork and gas evidence | Simulate actual Mainnet assets and PoolManager; record block, result and limits | `OPTRA_MAINNET_REAL_ASSET_FORK_SIMULATION_REF` + SHA-256; `OPTRA_MAINNET_GAS_REPORT_REF` + SHA-256 | Fresh fork PASS at block `119617306`, 1/1 test, gas 655,487; log `contracts/.local/optra-mainnet-real-asset-fork-119617306-20261121.log`, SHA-256 `bfa12968b91acf5e8c4a0c3890852e0b230c8ae866543b76e76905559732df23`. The estimate report is `contracts/.local/optra-mainnet-p4-candidate-estimate-20261121-release-a750a83.json`, SHA-256 `26d0587f67c80d1831d5c32a0e776b86399685cdaa2f7265c7856ab3f0da6a84`. Both used the public RPC read-only; production-provider approval remains absent. USDG balance/liquidity in the fork were overrides only. |
| Independent security audit | Independent auditor/report for the exact source commit and deployment scope; resolve findings and retain the final report digest | `OPTRA_MAINNET_AUDIT_REPORT_REF` + SHA-256 | Missing; internal engineering/security results are not an independent audit. |
| Exact transaction approval | Review the final eligible JSON packet and approve its exact `approvalSha256`, including signer, nonce, destination, calldata, value, gas, fee caps, constructor args, CREATE2 salt/address, source hashes, and evidence references | `OPTRA_MAINNET_FINAL_APPROVAL_REF`, `OPTRA_MAINNET_APPROVED_PACKET_SHA256` | Not requested. A candidate estimate exists, but strict preflight is blocked and no approval-eligible packet/hash exists. |

## Verified configuration snapshot

A read-only request to `https://robinhood.drpc.org` returned chain ID `4663`. The runtime at the source-pinned PoolManager address `0x8366a39CC670B4001A1121B8F6A443A643e40951` matched the locally pinned size `24009` bytes and SHA-256 `6eb21c69298b064e37fcf8089a941ae096fe08c0f179b2d399567aef1b10585b`. The CREATE2 factory at `0x4e59b44847b379578588920cA78FbF26c0B4956C` matched size `69` bytes and SHA-256 `e0af82ad2e5188285db8ba0b2ae054d13f0fd4fe325c48c7f2dace48454404b9`.

These point-in-time RPC observations do not approve a production provider or establish source verification. The supplied Safe and keeper candidates are now present in the engineering tuple; cross-project Safe authorization and keeper operator/key custody remain unconfirmed. The fresh strict preflight passed chain ID and pinned runtime checks, then stopped on the missing Mainnet acknowledgement, owner-approved gas ceilings, provider/PM/asset/jurisdiction/route/keeper-runbook approvals, audit, and required evidence references. A read-only estimate exists at block `119617126`; its predicted CREATE2 candidate had no code at block `119617306`. No final packet or approval hash exists.

The reference ETH/USDG pool is independently confirmed by the PoolManager `Initialize` log for pool ID `0xa791e5169faf703c0b63fd9552c33ec1128a773a00f5dc33a640da62a022cd35`: block `101281159`, transaction `0x035292897c4c0d8e2286efbb511b1cde4e58959c78cc4226b3d8e9b70171fe8f`. Indexed currencies are native ETH (`address(0)`) and USDG. Its key uses dynamic fee `0x800000`, tick spacing `1`, and third-party hook `0x987e330f00b79864a07fe81dfac344d0078abcc`; it is not the proposed OPTRA pool. At reference block `119160725`, the state read returned sqrt price `3238620707560349683414145`, tick `-202109`, and active liquidity `339343707177073276`. Refresh this price immediately before any separately approved pool initialization.

## Stop conditions

- Re-read the live reference-pool price at the eventual pool-initialization block; do not reuse the fork snapshot as a production quote.
- Do not claim that the existing dynamic-fee ETH/USDG pool is protected by OPTRA; the hook requires a new pool and separate liquidity.
- Do not substitute synthetic-token fork tests for the required selected-real-asset simulation.
- Do not treat runtime code at a Safe address as proof of its owner set or threshold; use the live Safe getters.
- Do not request final packet approval until every row above has evidence and strict preflight passes.
- The deploy-only transaction is not pool creation or activation. Any later Safe/pool setup and liquidity funding require a separate reviewed transaction batch and approval.

## Related documents

- `docs/MAINNET_CHECKLIST.md`
- `docs/MAINNET_DEPLOYMENT_RUNBOOK.md`
- `docs/contract-deployment-plan.md`
- `docs/INTERNAL_AUDIT.md`
- `docs/THREAT_MODEL.md`
- `docs/KNOWN_LIMITATIONS.md`
- `docs/INCIDENT_RESPONSE.md`
