# OPTRA experimental Uniswap v4 guard

This Foundry workspace is an experimental proof of concept for one new OPTRA-controlled Uniswap v4 spot pool. It is not production-ready, an options venue, an options execution system, or a Protective Put settlement contract. The hook can gate swaps in the direction that buys one configured ERC-20 underlying. It cannot identify options activity, inspect positions, or prove that an underlying-out swap reduces risk.

## Scope and contract behavior

- Hook permissions: `beforeInitialize` and `beforeSwap` only (`0x2080`).
- The hook binds once to a pool created from its configured token pair. PoolManager calls are checked by the hook.
- New deployments start paused without a published policy. Missing, future-dated, stale, or paused policy blocks underlying-in swaps.
- Underlying-out swaps remain permitted even when policy is missing, stale, or paused. This is token-flow direction only; it is not position closure or an options exit.
- Liquidity changes are not gated by the hook.
- Policy freshness for the Testnet fixture is 300 seconds.

## Phase A: safe deployment

`script/OptraTestnetDeployment.s.sol` deploys two open-mint synthetic tokens (`mOPTRA`, `mUSDG`), a CREATE2 helper, test-only v4 liquidity and swap helpers, and the permission-mined hook. It initializes a 3000-fee / 60-tick-spacing pool at raw 1:1 price (`sqrtPriceX96 = 2^96`).

Phase A is exactly **7 transactions**: five contract creations, hook deployment through the CREATE2 helper, and PoolManager initialization. It performs no token mint, approval, liquidity deposit, policy publication, or swap. Readback requires the pool bound, correct roles and permission bits, 300-second policy age, paused entry, and no published policy. The fixture has no token supply or liquidity.

Broadcast requires both `OPTRA_TESTNET_DEPLOYMENT_APPROVED=true` and `OPTRA_TESTNET_DEPLOYER_ADDRESS` matching the actual Foundry signer. For a real Testnet broadcast, use a dedicated Testnet-only account from the local encrypted Foundry keystore with `--account` and `--sender`. Do not use `--unlocked`, a raw key environment variable, or the published Anvil test key for public transactions.

The environment flag is only a local execution guard; it does not authenticate owner consent. Set it only after explicit approval of the exact Phase A transaction packet.

## Phase B: separately approved acceptance

`script/OptraTestnetAcceptance.s.sol` requires a separate `OPTRA_TESTNET_ACCEPTANCE_APPROVED=true` gate and the same configured deployer address. It refuses to start unless Phase A is paused with no policy and both synthetic assets have zero supply. A partial or completed Phase B run cannot silently be replayed as a fresh run.

The Phase B flag is also only an execution guard. It must be set only after separate explicit approval of the exact synthetic-asset liquidity and swap acceptance packet.

Phase B is **13 transactions**: mint both synthetic assets (2), token approvals (4), seed pool liquidity (1), publish a temporary allow policy (1), exact-input and exact-output underlying buys (2), pause policy (1), and exact-input and exact-output underlying-out swaps (2). It then simulates denied paused buys with non-broadcast calls and verifies final policy, pause, freshness, and pool ID. All assets, liquidity, and swaps are synthetic Testnet demonstrations.

The policy expires after 300 seconds. If Phase B is interrupted after publishing allow, underlying-in swaps fail once the policy is stale. Immediately pause with the keeper account:

```sh
cast send "$OPTRA_TESTNET_HOOK" "publishPolicy(bool)" true \
  --rpc-url "$ROBINHOOD_TESTNET_RPC_URL" \
  --account "$OPTRA_TESTNET_ACCOUNT"
```

Then independently read back `entryPaused`, `policyPublished`, and `isPolicyFresh` with `cast call`. The keeper and admin are the deployer in this isolated fixture. A publish-pause transaction is a direct recovery operation; it does not need the Phase B acceptance script.

## RPC and Testnet-only signer

The official current-head endpoint works for deployment checks and fork simulations; archive access is not required for the initial deployment. The public endpoint is rate-limited. An authenticated Alchemy endpoint can be supplied through the same RPC variable if available.

```sh
export ROBINHOOD_TESTNET_RPC_URL="https://rpc.testnet.chain.robinhood.com"
cast chain-id --rpc-url "$ROBINHOOD_TESTNET_RPC_URL"
cast block-number --rpc-url "$ROBINHOOD_TESTNET_RPC_URL"
cast code 0x8366a39cc670b4001a1121b8f6a443a643e40951 --rpc-url "$ROBINHOOD_TESTNET_RPC_URL" | python3 -c \
  "import hashlib,sys; code=bytes.fromhex(sys.stdin.read().strip()[2:]); print(len(code), hashlib.sha256(code).hexdigest())"
```

If the public RPC resets connections, configure a private Alchemy app endpoint in the local shell and reuse `ROBINHOOD_TESTNET_RPC_URL`. Robinhood publishes the Testnet endpoint as `https://robinhood-testnet.g.alchemy.com/v2/{API_KEY}`. Keep the API key in a local secret manager or shell environment; do not add a full endpoint to project files or logs.

```sh
export ROBINHOOD_TESTNET_RPC_URL="https://robinhood-testnet.g.alchemy.com/v2/${ALCHEMY_API_KEY:?configure ALCHEMY_API_KEY locally}"
cast chain-id --rpc-url "$ROBINHOOD_TESTNET_RPC_URL"
cast balance "$OPTRA_TESTNET_DEPLOYER_ADDRESS" --rpc-url "$ROBINHOOD_TESTNET_RPC_URL" --ether
```

Expected chain ID is `46630`; expected PoolManager runtime is 24,009 bytes with SHA-256 `6eb21c69298b064e37fcf8089a941ae096fe08c0f179b2d399567aef1b10585b`.

The designated encrypted account is `optra-testnet-deployer`. Verify its address locally and check its balance; the command may prompt for the keystore password. Do not send the password or any key material:

```sh
export OPTRA_TESTNET_ACCOUNT="optra-testnet-deployer"
cast wallet address --account "$OPTRA_TESTNET_ACCOUNT"
cast balance "$OPTRA_TESTNET_DEPLOYER_ADDRESS" --rpc-url "$ROBINHOOD_TESTNET_RPC_URL" --ether
```

Run the address command locally to compare the unlocked keystore address with `OPTRA_TESTNET_DEPLOYER_ADDRESS`; do not send the keystore password. Do not generate or import a replacement wallet if this account is missing. The public address and sufficient Testnet ETH are required before an owner-specific packet can be prepared. Do not reuse an unrelated project keystore.

## Dry runs, broadcasts, and postflight

Run dry runs without `--broadcast`. They do not need the approval flags and do not sign transactions. Always rerun Phase A with the selected deployer address because token, helper, hook, pool, and CREATE2 salt predictions depend on the sender.

```sh
forge script script/OptraTestnetDeployment.s.sol:OptraTestnetDeployment \
  --rpc-url "$ROBINHOOD_TESTNET_RPC_URL" \
  --sender "$OPTRA_TESTNET_DEPLOYER_ADDRESS" -vv
```

After a separate owner approval naming the exact network, signer, arguments, transaction sequence, gas ceiling, and synthetic fixture, Phase A broadcast uses the encrypted local keystore:

```sh
OPTRA_TESTNET_DEPLOYMENT_APPROVED=true \
OPTRA_TESTNET_DEPLOYER_ADDRESS="$OPTRA_TESTNET_DEPLOYER_ADDRESS" \
forge script script/OptraTestnetDeployment.s.sol:OptraTestnetDeployment \
  --rpc-url "$ROBINHOOD_TESTNET_RPC_URL" \
  --account "$OPTRA_TESTNET_ACCOUNT" --sender "$OPTRA_TESTNET_DEPLOYER_ADDRESS" --broadcast -vv
```

After Phase A, independently run `script/optra-testnet-postflight.sh` with `phase-a` and the emitted hook, token, pool, and deployer addresses. Phase B dry run and broadcast require these exact addresses:

```sh
OPTRA_TESTNET_UNDERLYING="$OPTRA_TESTNET_UNDERLYING" \
OPTRA_TESTNET_QUOTE="$OPTRA_TESTNET_QUOTE" \
OPTRA_TESTNET_HOOK="$OPTRA_TESTNET_HOOK" \
OPTRA_TESTNET_LIQUIDITY_ROUTER="$OPTRA_TESTNET_LIQUIDITY_ROUTER" \
OPTRA_TESTNET_SWAP_ROUTER="$OPTRA_TESTNET_SWAP_ROUTER" \
forge script script/OptraTestnetAcceptance.s.sol:OptraTestnetAcceptance \
  --rpc-url "$ROBINHOOD_TESTNET_RPC_URL" \
  --sender "$OPTRA_TESTNET_DEPLOYER_ADDRESS" -vv
```

After the Phase B dry run and a separate explicit approval, broadcast it with the dedicated keystore account:

```sh
OPTRA_TESTNET_ACCEPTANCE_APPROVED=true \
OPTRA_TESTNET_DEPLOYER_ADDRESS="$OPTRA_TESTNET_DEPLOYER_ADDRESS" \
OPTRA_TESTNET_UNDERLYING="$OPTRA_TESTNET_UNDERLYING" \
OPTRA_TESTNET_QUOTE="$OPTRA_TESTNET_QUOTE" \
OPTRA_TESTNET_HOOK="$OPTRA_TESTNET_HOOK" \
OPTRA_TESTNET_LIQUIDITY_ROUTER="$OPTRA_TESTNET_LIQUIDITY_ROUTER" \
OPTRA_TESTNET_SWAP_ROUTER="$OPTRA_TESTNET_SWAP_ROUTER" \
forge script script/OptraTestnetAcceptance.s.sol:OptraTestnetAcceptance \
  --rpc-url "$ROBINHOOD_TESTNET_RPC_URL" \
  --account "$OPTRA_TESTNET_ACCOUNT" --sender "$OPTRA_TESTNET_DEPLOYER_ADDRESS" --broadcast -vv
```

Run the read-only postflight after each phase:

```sh
script/optra-testnet-postflight.sh "$ROBINHOOD_TESTNET_RPC_URL" phase-a \
  "$OPTRA_TESTNET_HOOK" "$OPTRA_TESTNET_UNDERLYING" "$OPTRA_TESTNET_QUOTE" \
  "$OPTRA_TESTNET_POOL_ID" "$OPTRA_TESTNET_DEPLOYER_ADDRESS"
script/optra-testnet-postflight.sh "$ROBINHOOD_TESTNET_RPC_URL" phase-b \
  "$OPTRA_TESTNET_HOOK" "$OPTRA_TESTNET_UNDERLYING" "$OPTRA_TESTNET_QUOTE" \
  "$OPTRA_TESTNET_POOL_ID" "$OPTRA_TESTNET_DEPLOYER_ADDRESS"
```

A Phase B broadcast requires a distinct approval from Phase A. Never present the synthetic pool as market liquidity or an options venue.

## Reproducible dependencies

The v4-core and forge-std dependencies are Git submodules pinned by the commit IDs stored in the OPTRA repository index. v4-core's nested submodule graph pins its forge-std, OpenZeppelin, Solmate, and ds-test dependencies. From the OPTRA repository root, initialize all levels with:

```sh
git submodule update --init --recursive
```

Do not update these dependencies to a moving branch as part of a routine build. Review and pin a new commit explicitly when changing dependency versions. `dependencies.lock` records the reviewed top-level tags and commits; the Git submodule pointers are the checkout source of truth.

## Verification commands

Run from `contracts/`:

```sh
forge fmt --check
forge build
forge lint
forge test --fuzz-runs 1000 -vv
forge test --match-path test/OptraTestnetPhases.t.sol \
  --fork-url "$ROBINHOOD_TESTNET_RPC_URL" -vv
bash -n script/optra-testnet-preflight.sh script/optra-testnet-postflight.sh
```

The current-head fork keeps all hook, token, liquidity, policy, and swap writes in fork state. The two test-only v4 helpers are direct PoolManager integration helpers, not an approved general router. No public OPTRA contract deployment has been made.

## Mainnet

Mainnet checks are read-only. Chain ID is `4663`. No Mainnet transaction is authorized. Mainnet requires successful Testnet acceptance, independent security review, verified assets and route, gas assessment, and separate explicit owner authorization. The hook remains a spot swap-direction gate and cannot execute or settle Protective Put options.

## Sources

- Robinhood network connection guide: <https://docs.robinhood.com/chain/connecting/>
- Uniswap v4 deployment registry: <https://developers.uniswap.org/docs/protocols/v4/deployments>
- Robinhood deployment guide: <https://docs.robinhood.com/chain/deploy-smart-contracts/>
