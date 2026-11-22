# OPTRA final approval sheet (2026-11-21)

**UPDATE 2026-11-22: packet `9b60e75f…97c1` was approved by the owner and broadcast. OptraGuardHook is deployed at `0x4089d38251fF25936d778C799d5d3AB5658c2080`, tx `0xdc17732c4568fb66735a7f240a586fbc8a4d513922b1c70d152e2b467a869fc0`, block 120,305,454, status 1. Pool initialization, liquidity, keeper funding/policy, options execution and Live Agent remain NOT approved. Record: `docs/evidence/p4/mainnet-deployment-record-20261122.md`. Section 0 below is the pre-deployment request, kept as history.**

## 0. Transaction authorization request: OptraGuardHook deployment (current)

The deployment-only risk-acceptance workflow is implemented (`docs/MAINNET_DEPLOYMENT_ONLY_RISK_ACCEPTANCE.md`, SHA-256 `a1d6d70a9f29f1073e26a94ac2351d7ee5dba2584621faf1666411a784ef20af`). Strict preflight passes with the audit, asset, jurisdiction and keeper-runbook gates recorded as WAIVED and all other gates enforced. The eligible packet passes the read-only `--verify` rehearsal of every broadcast check. Nothing has been signed or sent.

| Item | Value |
|---|---|
| Packet | `docs/evidence/p4/optra-mainnet-p4-approval-packet-20261121.json`, file SHA-256 `f54fa78beea424ae41bb486cd6602c79b5992561bb1fb3f628e113c2dc718c04` |
| **Packet approvalSha256** | `9b60e75fd06acd31894179d3488f92b4eb1ba9b468d1ac12148841a7a8ed97c1` |
| Chain | Robinhood Chain Mainnet, 4663 |
| Signer | `0xAa8fDF2f96aFC037D50659CFd09fDF3Fac060bBf`, keystore `optra-mainnet-deployer`, nonce 0 |
| Recipient | CREATE2 factory `0x4e59b44847b379578588920cA78FbF26c0B4956C` |
| ETH value | 0 |
| Calldata SHA-256 | `4db91a8dc4192a1daab51e163b89818c6ba392286579c3d789e0ad657c90442d` (8,625 bytes) |
| Predicted contract | `0x4089d38251fF25936d778C799d5d3AB5658c2080` (no code at block 119957360) |
| Gas limit / max fee / priority | 2,178,973 / 50,000,000 wei / 0 |
| Maximum network fee | 108,948,650,000,000 wei = 0.00010894865 ETH (balance 0.00042 ETH) |
| Binding | `contracts/` git tree `cf45caa14da5b7c896a0355a718eef899cedea0c`, hook source SHA-256 `03ead970…864e8`; any change under `contracts/` voids the packet, other commits do not |

Approving this packet hash is also your acceptance of the five risks in the risk-acceptance document: unaudited immutable code, Safe-owner consent not obtained (so the hook may never be usable), keeper without custody record, unverified explorer status, and possible fee loss. It is deployment-only. It does not authorize pool initialization, liquidity, keeper policy, or any CallPut or agent activity.

To approve, reply with: "Approve OptraGuardHook deployment packet 9b60e75f…97c1". Signing needs your keystore password, which engineering never handles, so you run one command after approving; I then run postflight and source verification:

```sh
cd "<repo>" && source docs/evidence/p4/p4-mainnet.env
export OPTRA_MAINNET_FINAL_APPROVAL_REF="<your approval record>"
export OPTRA_MAINNET_APPROVED_PACKET_SHA256=9b60e75fd06acd31894179d3488f92b4eb1ba9b468d1ac12148841a7a8ed97c1
export OPTRA_MAINNET_SIGNER_ACCOUNT=optra-mainnet-deployer
contracts/script/optra-mainnet-deploy.sh --broadcast docs/evidence/p4/optra-mainnet-p4-approval-packet-20261121.json
```

Read-only recheck before sending: `contracts/script/optra-mainnet-deploy.sh --verify docs/evidence/p4/optra-mainnet-p4-approval-packet-20261121.json` (same environment, no approval variables needed).

The sections below are the earlier history and still apply to pool initialization and operation.

Nothing here has been signed, broadcast, funded or activated. Production release `1a80527` (Railway deployment `181d2d17-fd7c-4898-9c89-33baf2beccb7`) is unchanged by this sheet.

## 1. P4 `OptraGuardHook` deployment: frozen candidate

Robinhood Chain Mainnet, chain ID 4663. One transaction: a CREATE2 deployment through the singleton factory. No pool initialization, liquidity, policy publication or options action.

| Field | Value |
|---|---|
| Signer | `0xAa8fDF2f96aFC037D50659CFd09fDF3Fac060bBf`, Foundry keystore label `optra-mainnet-deployer`, nonce 0 |
| To (CREATE2 factory) | `0x4e59b44847b379578588920cA78FbF26c0B4956C` (runtime SHA-256 pinned) |
| Value | 0 |
| Calldata | salt + init code, 8,625 bytes, full hex in the candidate file. SHA-256 `4db91a8dc4192a1daab51e163b89818c6ba392286579c3d789e0ad657c90442d` |
| CREATE2 salt (frozen) | `0xa45289a5ed60d937a2e68ac0ec57711cb57522aca6b4268c989a4cbb339dab5c` |
| Init-code hash | `0x57e4b5f8cb3a98d87f5ac598b6017b6cb442d13bc9b0fcea9671012311d97840` |
| Predicted hook address | `0x4089d38251fF25936d778C799d5d3AB5658c2080` (low bits `0x2080` = beforeInitialize + beforeSwap). No code there at block 119691942 |
| Constructor | PoolManager `0x8366a39CC670B4001A1121B8F6A443A643e40951`; underlying `0x0000000000000000000000000000000000000000` (native ETH); quote USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`; pool creator and admin Safe `0xf9C76ef996C5cbC73E4E23927D6EecB3295c8d45`; keeper `0x23439a41eDC01D58d3Aaa0C75E9dFEE0C0196848`; max policy age 300 s |
| Later pool parameters | fee 3000, tick spacing 60, initial sqrtPriceX96 `3185677305239360665288704` (to be refreshed from the live reference pool at the separately approved initialization) |
| Gas | estimate 1,676,133; limit 2,178,973 (130%) |
| Fees | max fee 50,000,000 wei, priority 0 (observed gas price 20,374,000 wei at freeze) |
| Fee ceiling | 108,948,650,000,000 wei = 0.00010894865 ETH. Expected cost at the estimate: 0.00008380665 ETH |
| Deployer balance | 0.00042 ETH, 3.9 times the ceiling. No top-up needed for this transaction |
| Source | `contracts/src/OptraGuardHook.sol` SHA-256 `03ead9705a22ecf8255ad4193705f99094dc82c929ecda9be8e43cc677e864e8`; `foundry.toml` SHA-256 `abf3a679c9566b4eb2ccca9cfc0632ce82ef53ebaa1f4ae5a9a2f7d29099121a`; Solc 0.8.26, optimizer runs 44444444, EVM cancun |
| Candidate manifest | `docs/evidence/p4/optra-mainnet-p4-frozen-candidate-owner-config-20261121.json` (supersedes the earlier candidate; same calldata). Canonical `candidateSha256` `06a7b744a85f613df197066f1e80ad3b8723ffffaad2d0090b101858ae1db2c3`; file SHA-256 `f47505906ee4fb82501692c15388f49a241fed65181832c26e52e1edbff9632b`; read at block 119716834 (gas price 20,004,000 wei, balance 0.00042 ETH, nonce 0, no code at the predicted address); built at commit `6b7c5a04577c2a32e555b0cdec6fa61dccace639`. It carries the evidence references below |
| Evidence | Real-asset fork test passed at block 119617866 (`docs/evidence/p4/real-asset-fork-block-119617866.log`, SHA-256 `bfd7cb6048e0ee9334da76fbefafbf48b1d7ace69927abd028e1f74070ceb8c3`; balances and liquidity were fork-only overrides). Gas report block 119617126 (`docs/evidence/p4/gas-report-block-119617126.json`, SHA-256 `26d0587f67c80d1831d5c32a0e776b86399685cdaa2f7265c7856ab3f0da6a84`). Foundry suite 34 passed, 5 fork tests skipped by design |

This candidate is `approvalEligible: false` and `--broadcast` refuses it. The estimate comes from the public RPC, excludes any chain-specific data fee that `eth_estimateGas` does not report, and the 130% limit is the margin for that.

### Independent verification commands (read-only)

```sh
python3 -c "import json,hashlib;o=json.load(open('docs/evidence/p4/optra-mainnet-p4-frozen-candidate-20261121.json'));c=o['candidate'];print(hashlib.sha256(json.dumps(c,sort_keys=True,separators=(',',':')).encode()).hexdigest()==o['candidateSha256'])"
cast create2 --deployer 0x4e59b44847b379578588920cA78FbF26c0B4956C --salt 0xa45289a5ed60d937a2e68ac0ec57711cb57522aca6b4268c989a4cbb339dab5c --init-code-hash 0x57e4b5f8cb3a98d87f5ac598b6017b6cb442d13bc9b0fcea9671012311d97840
cast code 0x4089d38251fF25936d778C799d5d3AB5658c2080 --rpc-url "$OPTRA_MAINNET_RPC_URL"
```

### Final packet and deployment (after section 2 is complete)

Set every `OPTRA_MAINNET_*` value from the candidate plus the section 2 references, set `OPTRA_MAINNET_CREATE2_SALT` to the frozen salt, gas limit 2178973, max fee 50000000, priority fee 0, ceiling 2178973 and 108948650000000. Then:

```sh
contracts/script/optra-mainnet-deploy.sh --prepare /secure/path/optra-mainnet-p4-packet.json
```

The packet pins the same calldata and address; only its hash and source commit change. Review it, compare its `approvalSha256`, and approve that exact hash. Any later commit requires a new `--prepare`. You then run, with your own keystore:

```sh
contracts/script/optra-mainnet-deploy.sh --broadcast /secure/path/optra-mainnet-p4-packet.json
contracts/script/optra-mainnet-postflight.sh /secure/path/optra-mainnet-p4-packet.json 0x<transaction-hash>
contracts/script/optra-mainnet-verify-source.sh --prepare 0x4089d38251fF25936d778C799d5d3AB5658c2080 /secure/path/optra-mainnet-verification
```

The deployment alone leaves the hook unbound and paused. Pool initialization (Safe to PoolManager, fresh price) and liquidity are separate batches with their own approvals. The hook gates swap direction in its own new ETH/USDG pool only; it does not protect the existing pool and does not execute CallPut options.

## 2. Evidence status for P4

Owner configuration decisions (2026-11-21) are recorded in `docs/evidence/p4/owner-configuration-decisions-20261121.md` (SHA-256 `aa24831c512d0ca37b1d6a4a679196e811604b3bc8b5a53e4fe4933712a2e57e`) and are now referenced by the provider, PM-scope, pool-route and Mainnet-acknowledgement fields. The record states plainly that it is not Safe-owner, issuer, legal or auditor authorization. Strict preflight now passes chain 4663, the PoolManager and factory fingerprints, USDG decimals 6, the Safe (3 owners, threshold 2) and the address guards, and stops on exactly these items:

| # | Environment name | What is missing | Who |
|---|---|---|---|
| 1 | `OPTRA_MAINNET_ASSET_APPROVAL_REF`, `OPTRA_MAINNET_JURISDICTION_APPROVAL_REF` | Third-party eligibility of USDG and the native ETH/USDG pool for the intended users: issuer or venue terms, and a legal/jurisdiction determination. Your pair selection is a configuration choice, not this evidence | Owner with legal/issuer |
| 2 | `OPTRA_MAINNET_KEEPER_RUNBOOK_REF` | `docs/KEEPER_CUSTODY_RUNBOOK.md` is drafted (roles, custody rules, 240 s heartbeat, funding estimate, alerts, rotation and revocation). It is not an approval record: you must complete its section 9 (operator, backup, custody method, allow/pause signal, alert destination, funding, revocation rehearsal) and approve it. The keeper EOA currently has balance 0 and nonce 0 | Owner |
| 3 | `OPTRA_MAINNET_AUDIT_REPORT_REF`, `OPTRA_MAINNET_AUDIT_REPORT_SHA256` | Independent audit of the final source and deployment scope. Internal review does not qualify | External auditor |

Outside the script, still required before you approve a packet: consent of the Safe's owners to act as OPTRA admin and pool creator (it was read on-chain; consent is not on record). Then `OPTRA_MAINNET_FINAL_APPROVAL_REF` and `OPTRA_MAINNET_APPROVED_PACKET_SHA256`: your approval of the exact packet hash.

No eligible approval packet exists, and I did not generate one with placeholder references, since that would produce a hash that looks approvable. `--prepare` writes it in one step once items 1 to 3 are supplied. Its calldata, salt, address and fee ceiling will be identical to the frozen candidate; its `approvalSha256` and source commit will differ because it adds the evidence references and the HEAD at that time. The fee ceiling, calldata and address can be reviewed and approved now as parameters; the hash cannot.

## 3. CallPut Mainnet order: fresh minimal packet

BuyPutSpread AAPL size 0.1 (raw `100000000000000000`, minimum fill raw `78000000000000000`), read at block 119692444 and saved at `docs/evidence/callput-order-packet-block-119692444.json` (SHA-256 `9b93ffd7c35a7a873a23268545292706ffc6bd82c0016694252c019f61cd28df`). Legs: long `AAPL-27NOV26-350-P`, short `AAPL-27NOV26-345-P`, expiry 1795798800. Feed marks are indicative; there is no executable venue quote.

| Step | To | Value | Amount / data | Gas estimate / ceiling |
|---|---|---|---|---|
| 1 USDG approve | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`, spender `0x0D240c1EbEeE7F74B40d6611326f5df98AB00e1B` | 0 | raw 288,260 recomputed at Prepare (0.288260 USDG), never above raw 1,000,000 | 41,248 / 53,622 |
| 2 open request | PositionManager `0x426a6b482893557E58cF38de635fEbB30Fd6a3C3`, selector `0x4fd5f4af` | 60,000,000,000,000 wei execution fee | `amountIn` raw 288,260 | 603,354 / 784,360 |

Worst case for gas plus execution fee is about 0.000077 ETH, plus at most 1 USDG. The sizing above was computed for the deployer address as a placeholder. The trading signer has not been designated, so it is not a real packet until you name the signer and I rerun `bun run scripts/callput-robinhood-approval-packet.ts <signer> AAPL 0.1`. The legs are valid only while at least 3 days remain to expiry (until about 24 Nov 2026); after that, rerun the script.

Missing for this order: (a) the signer address, with at least 0.30 USDG and 0.0001 ETH; (b) your approval message naming the exact transactions (template in `docs/CallPut-Robinhood-Mainnet-Approval-Packet.md` section 5); (c) a local live-signing build from the final release commit. Production stays "Preview only" and cannot sign.

### Wallet acceptance (MetaMask / Phantom): not done

No MetaMask or Phantom extension exists in any browser profile on this machine (checked Chrome and Chromium profile extension folders), so real-extension acceptance cannot run here, and I did not substitute a mock. A mock provider only proves wiring. What you do, in your own browser with your own wallet, without any financial submission: open `https://opetra-production.up.railway.app/tape`, connect, confirm chain 4663, sign OPTRA's login message only (a message signature, not a transaction), and confirm the Order panel reads "Preview only" with no send button. To also check the wallet prompt itself, run the local signing build, press Prepare, and press Reject in the wallet at the first prompt. Nothing is sent on reject. Report the wallet, version, and a screenshot of the Preview chip and of the rejected prompt.

## 4. Live Agent

Implemented and tested: durable stop, owner grants, single-flight lease, idempotent request ledger, reconciliation and halt, hard caps, cross-owner isolation (`lib/venue/callput-live-agent-store.ts`, migration `0006`, 15 integration tests). Autonomous execution remains disabled: nothing imports the store, no submission path exists, and every authorization fails closed unless `LIVE_TRADING_ENABLED` is exactly `true`. Missing evidence, all external, and required before a grant can become active:

1. CallPut's written confirmation of the delegation/session terms for OPTRA's agent. The MCP shows an Account workflow exists; no grant to OPTRA exists.
2. The owner's trading address and the route (direct wallet or CallPut Account), with the owner-signed on-chain grant reference.
3. An independent audit of the account/session contracts in use.
4. Your approval of the exact policy (assets, collateral caps, expiry).
5. A rehearsed revocation.

## 5. Release status

Production `1a80527` is deployed and verified (health 200, `liveTradingEnabled: false`, `v4ClaimLevel: L0`, Tape "Preview only"). The commits since then (deploy-script `--freeze` mode and salt pinning, Live Agent store with migration 0006, evidence and docs) are not yet on main. Migration 0006 adds four tables and changes no existing data. It must pass CI on the exact SHA before main is pushed.
