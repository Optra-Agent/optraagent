# OPTRA Mainnet P4 readiness (2026-11-21)

**UPDATE 2026-11-22: OptraGuardHook is DEPLOYED at `0x4089d38251fF25936d778C799d5d3AB5658c2080` (tx `0xdc17732c4568fb66735a7f240a586fbc8a4d513922b1c70d152e2b467a869fc0`, block 120,305,454, fee 0.0000329727 ETH). Deployment-only: unaudited, uninitialized, no pool, no funds moved. See `docs/evidence/p4/mainnet-deployment-record-20261122.md`. The text below is the pre-deployment readiness record.**

Status (pre-deployment): engineering-complete, owner-gated. Nothing was signed, broadcast, deployed, initialized or funded. Every figure below is a read-only measurement on Robinhood Chain Mainnet (chain 4663) unless marked "proposal".

## Production contract inventory

| Item | Value | Ownership |
|---|---|---|
| OPTRA contract to deploy | `OptraGuardHook` (`contracts/src/OptraGuardHook.sol`), one instance | OPTRA |
| Uniswap v4 PoolManager | `0x8366a39CC670B4001A1121B8F6A443A643e40951` (runtime SHA-256 pinned in preflight) | External, already deployed |
| CREATE2 singleton factory | `0x4e59b44847b379578588920cA78FbF26c0B4956C` (runtime SHA-256 pinned) | External, already deployed |
| USDG | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`, 6 decimals | External |
| Safe (admin and pool creator) | `0xf9C76ef996C5cbC73E4E23927D6EecB3295c8d45`, 3 owners, threshold 2 | Owner-supplied candidate |
| Keeper | `0x23439a41eDC01D58d3Aaa0C75E9dFEE0C0196848`, EOA, not a Safe owner, not the deployer | Owner-supplied candidate |
| Deployer | `0xAa8fDF2f96aFC037D50659CFd09fDF3Fac060bBf`, EOA, nonce 0 | Owner-supplied |
| Testnet mocks (tokens, CREATE2 helper, test routers) | Not deployed and not required | Local/Testnet only |

No OPTRA registry, CallPut contract, router or token is needed for the selected scope. The hook gates swap direction in its own ETH/USDG pool only. It does not protect the existing ETH/USDG pool and does not execute CallPut options.

## Predicted deployment (not a deployed address)

- Report: `contracts/.local/optra-mainnet-p4-candidate-estimate-20261121-release-a750a83.json`, SHA-256 `26d0587f67c80d1831d5c32a0e776b86399685cdaa2f7265c7856ab3f0da6a84`, read at block 119617126, source commit `a750a831c6a91ad761c91f4073f17a436703bb1f`.
- Predicted hook address: `0x4089d38251fF25936d778C799d5d3AB5658c2080`. CREATE2 factory `0x4e59…956C`, salt `0xa45289a5ed60d937a2e68ac0ec57711cb57522aca6b4268c989a4cbb339dab5c`, init-code hash `0x57e4b5f8cb3a98d87f5ac598b6017b6cb442d13bc9b0fcea9671012311d97840`. Independently reproduced with `cast create2`. `eth_getCode` at block 119617306 returned `0x`.
- The salt is mined at random on every `--estimate` run to satisfy the hook's permission-bit suffix `2080`, so the address changes between runs. The address becomes fixed only when `--prepare` writes an approval packet. Any rerun requires a new review. Update 2026-11-21: this salt is now pinned with `OPTRA_MAINNET_CREATE2_SALT`, and `--freeze` writes the frozen candidate. See `docs/MAINNET_FINAL_APPROVAL_SHEET.md`.
- Constructor arguments (ABI-encoded in the report): PoolManager, underlying `address(0)` (native ETH), quote USDG, admin Safe, pool creator Safe, keeper, max policy age 300 seconds.
- Pool parameters (used later by the Safe, not by this deployment): static fee 3000, tick spacing 60, initial sqrtPriceX96 `3185677305239360665288704`. The final price must be re-derived from the live reference pool immediately before the separately approved initialization.

## Gas and funding

| Item | Value |
|---|---|
| `eth_estimateGas` | 1,676,133 |
| Gas limit proposal (130%) | 2,178,973 |
| Observed gas price (block 119617306) | 20,432,000 wei |
| Max fee proposal (2x observed) | 40,864,000 wei; priority fee 0 |
| Fee ceiling proposal (limit x max fee) | 89,041,552,672,000 wei (0.000089041552672 ETH) |
| Deployer balance | 420,000,000,000,000 wei (0.00042 ETH), about 4.7x the ceiling |
| Deployer USDG | 0.450270 USDG (not used by this transaction) |

The report states its scope: the constructor and CREATE2 call only. It excludes the Safe's pool initialization, any liquidity, policy publication, and chain-specific data fees that `eth_estimateGas` may not report. The fee values above are engineering proposals, not owner-approved ceilings, and they were measured over the public RPC.

## Verification evidence

- Real-asset fork: `RUN_OPTRA_ROBINHOOD_REAL_ASSET_FORK=true forge test --match-path test/OptraRobinhoodRealAssetFork.t.sol --fork-url https://rpc.mainnet.chain.robinhood.com --fork-block-number 119617306 -vv` passed 1/1 (test gas 655,487). Log `contracts/.local/optra-mainnet-real-asset-fork-119617306-20261121.log`, SHA-256 `bfa12968b91acf5e8c4a0c3890852e0b230c8ae866543b76e76905559732df23`. USDG balance and new-pool liquidity are fork-only overrides; no asset moved.
- Local Foundry suite: 34 passed, 0 failed, 5 fork tests skipped by design.
- Source-verification preparation (pre-deploy): `contracts/.local/optra-mainnet-p4-verification-prep-20261121/standard-input.json` (SHA-256 `b3da2973abbc938ae9c5f7f81a869c081e512fdb1bc2bc6eaf32d4d0678aa3c0`, byte-identical to the earlier owner-review artifact) and `constructor-args.hex`. Compiler Solc 0.8.26, optimizer runs 44444444, EVM cancun. Submission needs the deployed address, so it runs after deployment through `contracts/script/optra-mainnet-verify-source.sh --prepare <address> <dir>`.
- Strict preflight with all measured values supplied: chain, PoolManager and CREATE2 fingerprints, USDG decimals 6, Safe 3 owners / threshold 2, keeper EOA, deployer EOA and pool parameters all pass.

## Remaining genuine blockers (strict preflight, exit 2)

Engineering cannot supply these, and none may be fabricated:

1. `OPTRA_MAINNET_I_UNDERSTAND_MAINNET=yes`, the owner's explicit acknowledgement.
2. `OPTRA_MAINNET_PROVIDER_APPROVAL_REF`: an owner-approved production RPC provider. Fee values must be re-measured on it.
3. `OPTRA_MAINNET_PM_APPROVAL_REF`: PM scope approval for the spot-pool gate.
4. `OPTRA_MAINNET_ASSET_APPROVAL_REF` and `OPTRA_MAINNET_JURISDICTION_APPROVAL_REF`: asset and jurisdiction eligibility.
5. `OPTRA_MAINNET_POOL_ROUTE_APPROVAL_REF`: approval of the new hook-specific pool and operating route.
6. `OPTRA_MAINNET_KEEPER_RUNBOOK_REF`: keeper operator identity, key custody and runbook.
7. `OPTRA_MAINNET_AUDIT_REPORT_REF` and `OPTRA_MAINNET_AUDIT_REPORT_SHA256`: an independent audit report. Internal review does not qualify.

Also outside engineering control: confirmation that the Safe's owners authorize its use as OPTRA admin and pool creator (it was read at block 119556696 but cross-project consent is not on record), the owner's approval of the fee ceilings, and the owner's approval of the final packet hash.

## Executable sequence once the blockers are cleared

1. Set the nine values above plus the measured fee values and evidence SHA-256 values, then `contracts/script/optra-mainnet-deploy.sh --prepare <new-packet.json>`. This writes the approval packet with `approvalSha256`, pinned salt, nonce, gas limit and fees. It does not send anything.
2. The owner reviews the packet and approves its exact hash.
3. The owner runs `--broadcast` with `OPTRA_MAINNET_FINAL_APPROVAL_REF`, `OPTRA_MAINNET_APPROVED_PACKET_SHA256` and a Foundry keystore label. Engineering never handles the key.
4. `contracts/script/optra-mainnet-postflight.sh`, then source verification. Pool initialization and liquidity are separate Safe transactions, each needing its own approval.
