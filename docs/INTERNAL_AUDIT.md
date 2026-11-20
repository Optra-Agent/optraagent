# OPTRA Internal Contract Security Review — P4 Delta

Date: 2026-11-20
Review type: Focused internal differential review of the P4 contract worktree; not an independent audit.
Base: `48c265e6e92d78ca643bfcdf60ed5928cd671d0a` (current worktree is dirty; no commit range).

## Executive summary

| Category | Count / status |
|---|---:|
| Confirmed open exploit findings in reviewed delta | 0 |
| Findings fixed during review | 2 MEDIUM (keeper rotation; Mainnet manager address) |
| Production-deployment blocker findings | 4 categories, with multiple external gates |
| Runtime line / statement / branch / function coverage | 100% / 98.36% / 90.48% / 100% |

Overall risk: HIGH for Mainnet deployment because architecture approval, asset eligibility, production role wiring, independent review, and deployment-specific controls remain unresolved. The reviewed source delta has no confirmed open exploit after the keeper-rotation and manager-address fixes.

Recommendation: NO-GO for any Testnet/Mainnet broadcast from the current packet; NO-GO for Mainnet deployment. Continue only after PM approval and external asset/role gates. No hypothetical transaction batch is offered for approval.

## Scope and changes reviewed

Reviewed current worktree changes in:

- `contracts/src/OptraGuardHook.sol`
- `contracts/test/OptraGuardHook.t.sol`
- `contracts/test/OptraRobinhoodMainnetFork.t.sol` (new, untracked at review time)
- `contracts/test/OptraRobinhoodFork.t.sol`
- `contracts/script/OptraLocalSimulation.s.sol`
- `contracts/README.md`
- `docs/execution-ledger.md`
- `docs/contract-deployment-plan.md`

The code delta adds a 900-second maximum policy-age constant; deployed-code checks for PoolManager and both configured tokens; a chain-4663 pin to Robinhood's official PoolManager address; Mainnet-only contract-code checks for admin and pool creator and distinct admin/keeper roles; a Mainnet keeper-rotation check; constructor/callback regression tests; and a Mainnet fork-only PoolManager simulation. Existing 300-second fixtures remain the selected engineering default. No `GuardRegistry`, CallPut execution contract, token, registry, or unrelated production contract was added.

The only production-candidate Solidity source remains an explicitly experimental one-pool spot-direction hook. No OPTRA Mainnet or Testnet deployment exists. The source does not execute options orders or prove portfolio-risk reduction.

## Findings

### P4-FIX-01 — MEDIUM, fixed: Mainnet admin could rotate itself into keeper

Location: `contracts/src/OptraGuardHook.sol:135-140`; regression test `contracts/test/OptraGuardHook.t.sol:356-360` (`test_mainnetAdminCannotBecomeKeeperAfterDeployment`).

Before the fix, the constructor rejected `keeper == admin` on chain 4663, but `setKeeper(admin)` did not repeat that invariant. An admin could rotate itself into the keeper role and then publish `entryPaused=false`, defeating the intended Mainnet role separation. This required admin authority; it was not an unauthenticated exploit, but it violated the stated role boundary.

Evidence: the new regression test was run first and failed with `next call did not revert as expected`. A Mainnet-only `newKeeper == admin` validation was then added. The same test passed, and the full Foundry suite passed afterward. Testnet's existing shared test-fixture roles remain compatible because the additional check is specific to chain ID 4663.

Status: FIXED and covered.

### P4-BLOCK-01 — MEDIUM deployment blocker: Mainnet PoolManager runtime and deployment path are not verified

Location: `contracts/src/OptraGuardHook.sol:33, 74-82`; constructor regression test `contracts/test/OptraGuardHook.t.sol:347-353` (`test_mainnetRejectsUnapprovedPoolManagerWithCode`); Mainnet fork harness `contracts/test/OptraRobinhoodMainnetFork.t.sol:23-26, 50-52`.

The first focused reviewer found that a code-bearing but incorrect manager address could be supplied. The current source closes that address-misconfiguration path: on chain ID `4663`, the constructor now requires `0x8366a39CC670B4001A1121B8F6A443A643e40951`, and a regression test rejects another code-bearing manager. The constructor still does not enforce the manager runtime hash. The fork harness checks the live runtime, but the only deployment script present is Testnet-only and chain-guarded for `46630`; no chain-4663 deployment/ops script checks the address and runtime together with exact signer, audit opt-in, Safe configuration, and zero-deployer-role postconditions.

The manager regression test was first run with the wrong manager and failed because deployment did not revert; after adding the chain-specific address guard, the targeted test passed.

Impact: the exact address is now enforced by the contract, but a deployment workflow still needs to verify current runtime code and bind the exact constructor data to the selected signer. This is a release-integrity gap, not a demonstrated path to steal funds from the official PoolManager.

Required: add and test a Mainnet-only deployment/ops path that re-checks the pinned address and runtime, checks the exact constructor data, and never deploys mock/example assets.

### P4-BLOCK-02 — HIGH product/security blocker: one pause bit is not the PM's complete Breaker/Sessions policy

Location: `contracts/src/OptraGuardHook.sol:46-51, 120-131, 166-188`.

The hook consumes only one keeper-published boolean and timestamp. It does not implement authenticated per-asset sessions, holiday/early-close logic, corporate-action data, venue health, price conditions, or options-position state. No production keeper publisher/calendar integration is present. A boolean can encode an offchain decision only if the approved operator and source are trustworthy; those are not selected.

Impact: passing tests prove the boolean gate, not the PM's full product semantics. Until the PM approves this exact boundary and its offchain inputs, it must not be presented as enforcing all Breakers/Sessions.

### P4-BLOCK-03 — HIGH asset/legal blocker: no approved token pair or jurisdiction decision

The constructor checks that token addresses contain code and are distinct; it does not prove asset identity, issuer permission, per-asset availability, router support, liquidity, or user eligibility. No Mainnet underlying/quote pair or pool route is selected. Robinhood's [official Stock Token documentation](https://docs.robinhood.com/chain/stock-tokens/) describes asset-specific trading availability and restrictions, including restrictions on offering/selling/delivering to U.S. persons. Resolve this with authorized product/legal review; do not guess an asset from a public contract list.

### P4-BLOCK-04 — HIGH governance blocker: production operators and audit are absent

Mainnet construction requires code at admin and pool creator and makes the initial keeper distinct from admin. Code length alone does not validate a Safe's owners/threshold, operational quorum, keeper security, initializer trust, or emergency response. No Safe/admin, keeper, pool creator, Mainnet deployer, or trusted production RPC is recorded. No independent audit is recorded; internal review and Slither are not substitutes.

### P4-RISK-01 — MEDIUM residual: underlying-out is not a verified risk reduction

Location: `contracts/src/OptraGuardHook.sol:175-185`.

The hook permits the direction sending the configured underlying out of the pool even when policy is missing, stale, or paused. A caller can sell underlying for reasons unrelated to an options close or may increase risk elsewhere. The hook does not inspect positions or trusted route context. Documentation and UI must call this “underlying-out token flow,” not an options exit, hedge, or risk-reducing action.

### P4-RISK-02 — MEDIUM residual: pool economics are selected by the initializer

Location: `contracts/src/OptraGuardHook.sol:102-117`.

The first authorized creator chooses fee, tick spacing, initial price, and timing. The hook binds the first matching pair/pool but does not constrain those economics or validate liquidity/slippage. These values and the initializer route must be explicitly reviewed before any pool exists.

## Verification evidence

Commands run from `contracts/` on 2026-11-20:

| Check | Result |
|---|---|
| `forge fmt --check` | Passed. |
| `forge build --sizes` | Passed with Solidity 0.8.26. `OptraGuardHook`: 7,085-byte runtime, 8,369-byte initcode. |
| `forge test --fuzz-runs 1000` | 33 passed, 0 failed, 4 optional fork suites skipped. Freshness fuzz ran 1,000 cases; invariant ran 128,000 handler calls with 0 reverts. |
| `forge lint` | Passed. |
| `forge coverage --ir-minimum --report summary --no-match-coverage 'script|test'` | 94/94 lines, 120/122 statements, 19/21 branches, 21/21 functions. Foundry warns that `--ir-minimum` can make source mapping inaccurate. |
| `slither src/OptraGuardHook.sol --compile-force-framework foundry --filter-paths 'lib' --exclude timestamp` | 17 contracts analyzed, 101 detectors, 0 reported results. The timestamp detector was explicitly excluded because the design intentionally uses chain time; this is not a no-timestamp-risk claim. |
| Robinhood Mainnet fork | Read-only RPC returned chain ID 4663; pinned block 118774800; `test_mainnetPoolManagerEnforcesFreshPolicyAndKeepsUnderlyingOutAvailable` passed 1/1. |

The Mainnet fork harness checks the official PoolManager runtime size/hash and creates mock assets, a hook, pool, and simulated swaps only in local fork state. It proves the tested callback path at that fork block; it does not prove real Stock Token behavior, approved routing, liquidity, legal eligibility, verified source on an explorer, or deployment safety.

A second focused adversarial review of the pre-pin snapshot found no confirmed unprivileged exploit or introduced regression. It highlighted the manager-address gap, which the current constructor pin and regression test close, and the conditional limitation that underlying-out swaps remain possible during a stale/paused policy. That behavior is intentional for the documented asymmetric spot gate, but would be a blocker if the required semantics were a full swap halt or options-position control. This review is not an independent audit.

## Blast radius and historical context

- The hook is reached through PoolManager callbacks for a pool whose `PoolKey` includes this hook; the only project-authored consumers found are Foundry tests and local/Testnet scripts. No frontend, Paper engine, Railway service, CallPut adapter, or Live Options route calls it.
- The reviewed diff added validation and tests; no access-control or bounds check was removed. The role-rotation gap above was a pre-existing mismatch between the new constructor invariant and the existing `setKeeper` mutator, found by targeted review and closed with a regression test.
- The Mainnet fork test is deliberately separate from the existing CallPut read-only fork. It does not invoke CallPut or imply any permission to use CallPut or enable Live Trading.

## Release blockers and next steps

1. Record formal PM approval; owner authorization for engineering does not replace it.
2. Complete the token/jurisdiction, router/initializer, pool configuration, Safe, keeper, and deployer decisions.
3. Add a guarded Mainnet deployment/ops script and test all chain, manager/hash, Safe, signer, role-separation, and no-mock guards.
4. Regenerate the earlier Testnet packet from current bytecode; the 2026-11-16 predicted CREATE2 address, salt/init-code hash, constructor bytes, pool ID, and gas are stale.
5. Complete Testnet acceptance and independent audit; publish exact source/compiler verification inputs.
6. Only then run a signer-specific non-broadcast Mainnet simulation on a trusted provider, set an evidence-backed gas ceiling, and present the exact calldata batch for separate Project Owner approval.

No transaction was signed or broadcast. No Mainnet signer was inspected. No funds were moved. Live Trading, Railway Production, and Paper Trading were not changed.

## Methodology and limitations

Focused differential review of the current dirty worktree against base commit `48c265e6e92d78ca643bfcdf60ed5928cd671d0a`, with line-by-line review of the modified Solidity, tests, fork harness, test/deployment callers, and relevant PM/deployment records. This report does not repeat the 2026-11-16 local/Testnet review, audit all vendored Uniswap dependencies, review unrelated CallPut worktree changes, or substitute for independent auditors, legal counsel, or a complete production threat review. Confidence is high for the changed branch/test evidence and limited for production readiness because the target assets, route, and operators do not exist in the current packet.