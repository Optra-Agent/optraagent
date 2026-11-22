# OPTRA P4 deployment-only risk acceptance

Scope: DEPLOYMENT-ONLY release of one uninitialized `OptraGuardHook` on Robinhood Chain Mainnet (chain 4663) at the CREATE2 address `0x4089d38251fF25936d778C799d5d3AB5658c2080`.

Status: proposed by engineering at the Project Owner's direction. It has no effect until the Project Owner approves the exact packet hash of a prepared packet that references this document's SHA-256. Approving the packet hash is the owner's acceptance of every item below. It is not Safe-owner consent, an audit, an issuer or legal determination, or an approval of any later transaction.

## What the deployment transaction does

One CREATE2 transaction from the deployer `0xAa8fDF2f96aFC037D50659CFd09fDF3Fac060bBf` to the singleton factory `0x4e59b44847b379578588920cA78FbF26c0B4956C`, with frozen calldata and a fee ceiling of 0.00010894865 ETH. It creates a contract that holds no funds, has no pool, no liquidity, no published policy and no keeper activity. Until a pool is bound and a keeper policy is fresh, every risk-increasing swap path reverts. Nothing can be traded through it, and it does not touch the existing ETH/USDG pool or any CallPut position.

## Gates waived for this deployment only

| Gate | Why it is waivable for deployment-only |
|---|---|
| `OPTRA_MAINNET_AUDIT_REPORT_REF`, `OPTRA_MAINNET_AUDIT_REPORT_SHA256` | The contract holds no value and has no users at deployment. An audit is a governance gate OPTRA defined for operation, not a requirement of the chain. |
| `OPTRA_MAINNET_ASSET_APPROVAL_REF`, `OPTRA_MAINNET_JURISDICTION_APPROVAL_REF` | No asset is moved, pooled or offered to anyone by deploying the hook. Eligibility governs the pool and its users, which do not exist yet. |
| `OPTRA_MAINNET_KEEPER_RUNBOOK_REF` | The keeper does nothing until a pool exists. The runbook draft is `docs/KEEPER_CUSTODY_RUNBOOK.md`; its owner section stays open. |

## Risks the owner accepts by approving the packet

1. The deployed code is unaudited and immutable at a public address. If a later audit finds a defect, the fix is a new deployment at a different address, and this one is abandoned. The cost is the fee above.
2. The Safe `0xf9C76ef996C5cbC73E4E23927D6EecB3295c8d45` is the immutable admin and pool creator, and its owners have not consented. If they decline or cannot act, no pool can ever be initialized on this hook and its keeper can never be rotated. The hook would be an unusable contract, not a hazard.
3. The keeper `0x23439a41eDC01D58d3Aaa0C75E9dFEE0C0196848` is a candidate with no custody record. It is unfunded and unused.
4. Public explorers will show an unverified or unaudited contract. Source verification is submitted after deployment, but verified source is not an audit.
5. The fee may be lost if the transaction reverts or the address is already occupied. The preflight and fork rehearsal reduce but do not remove that chance.

## Still mandatory, not waived

Chain ID 4663; pinned PoolManager and CREATE2 runtime fingerprints; constructor and address guards (distinct Safe, keeper and deployer, Safe with at least three owners); the real-asset fork evidence and gas report with their hashes; the gas and fee ceilings; the owner's Mainnet acknowledgement; the provider, PM-scope and pool-route records; a clean `contracts/` tree bound to the packet; nonce, chain and balance checks at send time; and the owner's approval of the exact packet hash.

## Not covered by this acceptance (each needs its own gates and approval)

Pool initialization, liquidity, keeper policy publication, any claim that the hook protects users or is audited or eligible, CallPut order execution, and Live Agent activity. Product copy must not describe this contract as audited, eligible or protective until those gates exist.
