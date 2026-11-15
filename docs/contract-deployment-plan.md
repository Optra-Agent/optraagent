# OPTRA Contract Deployment Plan

Updated: 2026-11-15 (Asia/Jakarta)

## Current inventory

The repository contains no Solidity source, Foundry workspace, contract ABI, deployment script, or verified OPTRA contract address. The existing 36 hook definitions and the Breaker/Sessions stages execute in the offchain paper engine; they are not deployed contracts. The paper MVP remains independent of contract deployment, and live execution remains disabled (`LIVE_TRADING_ENABLED=false`, `V4_CLAIM_LEVEL=L0`).

| State | Count | Evidence |
|---|---:|---|
| OPTRA Solidity contracts present | 0 | Repository inventory: no `.sol` files or `contracts/` workspace. |
| Compiled / unit-tested / simulated | 0 / 0 / 0 | No Foundry or other contract build configuration exists. |
| Deployed / explorer verified | 0 / 0 | No OPTRA deployment addresses or receipts exist. |
| Conditional PM roadmap modules | 2 | `OptraGuardHook` and `GuardRegistry`, subject to feasibility review and owner approval. |

The PM brief identifies a v4 spot pool using the hook as a future deployment target. A pool instance and the external Uniswap v4 PoolManager are not separate OPTRA-authored contract modules and do not justify a six-contract count.

## Candidate review

The original PM brief calls for `OptraGuardHook` and `GuardRegistry` in the future guarded-live phase. The master execution brief locks v4 at L0 for the MVP and prohibits spontaneous contract additions. Six registry-style candidates from the takeover request were compared with the current server-side system:

| Candidate | Decision | Reason |
|---|---|---|
| `OptraGuardHook` | **Keep as a conditional future module** | The PM roadmap requires an EVM hook for entry checks on OPTRA-owned Robinhood Chain spot pools. It must be technically feasible, audited, and approved before implementation. A v4 spot hook does not govern third-party options transactions. |
| `GuardRegistry` | **Keep as a conditional future module** | The PM describes shared halt, venue, corporate-action, and session state with a revocable keeper role. This supplies inputs to `OptraGuardHook`; it is distinct from the hook's pool callbacks. |
| `AgentRegistry` | **Defer** | The current owner-scoped PostgreSQL agent records already provide the required private MVP identity and lifecycle. Onchain publication is not specified for the paper release. |
| `RecipeRegistry` | **Defer** | Canonical recipe hashes and immutable launched recipes are already stored with the paper records. Publishing strategies by default would conflict with private, owner-scoped recipes. Revisit only with an explicit public-sharing requirement. |
| `HookRegistry` | **Reject for this scope** | Hook definitions and evaluator status are static catalog/API data. A second onchain catalog duplicates the current source and adds no enforcement beyond `GuardRegistry` and `OptraGuardHook`. |
| `RiskPolicyRegistry` | **Reject for this scope** | It duplicates the PM's `GuardRegistry` halt/session state and the current offchain Breaker policy. No separate policy lifecycle or consumer is specified. |
| `SessionRegistry` | **Reject for this scope** | Wallet sign-in uses origin-bound nonces and revocable server cookies. An onchain record would expose wallet-linked session data and is not required for current authentication. |
| `EvidenceAnchor` | **Defer** | The public verification surface currently reports source-backed offchain claims. No public commitment format, privacy analysis, or trust requirement justifies posting Tape or user-linked hashes onchain. |

The current specification supports two conditional OPTRA-authored modules, not six. Do not split these into empty wrappers to meet a count. Adding modules requires an approved use case, unique state owner, authorized writer, privacy review, and consumers that cannot use the existing offchain service.

## Target chain settings

The supplied chain IDs and public endpoints match the current [Robinhood Chain connection documentation](https://docs.robinhood.com/chain/connecting/). The documentation also marks the public endpoints as rate-limited and not recommended for production use.

| Network | Chain ID | RPC | Explorer |
|---|---:|---|---|
| Robinhood Chain Testnet | 46630 | `https://rpc.testnet.chain.robinhood.com` | `https://explorer.testnet.chain.robinhood.com` |
| Robinhood Chain Mainnet | 4663 | `https://rpc.mainnet.chain.robinhood.com` | `https://robinhoodchain.blockscout.com` |

On 2026-11-15, a read-only `eth_chainId` request was attempted against both supplied public RPCs. The TLS handshake returned a certificate for the unrelated host `internetpositif.id`, expiring 2026-06-04; `curl` rejected it, and no JSON-RPC response or chain ID was obtained. This appears to be network interception or blocking. TLS verification was not bypassed, and the certificate response is not treated as RPC evidence. Before any deployment, resolve network access and use an owner-approved, trusted RPC provider; verify its `eth_chainId` with normal TLS immediately before signing. The official docs recommend a provider endpoint for production use.

Before any deployment, the deployment command must query `eth_chainId` from the exact active RPC immediately before signing and stop unless it matches the selected target. Never infer the chain from a wallet label or an explorer URL.

## Conditional architecture boundary

If the owner approves the PM roadmap after feasibility review, the initial scope should remain:

- `GuardRegistry`: keeper-writable halt, venue state, corporate-action pauses, and session schedule root; a separate admin role can revoke the keeper. Define role handoff and stale-state behavior before coding.
- `OptraGuardHook`: enforce the approved entry gates in `beforeSwap` for OPTRA-owned spot pools. Reduce/exit behavior stays available. `beforeAddLiquidity` remains disabled unless separately reviewed. Hook permissions, `hookData` meaning, token transfer restrictions, pool availability, and Robinhood Chain v4 support are unresolved feasibility questions.
- No personal data, private Tape records, strategy text, session cookies, or wallet-authentication challenges onchain.
- No token transfers, swaps, custody, borrowing, payment, or live trading as part of this deployment plan.

The existing paper application must work when neither module exists. Do not claim the current offchain hook stages are enforced by this proposed architecture.

## Release sequence and evidence states

1. **Planned:** record owner-approved behavior, assets/pools, role owners, entry/exit semantics, privacy boundary, and failure behavior. Resolve the PM's Robinhood stock-token/custom-hook and v4 pool feasibility questions.
2. **Compiled:** only after approval, add an isolated `contracts/` directory and minimal Foundry setup in this repository. Pin the compiler/toolchain without changing the web stack. Compile with reproducible settings.
3. **Tested:** add unit, access-control, fuzz/invariant, and adversarial tests for halts, venue degradation, corporate-action pauses, sessions, role revocation, fail-closed entries, and allowed exits. Run static analysis and independent security review before any public deployment.
4. **Simulated:** fork or otherwise simulate against a verified target-chain state; report constructor inputs, permissions, gas estimates, and the exact RPC chain ID. Simulation output must state clearly that no deployment occurred.
5. **Testnet deployed:** only after explicit owner authorization. Read contract addresses from successful receipts, verify deployed bytecode and explorer source, then exercise the approved integration against testnet.
6. **Mainnet deployed:** separate approval after testnet verification, security review, and gas-cost assessment. Mainnet deployment is never part of an automatic release command.

Any future status display must show each contract separately as `Planned`, `Compiled`, `Tested`, `Simulated`, `Deployed`, and `Explorer verified`. A status or simulation command may be added after the implementation scope is approved; `bun run contracts:status` and `bun run contracts:simulate` are not present today. Addresses and explorer links must come from deployment receipts and verified chain data, never from placeholders.

## Deployment blockers

- Owner approval is not established by the PM brief; its owner status is marked pending approval.
- Robinhood Chain v4/stock-token custom-hook compatibility and required permissions have not been verified.
- The supplied public RPCs could not provide an authenticated chain ID in this environment; use a reachable trusted provider and verify its chain ID immediately before deployment.
- No contract source, test suite, build tool, deployment credentials, or chain receipt exists.
- Contract behavior requires technical review and audit before mainnet consideration.

This contract roadmap is separate from paper web release readiness. It does not block the paper-only MVP.
