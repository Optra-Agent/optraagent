# OPTRA Contract Deployment Plan

Updated: 2026-11-20 (Asia/Jakarta)

## Current inventory

The current worktree contains one OPTRA-authored Solidity contract, `OptraGuardHook`, a Foundry workspace, and guarded Mainnet estimate/prepare/broadcast/postflight/source-preparation tooling. The hook remains an experimental one-pool spot-direction gate, not a production-approved module. No OPTRA Testnet/Mainnet receipt or explorer-verified OPTRA address exists. The paper MVP remains independent of contract deployment, and live execution remains disabled (`LIVE_TRADING_ENABLED=false`, `V4_CLAIM_LEVEL=L0`).

| State | Count | Evidence |
|---|---:|---|
| OPTRA-authored production-candidate sources | 1 | `contracts/src/OptraGuardHook.sol`; experimental and not deployment-approved. |
| Shared `GuardRegistry` sources | 0 | Remains conditional; one hook currently owns its own pause state. |
| Compiled / unit-tested | 1 / 1 | `forge build` passed; focused Foundry suite and coverage are recorded in the P4 addendum below. |
| Robinhood Mainnet fork simulation | 1 | `OptraRobinhoodRealAssetFork.t.sol` uses live PoolManager/USDG and live ETH/USDG reference state; balances and seeded test liquidity are fork-only overrides. |
| OPTRA deployed / explorer verified | 0 / 0 | No OPTRA deployment receipts or verified addresses exist; external Robinhood/Uniswap dependencies are excluded. |
| Conditional PM roadmap modules | 2 | `OptraGuardHook` and `GuardRegistry`; only the first is implemented. Owner confirmed P4 scope alignment; independent/legal and exact transaction approvals remain separate. |

The PM brief identifies a v4 spot pool using the hook as a future deployment target. A pool instance and the external Uniswap v4 PoolManager are not separate OPTRA-authored contract modules and do not justify a six-contract count.

Foundry CLI and a repository Foundry workspace are present; Solidity tests and Mainnet deployment tooling are run from `contracts/`.

## Candidate review

The original PM brief calls for `OptraGuardHook` and `GuardRegistry` in the future guarded-live phase. The Project Owner has authorized P4 engineering while keeping CallPut/live execution separate. `GuardRegistry` remains conditional; no extra contract is added without a real second consumer:

| Candidate | Decision | Reason |
|---|---|---|
| `OptraGuardHook` | **Implemented for P4 engineering; production gate remains NO-GO** | The owner authorized the hook for an OPTRA-owned Robinhood Chain spot pool. It remains experimental pending external review/approvals. A v4 spot hook does not govern third-party options transactions. |
| `GuardRegistry` | **Conditional; do not assume it is a separate deployment** | A shared registry is justified if multiple guarded pools/hooks need common public state and a separately revocable keeper role. For a single hook and one initial pool, storing the minimal guard state in `OptraGuardHook` is simpler and reduces the external call/role surface. Owner approval must select one design. |
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

### Read-only infrastructure verification — 2026-11-15

Normal TLS-verified `curl` JSON-RPC requests to both supplied public RPCs succeeded during this investigation:

| Network | `eth_chainId` | `eth_blockNumber` observed | `eth_getCode` at v4 PoolManager |
|---|---|---|---|
| Testnet | `0xb626` = 46630 | `0x9291abc` | Nonempty bytecode at `0x8366a39cc670b4001a1121b8f6a443a643e40951`. The official testnet Blockscout smart-contract API returned `src/PoolManager.sol` and `creation_status: success` for that address. |
| Mainnet | `0x1237` = 4663 | `0x6dbbd2f` | Nonempty bytecode at `0x8366a39cc670b4001a1121b8f6a443a643e40951`. |

The [official Uniswap v4 deployment list](https://developers.uniswap.org/docs/protocols/v4/deployments) identifies that PoolManager on Robinhood Chain mainnet and lists the mainnet v4 periphery, including Universal Router 2.1.2 at `0x204FAca1764B154221e35c0d20aBb3c525710498`. Its testnet section does not list Robinhood Chain Testnet. The testnet RPC bytecode and testnet explorer source record therefore establish a PoolManager-shaped deployment at the same address, but do not establish Uniswap's supported testnet router path or a usable test pool. No router or pool interaction was performed.

Robinhood's [stock-token documentation](https://docs.robinhood.com/chain/stock-tokens/) describes the tokens as standard ERC-20s that can be transferred and composed into applications. This resolves the generic interface concern, not the exact asset decision: the selected token's trading capability, token contract, quote asset, pool/liquidity, and jurisdictional restrictions still need review. Stock Tokens are described as tokenised debt securities, and direct primary-market minting is limited to authorised participants.

Subsequent repeat requests intermittently ended with `curl: (35) Recv failure: Connection reset by peer`; the testnet explorer API worked once and then also reset. No TLS verification was disabled. Treat the successful responses above as point-in-time evidence, not a production RPC reliability guarantee. Robinhood marks its public RPCs rate-limited and recommends a provider endpoint for production. The mainnet Blockscout contract API returned HTTP 403 in this environment; that response is not evidence about deployed bytecode. The mainnet code check came from the RPC and the official address mapping from Uniswap's deployment list.

Before any signing or deployment, use an owner-approved, trusted RPC provider, query `eth_chainId` from the exact active RPC immediately before signing, and stop unless it matches the selected target. Never infer the chain from a wallet label or an explorer URL.

## Conditional architecture boundary

These contracts are not necessary for the current paper MVP. An offchain policy service remains the smaller sufficient solution unless OPTRA later operates its own spot pools and needs onchain entry vetoes that cannot be supplied by the server. If the owner approves the PM roadmap after feasibility review, the initial scope should remain:

- `GuardRegistry`: keeper-writable halt, venue state, corporate-action pauses, and session schedule root; a separate admin role can revoke the keeper. Define role handoff and stale-state behavior before coding.
- `OptraGuardHook`: enforce approved entry gates in `beforeSwap` for OPTRA-owned spot pools. Reduce/exit behavior stays available. `beforeAddLiquidity` remains disabled unless separately reviewed. Robinhood Chain v4 PoolManager code exists on both chains by the point-in-time reads above, and the official mainnet v4 periphery is listed. Hook permissions/address mining, the exact router path, `hookData` semantics, asset/pool selection, liquidity, and operational stale-state behavior remain unresolved.
- No personal data, private Tape records, strategy text, session cookies, or wallet-authentication challenges onchain.
- No contract-initiated token transfers/swaps, custody, borrowing, payment, or automated live trading. If separately approved, the hook only gates user-initiated swaps through an OPTRA-owned pool; it does not submit orders or move funds itself.

The existing paper application must work when neither module exists. Do not claim the current offchain hook stages are enforced by this proposed architecture.

## Conditional implementation specification (approval-gated)

This section records the earlier engineering proposal for the PM-backed candidates. The Project Owner subsequently authorized P4 engineering on 2026-11-20, but the PM brief still awaits formal PM approval and no deployment is authorized. The deterministic paper engine, option model, wallet sessions, PostgreSQL, and private Tape remain offchain. Current paper trading needs neither contract. The experimental implementation uses one `OptraGuardHook` with minimal admin/keeper state; a separate `GuardRegistry` remains unjustified until multiple hook/pool instances need shared state.

```text
Market providers + deterministic rules + private agent/Tape state (offchain)
                 |
          authorized keeper
                 v
 GuardRegistry (only if shared state is required)
                 ^ read-only state; otherwise state lives in Hook
                 |
Wallet -> v4 router -> PoolManager -> OptraGuardHook -> OPTRA-owned spot pool
                                         |
                       gates eligible entry swaps

Options venues and third-party pools: outside this hook's control
Paper engine and Tape: not called by these contracts
```

### Modules and responsibilities

1. **`GuardRegistry` (optional)** — sole owner of shared public guard state only if the separate-module criterion above is met. Candidate state: per-token `haltUntil`; per-token corporate-action pause interval; and a versioned session policy. Candidate roles: an owner-controlled admin (preferably a multisig) manages roles and policy, while a revocable keeper publishes time-sensitive state. Venue state belongs here only if hook execution can authenticate which venue/purpose a swap represents. Every state write emits the corresponding PM event. Reads are public; no user, wallet-session, strategy, or position data is stored.
2. **`OptraGuardHook`** — binds to the Robinhood v4 `PoolManager`; initial permission is `beforeSwap` only. It checks an explicit token/pool allowlist and reads the registry. Do not enable `beforeAddLiquidity` in the first version; LP withdrawal must remain possible. Uniswap documents that hooks are bound to a pool at initialization and that low address bits encode callback permissions; deployment therefore requires deterministic address mining with the matching `HookMiner` process ([hook concepts](https://developers.uniswap.org/docs/protocols/v4/concepts/hooks), [hook deployment](https://developers.uniswap.org/docs/protocols/v4/guides/hooks/hook-deployment)).
3. **Pool** — an OPTRA-owned v4 pool initialized with this hook, for one owner-approved stock-token/quote-token pair. The hook does not attach to existing third-party pools. No stock token, quote token, pool, liquidity, or address is assumed by this spec.

### Proposed decision and failure rules

- Apply halt, corporate-action, venue, and session checks only to swaps that increase exposure to the approved underlying. Derive token-in/token-out from the pool key and swap direction. Treat caller-provided `hookData` as untrusted; never accept an `isExit` flag as proof of a reducing swap.
- Allow swaps that demonstrably sell the approved underlying token to reduce exposure through the guarded pool, including while entry gates are active. The initial hook does not assert that selling a token closes an options position or reduces a user's total portfolio risk.
- `Venux` remains offchain unless a dedicated pool mapping or trusted router provides authenticated venue/purpose context. A user-controlled `hookData` value cannot prove that a swap is a hedge for a particular options venue. If the approved integration has no such trusted context, omit venue state from the onchain registry rather than publish state the hook cannot safely consume. Unrecognized pool/token combinations fail closed.
- Missing, expired, or malformed entry state blocks entry. Reducing swaps remain permitted. Store update timestamps/epochs and define a maximum age before coding; without freshness semantics, a keeper outage can leave stale state looking current.
- A bare session root cannot evaluate a timestamp. Before implementation, choose either explicit onchain schedule fields or a versioned schedule proof supplied with each swap, and specify its timezone, daylight-saving, holiday, and early-close semantics. The server's US equity-session logic must not be silently treated as an onchain policy.
- Corporate-action enforcement should use explicit registry pause intervals in v1. Reading an external token multiplier inside a swap hook is deferred until gas, failure, and interface behavior are measured.
- Hook restrictions cover only the OPTRA pool initialized with the hook. They do not enforce option orders at CallPut/Zeno, other spot pools, wallet approvals, custody, or agent behavior outside that path.

### Candidate state transitions, events, errors, and invariants

- Registry writes: admin sets/revokes keeper and updates policy; keeper sets/clears halt, venue status, corporate-action window, and versioned session policy. Reject invalid intervals, unknown statuses, zero policy versions, and role changes that would leave no admin.
- Preserve PM event intent: `HaltSet`, `VenueStatusSet`, `CorporateActionPause`, `SessionScheduleUpdated`. Add events for keeper/admin changes and clears so indexers can reconstruct current state. Event fields must include the affected key, new value, effective interval/version, and writer.
- Use custom errors for unauthorized writes, invalid intervals/status, unsupported pool/token, stale or missing entry state, and blocked entry. Error names and parameter encoding are part of the reviewed interface, not yet fixed ABI.
- Invariants: only authorized roles mutate registry state; keeper revocation takes effect immediately; entry is blocked under each active configured gate; a gate cannot prevent an approved underlying-out swap; caller-supplied data cannot bypass direction checks; unrelated pool keys cannot use the hook; exits and LP withdrawals remain possible; registry or oracle failure never silently authorizes an entry.

### Required implementation and verification gate

After scope approval, add an isolated `contracts/` Foundry workspace in this repository, pin Solidity (the verified testnet PoolManager source declares `0.8.26`), pin exact v4-core dependencies and optimizer/metadata settings, then publish reproducible compiler inputs. Tests must cover role authorization/revocation, intervals/status transitions, hook permission bits and deterministic address mining, token ordering/direction, hostile or empty `hookData`, every active gate, stale/missing state, allowed exits while halted/degraded/out of session, unsupported pools, and failure injection. Add fuzz/property tests for both token orderings, exact-input/exact-output directions, arbitrary hook data, timestamps around interval boundaries, and registry state changes. Run static analysis and independent review before mainnet consideration.

### Deployment, simulation, explorer, and ABI integration

- Add a Foundry deployment script only after reviewed implementation. Its default path is simulation; it must print and assert live `eth_chainId`, target PoolManager code, constructor inputs, mined hook address/permission bits, role recipients, and gas estimate. Broadcasting requires an explicit command flag and a separately authorized operator; no key or deployer mnemonic is committed. No deployment script may silently switch networks.
- Reproduce a testnet simulation against a pinned block and explicit chain ID. Record source/dependency commit hashes, compiler and optimizer settings, constructor inputs, simulated transaction data, gas estimate, and the expected state transitions. A simulation must be labeled as such and must not create an address or receipt claim.
- After an authorized deployment, save addresses and transaction hashes from receipts in a chain-specific deployment manifest. Read back bytecode and registry state from the same chain, then verify the exact source/compiler/settings with the Robinhood Blockscout explorer/API. Store verification response and code hash; only successful chain and explorer checks advance status.
- Generate and version only the minimal `GuardRegistry`/`OptraGuardHook` ABIs from the reviewed build. If a future UI needs chain status, expose a read-only server adapter on the existing public verification surface (chain ID, confirmed block, deployment manifest, and public registry state). Do not give the browser a signer or let it write guard state. No such chain-status API or ABI integration exists today; the paper app and private Tape remain independent.

Testnet readiness is **protocol infrastructure only**: the chain is reachable and a verified PoolManager source record is present, but Robinhood testnet router support, an approved asset pair/pool, an OPTRA hook, reviewed implementation, passing contract tests, safe deployer account, funded testnet ETH, measured gas estimate, and explicit owner deployment authorization are all outstanding. Testnet deployment still needs its own authorization. Mainnet requires separate authorization after testnet verification, audit, asset/legal review, and gas assessment. No gas-cost estimate is defensible until the implementation exists and is measured against the chosen RPC. Mainnet deployment, key access, or live trading is not part of this work.

### Items requiring owner authorization

1. Whether future v1 needs any onchain enforcement at all; if yes, which exact stock-token/quote pair and which new OPTRA-owned pool.
2. One self-contained hook versus a separate shared `GuardRegistry`; whether Venux stays offchain; and exact entry/reducing-swap semantics.
3. Session schedule representation, DST/calendar policy, state freshness limits, failure behavior, admin/keeper operators, and revocation procedure.
4. Approval of the written specification before Solidity implementation. Approval to implement is not permission to broadcast a testnet transaction.
5. Separate authorization naming the testnet deployment, deployer, and bounded gas; then a later independent mainnet decision after testnet verification, security review/audit, permissions inspection, asset/legal review, and gas-cost assessment.

## Release sequence and evidence states

1. **Planned:** record owner-approved behavior, assets/pools, role owners, entry/exit semantics, privacy boundary, and failure behavior. Verify the exact stock-token and quote-token contracts, per-asset availability, target pool route, and any issuer allowlist or jurisdictional requirements.
2. **Compiled:** only after approval, add an isolated `contracts/` directory and minimal Foundry setup in this repository. Pin the compiler/toolchain without changing the web stack. Compile with reproducible settings.
3. **Tested:** add unit, access-control, fuzz/invariant, and adversarial tests for halts, venue degradation, corporate-action pauses, sessions, role revocation, fail-closed entries, and allowed exits. Run static analysis and independent security review before any public deployment.
4. **Simulated:** fork or otherwise simulate against a verified target-chain state; report constructor inputs, permissions, gas estimates, and the exact RPC chain ID. Simulation output must state clearly that no deployment occurred.
5. **Testnet deployed:** only after explicit owner authorization. Read contract addresses from successful receipts, verify deployed bytecode and explorer source, then exercise the approved integration against testnet.
6. **Mainnet deployed:** separate approval after testnet verification, security review, and gas-cost assessment. Mainnet deployment is never part of an automatic release command.

Any future status display must show each contract separately as `Planned`, `Compiled`, `Tested`, `Simulated`, `Deployed`, and `Explorer verified`. A status or simulation command may be added after the implementation scope is approved; `bun run contracts:status` and `bun run contracts:simulate` are not present today. Addresses and explorer links must come from deployment receipts and verified chain data, never from placeholders.

## Deployment blockers

- The Project Owner authorized P4 engineering and explicitly confirmed PM scope alignment on 2026-11-20; do not request routine PM re-confirmation. Exact transaction approval remains separate.
- A technical ETH/USDG pool candidate is selected and real-asset fork-tested. It is a new hook-specific pool, not the existing dynamic-fee ETH/USDG pool; the initial price and liquidity plan remain separate, time-sensitive operational gates.
- Public RPCs returned valid chain IDs and bytecode in this read-only session, but repeat calls reset intermittently; use a trusted provider and verify its chain ID immediately before deployment.
- The current candidate is native ETH/USDG. The deployer, Safe candidate, and distinct keeper candidate are supplied and read-only checked. Cross-project Safe authorization, keeper operator/key custody, production RPC approval, owner-approved gas ceilings, independent audit, and asset/jurisdiction evidence remain outstanding; no approval-eligible packet exists.
- The hook is not a full onchain implementation of Breaker/Sessions policy: it stores one keeper-published pause bit and does not consume authenticated per-asset session or venue state.
- Internal checks do not replace an independent security audit. No independent audit or Mainnet receipt exists.

This contract roadmap is separate from paper web release readiness. It does not block the paper-only MVP.

## 2026-11-20 P4 engineering verification and Mainnet gate

The Project Owner authorized P4 engineering and confirmed PM scope alignment while keeping exact transaction approval separate. This addendum supersedes earlier readiness statements in this plan. It is not an independent audit or permission to broadcast.

### Worktree result

- `OptraGuardHook` remains the sole OPTRA-authored production candidate. No `GuardRegistry` or unrelated contract was added.
- Constructor hardening requires deployed code at PoolManager and quote-token addresses; native ETH is represented by `address(0)` as the underlying. It caps `maxPolicyAge` at 900 seconds and on chain ID `4663` pins the official PoolManager address while requiring contract-code admin/pool-creator addresses and a keeper distinct from admin.
- Mainnet keeper rotation also rejects setting the admin as keeper. A regression test was first run red, then passed after the guard was added.
- The engineering default for a future instance remains `maxPolicyAge=300` seconds. That is not a finalized Mainnet constructor packet.
- `test/OptraRobinhoodMainnetFork.t.sol` remains a synthetic infrastructure regression test. `test/OptraRobinhoodRealAssetFork.t.sol` additionally verifies a new native ETH/USDG hook pool against live Mainnet PoolManager/USDG and a live reference-pool price; fork balances/liquidity are state overrides only.

### Verification record

From `contracts/`:

| Check | Result |
|---|---|
| `forge fmt --check` | Passed. |
| `forge build --sizes` | Passed with Solidity 0.8.26; `OptraGuardHook` runtime 7,085 bytes and initcode 8,369 bytes. |
| `forge test --fuzz-runs 1000` | 33 passed, 0 failed, 4 optional fork suites skipped; freshness fuzz 1,000 runs; invariant handler 128,000 calls. |
| `forge lint` | Passed. |
| `forge coverage --ir-minimum --report summary --no-match-coverage 'script|test'` | 100% lines, 98.36% statements, 90.48% branches, 100% functions. Foundry notes that `--ir-minimum` can affect source mapping. |
| Slither on `src/OptraGuardHook.sol` | 101 detectors, 0 reported results; the timestamp detector was explicitly excluded because chain time is intentionally used for freshness. |
| Robinhood Mainnet fork, chain ID 4663, block 118774800 | 1/1 fork test passed. This verifies only the tested PoolManager/callback path, not production assets, route, or economic behavior. |

This is a focused internal delta review, not an independent security audit. See `docs/INTERNAL_AUDIT.md`, `docs/THREAT_MODEL.md`, `docs/INCIDENT_RESPONSE.md`, `docs/KNOWN_LIMITATIONS.md`, and `docs/MAINNET_CHECKLIST.md` for scope and current gates.

### Exact deployment packet status

No eligible Mainnet transaction batch exists. The 2026-11-21 read-only candidate estimate records a predicted address, constructor tuple, and measured gas, but none is an approval hash or deployed address. The supplied Safe/admin (recommended as pool creator) and separate keeper EOA were read-only checked; cross-project authorization, keeper custody/runbook, approved production provider, external/legal evidence, audit, and owner-approved gas ceilings remain unresolved. The deployer EOA is supplied. Deployment scripts remain gated.

Robinhood's [Stock Token documentation](https://docs.robinhood.com/chain/stock-tokens/) says asset trading capabilities vary by session and must be checked per asset. It also states that Stock Tokens may not be offered, sold, or delivered in the United States or to/for U.S. persons. The asset/jurisdiction decision therefore requires formal review rather than an engineering guess. Robinhood's [network documentation](https://docs.robinhood.com/chain/connecting/) marks the official public RPC as rate-limited and not recommended for production; a trusted provider must be selected for any eventual signer-specific dry run.

The exact Phase A Testnet packet recorded in `docs/onchain-hardening-testnet-preparation-2026-11-16.md` is stale after the hook bytecode change. Its predicted CREATE2 address, salt/init-code hash, constructor bytes, and gas values must not be reused.

### Future verification sequence (not executed)

1. No routine PM scope confirmation is outstanding. Obtain asset/jurisdiction and pool-route evidence for the selected native ETH/USDG candidate.
2. Obtain the actual multisig/admin Safe and separate keeper EOA/operator, verify the Safe owner set/threshold, and approve Safe as pool creator. Use the supplied deployer as a distinct EOA after a fresh signer/balance check.
3. After independent review/audit and Testnet acceptance, simulate the exact Mainnet batch on a trusted provider/fork with the selected signer address; record exact calldata, predicted address, gas estimate and explicit ceiling. Do not sign or broadcast during this step.
4. Generate the verification inputs for the exact compiled source, constructor bytes, compiler/optimizer/via-IR/EVM settings. Verify through the supported Blockscout/Sourcify path and independently read back code, roles, pool ID, permissions, and paused/no-policy state after a separately approved broadcast.
5. Request final Project Owner transaction approval only after the complete exact batch and all independent gates are recorded. No Live Trading, CallPut execution, liquidity provision, or fund movement is included in this hook deployment scope.

## 2026-11-20 Mainnet tooling completion update

This section supersedes earlier statements in this document that no Mainnet deployment/preflight/postflight/source-preparation scripts exist. The following owner-operated scripts are now present:

- `contracts/script/optra-mainnet-preflight.sh`: read-only chain-ID, pinned PoolManager/CREATE2 runtime fingerprints, parameter, Safe, token, explicit Mainnet acknowledgement, approval-reference, and gas-ceiling guards.
- `contracts/script/optra-mainnet-deploy.sh`: read-only estimate and exact CREATE2 approval-packet preparation; its separate broadcast path requires the exact owner-approved packet hash/reference, a local signer keystore, live chain/nonce/balance checks, current source/build/calldata checks, and is for the owner/operator only.
- `contracts/script/optra-mainnet-postflight.sh`: approved-packet receipt/calldata/runtime/getter checks; requires the new hook remain unbound, entry-paused, and without published/fresh policy.
- `contracts/script/optra-mainnet-verify-source.sh`: prepares local standard-JSON input, constructor arguments and a verification manifest; it submits no source.

Read-only verification on 2026-11-20 through `https://robinhood.drpc.org` returned chain ID `4663`. The PoolManager at `0x8366a39CC670B4001A1121B8F6A443A643e40951` matched runtime size `24009` and SHA-256 `6eb21c69298b064e37fcf8089a941ae096fe08c0f179b2d399567aef1b10585b`; the CREATE2 factory at `0x4e59b44847b379578588920cA78FbF26c0B4956C` matched size `69` and SHA-256 `e0af82ad2e5188285db8ba0b2ae054d13f0fd4fe325c48c7f2dace48454404b9`. These are point-in-time runtime observations, not production-provider approval or source verification.

The preflight verified chain ID and both runtime fingerprints. Engineering selected native ETH/USDG, static fee 3000, tick spacing 60, policy age 300 seconds, and the supplied Safe candidate as admin/pool creator; the supplied keeper is a separate EOA candidate and not one of the Safe's owners. The latest real-asset fork test passed on chain 4663 at block 119544065 using live PoolManager/USDG and reference-pool state, with fork-only balance/liquidity overrides. A read-only `eth_estimateGas` result is available for the supplied candidate tuple, but gas/fee ceilings and funding limits are not owner-approved. The estimate used a public RPC without production-provider approval.

The exact unresolved external decisions and current NO-GO posture are consolidated in `docs/MAINNET_OWNER_DECISIONS.md`; operator steps and environment names are in `docs/MAINNET_DEPLOYMENT_RUNBOOK.md`. P4 engineering scope is confirmed. Remaining gates are cross-project Safe authorization, keeper operator/key custody, legal/provider/audit evidence, owner-approved gas and fee ceilings, a fresh funding check, and explicit approval of a specific final packet hash.

### 2026-11-20 owner-wallet refresh

The owner supplied deployment EOA `0xAa8fDF2f96aFC037D50659CFd09fDF3Fac060bBf` and Foundry keystore label `optra-mainnet-deployer`. Read-only Robinhood Mainnet checks at block `119108809` observed `0.00042 ETH` and `0.45027 USDG`; no keystore material was accessed. This is a historical observation; see the current refresh below. Only `OptraGuardHook` is an OPTRA-authored production candidate; existing Robinhood PoolManager/CREATE2 contracts are dependencies, and test mocks are local-only. The hook deployment would not create/init a pool; future pool initialization and liquidity are separate owner-approved actions. No OPTRA Mainnet contract is deployed.

## 2026-11-21 candidate refresh — read-only, not approval

- Supplied deployer `0xAa8fDF2f96aFC037D50659CFd09fDF3Fac060bBf`, Safe candidate `0xf9C76ef996C5cbC73E4E23927D6EecB3295c8d45`, and keeper candidate `0x23439a41eDC01D58d3Aaa0C75E9dFEE0C0196848` were used as the ETH/USDG engineering tuple. The Safe readback at block 119433484 showed Safe L2 v1.5.0, 3 owners, threshold 2, and no enabled modules. Cross-project Safe authorization and keeper operator/key custody remain unconfirmed.
- Read-only CREATE2/gas report: `contracts/.local/optra-mainnet-p4-candidate-estimate-20261121-current.json`, block 119537033, estimate 1,676,133 gas, source SHA-256 `03ead9705a22ecf8255ad4193705f99094dc82c929ecda9be8e43cc677e864e8`, Foundry config SHA-256 `abf3a679c9566b4eb2ccca9cfc0632ce82ef53ebaa1f4ae5a9a2f7d29099121a`. It derives candidate CREATE2 address `0x98332827Ff79e07eCD1A63CC04462D3817622080` and salt `0x7f0289f5660a0648a66c492761168c6d2ff2b6dce746111185dbdcef5772437b`; `eth_getCode` returned empty at block 119544065. These are predictions, not a deployed contract address.
- Candidate gas proposal only: 130% gas limit 2,178,973; at observed gas price 20,018,000 wei, an illustrative 2x max-fee candidate with zero priority fee caps cost at 87,237,363,028,000 wei. The candidate cap is unapproved and the estimate used a public RPC that is not approved for production signing.
- Current real-asset fork: block 119544065, one test passed, gas 655,383; local log SHA-256 `e3a6014841a325331ba7b3d9058956afc12f6ab69914c2526b43c18e4e9d85f1`. Fork-only USDG balance/liquidity overrides were used; no transaction was sent.
- Fresh strict preflight passed chain 4663 and pinned PoolManager/CREATE2 fingerprints, then blocked on Mainnet acknowledgement, owner-approved gas ceilings, provider/PM/asset/jurisdiction/pool/keeper-runbook approvals, and independent audit/evidence references. No approval-eligible transaction packet or `approvalSha256` exists. No source-verification submission, signature, broadcast, pool initialization, liquidity provision, or Live Trading activation occurred.
