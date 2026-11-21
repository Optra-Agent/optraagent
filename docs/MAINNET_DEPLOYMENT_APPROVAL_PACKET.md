# OPTRA P4 Mainnet approval-readiness packet

Status: NO-GO — no approval-eligible packet exists. The supplied deployer, Safe candidate, and keeper are recorded and read-only checked; no transaction has been signed or broadcast, and no OPTRA contract is deployed on Robinhood Mainnet.

## Engineering decisions selected

- Production contract: one `OptraGuardHook`, deployed through the chain-4663 CREATE2 factory at `0x4e59b44847b379578588920cA78FbF26c0B4956C`.
- External protocol: Robinhood Mainnet Uniswap v4 `PoolManager` at `0x8366a39CC670B4001A1121B8F6A443A643e40951`; no OPTRA token, oracle, router, or Testnet mock deployment is required for the hook itself.
- Candidate pool: native ETH (`address(0)`) / USDG (`0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`, 6 decimals), static fee 3000 (0.30%), tick spacing 60, policy freshness 300 seconds.
- Role boundaries: supplied Safe candidate `0xf9C76ef996C5cbC73E4E23927D6EecB3295c8d45` is the candidate immutable admin and pool creator; supplied keeper candidate `0x23439a41eDC01D58d3Aaa0C75E9dFEE0C0196848` is a distinct EOA; deployment EOA is `0xAa8fDF2f96aFC037D50659CFd09fDF3Fac060bBf` (`optra-mainnet-deployer` keystore label). The Safe readback showed 3 owners/threshold 2, and the keeper/deployer are not among those owners; cross-project authorization and keeper operator/key custody are unconfirmed. Do not reuse the deployer as keeper.
- Safe candidate readback: SafeL2 v1.5.0 and no enabled modules at block 119433484; latest owner/threshold read at block 119556696 returned 3 owners/threshold 2. No Safe-creation transaction is needed for this supplied candidate; owner authorization for OPTRA use remains external.
- Pool initialization is a distinct Safe-to-PoolManager transaction after hook deployment. It must use a fresh approved price; it is not covered by the deploy-only script. Liquidity provisioning is separately funded and is not authorized here.
- This gate controls only spot swap direction in its own pool. It does not protect the existing ETH/USDG pool, execute CallPut options, or prove a sell closes an options position.

## Verified evidence

- Read-only RPC at block 119140085: chain ID 4663; USDG reports `Global Dollar` / `USDG`, 6 decimals, and 170 bytes of proxy runtime; deployer balance was 0.00042 ETH and nonce 0. Observed gas price was 20,482,000 wei. These are point-in-time observations, not an approved production RPC or a funding sufficiency result.
- Real-asset fork evidence: `docs/evidence/OPTRA_MAINNET_REAL_ASSET_FORK.md` (SHA-256 `e94de0cc0fb50d626be7b9e50abf468f489389040a30e67dddd7493f91184663`). Pinned block 119160725 passed (test gas 655,483); the final-source latest-head run also passed (test gas 655,359). USDG balance and test liquidity were state-overridden on the fork; no real assets moved.
- Unit test passed for native ETH as configured underlying: `test_nativeUnderlyingCurrencyCanBindToUsdQuotePool`.
- The fork test is not an independent audit, production liquidity evidence, Safe test, or deployment estimate.

## Exact batch readiness

No approval-eligible packet is available. A read-only candidate estimate exists at block 119537033 with estimated gas 1,676,133 and predicted CREATE2 candidate `0x98332827Ff79e07eCD1A63CC04462D3817622080`; read-only `eth_getCode` returned empty at block 119544065. This is not a deployed contract address or an approval hash. The strict preflight and deployment script remain broadcast-gated. Remaining inputs and external gates:

1. Confirm the supplied Safe's cross-project authorization and owner control for this exact OPTRA deployment; do not create another Safe by default. See `docs/MAINNET_SAFE_SETUP.md`.
2. Confirm keeper operator/key custody, incident response, and the approved keeper runbook; the supplied EOA candidate differs from the Safe and deployer.
3. Owner-approved production RPC provider, plus asset/jurisdiction and pool-route approval evidence.
4. Formal PM approval reference required by the strict preflight; engineering scope confirmation is not a transaction approval.
5. Independent audit of the final committed source/deployment scope, with report reference and SHA-256.
6. Owner-approved gas-unit and fee ceilings, refreshed on the approved provider, followed by a fresh deployer balance check.
7. Regenerate the exact packet after all gates pass, then obtain explicit approval of that packet's SHA-256 before any signing/broadcast.

The current candidate limit of 2,178,973 gas and illustrative fee cap of 40,036,000 wei (0.000087237363028 ETH worst-case) are engineering proposals only, not owner-approved limits. The deployer balance was 0.00042 ETH at block 119544065; this point-in-time observation does not approve a spending ceiling or replace a fresh balance check after packet approval.

## Proposed transaction sequence (not approved calldata)

1. Deploy `OptraGuardHook` via CREATE2 factory using the eventual verified Safe, keeper, native ETH/USDG configuration, and 300-second policy age. Pool stays unbound and paused after deployment.
2. Safe initializes the new ETH/USDG pool with fee 3000 / spacing 60 using the exact owner-reviewed current sqrt price.
3. A separately authorized liquidity provider funds the pool; no LP has been designated and no liquidity amount is proposed.
4. The verified keeper publishes policy only after monitoring, freshness, emergency-stop, and operator runbooks are active.

Each state-changing batch requires its own exact calldata, nonce, gas and fee caps, source hashes, and explicit approval. No Mainnet signing, broadcast, pool initialization, liquidity, or keeper policy publication is authorized by this readiness packet.

## Artifacts

- Contract and deployment tooling: `contracts/src/OptraGuardHook.sol`, `contracts/script/optra-mainnet-preflight.sh`, `contracts/script/optra-mainnet-deploy.sh`, `contracts/script/optra-mainnet-postflight.sh`.
- Fork test: `contracts/test/OptraRobinhoodRealAssetFork.t.sol`.
- Owner decisions and external dependencies: `docs/MAINNET_OWNER_DECISIONS.md`.
- Safe setup worksheet, including live v1.5.0 code-hash checks: `docs/MAINNET_SAFE_SETUP.md`.
- Deployment procedure: `docs/MAINNET_DEPLOYMENT_RUNBOOK.md`.
- Independent audit scope: `docs/INDEPENDENT_AUDIT_HANDOFF.md`.
