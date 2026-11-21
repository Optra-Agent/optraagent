# OPTRA P4 Mainnet Deployment Runbook

Status: engineering tooling, supplied Safe/keeper candidates, a read-only CREATE2/gas estimate, and a real ETH/USDG fork simulation are present. Mainnet remains NO-GO: Safe cross-project authorization, keeper custody/runbook, trusted-provider and asset/jurisdiction/route evidence, independent audit, owner-approved gas ceilings, and exact transaction approval remain outstanding. No Mainnet transaction has been signed or sent.

## What the scripts do

All scripts are read-only except `optra-mainnet-deploy.sh --broadcast`, which is a local-operator-only, approval-gated send path. The agent does not broadcast Mainnet transactions or handle keystore passwords/private keys. The deployment packet covers exactly one CREATE2 factory transaction deploying `OptraGuardHook`; it does not initialize a pool, add liquidity, publish policy, perform a swap, or submit an options order.

- `contracts/script/optra-mainnet-preflight.sh --estimate`: verify chain ID and pinned runtime fingerprints; validate the supplied candidate tuple. The current candidate tuple passed this read-only check; this does not satisfy external approvals.
- `contracts/script/optra-mainnet-preflight.sh --strict`: additionally require explicit Mainnet acknowledgement, provider/PM/asset/jurisdiction/pool/keeper approvals, real-asset fork and gas evidence references/hashes, an independent audit reference/hash, Safe owner/threshold checks, Safe as pool creator, a separate keeper EOA, and owner-approved gas/fee ceilings. The supplied Safe candidate read back as 3 owners/threshold 2 at block 119433484; cross-project authorization is unconfirmed. The Project Owner's P4 scope authorization is recorded, but the required formal PM approval reference is not present.
- `contracts/script/optra-mainnet-deploy.sh --estimate <new-report.json>`: locally build the contract, derive and verify the CREATE2 address through a read-only factory call, call `eth_estimateGas`, then write a mode-0600 report. It does not broadcast. A candidate estimate was measured at block 119537033: 1,676,133 gas and a predicted CREATE2 address recorded in the report. The code check at block 119544065 returned empty.
- `contracts/script/optra-mainnet-deploy.sh --prepare <new-packet.json>`: only after strict preflight, create a mode-0600 approval packet with the exact transaction, constructor arguments, CREATE2 salt/address, chain/block, source/config hashes, gas estimate/limits, evidence references, and a canonical SHA-256 approval hash. It refuses to overwrite an existing path.
- `contracts/script/optra-mainnet-deploy.sh --broadcast <packet.json>`: operator-only. Requires the recorded final approval reference and exact approved packet SHA-256; re-runs strict guards; compares current source/config/build, constructor data, CREATE2 address/data, gas settings, chain, nonce, signer address and max-cost balance to the packet before asking the local keystore to sign/send. Never run until the owner has approved that exact packet.
- `contracts/script/optra-mainnet-postflight.sh <packet.json> <tx-hash>`: verifies the approved packet hash, successful receipt, actual sender/destination/calldata/nonce/value/gas, deployed runtime presence/size/hash, and constructor getter readbacks. It requires the instance to remain unbound, entry-paused, and without published/fresh policy.
- `contracts/script/optra-mainnet-verify-source.sh --prepare <hook-address> <new-output-directory>`: reads the deployed getters, prepares standard-JSON verification input, compiler version, constructor args and manifest. It does not submit source. Follow the manual Sourcify/Robinhood Blockscout process and verify exact match on the chain explorer.

## Keeper policy operation

The configured keeper is a distinct EOA from the Safe/admin and deployer. It may only publish `pauseEntries`; the contract timestamps each publication using chain time, and policy expires after the configured 300-second maximum age. Missing, stale, or paused policy blocks risk-increasing ETH buys; ETH-out remains permitted. The keeper cannot initialize/rebind the pool, set the policy age, withdraw funds, change the Safe, or authorize swaps. The Safe can rotate/revoke the keeper; either action invalidates policy and returns the hook to paused state.

Before any future policy publication, use a trusted read-only RPC to check chain ID 4663, hook runtime, `keeper()`, `admin()`, `poolCreator()`, `poolBound()`, `configuredPoolId()`, `policyPublished()`, `entryPaused()`, `policyUpdatedAt()`, `maxPolicyAge()`, and `isPolicyFresh()`. Verify the proposed `pauseEntries` value and the designated keeper signer locally. A fresh `pauseEntries=true` is the safe initial posture. Do not publish `false` unless production, asset, route, monitoring, and risk approvals are in force and the exact transaction batch has its separate owner approval. Do not place keeper secrets in agent chat, shell history, repository files, or logs; do not enable autonomous signing. This runbook documents the operator boundary and does not itself authorize a policy transaction.

## Owner-provided environment

The scripts never source `.env`. Supply values explicitly in the operator's local shell; do not paste RPC credentials, keystore passwords, private keys, or seed phrases into agent chat or logs.

Required for estimate/prepare:

- `OPTRA_MAINNET_RPC_URL`
- `OPTRA_MAINNET_DEPLOYER`
- `OPTRA_MAINNET_ADMIN_SAFE`
- `OPTRA_MAINNET_KEEPER`
- `OPTRA_MAINNET_POOL_CREATOR`
- `OPTRA_MAINNET_UNDERLYING=0x0000000000000000000000000000000000000000` (native ETH) and `OPTRA_MAINNET_QUOTE=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` (USDG; 6 decimals)
- `OPTRA_MAINNET_POOL_FEE`, `OPTRA_MAINNET_TICK_SPACING`, `OPTRA_MAINNET_INITIAL_SQRT_PRICE_X96`, `OPTRA_MAINNET_MAX_POLICY_AGE`
- `OPTRA_MAINNET_GAS_LIMIT`, `OPTRA_MAINNET_GAS_LIMIT_CEILING`, `OPTRA_MAINNET_MAX_FEE_PER_GAS_WEI`, `OPTRA_MAINNET_MAX_PRIORITY_FEE_PER_GAS_WEI`, `OPTRA_MAINNET_TOTAL_FEE_CEILING_WEI`
- `OPTRA_MAINNET_I_UNDERSTAND_MAINNET=yes`
- Approval references: `OPTRA_MAINNET_PROVIDER_APPROVAL_REF`, `OPTRA_MAINNET_PM_APPROVAL_REF`, `OPTRA_MAINNET_ASSET_APPROVAL_REF`, `OPTRA_MAINNET_JURISDICTION_APPROVAL_REF`, `OPTRA_MAINNET_POOL_ROUTE_APPROVAL_REF`, `OPTRA_MAINNET_KEEPER_RUNBOOK_REF`, `OPTRA_MAINNET_REAL_ASSET_FORK_SIMULATION_REF`, `OPTRA_MAINNET_GAS_REPORT_REF`, `OPTRA_MAINNET_AUDIT_REPORT_REF`
- Evidence digests: `OPTRA_MAINNET_REAL_ASSET_FORK_SIMULATION_SHA256`, `OPTRA_MAINNET_GAS_REPORT_SHA256`, `OPTRA_MAINNET_AUDIT_REPORT_SHA256`

Broadcast additionally requires `OPTRA_MAINNET_FINAL_APPROVAL_REF`, `OPTRA_MAINNET_APPROVED_PACKET_SHA256`, `OPTRA_MAINNET_SIGNER_ACCOUNT`, and the local Foundry keystore. Owner-selected values and references must be recorded in `docs/MAINNET_OWNER_DECISIONS.md` first.

## Future operator sequence

Run only after all external gates are recorded. Replace output paths with new, empty paths in an access-controlled directory. The estimate is read-only; no result here is an approval.

```sh
contracts/script/optra-mainnet-preflight.sh --estimate
contracts/script/optra-mainnet-deploy.sh --estimate /secure/path/optra-mainnet-gas-report.json
```

After the real-asset fork simulation, independent audit, asset/jurisdiction and pool-route evidence, trusted provider selection, actual Safe/keeper selection, and measured/approved ceilings (no further PM scope confirmation is needed):

```sh
contracts/script/optra-mainnet-preflight.sh --strict
contracts/script/optra-mainnet-deploy.sh --prepare /secure/path/optra-mainnet-p4-packet.json
```

Review the entire packet and independently hash/compare it. Obtain explicit Project Owner approval naming that exact `approvalSha256`. Only the owner/operator may then run the local keystore send path:

```sh
contracts/script/optra-mainnet-deploy.sh --broadcast /secure/path/optra-mainnet-p4-packet.json
```

After a successful send, use the returned transaction hash and exact approved packet:

```sh
contracts/script/optra-mainnet-postflight.sh /secure/path/optra-mainnet-p4-packet.json 0x<transaction-hash>
contracts/script/optra-mainnet-verify-source.sh --prepare 0x<deployed-hook-address> /secure/path/optra-mainnet-verification
```

Confirm receipt, deployed runtime, getter state, Sourcify match, and Robinhood Blockscout source status before recording deployment. If the explorer API is challenged, do not claim source verification from a local manifest or Sourcify alone; complete the chain explorer check through the supported manual route.

## Measurement and safety limits

`eth_estimateGas` covers only the deployment transaction at the selected RPC's latest state. It is not a forecast for Safe actions, pool initialization, liquidity, keeper publication, swaps, or future data fees. A measured gas report must include the selected real pair/route and exact source/config hashes. The packet's gas limit × max fee is the upper bound checked against the owner-provided total-fee ceiling and signer balance.

The PoolManager and CREATE2 runtime fingerprints in the preflight were independently re-read from a public Robinhood Mainnet RPC on 2026-11-20. That endpoint was used read-only and is not approved for production signing. Select an owner-approved provider and re-check chain ID 4663 immediately before packet generation and any owner-operated broadcast.

The recommended ETH/USDG pool is a new pool at fee 3000 / tick spacing 60; the existing dynamic-fee ETH/USDG pool cannot be retrofitted. The supplied Safe candidate is the recommended admin and pool creator; the supplied keeper remains a distinct EOA candidate. Cross-project Safe authorization and keeper operator/key custody are not confirmed. The initial price must be refreshed from the live reference pool immediately before a separately approved Safe initialization. Hook deployment alone leaves the hook unbound and entries paused; it creates no liquidity and does not enable Paper/Live Trading.
