# OptraGuardHook: independent audit handoff

Status: ready for an external reviewer. No independent audit has been performed. This document is not an audit, an approval, or a deployment authorization. No OPTRA contract is deployed on Robinhood Chain Mainnet.

## 1. Scope

| Item | Value |
|---|---|
| In scope | `contracts/src/OptraGuardHook.sol` (293 lines), deployment scripts, relevant regression/fork tests, and candidate configuration. |
| Source SHA-256 | `03ead9705a22ecf8255ad4193705f99094dc82c929ecda9be8e43cc677e864e8` |
| Git baseline | Candidate source was measured with repository HEAD `ddbd85bada890160f22686d961f181decfc674c3`; the worktree was dirty. The SHA above pins the hook source bytes, not a clean committed release tree. Review the exact source and script hashes below; pin the final committed source/scripts before issuing findings. |
| Preflight script SHA-256 | `bc24f311d2226c36ff4bf831c45e716c443319deea93b4c9e825dd5112c6a2e1` |
| Deploy script SHA-256 | `9d01308db32a51669c3a8bb5816c1e59f5be7c08e708172340f7d17f9711fcd9` |
| Postflight script SHA-256 | `9bcdb79f3d81456421cc56ea712fae0b40d6760e676363af64e646bc94cb4e18` |
| Source-verification script SHA-256 | `b39e01760dbd28d0e80f28315e29f19695c9ec4a2dab33a3652b752e6c813b52` |
| Unit-test SHA-256 | `contracts/test/OptraGuardHook.t.sol` `805a25832ef9ca5ae1600f6b11ece27d5106702f6e1a30f72ec66cbc7c660a4c` |
| Real-asset fork-test SHA-256 | `contracts/test/OptraRobinhoodRealAssetFork.t.sol` `72bc5a98ff98c9943c2a8c7d8d0c2012c61644e49bcfc7d58f79d20df32bfc3e` |
| Compiler | Solidity 0.8.26, optimizer runs 44,444,444, via-IR, EVM Cancun, `bytecode_hash = none` (`contracts/foundry.toml`) |
| Dependencies | Uniswap v4-core v4.0.0 (`e50237c4…`), forge-std v1.17.0 (`f3dae6e6…`), pinned in `contracts/dependencies.lock` |
| Local build | Runtime 7,085 bytes, creation code 8,369 bytes (forge 1.8.3) |
| Target | Robinhood Chain Mainnet, chain 4663. PoolManager `0x8366a39CC670B4001A1121B8F6A443A643e40951` (runtime 24,009 bytes, SHA-256 `6eb21c69…585b`). CREATE2 factory `0x4e59b44847b379578588920cA78FbF26c0B4956C`. |
| Out of scope | CallPut contracts, options execution, the web app, Uniswap v4-core itself, and legal/jurisdiction or asset-eligibility opinions |

## 2. What the contract is, and is not

An experimental one-pool Uniswap v4 spot-swap gate. The selected candidate is native ETH (`address(0)`) / USDG; the hook uses two permissions only: `beforeInitialize` and `beforeSwap`. Every other callback reverts with `UnsupportedCallback` and is not enabled by the address flags.

- `beforeInitialize` binds the instance to the first pool whose creator equals the immutable `poolCreator`, whose pair matches the immutable `(underlyingToken, quoteToken)`, and whose key points at this hook. A second bind reverts.
- `beforeSwap` permits any swap that sells the configured underlying (by token direction only). Any other swap requires a published policy, `entryPaused == false`, and a policy age of at most `maxPolicyAge` (1 to 900 seconds).
- `publishPolicy(bool)` is keeper-only and stamps `block.timestamp`.
- `setKeeper` and `revokeKeeper` are admin-only. Either one clears the policy and pauses entries. On chain 4663 the keeper cannot equal the admin.
- On chain 4663 the constructor requires the pinned PoolManager, code at the pool creator and admin, a distinct keeper, and permits native ETH only as the underlying; quote remains a code-bearing ERC-20.

It does not identify options orders or user exposure, does not close positions, holds no funds, and has no upgrade path. It cannot govern CallPut orders.

## 3. Evidence the reviewer can reproduce

| Command / check (from `contracts/`) | Result / evidence |
|---|---|
| `forge test` | 34 passed, 0 failed, 5 skipped (opt-in network fork tests) |
| `RUN_OPTRA_ROBINHOOD_MAINNET_FORK=true forge test --match-contract OptraRobinhoodMainnetForkTest --fork-url https://rpc.mainnet.chain.robinhood.com` | 1 passed. The hook binds and gates swaps against the real PoolManager runtime, using synthetic tokens in transient fork state. |
| `RUN_OPTRA_ROBINHOOD_REAL_ASSET_FORK=true forge test --fork-url https://rpc.mainnet.chain.robinhood.com --fork-block-number 119160725 --match-path test/OptraRobinhoodRealAssetFork.t.sol -vv` | Historical pinned run: 1 passed at block 119160725. |
| Latest real-asset fork refresh | 1 passed at block 119544065, test gas 655,383; log `contracts/.local/optra-mainnet-real-asset-fork-119544065-20261121.log`, SHA-256 `e3a6014841a325331ba7b3d9058956afc12f6ab69914c2526b43c18e4e9d85f1`. USDG balance and new-pool liquidity were fork-only overrides. |
| Invariant `invariant_missingPolicyAlwaysHasPausedZeroTimestampState` | 256 runs, 128,000 calls, 0 reverts |
| Current CREATE2/gas candidate | Read-only estimate at block 119537033: 1,676,133 gas; candidate address/salt/calldata are in `contracts/.local/optra-mainnet-p4-candidate-estimate-20261121-current.json` (SHA-256 `b563958d1f1febdb923eea44859fe34d8421e389ef2a80a8c7e7f671061bbf68`). The candidate address had no code at block 119544065. It used the public RPC, not an owner-approved production provider; no gas ceiling is approved. |

The candidate roles are now supplied and read-only checked. Final deployment gas/fee ceilings must be refreshed on an owner-approved RPC and explicitly approved; the current public-RPC estimate is evidence, not an owner-approved spending ceiling.

## 4. Script review notes

- Rehearsal on a local `anvil --fork-url` of Robinhood Mainnet (chain 4663), with locally deployed synthetic tokens and a mock three-owner Safe. These existed only in local fork state and were not deployed anywhere real. It exercised the `--estimate` path of `optra-mainnet-preflight.sh` and `optra-mainnet-deploy.sh`.
- Defect found and fixed: `optra-mainnet-deploy.sh` parsed the mined CREATE2 address with an unanchored 40-hex regex. `cast create2 --ends-with` prints the salt after the address, so the first 40 hex digits of the 64-hex salt could be taken as the "address" and fail the flag check. The regex is now word-anchored (`\b0x[0-9a-fA-F]{40}\b`). Reviewer: please confirm no other regex has the same problem. Review the Safe-owner parser around `getOwners()` in `optra-mainnet-preflight.sh` against the expected `cast getOwners()` output; avoid relying on this document's stale line numbers after script changes.
- The deployer guard rejects an address that has any code, including an EIP-7702 delegation (`0xef0100…`). That is conservative and intended. The rehearsal showed a well-known test address that carries a delegation on this chain. The owner's deployer must be a plain EOA with no delegation.
- `optra-mainnet-preflight.sh --strict` has been run read-only with the supplied deployer, Safe candidate, keeper, and ETH/USDG tuple: it passed chain ID and PoolManager/factory runtime fingerprints, then returned missing Mainnet acknowledgement, owner-approved gas ceilings, formal provider/PM/asset/jurisdiction/pool/keeper-runbook approvals, and audit/evidence references. The Safe candidate readback is 3 owners/threshold 2; cross-project authorization is unconfirmed. `--prepare`, `--broadcast`, and postflight have not been run. No transaction was signed or broadcast.

## 5. Questions for the reviewer

1. Can a pool creator other than `poolCreator` bind the instance through any v4 path (router, `unlock` callback, `initialize` ordering)?
2. Review native-ETH settlement and USDG proxy/transfer semantics, including pause, blacklist, fee-on-transfer, rebasing, or other non-standard token behavior, against the one-way underlying-sell allow rule.
3. Is the keeper's `block.timestamp` freshness window acceptable given validator timestamp influence on this chain, at the owner's chosen `maxPolicyAge`?
4. Immutable admin and creator with no rotation of either. Is the keeper-only rotation path enough for the intended operations?
5. Confirm the CREATE2 address-flag mining (`0x2080` low bits) and the factory's pinned runtime match what v4 expects.
6. Review the deploy script's guard sequence for a path that broadcasts without the exact packet hash.

## 6. Deliverables expected from the reviewer

Written report for the exact source SHA-256 above, severity-ranked findings with a fix and re-review status, the final report file and its SHA-256 (recorded as `OPTRA_MAINNET_AUDIT_REPORT_REF` and `OPTRA_MAINNET_AUDIT_REPORT_SHA256` in the preflight), and an explicit statement of what was not reviewed.

## 7. References

`docs/INTERNAL_AUDIT.md`, `docs/THREAT_MODEL.md`, `docs/KNOWN_LIMITATIONS.md`, `docs/INCIDENT_RESPONSE.md`, `docs/MAINNET_CHECKLIST.md`, `docs/MAINNET_OWNER_DECISIONS.md`, `docs/MAINNET_DEPLOYMENT_RUNBOOK.md`, `docs/MAINNET_SAFE_SETUP.md`, `docs/evidence/OPTRA_MAINNET_REAL_ASSET_FORK.md`, and `docs/contract-deployment-plan.md`. The internal audit is an engineering review and does not substitute for an independent one.
