# OPTRA Mainnet Contract Checklist

Updated: 2026-11-21

## Decision

NO-GO. P4 engineering scope and the ETH/USDG candidate are recorded. The supplied deployer, Safe candidate, and keeper were checked read-only; Safe cross-project authorization and keeper custody/runbook remain unconfirmed. A current CREATE2/gas estimate and real-asset fork result exist as local evidence, but the RPC is not owner-approved, gas ceilings are not approved, and legal/asset, PM, route, audit, and exact-transaction approvals are absent. No OPTRA Mainnet contract has been deployed. This checklist does not authorize signing, broadcasting, liquidity provision, Live Trading, or movement of funds.

The consolidated decision record is `docs/MAINNET_OWNER_DECISIONS.md`; the owner/operator procedure is `docs/MAINNET_DEPLOYMENT_RUNBOOK.md`.

## Current evidence

| Gate | Status | Evidence / blocker |
|---|---|---|
| Project Owner P4 scope authorization | RECORDED | Owner explicitly confirmed scope alignment and directed no further routine PM confirmation. |
| Candidate source/tests | PASS, EXPERIMENTAL | `OptraGuardHook`; native ETH support was regression-tested; security scope remains spot-direction-only. |
| Mainnet infrastructure | VERIFIED, READ-ONLY | Chain 4663; pinned PoolManager and CREATE2 runtime checks. Not production-provider approval or source verification. |
| Real-asset fork | PASS, LIMITED | `OptraRobinhoodRealAssetFork.t.sol`: live PoolManager/USDG, live ETH/USDG reference price, fork-only balance/liquidity overrides; buy gating and ETH-out passed. |
| Recommended engineering configuration | SELECTED | Native ETH/USDG, fee 3000, spacing 60, policy age 300 seconds; Safe as admin and pool creator; separate keeper EOA. |
| Legal/asset eligibility | BLOCKED, EXTERNAL | Product/jurisdiction/asset approval still required; technical address verification is not legal approval. |
| Safe/admin and keeper | CANDIDATES VERIFIED; AUTHORIZATION BLOCKED | Safe candidate readback: Safe L2 v1.5.0/no enabled modules at block 119433484; latest owner/threshold read at block 119556696 returned 3 owners/threshold 2. Supplied keeper and deployer are not among those owners. Cross-project Safe authorization, keeper operator/key custody, and runbook are not confirmed. |
| Deployment scripts | IMPLEMENTED, GATED | Fresh strict preflight passed chain 4663 and pinned PoolManager/CREATE2 fingerprints, then stopped at missing acknowledgement, approved ceilings, and external evidence. |
| Production RPC provider | BLOCKED, EXTERNAL | Public RPC used read-only; provider approval missing. |
| Gas report/funding | CANDIDATE ONLY | Read-only estimate at block 119537033: 1,676,133 gas. A 130% candidate limit is 2,178,973 units. At block 119544065, deployer nonce was 0, balance 0.00042 ETH, and observed gas price was 20,018,000 wei. Candidate fee caps remain unapproved; no funding or fee sufficiency is asserted for a final transaction. |
| Independent security audit | BLOCKED, EXTERNAL | Internal test/fork evidence is not an independent audit. |
| Exact transaction packet | NOT APPROVAL-ELIGIBLE | Local estimate records predicted CREATE2 candidate `0x98332827Ff79e07eCD1A63CC04462D3817622080` (no code at block 119544065), salt, init-code hash, and calldata. No final approval hash exists; values and packet require refresh after approved RPC/evidence and owner-set gas ceilings. |
| Final transaction approval | NOT REQUESTED | There is no executable packet to approve. |

## Known contract and deployment boundaries

Constructor shape: `(poolManager, underlyingToken, quoteToken, poolCreator, admin, keeper, maxPolicyAge)`.

- PoolManager is source-pinned at `0x8366a39CC670B4001A1121B8F6A443A643e40951` on chain ID `4663`; the preflight verifies its live code size and SHA-256 fingerprint.
- The CREATE2 factory is `0x4e59b44847b379578588920cA78FbF26c0B4956C`; the preflight verifies its pinned runtime fingerprint.
- Engineering candidate: underlying native ETH (`address(0)`), quote USDG at `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`, fee 3000, spacing 60, policy age 300 seconds. Initial sqrt price is refreshed from the live reference pool immediately before separate pool initialization; contract maximum policy age is 900 seconds.
- Mainnet constructor requires code at PoolManager, quote token, Safe pool creator, and Safe admin; the keeper is a distinct EOA; the deployer is an EOA distinct from admin and keeper.
- The deploy-only transaction creates an unbound hook with entries paused and no published/fresh policy. Pool initialization and liquidity are separate owner-reviewed actions.

The supplied deployer and constructor roles are now in the candidate tuple. The read-only estimate is not an owner-approved transaction packet; gas/fee ceilings, external evidence, and the exact approval hash remain unavailable. The prior Testnet Phase A packet is stale after the hook bytecode change and must not be reused.

## Gates before an exact packet

1. No further routine PM scope confirmation is needed; the Project Owner confirmed it. Keep that approval separate from exact transaction approval.
2. Obtain product/legal confirmation for the proposed native ETH/USDG pair, users/jurisdiction, and asset availability. Do not infer legal eligibility from a ticker or contract code.
3. Record the exact pool route and initializer: Safe as creator, static fee 3000, spacing 60, fresh initial price, and separate liquidity ownership/funding plan.
4. Confirm cross-project authorization and owner control for the supplied Safe candidate; confirm keeper operator/key custody, recovery, and incident-response runbook. The observed Safe owner count/threshold does not by itself establish OPTRA authorization.
5. Complete the independent audit for the exact source and deployment scope; resolve findings. Internal checks are not an audit.
6. Re-run the real-asset fork and gas estimate against an owner-approved trusted provider. Record source/dependency hashes, compiler settings, exact calldata, estimate, owner-approved max gas, fee price and total fee ceiling.
7. Prepare source-verification inputs for the exact build (Solidity 0.8.26, optimizer 44,444,444, via-IR, Cancun, metadata settings). Verify the chain-specific explorer route.
8. Only after all gates pass, generate the exact packet and request explicit Project Owner approval of its `approvalSha256`. PM/product approval and transaction approval remain separate gates.

## Post-broadcast verification plan

Only after separately approved operator broadcast:

- Verify the exact transaction receipt, sender, nonce, destination, calldata, gas used, block and transaction hash.
- Read deployed runtime code and fingerprint; verify exact source/compiler/settings on Sourcify and Robinhood Blockscout.
- Read back PoolManager, token pair, creator, Safe/admin, keeper, policy age, pool ID, hook permissions, `poolBound`, `entryPaused=true`, `policyPublished=false`, and `isPolicyFresh=false`.
- Confirm no pool initialization, liquidity, policy unpause, options order, Live Trading toggle, or fund transfer occurred unless separately scoped and approved.
- Update the execution ledger only from verified receipts and live readback; predicted addresses and fork state are not deployment evidence.

## Scope boundaries

- Do not deploy mock tokens or test routers on Mainnet.
- Do not deploy a separate `GuardRegistry` without a second real consumer requiring shared state.
- Do not claim the hook enables CallPut, Live Options, or general Live Trading.
- Preserve Railway Production, Paper Trading, `LIVE_TRADING_ENABLED=false`, and `V4_CLAIM_LEVEL=L0`.

See `docs/contract-deployment-plan.md`, `docs/INTERNAL_AUDIT.md`, `docs/THREAT_MODEL.md`, `docs/INCIDENT_RESPONSE.md`, and `docs/KNOWN_LIMITATIONS.md`.
