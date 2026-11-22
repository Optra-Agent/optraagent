# OptraGuardHook Mainnet deployment record (2026-11-22)

Status: DEPLOYED, UNAUDITED, UNINITIALIZED. Deployment-only. No pool was initialized, no liquidity or collateral moved, no keeper policy published, no options order or Live Agent activated.

## Transaction

| Item | Value |
|---|---|
| Network | Robinhood Chain Mainnet, chain id 4663 |
| Transaction | `0xdc17732c4568fb66735a7f240a586fbc8a4d513922b1c70d152e2b467a869fc0` |
| Receipt status | 1 (success) |
| Block | 120,305,454 |
| From | `0xAa8fDF2f96aFC037D50659CFd09fDF3Fac060bBf` (deployer, nonce 0 -> 1) |
| To | CREATE2 singleton factory `0x4e59b44847b379578588920cA78FbF26c0B4956C` |
| Gas used / limit | 1,647,644 / 2,178,973 (estimate was 1,676,133) |
| Effective gas price | 20,012,000 wei |
| Network fee paid | 32,972,651,728,000 wei = 0.0000329727 ETH (ceiling 0.00010894865 ETH) |
| Deployer balance | 0.00042 ETH -> 0.000387027348272 ETH (difference equals the fee) |
| Approved packet | `9b60e75fd06acd31894179d3488f92b4eb1ba9b468d1ac12148841a7a8ed97c1` |

Postflight (`contracts/script/optra-mainnet-postflight.sh`): PASS on receipt status, sender, destination, nonce, calldata/value equal to the approved packet, and every constructor readback below.

## Contract

| Item | Value |
|---|---|
| OptraGuardHook | `0x4089d38251fF25936d778C799d5d3AB5658c2080` (equals the packet's predicted CREATE2 address; low bits `0x2080` = beforeInitialize + beforeSwap) |
| Runtime size | 7,085 bytes (equals the gas-report runtime size) |
| Runtime keccak256 | `0x152fcfec4be8caaca32ea621c32b9aafc7bad7d803293e4e0a9321fe58fdc6d7` |
| Runtime SHA-256 | `86e1828b23fc82d70ed7df0c97992f9851063cccc93e8cb72212bf51b6b8693c` |
| Local comparison | `forge inspect ... deployedBytecode` is the same length; the only differing bytes (374, in 31 32-byte windows) are all zero in the local build, i.e. the constructor-set immutables |

Constructor state read back from the live contract: poolManager `0x8366a39CC670B4001A1121B8F6A443A643e40951`; underlyingToken `0x0000000000000000000000000000000000000000` (native ETH); quoteToken USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`; poolCreator and admin Safe `0xf9C76ef996C5cbC73E4E23927D6EecB3295c8d45`; keeper `0x23439a41eDC01D58d3Aaa0C75E9dFEE0C0196848`; maxPolicyAge 300 s. All equal the packet.

## Source verification

| Verifier | Result |
|---|---|
| Sourcify (chain 4663) | `match` for runtime and creation (not `exact_match`), verified 2026-11-22T02:10:50Z, matchId 59692565 |
| Robinhood Blockscout | `is_verified: true`, `is_fully_verified: false` (partial match), contract name OptraGuardHook, compiler v0.8.26+commit.8a97fa7a, optimizer runs 44444444, verified_at 2026-11-22T02:11:10Z. Submitted through a browser session because the explorer API is Cloudflare-challenged for curl. |
| Input | standard-json-input SHA-256 `b3da2973abbc938ae9c5f7f81a869c081e512fdb1bc2bc6eaf32d4d0678aa3c0` (equal to the owner-reviewed artifact) |

"Verified source" is not an audit, and the match grade is partial (not exact) on both services.

### Why the match is partial and why it cannot be upgraded without redeploying

Investigated 2026-11-22; no deployed code was changed.

- Compiler and settings reproduce the deployment: solc 0.8.26+commit.8a97fa7a, optimizer on with 44,444,444 runs, `viaIR` true, EVM cancun, no libraries, remappings from `foundry.toml`. A local `forge inspect ... deployedBytecode` is the same length as the on-chain code and differs only inside the constructor-set immutable slots (all zero locally). Sourcify reports both `creationMatch` and `runtimeMatch` as `match`, which compares the creation bytecode including the constructor arguments.
- The deployed runtime ends in the CBOR block `a164736f6c634300081a` (10 bytes): the solc version only. `foundry.toml` sets `bytecode_hash = "none"`, so there is no IPFS or bzzr metadata hash in the bytecode.
- Sourcify's exact (perfect) match and Blockscout's `is_fully_verified` both require the metadata hash embedded in the bytecode to equal the hash of the compiler's metadata file (their documented definition of a perfect match; I did not test alternative submissions). With no embedded hash that comparison cannot succeed for any submitted input, so partial is the highest grade this deployment can reach.
- The only way to obtain an exact or full match is to rebuild with a metadata hash and deploy new bytecode at a new address. That is a different deployment and was not done for a label.

Status stays: verified source, partial match, on both services. Not exact, not fully verified, not an audit.

## Evidence files (SHA-256)

- `deployment-receipt-20261122.json` `5ecc079d0390c19c61e9c1e5f737b15fb62b52a50e9abb847405125066d181c8`
- `deployment-postflight-20261122.txt` `a78f328a2e7ffcb4cd6b4d50c66cedc23f7e74f402de6631d9eec2e2a8bc443d`
- `deployment-sourcify-20261122.json` `e2ae10601db4e86d0dc9f9d6f72a300b7cbc7b97b9653aa9134bc99da74a9fe3`
- `deployment-constructor-args-20261122.hex` `78f9949bf9c7b5ea5b29c4f485bb36e88dc99bf7046d973929a3e3a31b8eda57`

## Still open (each needs its own approval)

Independent audit; consent of the three Safe owners (the Safe is immutable admin and pool creator, so the hook cannot be initialized without them); keeper custody record; pool initialization and initial price; funding the keeper; keeper policy publication; any options execution or Live Agent. The product claim level stays L0.
