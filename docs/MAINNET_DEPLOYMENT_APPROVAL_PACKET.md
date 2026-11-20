# OPTRA P4 Mainnet Deployment — Owner Input Sheet and Gate Status

Status: NO-GO. No packet is eligible for approval. Nothing is deployed, signed, or broadcast.
Scope: deploys only `OptraGuardHook` (Uniswap v4 spot swap-direction gate). It is not a CallPut options executor and creates no pool.

## Read-only facts verified (chain 4663, block 119006564, rpc.mainnet.chain.robinhood.com)

| Item | Value |
|---|---|
| PoolManager | `0x8366a39CC670B4001A1121B8F6A443A643e40951`, 24009 bytes, sha256 `6eb21c69…585b` — PASS |
| CREATE2 factory | `0x4e59b44847b379578588920cA78FbF26c0B4956C`, 69 bytes, sha256 `e0af82ad…04b9` — PASS |
| Gas price observed | 20,034,000 wei (0.02 gwei) |
| Reference gas (fork, synthetic tokens) | estimateGas 1,676,421; factory deploy 1,648,245 |
| Indicative fee at observed price | ~3.36e13 wei (~0.0000336 ETH). Indicative only: a real-asset estimate is still required. |
| Source SHA-256 | `cc952a87aa28ab78754de3abe3b9015fc1f706baaf922f797f74b5a8de723ba2` (see `docs/INDEPENDENT_AUDIT_HANDOFF.md`) |

## Verified candidate values and wallet status (read-only, block ~119.05M)

| Item | Result |
|---|---|
| MSFT stock token `0xe93237C50D904957Cf27E7B1133b510C669c2e74` | code present, symbol MSFT, 18 decimals, supply 3,479.39 |
| USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` | code present, symbol USDG, 6 decimals |
| `0x27f35B08…aBBd9` (`optra-testnet-deployer`) | Testnet-only by its own record. Mainnet: 0 ETH, nonce 0, 0 USDG. Not a valid Mainnet deployer. |
| Mainnet deployer / trading wallet | Not supplied. No balances can be read. |

These two tokens are verifiable candidates only; whether MSFT/USDG is the approved pair, the fee, spacing, price, creator and route remain owner decisions. No existing OPTRA-hook pool exists (the hook is not deployed).

The deployer must hold at least `OPTRA_MAINNET_TOTAL_FEE_CEILING_WEI` (indicative 3.4e13 wei).

## Strict preflight result (`optra-mainnet-preflight.sh --strict`)

Chain ID and factory fingerprint pass. BLOCKED on 27 missing owner values, in four groups:

1. Operators: DEPLOYER (+ keystore name), ADMIN_SAFE (>=3 owners, threshold >=2, read live), KEEPER (different from Safe), POOL_CREATOR, MAX_POLICY_AGE (1-900 s).
2. Market: UNDERLYING, QUOTE (chain-4663 token addresses), POOL_FEE, TICK_SPACING, INITIAL_SQRT_PRICE_X96. The agent does not choose these.
3. Fee limits: GAS_LIMIT, GAS_LIMIT_CEILING, MAX_FEE_PER_GAS_WEI, MAX_PRIORITY_FEE_PER_GAS_WEI, TOTAL_FEE_CEILING_WEI, I_UNDERSTAND_MAINNET=yes.
4. Evidence references: PROVIDER, PM, ASSET, JURISDICTION, POOL_ROUTE, KEEPER_RUNBOOK, REAL_ASSET_FORK_SIMULATION (+SHA-256), GAS_REPORT (+SHA-256), AUDIT_REPORT (+SHA-256).

## Owner actions needed, in order

1. PM approval of the spot-only scope.
2. Choose the token pair, pool fee/spacing/initial price, creator, and route.
3. Provide a production Safe and a keeper, with a runbook.
4. Commission an independent audit of source SHA above.
5. Approve a production RPC provider.
6. Provide the deployer address and keystore name (no keys or passwords to the agent).

Engineering then runs the real-asset fork simulation and gas report, then `--strict`, then `--prepare` (produces the packet with `approvalSha256`). The owner approves that exact hash, and the owner runs `--broadcast`. Postflight and source verification follow, and only then is an address, tx hash, and explorer link reportable.
