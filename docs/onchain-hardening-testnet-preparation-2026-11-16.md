# OPTRA onchain hardening and Testnet preparation — 2026-11-16

## Decision

**Local proof of concept: verified. Robinhood Testnet deployment: NO-GO. Mainnet: separately gated and not authorized.** No public-network transaction was sent. No production key was read or used.

The hardening pass stayed within `contracts/`, `contracts/README.md`, and this report. It did not change the trading engine, database, authentication, or shared fullstack tracker. The implementation remains an experimental directional gate for one new Uniswap v4 spot pool; it does not execute or identify options trades.

## Scope and implementation changes

Reviewed `contracts/src/OptraGuardHook.sol`, the Foundry integration suite, both deployment/simulation scripts, the existing contract plan, and the original PM brief (§8 and P4). The PM brief describes onchain controls for spot legs and calls for halting risk-increasing directions while allowing reductions. It also distinguishes spot swaps from options orders executed at an external venue. This prototype cannot enforce the PM's options-position semantics.

One contract state correction was made: `entryPaused` now initializes to `true`. A missing policy already reverted risk-increasing swaps, but the getter previously reported `false` before the first publication. A regression test proved the state mismatch before the constructor change and now verifies the fail-closed state.

The integration tests now exercise:

- Both ERC-20 address orderings using real PoolManager initialization and seeded pools.
- Exact-input and exact-output underlying buys and underlying-out swaps. `amountSpecified < 0` is exact input and `amountSpecified > 0` is exact output, per the pinned v4-core `IPoolManager.SwapParams` definition. The hook classifies direction using `zeroForOne` and sorted token addresses, so amount sign does not change buy/sell classification.
- Missing, paused, stale-at-boundary, stale-after-boundary, future-dated, and out-of-range timestamp policy states.
- Unauthorized keeper/admin calls, zero keeper, keeper rotation/revocation, unauthorized creator, wrong pair, second-pool initialization, wrong pool ID, and direct non-manager callback attempts.
- Underlying-out swaps while policy is missing, paused, and stale, plus liquidity removal while paused.
- A stateful invariant for the missing-policy state and 1,000-run fuzzing of freshness boundaries.

Hook permissions remain exactly `beforeInitialize` and `beforeSwap`, address bits `0x2080` (`8320` decimal). No liquidity, after-swap, or return-delta permissions are set. Constructor deployment validates the address bits through v4-core `Hooks.validateHookPermissions`.

The Testnet deployment script now pins the previously reviewed PoolManager address and runtime SHA-256, in addition to chain ID and nonempty code checks. A separate read-only [`optra-testnet-preflight.sh`](../contracts/script/optra-testnet-preflight.sh) checks the expected chain, manager address/runtime hash, and deployed code for two supplied token addresses. It never reads a key or sends a transaction. The hash pin comes from the earlier same-day report and still requires a fresh live-RPC comparison before any approval.

No `GuardRegistry` was introduced. The hook has one consumer, one bound pool, and a single pause bit; a second contract would add roles and calls without implementing the PM brief's wider policy schema.

## Contract behavior and security boundaries

| Area | Enforced by code | Limitation |
|---|---|---|
| Pool binding | PoolManager-only `beforeInitialize`; immutable creator and token pair; one pool ID | Creator chooses pool fee, tick spacing, and initial price when initializing. Those parameters are not pinned by the hook. |
| Entry policy | Keeper publishes a boolean; chain timestamp is stored; missing, paused, future, or stale state reverts the underlying-buy direction | No signed oracle, policy provenance, or independent rule proof. Keeper/admin custody and `maxPolicyAge` are trust decisions. |
| Direction | Uses `zeroForOne` plus address-sorted token order; exact-in and exact-out share the same direction rule | It is only a spot token-flow proxy. A sell is not proven to reduce a user's position. |
| Exit behavior | Any underlying-out swap passes even with missing, paused, or stale policy. LP removal works because liquidity callback permissions are off | The hook does not inspect `hookData`, router intent, holdings, LP position ownership, options positions, or external venue state. A risk-increasing transaction can also be routed outside this pool. |
| Scope | One new pool whose `PoolKey` includes this hook | It cannot be attached to an existing pool and does not guard other pools or the options venue. |
| Real money | This work contains only local simulation and deployment preparation | No Testnet or Mainnet deployment; no live trading path. |

The PM's stated "allow reduce" semantic is therefore **not** established by the current contract. The implemented exception is "allow swaps in the direction that sends the configured underlying out of this pool." In particular, the contract cannot distinguish a covered-position exit from an unrelated sale or a hedge that increases risk elsewhere. `hookData` is caller-controlled and ignored; it is not a safe proof of route or position context.

## Foundry verification

Run from `contracts/`:

```text
forge fmt --check                         PASS
forge build                               PASS — solc 0.8.26
forge lint                                PASS — no findings
forge test --fuzz-runs 1000 -vv           PASS — 26 tests, 0 failed
```

Breakdown: 18 policy/integration tests, 7 permission/initialization tests, and 1 invariant test. Freshness fuzz ran 1,000 cases. The invariant ran 256 sequences of 500 calls (128,000 handler calls) with zero reverts and zero invariant failures. No test was skipped.

The local-chain guard was also exercised without a key or `--broadcast`:

```text
forge script script/OptraTestnetDeployment.s.sol:OptraTestnetDeployment \
  --rpc-url http://127.0.0.1:18545 -vv
```

On local chain ID `31337` it reverted with `Robinhood Testnet chain ID 46630 required`, before the script read deployment configuration or a private key. The read-only shell preflight passed `bash -n` and rejected the same local RPC with `refusing non-Robinhood-Testnet chain ID: 31337`. Toolchain: Foundry `forge` and `anvil` version `1.8.3`.

## Local Anvil execution — LOCAL ONLY

The integration script ran against a fresh isolated Anvil at `127.0.0.1:18545`, chain ID `31337`, using Anvil's published local test key. The script used one broadcast segment; two later exit swaps were sent as separate local-only `cast send` transactions. It mined and checked the hook address, initialized a real pinned v4-core `PoolManager`, seeded liquidity, executed exact-input and exact-output buys, published pause state, and simulated rejected paused buys. The two underlying-out swaps were then persisted as local Anvil receipts.

| Local contract/state | Value |
|---|---|
| PoolManager | `0x5FbDB2315678afecb367f032d93F642f64180aa3` |
| Hook CREATE2 factory | `0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9` |
| OptraGuardHook | `0xEE91009bedff7abA73d3c745EA23f106bE8EE080` |
| Underlying / quote test tokens | `0xe7f1725e7734ce288f8367e1bb143e90bb3f0512` / `0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0` |
| PoolSwapTest / PoolModifyLiquidityTest | `0x5fc8d32690cc91d4c39d9d3abcbd16989f875707` / `0xdc64a140aa3e981100a9beca4e685f962f0cf6c9` |
| Pool ID | `0x2ca3bde1ba75d07911d3a2eab960522f71fec1cd5ce1d6f0ca2d2dcd634e0768` |
| CREATE2 salt / init-code hash | `0x000000000000000000000000000000000000000000000000000000000000076d` / `0xb0921390f37fbf16201f4a4eaebfe75420e98b6d189227124a4f00bb1b3359c4` |
| Permission bits / local runtime hash | `0x2080` / `0x0696d18108ad558323b137c19a0f56425399ad5c308c9cd5a321f2ed7a4e6860` (Keccak-256) |
| Read-back after execution | `poolBound=true`, matching Pool ID, `policyPublished=true`, `entryPaused=true`, timestamp `1794820512` |

The Forge broadcast file contains all **19 successful setup/deployment receipts** (`status=0x1`), with measured receipt gas totaling **12,768,123**. The script's pre-send gas estimate was **16,834,192**, reported separately from measured receipt gas.

| Operation | Local transaction hash | Receipt gas |
|---|---|---:|
| Hook CREATE2 deployment | `0x10b506577006ce2b97ae50202e6399a284f09a3c107c8ecd8123f0eb2f759945` | 1,615,927 |
| PoolManager initialize (emitted `Initialize` and hook `PoolBound`) | `0xb2a107e91b57979c3cbb151180f2db8986c317dc9d19e9890d18b0ddd246ab2f` | 85,184 |
| Seed liquidity | `0x8e00f360a9f86c0f0a985cd33a3ad6c01d7d02956fb1dd28f93f91dc8600ca32` | 292,797 |
| Publish allow policy | `0x32830bb719b81903932af48dd4bb88a2f322063b5d92f644d14b70856b22a29e` | 30,434 |
| Exact-input buy | `0xe97ce30798cf0af5110cd45b7bbfc233a4de2c06e8fe07b7f4f67edc0b35c0be` | 149,096 |
| Exact-output buy | `0xfa20846dcb985fe518fde10f742402d3ecf8641baf0e848708cb6509b5fe4300` | 126,298 |
| Publish paused policy | `0x4a1ab6ca2affd6eff03810fceff998e85489c11919638e0f4117129a32b33f6c` | 30,446 |
| Underlying-out exact-input swap while paused | `0x1d8ff87ff6485c48a3d613ad39724b6134d9b115d04c50525b800bfa03e5bd6b` | 143,212 |
| Underlying-out exact-output swap while paused | `0xe8d24bab2031939d7f4f339751de3923cf072f762401a4f02f46b3619e806787` | 126,138 |

The two buy rejections were deliberate `eth_call` simulations, not receipts. Exact-input and exact-output calls both returned a PoolManager `WrappedError` containing the hook's `EntriesPaused()` selector `0x3750d157`. The full 19-receipt Forge record is [`run-latest.json`](../contracts/broadcast/OptraLocalSimulation.s.sol/31337/run-latest.json). All addresses, receipt hashes, state, and gas above are **ephemeral local-only evidence**, not public-network deployments or explorer records.

Receipts confirmed the PoolManager `Initialize` event (`0xdd466e67…`), hook `PoolBound` (`0x58bf64cb…`), `PolicyPublished` (`0xe7fc0ff2…`), and v4 `Swap` (`0x40e9cecb…`) topics. The source topics and emitted values were read from local receipts; post-execution hook getters were independently read with `cast call`.

## Robinhood Testnet readiness

Historical snapshot from the earlier hardening pass. Current RPC, deployment, gas, and readiness findings are recorded in the final phased status at the end of this report.

### Findings

- Robinhood's official [network documentation](https://docs.robinhood.com/chain/connecting/) lists Testnet chain ID `46630`, native gas token `ETH`, and a public RPC that is rate-limited; it recommends a provider for production.
- The official [Uniswap v4 deployment registry](https://developers.uniswap.org/docs/protocols/v4/deployments) lists PoolManager `0x8366…0951`, router, Quoter, and PositionManager for **Robinhood Chain mainnet**. Its Testnet section does not list Robinhood Testnet. The mainnet entries do not prove Testnet code or a supported Testnet route.
- The prior same-day report records a Testnet RPC/Blockscout read at block `154000067` and an exact runtime-bytecode SHA-256 match for PoolManager `0x8366a39cc670b4001a1121b8f6a443a643e40951`: `dc9622b1fc330db4b042937696cb18f2fd04f9044f19cca3a74a0ea47bf3352f`. This is prior evidence. Fresh direct reads to both `rpc.testnet.chain.robinhood.com` and `explorer.testnet.chain.robinhood.com` returned HTTP 403 in this run, so the current head, deployed bytecode, and address code were **not** refreshed. The deployment script and preflight pin this earlier hash and will fail closed on a mismatch.
- The prior audit found no code at the mainnet-listed Universal Router 2.1.2 address on Testnet. Another address equal to the mainnet-listed Universal Router had bytecode but no verified source/name. Current source/identity and route could not be rechecked because of the 403 responses. Neither is an approved Testnet router based on available evidence.
- A custom caller can interact directly with a v4 PoolManager through its `unlock` callback flow, but that is a direct PoolManager integration path, not evidence that an approved Testnet router exists. No OPTRA swap client is deployed or selected. An independently reviewed test-only client and settlement flow would be needed if no verified router is approved.
- The earlier explorer check found canonical mainnet WETH and USDG without Testnet code. It found source-verified **mock** USDG/AAPL/HOOD contracts; these are synthetic candidates, not owner-approved assets. No approved underlying/quote pair, liquidity, or stock-token/custom-hook eligibility decision exists.
- No deployer account, Testnet ETH balance, gas ceiling, provider credential, selected pool initializer, fee/tick spacing, initial price, or approved Testnet route was supplied. No private key was read. Gas estimation against Testnet and source verification have not been run.

Robinhood's [deployment guide](https://docs.robinhood.com/chain/deploy-smart-contracts/) specifies Testnet chain ID `46630`, the Testnet explorer verification endpoint, and recommends a throwaway test deployer key rather than a real key. The deployment script's verification command is:

```sh
forge verify-contract <HOOK_ADDRESS> src/OptraGuardHook.sol:OptraGuardHook \
  --chain 46630 \
  --verifier blockscout \
  --verifier-url https://explorer.testnet.chain.robinhood.com/api/ \
  --constructor-args <ABI_ENCODED_CONSTRUCTOR_ARGS> \
  --compiler-version v0.8.26 \
  --optimizer-runs 44444444 \
  --via-ir \
  --evm-version cancun
```

This command was prepared, not executed. Explorer verification publishes source metadata; run only after the specific Testnet deployment and source-publication approval.

The keyless preflight command is shown in [`contracts/README.md`](../contracts/README.md). A deployment gas simulation uses Foundry's default non-broadcast script mode (the command intentionally omits `--broadcast`):

```sh
OPTRA_TESTNET_DEPLOYMENT_APPROVED=true \
forge script script/OptraTestnetDeployment.s.sol:OptraTestnetDeployment \
  --rpc-url "$ROBINHOOD_TESTNET_RPC_URL" \
  --sender "$OPTRA_TESTNET_DEPLOYER_ADDRESS"
```

This simulation was not run: no pair, pool creator/initializer route, deployment account, or trusted RPC was available. The existing script requires its explicit approval flag even for simulation. Approving the source specification alone does not satisfy that gate; do not set it until the exact Testnet configuration and deployment simulation are authorized. A later broadcast still requires an additional, transaction-specific authorization and the `--broadcast` option.

### Testnet approval checkpoint

The following approvals are independent and must be recorded against one deployment manifest:

1. **Behavior/scope:** approve the experimental spot-only scope and acknowledge that an underlying-out swap is not a verified position reduction or options exit. Resolve whether this differs from the PM's requested halt/exit semantics before any user-facing claims.
2. **Assets and pool:** approve the exact eligible underlying and quote token addresses, pair ordering, fee, tick spacing, initial sqrt price, pool creator/initializer, permitted liquidity source, and the intended route. Confirm stock-token transfer restrictions permit this hook/pool.
3. **Policy/governance:** approve `maxPolicyAge`, policy source and publication procedure, keeper operator, immutable admin custody (prefer a reviewed multisig), rotation/revocation process, and failure response.
4. **Execution path:** approve a verified router address and end-to-end call route, or authorize a separately reviewed direct PoolManager test client. Define the maximum swap size, slippage checks, and exit test cases.
5. **Infrastructure and gas:** use a trusted Testnet RPC; re-read chain ID, manager runtime hash and token code. Name a Testnet-only deployer, verify its funding without exposing its key, set an explicit gas limit/cost ceiling, and record the predicted CREATE2 address, salt, init-code hash, constructor arguments, and bytecode hash.
6. **Testnet transaction authorization:** the owner must approve the exact chain ID `46630`, deployer, factory/hook transaction, arguments, address prediction, gas cap, and explorer source submission. Specification approval alone is not permission to set `OPTRA_TESTNET_DEPLOYMENT_APPROVED=true` or broadcast. Do not add `--broadcast` until this authorization is recorded.
7. **Mainnet gate:** separately require successful Testnet deployment and explorer verification, end-to-end route and fail-closed/exit tests, independent security review/audit, asset/legal approval, measured gas and risk caps, and a new explicit owner authorization naming the exact Mainnet transactions. Testnet approval does not authorize Mainnet.

## Exact next task

An owner/designated protocol operator must select and approve a Testnet asset pair and route, then provide access to a trusted Testnet RPC and a funded **Testnet-only** deployer identity. Run the read-only preflight first; if the PoolManager hash no longer matches, stop and re-review. Only after that, prepare a non-broadcast deployment simulation and a reviewed direct/router swap client. A separate explicit Testnet transaction approval remains required before broadcast.

## Evidence locations

- Contract: [`OptraGuardHook.sol`](../contracts/src/OptraGuardHook.sol)
- Foundry tests: [`OptraGuardHook.t.sol`](../contracts/test/OptraGuardHook.t.sol)
- Local execution: [`OptraLocalSimulation.s.sol`](../contracts/script/OptraLocalSimulation.s.sol)
- Testnet deployment guard: [`OptraTestnetDeployment.s.sol`](../contracts/script/OptraTestnetDeployment.s.sol)
- Read-only Testnet preflight: [`optra-testnet-preflight.sh`](../contracts/script/optra-testnet-preflight.sh)
- Fullstack workstream and unrelated files were not changed.

## Final phased Testnet status — 2026-11-16

This section supersedes the earlier Testnet RPC, script, gas, and readiness statements above. No Robinhood Testnet or Mainnet transaction was broadcast. The Testnet fixture was executed only on a local fork.

### Implementation

- `script/OptraTestnetDeployment.s.sol` is Phase A. It deploys two unrestricted-mint synthetic tokens (`mOPTRA`, `mUSDG`), a CREATE2 factory, test-only v4 liquidity and swap helpers, and the hook. It initializes the pool and ends paused with no published policy, minted supply, liquidity, or swaps. Hook permissions are checked against `0x2080`; PoolManager address and runtime hash are checked.
- Phase A is 7 independent transactions: five contract creations, CREATE2 hook deployment, and PoolManager initialization.
- Public Phase A broadcast requires `OPTRA_TESTNET_DEPLOYMENT_APPROVED=true` and exact equality between `tx.origin` and `OPTRA_TESTNET_DEPLOYER_ADDRESS`.
- The environment flag is only an operator-side execution guard. It does not authenticate owner consent; the operator must set it only after explicit approval of the exact transaction packet.
- `script/OptraTestnetAcceptance.s.sol` is Phase B. It has a separate `OPTRA_TESTNET_ACCEPTANCE_APPROVED=true` gate and the same deployer-address check. It refuses a pool with a published policy or a token fixture with nonzero supply.
- The Phase B environment flag is only an operator-side execution guard. It does not authenticate consent; Phase B needs its own explicit approval after Phase A readback.
- Phase B is 13 transactions: two mints, four approvals, liquidity addition, allow-policy publication, exact-input and exact-output buys, pause-policy publication, and exact-input and exact-output underlying-out swaps. The script simulates denied paused buys without sending transactions and verifies final policy and pool state.
- The policy freshness window is 300 seconds. If an acceptance run is interrupted after allow publication, underlying-in swaps fail after expiry. The keeper can immediately recover with `cast send <HOOK> "publishPolicy(bool)" true --rpc-url <RPC> --account <KEYSTORE_ACCOUNT>`.
- `script/optra-testnet-postflight.sh` performs read-only Phase A or Phase B checks for chain, PoolManager hash, code, roles, pair, pool ID, 300-second policy age, pause, and policy state.
- A repeated Phase B run after acceptance fails the pristine-fixture guard. Operators must inspect interrupted partial state rather than silently replaying mints, liquidity, or policy updates.

### Robinhood Testnet current-head checks

- Official RPC: `https://rpc.testnet.chain.robinhood.com`.
- Latest direct read during this run: chain ID **46630**, block **154060165**, gas price **10,000,000 wei** (`0.01 gwei`). The RPC responded to chain, block, gas-price, code, deployment-simulation, and fork-test requests. The earlier HTTP 403 did not recur; its cause remains unknown. The endpoint is public and rate-limited.
- PoolManager `0x8366a39cc670b4001a1121b8f6a443a643e40951`: **24,009 runtime bytes**, SHA-256 `6eb21c69298b064e37fcf8089a941ae096fe08c0f179b2d399567aef1b10585b`, matching the pinned value.
- An authenticated Alchemy key is not configured. It is not currently needed: the official endpoint served the current head and the required latest-head fork/simulation. Historical archive access is not a deployment prerequisite.
- The pool assets are synthetic test tokens and the v4 test helpers are direct PoolManager integration helpers. No Testnet router is approved. This pool has no relationship to real stock liquidity or options activity.

### Simulation evidence (LOCAL ONLY; no public receipts)

- Remote, non-broadcast Phase A dry run against the official Testnet RPC passed at chain ID `46630`: **7 predicted transactions**, **6,673,820 estimated gas**, max fee **0.020000001 gwei**, max-fee amount **0.00013347640667382 ETH**. The simulation sender was the publicly known Foundry Anvil example address `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`; it was not unlocked, used to sign, or broadcast. Every predicted address from that run is simulation-only.
- A separate Anvil fork at `127.0.0.1:18548`, forked from Testnet head block `154056529`, auto-impersonated local address `0x1111111111111111111111111111111111111111`. Phase A produced **7/7 successful local receipts**; Phase B produced **13/13 successful local receipts**. No transaction left the local Anvil process.
- That ephemeral local fixture used hook `0x196E3A8c0DEf5494E38c4916e82f23ec22CfA080`, pool ID `0x0c4c399744587f2195da2195207190419e90982dc17ec301494f925abe919e44`, underlying `0x7b0083Cf738E20907a6cE5B1e4d02B2B448B479b`, quote `0xE799B2d7166a22C423C4a26f64dC42cEea2Ed248`. These addresses exist only in the local fork state.
- Local Foundry transaction-gas totals were **6,836,129** for Phase A and **2,347,059** for Phase B. Measured local receipt gas was **6,565,798** and **1,221,402**, respectively. Receipt statuses were successful. The 20 Phase A/B transactions remain independent and non-atomic.
- Local acceptance logs verified buys in both amount modes, denied buys in both modes after pausing, allowed underlying-out swaps in both modes, and final pause/policy/pool readback. `test_interruptedAcceptanceExpiresAndEmergencyPauseIsImmediate` separately verified 301-second expiry and immediate pause behavior.
- On the same local hook, `cast send publishPolicy(false)` then `cast send publishPolicy(true)` each succeeded and emitted `PolicyPublished`. Local-only transaction hashes: `0xa5abe7a9756956ba406f8e6746a1fb57e0e0eea955025fa013469818f9d14538` and `0x1122b083ab8ecf4537cdd75ef449a4b990cd38970fe0ce584295d2eb1841f4bb`. Independent getters returned `entryPaused=true`, `policyPublished=true`, `isPolicyFresh=true`.
- Broadcast guards were exercised against a local chain. Phase A without approval reverted before broadcast; a mismatched signer reverted; Phase B without its separate approval reverted; replaying Phase B after acceptance reverted at the pristine-state check. No public transaction was produced by these checks.
- Local Foundry records are in `contracts/broadcast/OptraTestnetDeployment.s.sol/46630/run-latest.json` and `contracts/broadcast/OptraTestnetAcceptance.s.sol/46630/run-latest.json`. They contain local-only data and are not explorer receipts.

### Gas planning

| Phase | Transactions | Foundry estimate | Measured local receipt gas |
|---|---:|---:|---:|
| A — safe deployment | 7 | 6,836,129 gas on local fork; remote non-broadcast estimate 6,673,820 | 6,565,798 |
| B — separately approved acceptance | 13 | 2,347,059 gas on local fork | 1,221,402 |
| A + B | 20 | 9,183,188 gas | 7,787,200 |
| A + B with 20% headroom | — | 11,019,826 gas | — |

At a max-fee cap of `0.020000001 gwei` observed in the remote Phase A simulation, the combined 20%-buffer budget is **0.000220396531019826 ETH**. This is a planning estimate only, not an approved spend ceiling. Phase A alone with the same 20% buffer is about **8,203,355 gas / 0.000164067108203355 ETH**; recompute from the actual signer-specific dry run before approval. Phase B remains optional and separately approved.

CREATE2 search iterations and all predicted addresses depend on the actual deployer. Re-run the exact dry run and gas estimate with the chosen account before preparing an owner transaction packet. Do not use the Anvil example or the local impersonation address for public transactions.

### Final verification

- `forge fmt --check`: passed.
- `forge build` (Solc 0.8.26): passed.
- `forge lint`: passed with no findings.
- `bash -n script/optra-testnet-preflight.sh script/optra-testnet-postflight.sh`: passed.
- `forge test --fuzz-runs 1000 -vv`: **26 passed, 0 failed, 2 fork-only suites skipped** in the non-fork run. Freshness fuzz: **1,000 runs**. Invariant: **128,000 calls, 0 reverts**.
- `forge test --match-path test/OptraTestnetPhases.t.sol --fork-url https://rpc.testnet.chain.robinhood.com -vv`: **3 passed, 0 failed, 0 skipped** at current Testnet head.
- Both deployment phases completed on the isolated local fork; Phase A postflight verified paused/no policy, and Phase B postflight verified paused/published/fresh policy.

### Security review of deployment orchestration

Review scope: `OptraTestnetDeployment.s.sol`, `OptraTestnetAcceptance.s.sol`, `OptraTestnetPhases.t.sol`, the postflight script, and the contract boundary relevant to these scripts. The new orchestration sources are untracked in this worktree, so there is no Git blame baseline for them; no existing hook access control or validation was removed. Blast radius is limited to explicitly invoked Foundry deployment/acceptance scripts and the synthetic Testnet fixture.

| Finding | Severity | Evidence and containment |
|---|---|---|
| Owner approval is not cryptographically authenticated by the scripts. | Medium operational risk | Environment booleans can be set by the operator. They are accidental-run guards only. Require an external, recorded owner approval for the exact Phase A packet and a separate Phase B packet before setting each flag. |
| A broadcast can stop between independent transactions. | Medium operational risk | Phase A remains paused and policy-free if interrupted before or after initialization. Phase B before allow remains paused; after allow, the 300-second age makes underlying-in swaps stale and fail-closed. The keeper pause command provides immediate recovery. Inspect partial state; the script refuses replay after minting or policy publication. |
| Test tokens are public-mint and test helpers expose direct PoolManager interactions. | High if substituted with real assets; bounded for this test | They are synthetic-only (`mOPTRA`/`mUSDG`) and must not be replaced with real market assets. Public activity may perturb this mock pool during the short acceptance interval; it carries no market or options semantics. |
| Phase B script authorization checks and recovery are partly operator workflow. | Coverage limitation | Happy paths, expiry, and direct pause are covered by current-head fork tests and local fork broadcasts. The public-broadcast approval and signer mismatch gates were manually exercised against local Anvil; they are not permanent unit tests of Foundry script context. |

Recommendation: **CONDITIONAL / NO-GO for public broadcast until the operator provides a dedicated funded Testnet-only keystore address and an owner-approved, signer-specific packet.** No concrete exploitable hook defect was found in this phase-orchestration review. This is not an independent security audit and does not make the experimental hook suitable for Mainnet.

### Readiness and single operator action

- **Testnet public transactions: BLOCKED.** No public deployer identity was designated, no OPTRA-specific funded Testnet account was selected, and its balance could not be checked. Other keystore identities were not read or used. The current RPC and contract code checks are working.
- **Explicit deployment approval: not ready to request.** The exact deployer, funded balance, signer-derived addresses, and owner-specific gas packet are still missing. Phase B also requires a later separate acceptance approval.
- **Next operator action at that time:** create/import and fund a dedicated Testnet-only account. This was completed by the owner as `optra-testnet-deployer`, address `0x27f35B08C44C59f516B6bDC66cc4884b540aBBd9`; the current blocker is working RPC access and the resulting live balance/nonce checks, as documented in the owner deployer continuation below. Do not send a private key or password.
- **Mainnet: NOT READY.** No Mainnet transactions were sent. Keep compatibility checks read-only. A future Mainnet deployment requires successful Testnet acceptance, independent security review, verified assets and pool, gas assessment, and separate explicit authorization.
- The hook is an experimental spot token-flow gate. It does not execute options, settle Protective Puts, identify an options order, or prove that an underlying-out swap closes a position.

## Owner Testnet deployer continuation — 2026-11-16

### Current access status

- The supplied public address is `0x27f35B08C44C59f516B6bDC66cc4884b540aBBd9`; the `optra-testnet-deployer` encrypted keystore file exists locally. Its permissions were tightened from mode `0644` to owner-only `0600`. It was not unlocked, exported, or used to sign.
- The encrypted file has no plaintext address field, so the keystore-to-address mapping was not independently verified without its local password. Do not send the password. The owner can verify locally with `cast wallet address --account optra-testnet-deployer` and compare it with the supplied address.
- Both `cast chain-id --rpc-url https://rpc.testnet.chain.robinhood.com` and the corrected `cast balance 0x27f35B08C44C59f516B6bDC66cc4884b540aBBd9 --rpc-url https://rpc.testnet.chain.robinhood.com --ether` failed with `Connection reset by peer (os error 54)`. No balance, EOA nonce, live Manager code, or current Testnet fee could be verified. No RPC or Alchemy credentials are configured in the current environment.
- Robinhood documents Alchemy Testnet RPC as `https://robinhood-testnet.g.alchemy.com/v2/{API_KEY}` and chain ID `46630`; Alchemy lists the same endpoint. The [`README`](../contracts/README.md) now supports it via the local `ROBINHOOD_TESTNET_RPC_URL` variable. The key must remain local and out of project files/logs. Sources: [Robinhood connection guide](https://docs.robinhood.com/chain/connecting/) and [Alchemy Robinhood Testnet RPC](https://www.alchemy.com/rpc/robinhood-testnet).

### Offline Phase A prediction (conditional on EOA nonce 0)

The following predictions use the owner-supplied public address, current compiled artifacts, the existing Phase A script configuration, and assume the EOA transaction count is zero. The nonce assumption and PoolManager state must be checked once RPC access returns; these are **not deployed addresses**.

| Nonce / step | Predicted address | Contract/action |
|---:|---|---|
| 0 | `0xf8D90b285C9a110445CBab1C2Ee84628c2d811AB` | Synthetic underlying `mOPTRA` |
| 1 | `0x844D1685805f7beb6a06B4d9b9BA3cB283B762aA` | Synthetic quote `mUSDG` |
| 2 | `0xBBBE0b3f3a13D99EB15fff8eECa01501193746D5` | CREATE2 factory |
| 3 | `0x7357A13fF3fBF718F08aFB6b29C85c8a0D4C4B31` | Test-only `PoolModifyLiquidityTest` helper |
| 4 | `0xBef92101Ec6beAF6CC97d789eD11933d9069F821` | Test-only `PoolSwapTest` helper |
| 5 | `0x29d07447A4fB70A9705A36a9dD7F6EC1cE9F6080` | Hook via factory CREATE2; salt `0x3032`, init-code hash `0x74838b5c8fb1a1f4d7eb5160f9fb51fb066440289a8629dc67108e03a4ca5816`, low permission bits `0x2080` |
| 6 | `0x8366a39cc670b4001a1121b8f6a443a643e40951` | PoolManager `initialize` call |

Pool ID computed offline: `0xa3707a2ed8eaeb0c68200f5616a8a6650dca837b267d811f73e730273cb0522b`. The proposed fixture sorts `mUSDG` before `mOPTRA`, uses fee `3000`, tick spacing `60`, raw 1:1 initial price (`sqrtPriceX96 = 2^96`), deployer as pool creator/admin/keeper, and `maxPolicyAge=300`. Phase A still contains exactly seven transactions: five creates, factory hook deployment, then pool initialization. The hook constructor initializes paused; Phase A does not mint, add liquidity, publish a policy, or swap.

With nonce zero, the seven EOA transactions are: nonce 0 create underlying; 1 create quote; 2 create CREATE2 factory; 3 create liquidity helper; 4 create swap helper; 5 call `factory.deploy(salt, initCode)` to create the hook; 6 call `PoolManager.initialize(poolKey, 2^96)`. The hook address is the CREATE2 result; transaction 5 is sent to the factory. Phase A has no justified transaction-count change.

The CREATE2 salt search and predicted addresses were computed locally from the script algorithm and compiled hook bytecode. The Phase A script must still be run against a working RPC with the actual signer address to verify nonce zero, chain ID `46630`, current PoolManager runtime hash, and all predictions before approval.

### Gas and authorization status

- No exact signer-specific RPC dry run was possible. The previous remote Phase A estimate was `6,673,820` gas using a different simulation sender; the previous conservative local estimate was `6,836,129` gas. With 20% headroom, the planning range is approximately **8,008,584–8,203,355 gas**. At the previous `0.020000001 gwei` max-fee assumption, that is **0.000160171688008584–0.000164067108203355 ETH**. This is provisional, not the packet spend ceiling; current Testnet fees and the owner address dry run remain outstanding.
- **Phase A approval is not requested yet.** The public RPC reset prevented balance, nonce, live runtime, and signer-specific gas verification. No public transaction has been sent. No Phase B work or approval has started.
- Exact operator action: configure a working Testnet RPC locally (Alchemy is supported), ensure the address has Testnet ETH for the freshly quoted gas cap, then provide the public balance/nonce/chain read results without sharing API credentials. After that, run `cast wallet address --account optra-testnet-deployer` locally and compare it with `0x27f35B08C44C59f516B6bDC66cc4884b540aBBd9` without sharing the password, rerun the existing Phase A dry run with `--sender 0x27f35B08C44C59f516B6bDC66cc4884b540aBBd9`, and present the verified seven-transaction packet for explicit approval.
- Mainnet remains read-only. Testnet acceptance, independent review, and a separate Mainnet authorization are still required before any Mainnet transaction.

### Signer-specific Phase A verification and approval packet (2026-11-16)

This section supersedes the preceding provisional RPC, balance, nonce, prediction, and gas-readiness statements. It records fresh read-only checks through the owner-configured authenticated Alchemy Robinhood Testnet endpoint and a new non-broadcast Foundry dry run. The RPC URL and credential were kept out of output and this report.

#### Live checks and simulation

- `cast chain-id`: `46630`.
- `cast block-number`: `154118853` at the live-state check.
- `cast balance 0x27f35B08C44C59f516B6bDC66cc4884b540aBBd9 --rpc-url <owner-configured Alchemy Testnet RPC> --ether`: `0.010000000000000000 ETH`.
- `cast nonce 0x27f35B08C44C59f516B6bDC66cc4884b540aBBd9`: `0`.
- PoolManager `0x8366a39cc670b4001a1121b8f6a443a643e40951`: runtime bytecode present, 24,009 bytes, SHA-256 `6eb21c69298b064e37fcf8089a941ae096fe08c0f179b2d399567aef1b10585b`, matching the deployment script's pin.
- Re-ran `forge script script/OptraTestnetDeployment.s.sol:OptraTestnetDeployment --rpc-url <owner-configured Alchemy Testnet RPC> --sender 0x27f35B08C44C59f516B6bDC66cc4884b540aBBd9 -vv` from `contracts/`. Exit `0`, `Script ran successfully`, chain ID `46630`, `SIMULATION COMPLETE`. The command omitted `--broadcast` and `--account`; it signed nothing and sent no transaction.
- The refreshed dry-run record is `contracts/broadcast/OptraTestnetDeployment.s.sol/46630/dry-run/run-latest.json` (local Foundry output, not public receipts). It contains exactly seven transactions from the deployer at nonces `0` through `6`; all seven match the fresh account nonce and expected sequence. Their recorded gas values sum to the reported `6,673,868` total.
- The encrypted keystore remains `optra-testnet-deployer`; the owner previously verified that its public address matches the address above. It was not unlocked or used to sign during this dry run.

#### Exact Phase A transaction packet for approval

Network: Robinhood Chain Testnet, chain ID `46630`. Signer: `optra-testnet-deployer`, `0x27f35B08C44C59f516B6bDC66cc4884b540aBBd9`. Starting nonce: `0`.

| Nonce | Transaction and predicted result | Destination / predicted address | Dry-run gas |
|---:|---|---|---:|
| 0 | Create 18-decimal synthetic `OPTRA TEST ASSET` / `mOPTRA` token | EOA CREATE → `0xf8D90b285C9a110445CBab1C2Ee84628c2d811AB` | 1,191,768 |
| 1 | Create 18-decimal synthetic `OPTRA TEST QUOTE` / `mUSDG` token | EOA CREATE → `0x844D1685805f7beb6a06B4d9B9BA3cB283B762aA` | 1,191,751 |
| 2 | Create `OptraTestnetCreate2Factory` | EOA CREATE → `0xBBBE0b3f3a13D99EB15fff8eECa01501193746D5` | 193,064 |
| 3 | Create test-only `PoolModifyLiquidityTest` bound to PoolManager | EOA CREATE → `0x7357A13fF3fBF718F08aFB6b29C85c8a0D4C4B31` | 1,778,284 |
| 4 | Create test-only `PoolSwapTest` bound to PoolManager | EOA CREATE → `0xBef92101Ec6beAF6CC97d789eD11933d9069F821` | 2,025,849 |
| 5 | Call `deploy(bytes32,bytes)` on the CREATE2 factory to deploy the hook | Factory `0xBBBE0b3f3a13D99EB15fff8eECa01501193746D5`; hook → `0x29d07447A4fB70A9705A36a9dD7F6EC1cE9F6080` | 175,476 |
| 6 | Call `PoolManager.initialize(poolKey, 2^96)` for the synthetic pool | PoolManager `0x8366a39cc670b4001a1121b8f6a443a643e40951`; pool ID → `0xa3707a2ed8eaeb0c68200f5616a8a6650dca837b267d811f73e730273cb0522b` | 117,676 |

Hook CREATE2 parameters: factory `0xBBBE0b3f3a13D99EB15fff8eECa01501193746D5`, salt `0x0000000000000000000000000000000000000000000000000000000000003032`, init-code hash `0x74838b5c8fb1a1f4d7eb5160f9fb51fb066440289a8629dc67108e03a4ca5816`. The hook constructor binds the PoolManager and the two predicted mock tokens; pool creator, admin, and keeper are the deployer; `maxPolicyAge=300` seconds. The pool uses fee `3000`, tick spacing `60`, and initial `sqrtPriceX96=79228162514264337593543950336` (`2^96`). Its token order is `mUSDG` then `mOPTRA`.

#### Gas budget and assertions

- Dry-run estimate: `6,673,868` gas at max fee `0.020000001 gwei` (base fee `0.01 gwei`, priority fee `0.000000001 gwei`); estimated amount `0.000133477366673868 ETH`.
- Approval spending ceiling with 20% gas headroom: `8,008,642` gas / `0.000160172848008642 ETH` at the observed max fee. This is a planning ceiling, not an aggregate onchain enforcement. Current balance exceeds it by `0.009839827151991358 ETH` (about `62.43x`). Recheck balance and fees immediately before broadcast because both can change.
- Script simulation assertions passed: PoolManager runtime pin; CREATE2 prediction and hook address; low permission bits `0x2080`; exact permission structure (`beforeInitialize` and `beforeSwap` only); valid hook address; initialized/bound pool ID; deployer as creator/admin/keeper; `maxPolicyAge=300`; 18-decimal fixture tokens; `entryPaused=true`; `policyPublished=false`.
- Source-level emergency controls: only the keeper can call `publishPolicy`; the designated keeper can immediately set pause true. The immutable admin can call `revokeKeeper`, which clears policy publication and timestamp and forces paused state. These controls were not exercised on a deployed public contract; Phase A remains policy-free and paused. Existing Foundry coverage is the local evidence for their behavior.
- Phase A does not mint tokens, add liquidity, publish an allow policy, or swap. These are unrestricted-mint synthetic assets and a synthetic spot pool, not real market liquidity, an options venue, options execution, or Protective Put settlement.

#### Independent post-deployment readback

After approval and broadcast, use the owner-configured RPC locally and run `script/optra-testnet-postflight.sh <RPC> phase-a 0x29d07447A4fB70A9705A36a9dD7F6EC1cE9F6080 0xf8D90b285C9a110445CBab1C2Ee84628c2d811AB 0x844D1685805f7beb6a06B4d9B9BA3cB283B762aA 0xa3707a2ed8eaeb0c68200f5616a8a6650dca837b267d811f73e730273cb0522b 0x27f35B08C44C59f516B6bDC66cc4884b540aBBd9`. Then read each deployed address with `cast code`, verify transaction receipts and the PoolManager initialization event, and independently call `poolBound`, `configuredPoolId`, `poolCreator`, `admin`, `keeper`, `maxPolicyAge`, `entryPaused`, `policyPublished`, and `isPolicyFresh`. Expected final state is bound, paused, no published policy, and not fresh. Obtain explorer links only from verified public transaction hashes.

**Approval state as of 2026-11-16: awaiting owner approval for that seven-transaction Testnet Phase A packet only. No public transaction had been broadcast; no public addresses, transaction hashes, receipts, or explorer verification existed. Phase B required a separate packet and approval. Mainnet was read-only. This packet was invalidated by the 2026-11-20 source change; see the superseding packet-staleness notice below.**

## Superseding packet-staleness notice — 2026-11-20

The hook source changed after this packet was generated: constructor validation and the maximum policy-age constant alter its creation bytecode. Therefore the 2026-11-16 packet's hook init-code hash, CREATE2 salt/address, dependent pool ID, constructor calldata, and gas figures are stale and must not be approved or reused. No Testnet or Mainnet transaction was broadcast from that packet. If Testnet deployment is later authorized, regenerate and independently review the exact packet from current source and a fresh signer-specific dry run.
