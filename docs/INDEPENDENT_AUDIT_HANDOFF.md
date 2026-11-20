# OptraGuardHook: independent audit handoff

Status: ready for an external reviewer. No independent audit has been performed. This document is not an audit, an approval, or a deployment authorization. No OPTRA contract is deployed on Robinhood Chain Mainnet.

## 1. Scope

| Item | Value |
|---|---|
| In scope | `contracts/src/OptraGuardHook.sol` (290 lines) and the deployment path in `contracts/script/optra-mainnet-{preflight,deploy,postflight,verify-source}.sh` |
| Source SHA-256 | `cc952a87aa28ab78754de3abe3b9015fc1f706baaf922f797f74b5a8de723ba2` |
| Git baseline | Hook source unchanged since commit `64872b7`. Reviewer should pin the commit that contains this document. |
| Compiler | Solidity 0.8.26, optimizer runs 44,444,444, via-IR, EVM Cancun, `bytecode_hash = none` (`contracts/foundry.toml`) |
| Dependencies | Uniswap v4-core v4.0.0 (`e50237c4…`), forge-std v1.17.0 (`f3dae6e6…`), pinned in `contracts/dependencies.lock` |
| Local build | Runtime 7,085 bytes, creation code 8,369 bytes (forge 1.8.3) |
| Target | Robinhood Chain Mainnet, chain 4663. PoolManager `0x8366a39CC670B4001A1121B8F6A443A643e40951` (runtime 24,009 bytes, SHA-256 `6eb21c69…585b`). CREATE2 factory `0x4e59b44847b379578588920cA78FbF26c0B4956C`. |
| Out of scope | CallPut contracts, options execution, the web app, Uniswap v4-core itself, token contracts chosen later |

## 2. What the contract is, and is not

An experimental one-pool Uniswap v4 spot-swap gate. It uses two hook permissions only: `beforeInitialize` and `beforeSwap`. Every other callback reverts with `UnsupportedCallback` and is not enabled by the address flags.

- `beforeInitialize` binds the instance to the first pool whose creator equals the immutable `poolCreator`, whose pair matches the immutable `(underlyingToken, quoteToken)`, and whose key points at this hook. A second bind reverts.
- `beforeSwap` permits any swap that sells the configured underlying (by token direction only). Any other swap requires a published policy, `entryPaused == false`, and a policy age of at most `maxPolicyAge` (1 to 900 seconds).
- `publishPolicy(bool)` is keeper-only and stamps `block.timestamp`.
- `setKeeper` and `revokeKeeper` are admin-only. Either one clears the policy and pauses entries. On chain 4663 the keeper cannot equal the admin.
- The constructor on chain 4663 requires the pinned PoolManager, and code at the pool creator and the admin.

It does not identify options orders or user exposure, does not close positions, holds no funds, and has no upgrade path. It cannot govern CallPut orders.

## 3. Evidence the reviewer can reproduce

| Command (from `contracts/`) | Result on 2026-11-20 |
|---|---|
| `forge test` | 33 passed, 0 failed, 4 skipped (fork tests need an env flag) |
| `RUN_ROBINHOOD_MAINNET_FORK=true forge test --match-contract CallPutRobinhoodMainnetForkTest` | 2 passed (read-only CallPut bindings) |
| `RUN_OPTRA_ROBINHOOD_MAINNET_FORK=true forge test --match-contract OptraRobinhoodMainnetForkTest --fork-url https://rpc.mainnet.chain.robinhood.com --gas-report` | 1 passed. The hook binds and gates swaps against the real PoolManager runtime, using synthetic tokens in transient fork state. |
| Invariant `invariant_missingPolicyAlwaysHasPausedZeroTimestampState` | 256 runs, 128,000 calls, 0 reverts |
| `optra-mainnet-deploy.sh --estimate` (rehearsal, see section 4) | `eth_estimateGas` = 1,676,421 for the CREATE2 factory deployment |
| Fork gas report, CREATE2 factory `deploy` | 1,648,245 gas |
| Fork gas report, `publishPolicy` | about 30,400 gas |
| Fork gas report, swap through the gated pool | 66,270 to 149,184 gas (8 calls) |

Gas for a real deployment depends on the exact owner-selected tuple. The figures above are measurements of the same bytecode with synthetic parameters, not a signed gas report for an approved candidate.

## 4. Script review notes

- Rehearsal on a local `anvil --fork-url` of Robinhood Mainnet (chain 4663), with locally deployed synthetic tokens and a mock three-owner Safe. These existed only in local fork state and were not deployed anywhere real. It exercised the `--estimate` path of `optra-mainnet-preflight.sh` and `optra-mainnet-deploy.sh`.
- Defect found and fixed: `optra-mainnet-deploy.sh` parsed the mined CREATE2 address with an unanchored 40-hex regex. `cast create2 --ends-with` prints the salt after the address, so the first 40 hex digits of the 64-hex salt could be taken as the "address" and fail the flag check. The regex is now word-anchored (`\b0x[0-9a-fA-F]{40}\b`). Reviewer: please confirm no other regex has the same problem. `optra-mainnet-preflight.sh` line 230 parses `getOwners()` output and does not contain 64-hex values.
- The deployer guard rejects an address that has any code, including an EIP-7702 delegation (`0xef0100…`). That is conservative and intended. The rehearsal showed a well-known test address that carries a delegation on this chain. The owner's deployer must be a plain EOA with no delegation.
- Strict mode (`--strict`), `--prepare`, `--broadcast` and `postflight.sh` were reviewed by reading and `bash -n` only. They were not run end to end because strict mode requires the real approval references and audit digests that do not exist yet.

## 5. Questions for the reviewer

1. Can a pool creator other than `poolCreator` bind the instance through any v4 path (router, `unlock` callback, `initialize` ordering)?
2. Is "sells the configured underlying" a sound allow rule when a pool uses a fee-on-transfer or rebasing token? The prototype assumes two plain ERC-20 assets.
3. Is the keeper's `block.timestamp` freshness window acceptable given validator timestamp influence on this chain, at the owner's chosen `maxPolicyAge`?
4. Immutable admin and creator with no rotation of either. Is the keeper-only rotation path enough for the intended operations?
5. Confirm the CREATE2 address-flag mining (`0x2080` low bits) and the factory's pinned runtime match what v4 expects.
6. Review the deploy script's guard sequence for a path that broadcasts without the exact packet hash.

## 6. Deliverables expected from the reviewer

Written report for the exact source SHA-256 above, severity-ranked findings with a fix and re-review status, the final report file and its SHA-256 (recorded as `OPTRA_MAINNET_AUDIT_REPORT_REF` and `OPTRA_MAINNET_AUDIT_REPORT_SHA256` in the preflight), and an explicit statement of what was not reviewed.

## 7. References

`docs/INTERNAL_AUDIT.md`, `docs/THREAT_MODEL.md`, `docs/KNOWN_LIMITATIONS.md`, `docs/INCIDENT_RESPONSE.md`, `docs/MAINNET_CHECKLIST.md`, `docs/MAINNET_OWNER_DECISIONS.md`, `docs/MAINNET_DEPLOYMENT_RUNBOOK.md`, `docs/contract-deployment-plan.md`. The internal audit is an engineering review and does not substitute for an independent one.
