# OPTRA onchain implementation report — 2026-11-16

## Status

Implemented and tested an **experimental, local-only** `OptraGuardHook` against Uniswap v4-core v4.0.0. It gates risk-increasing swaps in one new, creator-controlled v4 spot pool. It is not an options venue, options order guard, options execution system, or production deployment.

No OPTRA contract was deployed to Robinhood Testnet or Mainnet. No public transaction was broadcast. A local Anvil simulation used chain ID `31337`; its ephemeral addresses below are local evidence only.

This dated report supersedes the no-contract inventory in the 2026-11-15 [contract deployment plan](contract-deployment-plan.md). The shared plan, UI/fullstack tracker, and other active workstream files were left untouched.

## Scope and behavior

`GuardRegistry` was not added. One hook owns one small pause policy and binds to one pool; a separate state contract would add a call and role surface without a second consumer.

The hook's bounded rules are:

- Constructor fixes the PoolManager, nonzero ERC-20 underlying and quote tokens, pool initializer, immutable admin and maximum policy age. One hook instance can bind only the first matching pair initialized by that initializer. It stores the complete pool ID, so another fee/tick-spacing key cannot reuse the instance afterward. The trusted initializer chooses the pool fee and tick spacing; the hook does not prescribe production values.
- Permissions are exactly `beforeInitialize` and `beforeSwap`: low address bits `0x2080` (`1 << 13` plus `1 << 7`). The constructor calls v4 `Hooks.validateHookPermissions`; deployment uses CREATE2 salt mining and rechecks the result.
- `beforeInitialize` only accepts the configured initializer and pair. On v4, its `sender` is the initial caller of `PoolManager.initialize`; if a router initializes the pool, configure that router as `poolCreator`.
- Only the configured keeper can publish one boolean, `entryPaused`. The hook timestamps it with `block.timestamp`; callers cannot supply or backdate a timestamp. Only the immutable admin can rotate or revoke the keeper. Rotation/revocation clears prior policy and leaves the hook fail-closed for buys.
- Missing, future-dated, stale, or paused policy blocks swaps that buy the configured underlying. A fresh, unpaused policy allows that direction. The maximum age is immutable and must be explicitly selected at deployment. Local tests use one day only as a fixture.
- Swaps that send the underlying out of the pool are always allowed, including with missing, stale, or paused policy. This is a token-direction rule only; it does not show that an options position is being reduced or closed. Liquidity removal is also not gated because the hook has no removal permission.
- `hookData` is ignored. The hook does not read an oracle, market data, policy proof, wallet, position, or options order. Other callback methods revert if directly invoked, and their permission bits are unset.

**Trust model and unresolved decisions:** the keeper is trusted to publish the correct pause bit; compromised keeper authority can allow risk-increasing spot swaps while policy is fresh. The immutable admin can revoke it, which blocks buys, but cannot itself transfer admin authority. Production must select a controlled admin (for example a reviewed multisig), keeper operations and recovery, maximum policy age, asset pair, quote, pool fee/tick spacing, initializer route, and whether underlying-out swaps and LP withdrawals should remain open during a pause. None of those production choices is implied by the local fixture. A validator can influence `block.timestamp` within chain rules; the age limit bounds the freshness window but is not an independent clock.

The PM brief keeps options execution with offchain venue adapters. This hook only guards swaps through its own v4 spot pool. It cannot govern CallPut, Zeno, third-party pools, wallet approvals, or any other options venue.

## Source and build configuration

- [`contracts/src/OptraGuardHook.sol`](../contracts/src/OptraGuardHook.sol)
- [`contracts/test/OptraGuardHook.t.sol`](../contracts/test/OptraGuardHook.t.sol)
- [`contracts/script/OptraLocalSimulation.s.sol`](../contracts/script/OptraLocalSimulation.s.sol)
- [`contracts/script/OptraTestnetDeployment.s.sol`](../contracts/script/OptraTestnetDeployment.s.sol) — prepared, approval-gated, not executed against Testnet
- [`contracts/foundry.toml`](../contracts/foundry.toml), [`contracts/dependencies.lock`](../contracts/dependencies.lock)

Pinned build inputs: Solidity `0.8.26`, optimizer enabled with `44,444,444` runs, `via_ir=true`, Cancun EVM, metadata bytecode hash disabled; Uniswap v4-core `v4.0.0` commit `e50237c43811bd9b526eff40f26772152a42daba`; forge-std `v1.17.0` commit `f3dae6e6ee381f25eb6a246f7da9b85c91a68219`. Transitive v4-core source is vendored. Review dependency licenses before production distribution.

### Dependency tracking update — 2026-11-17

For the local source checkpoint, the vendored `lib/v4-core` and `lib/forge-std` directories were converted to recursive Git submodules pinned at the commits above. The preserved local directory contents matched the pinned checkouts with no file differences. The v4-core nested submodule graph pins its transitive forge-std, OpenZeppelin, Solmate, and ds-test revisions. From the OPTRA repository root, run `git submodule update --init --recursive`. After conversion, `forge build` succeeded and the local test run passed 26 tests with one Testnet-fork-only suite skipped. No remote deployment or transaction was performed.

The pinned core's [`Hooks.sol`](https://github.com/Uniswap/v4-core/blob/e50237c43811bd9b526eff40f26772152a42daba/src/libraries/Hooks.sol), [`IHooks.sol`](https://github.com/Uniswap/v4-core/blob/e50237c43811bd9b526eff40f26772152a42daba/src/interfaces/IHooks.sol), and [`PoolManager.sol`](https://github.com/Uniswap/v4-core/blob/e50237c43811bd9b526eff40f26772152a42daba/src/PoolManager.sol) were used as the implementation authority. The code confirms that the hook's low 14 address bits determine callbacks, permissions are validated against those bits, `PoolManager.initialize` checks the hook address then calls `beforeInitialize`, and swap processing calls `beforeSwap` before executing the pool swap. Official [Uniswap hook documentation](https://developers.uniswap.org/docs/protocols/v4/concepts/hooks) confirms a hook is selected in the `PoolKey` at pool initialization and cannot be added to an existing pool. Official [swap-hook documentation](https://developers.uniswap.org/docs/protocols/v4/guides/hooks/swap-hooks) describes `sender` as the initial manager caller (often a router) and `hookData` as arbitrary swapper-supplied bytes. The [hook deployment guide](https://developers.uniswap.org/docs/protocols/v4/guides/hooks/hook-deployment) confirms CREATE2 permission-bit mining.

## Verification evidence

Commands run from `contracts/`:

| Command | Result |
|---|---|
| `forge fmt --check` | Passed |
| `forge build` | Passed with Solidity 0.8.26; a clean build compiled 76 files |
| `forge lint` | Passed; no findings |
| `forge test -vv` | **18 passed, 0 failed, 0 skipped** |
| `forge test --match-test testFuzz_policyFreshness --fuzz-runs 1000 -vv` | **1 fuzz test passed, 1,000 runs** |

Coverage includes permission flags and valid hook address; real `PoolManager.initialize` callback binding; unauthorized/wrong-pair/second-pool initialization; invalid constructor config; manager-only callbacks; unauthorized keeper/admin operations; keeper rotation/revocation; missing, stale, future-dated, and exact-age-boundary state; arbitrary/malformed `hookData`; accepted and rejected swaps through the v4 `PoolSwapTest` router; policy pause/unpause changes; underlying-out swaps while missing/paused/stale; and liquidity removal while paused.

### Local Anvil simulation

The isolated run used `anvil --chain-id 31337 --host 127.0.0.1 --port 18545 --silent`, without touching SENTERA's port `3000`. Command:

```sh
forge script script/OptraLocalSimulation.s.sol:OptraLocalSimulation \
  --rpc-url http://127.0.0.1:18545 --broadcast -vv
```

The script has a hard chain-ID guard, mined a valid CREATE2 address, deployed a local PoolManager and test tokens, initialized and seeded one pool, performed an allowed buy, then paused the policy. It completed successfully and estimated **16,666,168 gas** for its local broadcast bundle. All **18 local Anvil transaction receipts returned status `0x1`**. Readback returned `poolBound=true`, `entryPaused=true`, `isPolicyFresh=true`, and pool ID `0xe6d4ddf73e284a2299255cd1620c521112895c7c92287358aefd40590dd34989`.

Ephemeral local-only addresses: PoolManager `0x5FbDB2315678afecb367f032d93F642f64180aa3`, temporary CREATE2 factory `0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9`, hook `0x96C0765DC3AFb2683883612c9f824cf06AB5E080`. Successful local transaction hashes include initialize `0xf0e1a908fa358e6f1a3e216d33e8f2178b51fd6352a34f9e26e34181b726bcd9`, liquidity seed `0x9254b6fd9392be99f9e228b5a347911b9328045110f26496acc0a9fa53bfa673`, allowed buy `0x5377885893d889ef8fa1bb7795184d595786a600348e3509dc3a04f06ec37869`, and pause update `0x68bd94e37598402d113e46f3465067585a486d8d1c15602d9725e765aff1aeda`.

After `vm.stopBroadcast`, the script locally simulated a paused buy and an underlying-out swap; those two calls have **no transaction receipts**. The blocked route is also exercised in passing Foundry integration tests. This is local deployment/simulation evidence only, not a Robinhood deployment or explorer verification. The Foundry script runner emits a stale virtual `foundry-pp/DeployHelper83.sol` artifact warning; it does not prevent the successful script execution.

Chain-safety negative checks also behaved as intended: the Anvil-only script reverted with `local Anvil chain ID 31337 required` on a local `31338` node; the Testnet deployment script reverted with `Robinhood Testnet chain ID 46630 required` on a local `31337` node before reading secrets or starting broadcast. No transactions were sent by either negative check.

## Robinhood Testnet read-only readiness — 2026-11-16

Normal TLS-verified reads to Robinhood's documented public Testnet RPC returned chain ID `46630` and block `154000067`. The [Robinhood connection documentation](https://docs.robinhood.com/chain/connecting/) lists Testnet chain ID `46630`, identifies the public RPC as rate-limited, and recommends a provider for production.

PoolManager `0x8366a39cc670b4001a1121b8f6a443a643e40951` has nonempty Testnet bytecode. The read-only [Blockscout contract API](https://explorer.testnet.chain.robinhood.com/api/v2/smart-contracts/0x8366a39cc670b4001a1121b8f6a443a643e40951) reports `is_verified=true`, `is_fully_verified=false`, source `src/PoolManager.sol`, and compiler `v0.8.26+commit.8a97fa7a` with `44,444,444` optimizer runs. The SHA-256 of the RPC bytecode and explorer `deployed_bytecode` matched exactly: `dc9622b1fc330db4b042937696cb18f2fd04f9044f19cca3a74a0ea47bf3352f`. This verifies a source-matched PoolManager deployment; it does not establish a verified OPTRA contract or a supported end-to-end route.

Routing checks do not establish a verified testnet swap path. The official [Uniswap deployment list](https://developers.uniswap.org/docs/protocols/v4/deployments) lists Robinhood Chain mainnet contracts but has no Robinhood Testnet deployment section. On Testnet, the mainnet-listed Universal Router 2.1.2 address `0x204FAca1764B154221e35c0d20aBb3c525710498` has no code. The Universal Router address `0x8876789976decbfcbbbe364623c63652db8c0904` has code (49,094 hex characters); its [Blockscout record](https://explorer.testnet.chain.robinhood.com/api/v2/smart-contracts/0x8876789976decbfcbbbe364623c63652db8c0904) reports a successful creation record but returns no verified name/source fields. PositionManager `0x58daec3116aae6d93017baaea7749052e8a04fa7` has code and a [source record](https://explorer.testnet.chain.robinhood.com/api/v2/smart-contracts/0x58daec3116aae6d93017baaea7749052e8a04fa7) (`is_verified=true`, `is_fully_verified=false`), but it is not evidence of a verified swap router path.

Canonical mainnet WETH `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` and USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` (addresses in Robinhood's [token contract documentation](https://docs.robinhood.com/chain/contracts/)) have no code on Testnet. Explorer records do show fully source-verified **mock** test contracts: [Mock USDG](https://explorer.testnet.chain.robinhood.com/api/v2/smart-contracts/0x8F9231B0F448bA9AD045348437458721676c23BC) `0x8F9231B0F448bA9AD045348437458721676c23BC`, [Mock AAPL](https://explorer.testnet.chain.robinhood.com/api/v2/smart-contracts/0x49a6d7470694FB1D9621cA4A5215704588A8A7BB) `0x49a6d7470694FB1D9621cA4A5215704588A8A7BB`, and [Mock HOOD](https://explorer.testnet.chain.robinhood.com/api/v2/smart-contracts/0xD2011A3b80F5297Ca2C4a1b4569D240a0140dCC4) `0xD2011A3b80F5297Ca2C4a1b4569D240a0140dCC4` (Solidity 0.8.28). These are candidate synthetic test assets only; they are not represented as canonical Robinhood assets or selected for an OPTRA pool. Robinhood's [Stock Token documentation](https://docs.robinhood.com/chain/stock-tokens/) describes product tokens, but asset eligibility, exact pair, trading route, liquidity, and restrictions still need approval.

[`OptraTestnetDeployment.s.sol`](../contracts/script/OptraTestnetDeployment.s.sol) is compiled but was not run on Testnet. It hard-checks chain ID `46630`, requires deployed Manager/token code, explicit constructor/role inputs, and `OPTRA_TESTNET_DEPLOYMENT_APPROVED=true`, mines CREATE2 bits, prints the predicted deployment values, estimates gas when dry-run, and prints a Blockscout verification command. No Testnet gas estimate or verification was performed because the initializer route, asset pair, admin/keeper policy, and max policy age are not approved. No public deployment occurred.

## Next smallest executable task

Resolve the production configuration decisions and prove a verified Testnet initializer/swap route with an explicitly selected test pair. Then perform a non-broadcast Testnet `forge script --gas-estimate` run using a trusted provider and review the exact mined address, constructor arguments, and verification command. A separate explicit authorization is still required before any Testnet broadcast; Mainnet needs a later, independent decision.

## References

- [Robinhood network / RPC configuration](https://docs.robinhood.com/chain/connecting/)
- [Robinhood smart contract deployment and verification endpoint](https://docs.robinhood.com/chain/deploy-smart-contracts/)
- [Robinhood stock tokens](https://docs.robinhood.com/chain/stock-tokens/)
- [Uniswap v4 deployment list](https://developers.uniswap.org/docs/protocols/v4/deployments)
- [Uniswap v4 hooks](https://developers.uniswap.org/docs/protocols/v4/concepts/hooks)
- [Uniswap v4 swap hooks](https://developers.uniswap.org/docs/protocols/v4/guides/hooks/swap-hooks)
- [Uniswap hook deployment](https://developers.uniswap.org/docs/protocols/v4/guides/hooks/hook-deployment)
