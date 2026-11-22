# OptraGuardHook Mainnet deployment: read-only revalidation (2026-11-22)

Status: packet still valid and passes every `--verify` check. Nothing was signed, broadcast, prepared, initialized or funded. Deployment has NOT happened. All values below were read from Robinhood Chain Mainnet (chain 4663) via `https://rpc.mainnet.chain.robinhood.com` at block 120,254,454 to 120,256,025 (about 2026-11-22 00:25 UTC), unless marked otherwise.

## Network and signer

| Item | Value |
|---|---|
| Network | Robinhood Chain Mainnet, chain id 4663 (`cast chain-id` = 4663) |
| Signer (from) | `0xAa8fDF2f96aFC037D50659CFd09fDF3Fac060bBf`, EOA (no code), keystore label `optra-mainnet-deployer` |
| Signer balance | 420,000,000,000,000 wei = 0.00042 ETH |
| Signer nonce | 0 (equals packet nonce) |
| Packet | `docs/evidence/p4/optra-mainnet-p4-approval-packet-20261121.json`, file SHA-256 `f54fa78beea424ae41bb486cd6602c79b5992561bb1fb3f628e113c2dc718c04` |
| Packet `approvalSha256` | `9b60e75fd06acd31894179d3488f92b4eb1ba9b468d1ac12148841a7a8ed97c1` (recomputed canonical hash matches) |

## Exact transaction

| Field | Value |
|---|---|
| To | CREATE2 singleton factory `0x4e59b44847b379578588920cA78FbF26c0B4956C` |
| Value | 0 |
| Nonce | 0 |
| Gas limit | 2,178,973 (130% of estimate 1,676,133) |
| Max fee per gas | 50,000,000 wei (0.05 gwei); priority fee 0 |
| Maximum network fee | 2,178,973 x 50,000,000 = 108,948,650,000,000 wei = 0.00010894865 ETH |
| Calldata | 8,625 bytes = 32-byte salt + init code (creation bytecode + 7 constructor words) |
| Calldata SHA-256 | `4db91a8dc4192a1daab51e163b89818c6ba392286579c3d789e0ad657c90442d` |
| First bytes | `0xa45289a5ed60d937a2e68ac0ec57711cb57522aca6b4268c989a4cbb339dab5c` (salt) then `610140604052346104eb` |
| Last 32 bytes | `000000000000000000000000000000000000000000000000000000000000012c` (maxPolicyAge = 300) |
| Salt | `0xa45289a5ed60d937a2e68ac0ec57711cb57522aca6b4268c989a4cbb339dab5c` |
| Init-code hash | `0x57e4b5f8cb3a98d87f5ac598b6017b6cb442d13bc9b0fcea9671012311d97840` |
| Predicted address | `0x4089d38251fF25936d778C799d5d3AB5658c2080` (low bits `0x2080` = beforeInitialize + beforeSwap) |

Full calldata hex is in the packet (`packet.transaction.data`); it is not repeated here.

Constructor (ABI-encoded in packet): PoolManager `0x8366a39CC670B4001A1121B8F6A443A643e40951`; underlying `address(0)` (native ETH); quote USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`; pool creator and admin Safe `0xf9C76ef996C5cbC73E4E23927D6EecB3295c8d45`; keeper `0x23439a41eDC01D58d3Aaa0C75E9dFEE0C0196848`; max policy age 300 s.

## Verification results

1. `optra-mainnet-deploy.sh --verify <packet>` (env from `docs/evidence/p4/p4-mainnet.env`): PASS, exit 0. Output: `PASS: signer balance covers approved maximum transaction cost (108948650000000 wei)` and `PASS: packet 9b60e75f...97c1 satisfies every broadcast check. Nothing was signed or sent.` It checked: packet hash, chain 4663, factory destination, `contracts/` tree and hook source/foundry hashes vs the packet, clean `contracts/`, configuration vs env, calldata = salt + current init code, chain id and nonce, balance vs max cost.
2. Init code: `forge build` + `forge inspect` creation bytecode + `cast abi-encode` constructor args; `cast keccak` = `0x57e4b5f8...d97840`, equal to the packet. Constructor args equal the packet's. Calldata equals `salt || initcode` byte for byte.
3. `cast create2 --deployer 0x4e59...956C --salt 0xa452...ab5c --init-code-hash 0x57e4...7840` = `0x4089d38251fF25936d778C799d5d3AB5658c2080`, equal to the packet.
4. Simulation: `eth_call` of the exact transaction from the signer returned `0x4089d38251ff25936d778c799d5d3ab5658c2080`. `eth_estimateGas` = 1,676,133 (0x199365), identical to the packet's estimate.
5. Nothing deployed: `cast code 0x4089...2080` = `0x`; `cast logs --address 0x4089...2080` from block 119,952,014 returned nothing; signer nonce is still 0, so the signer has sent no transaction at all. The factory emits no events, so a salt-specific log query is not possible; nonce 0 and empty code are the evidence.
6. Factory: code present, runtime SHA-256 `e0af82ad2e5188285db8ba0b2ae054d13f0fd4fe325c48c7f2dace48454404b9` equals the value pinned in `optra-mainnet-preflight.sh`. PoolManager: 24,009 bytes, runtime SHA-256 `6eb21c69298b064e37fcf8089a941ae096fe08c0f179b2d399567aef1b10585b`, equals the pinned value.
7. Source: `forge verify-contract --show-standard-json-input 0x4089... src/OptraGuardHook.sol:OptraGuardHook --chain 4663` gives SHA-256 `b3da2973abbc938ae9c5f7f81a869c081e512fdb1bc2bc6eaf32d4d0678aa3c0`, byte-identical to the earlier owner-review artifact (`contracts/.local/optra-mainnet-p4-owner-review-119441058.standard-input.json`). Hook source SHA-256 `03ead970...864e8` and `foundry.toml` SHA-256 `abf3a679...9121a` unchanged. Solc 0.8.26, optimizer runs 44444444, EVM cancun.
8. Evidence files re-hashed and match the packet: fork log `bfd7cb60...b8c3`, gas report `26d0587f...6a84`, owner record `aa24831c...2e57e`, risk-acceptance doc `a1d6d70a...20af`.

### On-chain dependencies

| Address | Result |
|---|---|
| Safe `0xf9C76ef996C5cbC73E4E23927D6EecB3295c8d45` | Proxy code present (123 bytes); singleton `0xedd160febbd92e350d4d398fb636302fccd67c7e` has code; `VERSION()` 1.5.0; threshold 2; owners `0xe28C6D49900d0E006C9a8EEdA44594385876D91C`, `0xfa0426d7AD93F4f1E990BD4C1103c771344ADa17`, `0x1bF7ef4E29EEB775eD30da27AF1dc740C5368Fb6` (all EOAs); Safe nonce 0, balance 0 |
| Keeper `0x23439a41eDC01D58d3Aaa0C75E9dFEE0C0196848` | EOA, nonce 0, balance 0; `isOwner` on Safe = false |
| Deployer | `isOwner` on Safe = false |
| USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` | Code present (170 bytes), `decimals()` 6, `symbol()` USDG |

### Fee and balance

- Current gas price 20,080,000 wei; latest base fee 20,110,000 wei (block 120,256,025). The packet max fee is 2.49x the current gas price.
- Expected cost at the estimate and current gas price: 1,676,133 x 20,080,000 = 33,656,750,640,000 wei (0.0000336568 ETH). At the full gas limit and current price: 43,753,777,840,000 wei.
- Worst case at the packet ceiling: 108,948,650,000,000 wei. Balance 420,000,000,000,000 wei covers it 3.86x, margin 311,051,350,000,000 wei (0.000311 ETH). Balance covers it with margin.
- The estimate comes from the public RPC and may not include every chain-specific data fee; the 130% gas limit is the margin for that. If the real cost exceeds the ceiling, the transaction fails or stalls rather than overspending.

## What is stale and what is not

| Field | Packet | Now | Verdict |
|---|---|---|---|
| Commit binding | `sourceCommit` `057bff6c3413c89cdd2af0744c66ed1642ed4903` | HEAD `1d92174799638a070e5d482455dab4633fc6a3a9` | Different commit, but the packet binds the `contracts/` git tree: `cf45caa14da5b7c896a0355a718eef899cedea0c` at both `057bff6` and HEAD. `git log 057bff6..HEAD -- contracts/` is empty and `git diff 057bff6 HEAD -- contracts` is empty. Not stale. `git status -- contracts docs` clean. |
| Block number | `createdAtBlock` 119,952,014 (ts 1795272454) | 120,254,454 (about 9.6 h later) | Informational only. Not a validity field. |
| Nonce | 0 | 0 | Unchanged |
| Balance | 0.00042 ETH (approval sheet) | 0.00042 ETH | Unchanged |
| Gas price | 20,374,000 (sheet, at freeze) | 20,080,000 | Moved slightly down. The ceiling is fixed by the max fee, not by observed price. |
| Predicted address code | none at block 119,957,360 (sheet) | `0x` at block 120,254,454 | Still empty |

Documentation drift (not a packet defect): `docs/MAINNET_P4_READINESS.md` still shows the earlier proposal (max fee 40,864,000 wei, ceiling 0.000089041552672 ETH, 4.7x balance). The packet and approval sheet use max fee 50,000,000 wei, ceiling 0.00010894865 ETH, 3.86x. The packet governs.

If the owner or any engineer changes anything under `contracts/` before sending, the tree no longer matches and `--verify` / `--broadcast` refuse. A re-prepare would then need: commit the change, export the env from `p4-mainnet.env` (including the pinned salt, gas limit, fees, ceilings, evidence refs and risk-acceptance ref/hash), run `--prepare` to a new packet file, re-verify, and obtain a new owner approval of the new `approvalSha256`. Not needed today.

## Contract-change review since the packet

No contract source, constructor parameter, ABI, Safe, keeper or USDG address changed. Evidence: empty `git log` and `git diff` for `contracts/` between `057bff6` and HEAD; identical `contracts/` tree hash; identical standard-json-input SHA-256; init-code hash, constructor args and predicted address reproduced independently. Commits since `057bff6` (`4863986`, `81dd6dd`, `1d92174`, and docs) touch app code, tests and docs only. The working tree has uncommitted app/lib/test edits outside `contracts/` and `docs/` (not part of this check); `git status` shows nothing modified under `contracts/` or `docs/` apart from this new file.

## Deployment-only risks (docs/MAINNET_DEPLOYMENT_ONLY_RISK_ACCEPTANCE.md): nothing material changed

1. Unaudited, immutable code at a public address. Unchanged. A defect means a new deployment at a new address.
2. Safe is immutable admin and pool creator; its three owners have not consented (no record in the repo; I did not contact anyone). Unchanged. Safe is still a 2-of-3 with nonce 0 and no activity, so no sign it has been informed or has acted. If the owners decline, the hook can never be initialized or its keeper rotated.
3. Keeper is a candidate with no custody record: still EOA, balance 0, nonce 0.
4. Explorer will show unverified source until post-deployment verification; verified source is not an audit.
5. Fee loss if the transaction reverts or the address is occupied. Reduced by this check: `eth_call` returns the predicted address and the address is empty. A competing deployment of the same salt/init code by someone else would require this exact calldata (the factory is permissionless); that would leave the same code at the same address, and this transaction would then revert and burn gas. Probability is low but not zero, since the calldata is only in this repo.
6. Public RPC without a service level; measurements were taken on it.

## NOT authorized by deployment-only approval

- Pool initialization (Safe call to PoolManager) and the initial price, which must be re-derived from the live reference pool immediately before.
- Liquidity provision or any movement of funds, including funding the keeper.
- Hook permission or admin changes, keeper rotation, keeper policy publication or any keeper operation.
- Any live infrastructure: keeper service, Live Agent, CallPut order execution, router actions.
- Any claim in product copy that the hook is audited, eligible or protective.
- Safe-owner consent, issuer or legal determinations, and the audit.

## Approval message the owner must paste

```
Approve OptraGuardHook deployment packet 9b60e75fd06acd31894179d3488f92b4eb1ba9b468d1ac12148841a7a8ed97c1: Robinhood Chain Mainnet (4663), from 0xAa8fDF2f96aFC037D50659CFd09fDF3Fac060bBf nonce 0, to CREATE2 factory 0x4e59b44847b379578588920cA78FbF26c0B4956C, value 0, calldata SHA-256 4db91a8dc4192a1daab51e163b89818c6ba392286579c3d789e0ad657c90442d, gas limit 2178973, max fee 50000000 wei, priority fee 0, maximum fee 0.00010894865 ETH, predicted address 0x4089d38251fF25936d778C799d5d3AB5658c2080. I accept the five risks in docs/MAINNET_DEPLOYMENT_ONLY_RISK_ACCEPTANCE.md (SHA-256 a1d6d70a9f29f1073e26a94ac2351d7ee5dba2584621faf1666411a784ef20af). This is deployment-only: it does not authorize pool initialization, liquidity, keeper policy, or any other transaction.
```

The owner then runs (engineering never handles the keystore password):

```sh
cd "<repo>" && source docs/evidence/p4/p4-mainnet.env
export OPTRA_MAINNET_FINAL_APPROVAL_REF="<record of the approval message>"
export OPTRA_MAINNET_APPROVED_PACKET_SHA256=9b60e75fd06acd31894179d3488f92b4eb1ba9b468d1ac12148841a7a8ed97c1
export OPTRA_MAINNET_SIGNER_ACCOUNT=optra-mainnet-deployer
contracts/script/optra-mainnet-deploy.sh --verify docs/evidence/p4/optra-mainnet-p4-approval-packet-20261121.json   # optional last read-only check
contracts/script/optra-mainnet-deploy.sh --broadcast docs/evidence/p4/optra-mainnet-p4-approval-packet-20261121.json
```

`--broadcast` sends with `--async`, so it prints a transaction hash without waiting for a receipt.

## Post-deployment checklist

1. `cast receipt <txhash> --rpc-url $OPTRA_MAINNET_RPC_URL`: status 1, `gasUsed` at or below 2,178,973, `from` is the deployer, `to` is the factory; record block number and effective gas price. Confirm deployer nonce is 1.
2. `cast code 0x4089d38251fF25936d778C799d5d3AB5658c2080` is non-empty; run `contracts/script/optra-mainnet-postflight.sh <packet> <txhash>`.
3. Runtime bytecode compare: local `forge inspect src/OptraGuardHook.sol:OptraGuardHook deployedBytecode` vs on-chain code. Immutables make them differ at the immutable slots, so compare after masking those, or compare `cast keccak` of the on-chain code with a local simulation of the same constructor args.
4. Read back the constructor state: `poolManager`, `underlying`, `quote`, `admin`, `poolCreator`, `keeper`, `maxPolicyAge` = 300, paused/unbound state (no pool bound, no fresh policy).
5. Source verification: `contracts/script/optra-mainnet-verify-source.sh --prepare 0x4089...2080 <dir>`, then `forge verify-contract` / explorer submission with the stored constructor args and the standard-json-input whose SHA-256 is `b3da2973...78aa3c0`.
6. Evidence capture: save receipt JSON, transaction hash, block, gas used, postflight output and verification result under `docs/evidence/p4/` with SHA-256 values; update `docs/MAINNET_P4_READINESS.md` and the approval sheet to "deployed" with those figures.
7. Update the Verify page (`app/(app)/verify/page.tsx`) with the deployed address, tx hash and explorer link, worded as "deployed, unaudited, uninitialized"; no claim of audit, eligibility or protection.
8. Do not initialize the pool, fund the keeper, or publish policy until each has its own approval.

## Not run

`--prepare`, `--broadcast`, `--estimate`, `--freeze`, the strict preflight and the real-asset fork test were not run in this revalidation. `--verify` runs `forge build` inside `contracts/` (ignored build output only; `git status` is clean for `contracts/` and `docs/`).
