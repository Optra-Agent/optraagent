# OPTRA P4 Mainnet Owner Decision Sheet

Status: NO-GO — no deployable asset/pool configuration or required approvals are recorded.
Date: 2026-11-20
Baseline: accepted P4 engineering from `64872b7`; this sheet does not authorize signing, broadcasting, pool initialization, liquidity, or live trading.

## Scope acknowledgement

`OptraGuardHook` is an experimental one-pool Uniswap v4 spot swap-direction gate. It can gate risk-increasing swaps in a pool initialized with this hook and permit configured-underlying sells. It does not identify options orders or user exposure, close an options position, execute CallPut orders, manage a general portfolio, or move funds. The proposed deployment transaction creates only the hook; it does not create or initialize a pool.

Record formal PM architecture/product approval separately from the Project Owner's approval of an exact transaction packet. Neither approval is inferred from engineering authorization.

## Decisions required

| Decision | Owner must provide/approve | Evidence required by the preflight | Current state |
|---|---|---|---|
| PM scope and limitations | Formal approval of P4 contract architecture, spot-only boundary, one-bit policy semantics, and non-CallPut scope | `OPTRA_MAINNET_PM_APPROVAL_REF` | Missing; brief remains a working brief awaiting PM approval. |
| Underlying and quote assets | Exact chain-4663 token addresses, symbols, decimals, supported transfer behavior, and approved pair | `OPTRA_MAINNET_ASSET_APPROVAL_REF`; both addresses must have code and valid `decimals()` | Missing; no token pair is selected. |
| Asset/jurisdiction eligibility | Product/legal determination for intended users, jurisdiction, issuer restrictions, and asset-specific availability | `OPTRA_MAINNET_JURISDICTION_APPROVAL_REF` | Missing; engineering cannot infer eligibility from a ticker or registry status. |
| Pool and operating route | Exact v4 PoolKey (pair, fee, spacing, hook), initializer/caller, router or direct manager path, initial price, liquidity owner, and future pool-creation transaction | `OPTRA_MAINNET_POOL_ROUTE_APPROVAL_REF`; code/runtime checks for selected contracts | Missing; fee, spacing, price, route, and pool do not exist as approved values. |
| Pool creator | Exact contract address that will be the `PoolManager.initialize` caller; verify code and the `beforeInitialize` sender behavior | Included in the approved pool-route record; `OPTRA_MAINNET_POOL_CREATOR` | Missing; do not assume it is the Safe. |
| Safe/admin | Safe address, verified unique owners, threshold, recovery and key-custody plan. Current strict guard requires at least 3 owners and threshold >=2. | `OPTRA_MAINNET_ADMIN_SAFE`; preflight reads `getOwners()` and `getThreshold()` | Missing; no production Safe or owners selected. |
| Keeper | Keeper address, protected key/operator, monitoring, incident response, revocation/rotation procedure, and approved policy freshness bound (1–900 seconds; 300 seconds is only the engineering default) | `OPTRA_MAINNET_KEEPER`, `OPTRA_MAINNET_KEEPER_RUNBOOK_REF` | Missing; keeper must differ from the Safe/admin. |
| Deployer/signer | EOA address and local Foundry keystore name; confirm signer address and fund only the approved maximum cost. Do not send keys/passwords to the agent. | `OPTRA_MAINNET_DEPLOYER`, `OPTRA_MAINNET_SIGNER_ACCOUNT` | Missing. The owner/operator, not the agent, runs the Mainnet broadcast. |
| Trusted RPC | Owner-approved provider and endpoint; confirm chain ID 4663 immediately before prepare/broadcast. Do not put provider credentials in this sheet or logs. | `OPTRA_MAINNET_PROVIDER_APPROVAL_REF`; `OPTRA_MAINNET_RPC_URL` | Missing. The observed dRPC endpoint was used for read-only checks only; it is not an approved production signer endpoint. |
| Gas and fee ceiling | Maximum gas units, maximum fee per gas, priority fee, total transaction-fee cap, and signer balance policy | `OPTRA_MAINNET_GAS_LIMIT`, `OPTRA_MAINNET_GAS_LIMIT_CEILING`, `OPTRA_MAINNET_MAX_FEE_PER_GAS_WEI`, `OPTRA_MAINNET_MAX_PRIORITY_FEE_PER_GAS_WEI`, `OPTRA_MAINNET_TOTAL_FEE_CEILING_WEI`; signed gas report reference/hash | Missing; no candidate transaction has been estimated. |
| Real-asset fork and gas evidence | Run fork simulation only after the owner selects the asset/pool/route. Record tested block, assets, route, result, gas, and limitations. | `OPTRA_MAINNET_REAL_ASSET_FORK_SIMULATION_REF` + SHA-256; `OPTRA_MAINNET_GAS_REPORT_REF` + SHA-256 | Missing; existing accepted fork evidence uses synthetic assets and is not a real-asset simulation. |
| Independent security audit | Independent auditor/report for the exact source commit and deployment scope; resolve findings and retain the final report digest | `OPTRA_MAINNET_AUDIT_REPORT_REF` + SHA-256 | Missing; internal engineering/security results are not an independent audit. |
| Exact transaction approval | Review the generated JSON packet and approve its exact `approvalSha256`, including signer, nonce, destination, calldata, value, gas, fee caps, constructor args, CREATE2 salt/address, source hashes, and evidence references | `OPTRA_MAINNET_FINAL_APPROVAL_REF`, `OPTRA_MAINNET_APPROVED_PACKET_SHA256` | Not requested; no eligible packet exists. |

## Verified configuration snapshot

A read-only request to `https://robinhood.drpc.org` returned chain ID `4663`. The runtime at the source-pinned PoolManager address `0x8366a39CC670B4001A1121B8F6A443A643e40951` matched the locally pinned size `24009` bytes and SHA-256 `6eb21c69298b064e37fcf8089a941ae096fe08c0f179b2d399567aef1b10585b`. The CREATE2 factory at `0x4e59b44847b379578588920cA78FbF26c0B4956C` matched size `69` bytes and SHA-256 `e0af82ad2e5188285db8ba0b2ae054d13f0fd4fe325c48c7f2dace48454404b9`.

These are point-in-time read-only RPC observations, not a production-provider approval or proof of source verification. The public Robinhood endpoints are rate-limited and not recommended for production use. The current `--estimate` preflight verified chain ID and both runtime fingerprints, then stopped because the owner-selected deployer, Safe, keeper, creator, token pair, fee, spacing, initial price, and policy age are unset.

## Stop conditions

- Do not select a ticker, token address, quote asset, pool, initializer, fee, tick spacing, or initial price on the owner's behalf.
- Do not substitute synthetic-token fork tests for the required selected-real-asset simulation.
- Do not treat runtime code at a Safe address as proof of its owner set or threshold; use the live Safe getters.
- Do not request final packet approval until every row above has evidence and strict preflight passes.
- The deploy-only transaction is not pool creation or activation. Any later Safe/pool setup requires a separate reviewed transaction batch and approval.

## Related documents

- `docs/MAINNET_CHECKLIST.md`
- `docs/MAINNET_DEPLOYMENT_RUNBOOK.md`
- `docs/contract-deployment-plan.md`
- `docs/INTERNAL_AUDIT.md`
- `docs/THREAT_MODEL.md`
- `docs/KNOWN_LIMITATIONS.md`
- `docs/INCIDENT_RESPONSE.md`
