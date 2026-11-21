# OPTRA Mainnet Safe setup worksheet

Status: supplied Safe candidate checked read-only; no Safe-creation transaction was prepared or submitted. Proxy/singleton and module readback at block 119433484 showed Safe L2 v1.5.0 and no enabled modules. Latest owner/threshold read at block 119556696 showed 3 owners and threshold 2; the supplied keeper and deployer are not among those owners. Cross-project authorization for OPTRA use and current owner approval remain unconfirmed.

## Selected setup

- Network: Robinhood Chain Mainnet, chain ID 4663 (Safe configuration identifies it as an L2 and not a testnet).
- Recommended Safe implementation: SafeL2 v1.5.0 at `0xEdd160fEBBD92E350D4D398fb636302fccd67C7e`.
- Proxy factory: `0x14F2982D601c9458F93bd70B218933A6f8165e7b`.
- Compatibility fallback handler: `0x3EfCBb83A4A7AfcB4F68D501E2c2203a38be77f4`.
- Recommended Safe configuration: 3 unique owner EOAs, threshold 2, standard fallback handler, and no unreviewed modules, guard, session keys, or delegates. This is a desired configuration, not a claim about how the existing candidate was created.
- Admin/pool creator role for OPTRA: the deployed Safe proxy address itself.
- Keeper role: separate operator EOA, not the Safe, any Safe owner, or the supplied deployer. The supplied keeper candidate was compared with the Safe's public owner list at block 119556696 and is not a Safe owner; the preflight enforces distinctness from Safe and deployer.
- Deployer remains `0xAa8fDF2f96aFC037D50659CFd09fDF3Fac060bBf` (`optra-mainnet-deployer`). It was not among the Safe owners at block 119556696 and is never the keeper.

## On-chain verification snapshot

The selected Safe v1.5.0 runtimes were read from the chain-4663 RPC and their Keccak hashes matched the official Safe deployment registry entries:

| Component | Address | Runtime bytes | Keccak-256 |
|---|---|---:|---|
| SafeL2 singleton | `0xEdd160fEBBD92E350D4D398fb636302fccd67C7e` | 22,231 | `0x180193227186ccb85316c94db1f0d156ed932b14712cfaac78901899178572dc` |
| SafeProxyFactory | `0x14F2982D601c9458F93bd70B218933A6f8165e7b` | 3,321 | `0x967dae4cda22b0c9ef7f31b010bdc1ceb0af9904b0c3dc060b5302e4c18a4529` |
| CompatibilityFallbackHandler | `0x3EfCBb83A4A7AfcB4F68D501E2c2203a38be77f4` | 6,294 | `0x3c6a85bcf7b563daa624b884b4e9a1b9fa5371edde7be945d998071a48f28bbc` |

Safe configuration identifies chain 4663 as Robinhood Chain/L2, marks v1.5.0 as the recommended master-copy version, and provides a Safe transaction service. The supplied proxy candidate read back to the v1.5.0 singleton at block 119433484; its latest `getOwners()`/`getThreshold()` read at block 119556696 showed 3 owners and threshold 2. Runtime hashes and getters establish implementation/configuration observations, not cross-project authorization or approval of an OPTRA transaction.

## Existing candidate verification and remaining operator steps

1. Do not create another Safe by default; the supplied candidate already has proxy code and the expected v1.5.0 singleton, 3-owner, threshold-2 configuration.
2. Have the Safe owners confirm, through their normal governance process, that this Safe is authorized for the exact OPTRA deployment and that the candidate owner set/recovery path is current. No Safe signature or transaction was requested or produced here.
3. Confirm the separate keeper operator/key custody, monitoring, incident response, and revocation/rotation runbook. The supplied keeper candidate is a distinct EOA from the Safe and deployer; its key custody authorization is not established by address readback.
4. Keep modules/guards/session keys unchanged until separately reviewed. Any change to the Safe configuration requires a fresh chain readback and owner review.
5. Configure `adminSafe=<verified Safe candidate>`, `poolCreator=<same Safe candidate>`, and `keeper=<verified distinct keeper EOA>` only after the external authorization and operator gates are recorded. The strict preflight checks Safe code, at least three unique owners, threshold >=2, distinct keeper/deployer, EOA keeper, and `poolCreator == adminSafe`.

The Safe candidate already exists; no creation calldata is needed for this stage. Any Safe configuration change or OPTRA deployment remains owner-controlled and requires review/approval of the exact transaction batch. The assistant has not signed or broadcast anything.

## OPTRA parameters still gated by evidence

The engineering candidate remains native ETH / USDG (`0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`, 6 decimals), static fee 3000, tick spacing 60, maximum policy age 300 seconds. These are implementation choices, not asset eligibility or route approval. Keep the candidate disabled until the owner supplies the asset/jurisdiction and pool-route approvals. Pool initialization is a separate Safe transaction with a fresh, owner-reviewed reference price; it is not part of the hook deployment transaction.

## Remaining owner/operator inputs

- Explicit cross-project authorization from the Safe owners for OPTRA's exact deployment scope and confirmation of Safe recovery/control.
- Keeper operator identity, key custody authorization, monitoring/incident response, and approved runbook.
- Owner selection of the production RPC provider.
- Asset/jurisdiction and pool-route evidence approving native ETH/USDG and the new fee-3000/spacing-60 pool.
- External audit report for the exact hook and deployment-script hashes in `docs/INDEPENDENT_AUDIT_HANDOFF.md`.
- Owner-approved gas/fee ceilings and explicit approval of the final exact transaction packet hash.

After these are received and verified, refresh the read-only estimate/source manifest on an owner-approved RPC, record gas/fee ceilings and a fresh deployer-balance check, generate the exact deployment packet, then wait for approval of that packet's SHA-256 before any signing or broadcast.
