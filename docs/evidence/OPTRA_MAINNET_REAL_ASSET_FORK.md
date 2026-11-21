# OPTRA Mainnet Real-Asset Fork Simulation

Status: PASS — fork-only, no Mainnet transaction submitted.

- Run date: 2026-11-20 (UTC+07:00)
- Network: Robinhood Chain Mainnet fork, chain ID 4663
- Pinned fork block: 119160725
- Command, from `contracts/`:
  `RUN_OPTRA_ROBINHOOD_REAL_ASSET_FORK=true forge test --fork-url https://rpc.mainnet.chain.robinhood.com --fork-block-number 119160725 --match-path test/OptraRobinhoodRealAssetFork.t.sol -vv`
- Pinned result: 1 passed, 0 failed, 0 skipped at block 119160725; test gas 655,483; wall time 69.18 seconds. After the final comment-only source clarification, the same test also passed against the RPC's latest head (1 passed, 0 failed, 0 skipped; test gas 655,359). Foundry did not print that latest-head block number.
- Test: initializes a new ETH/USDG hook pool using the live reference price; seeds liquidity on the local fork; verifies policy-gated ETH buy behavior and ETH-out behavior while policy is missing or paused.
- Final source SHA-256 (latest-head run): `contracts/src/OptraGuardHook.sol` `03ead9705a22ecf8255ad4193705f99094dc82c929ecda9be8e43cc677e864e8`; `contracts/test/OptraRobinhoodRealAssetFork.t.sol` `72bc5a98ff98c9943c2a8c7d8d0c2012c61644e49bcfc7d58f79d20df32bfc3e`. The only source edit between the pinned and latest-head fork passes corrected an obsolete comment; no executable code changed.
- Mainnet contracts read by the test: PoolManager `0x8366a39CC670B4001A1121B8F6A443A643e40951`; USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`.
- Verified reference pool ID: `0xa791e5169faf703c0b63fd9552c33ec1128a773a00f5dc33a640da62a022cd35`.
- At block 119160725, `getSlot0` returned sqrt price `3238620707560349683414145`, tick `-202109`; `getLiquidity` returned `339343707177073276`.
- The reference pool's `Initialize` log was read from Mainnet at block 101281159, transaction `0x035292897c4c0d8e2286efbb511b1cde4e58959c78cc4226b3d8e9b70171fe8f`. It confirms native ETH/USDG, dynamic fee `0x800000`, spacing `1`, and hook `0x987e330f00b79864a07fe81dfac344d0078abcc`. This is a reference pool, not the proposed OPTRA pool.
- Fork test setup overrides USDG balance and new-pool liquidity locally. They do not establish production funding/liquidity and no real assets moved.
- Scope limits: this is not a Safe ownership/threshold test, production deployment simulation, final deployment gas estimate, source-verification result, legal/asset approval, venue permission, or independent audit.

The production candidate remains a separate hook-specific native ETH/USDG pool with static fee 3000, tick spacing 60, and maximum policy age 300 seconds. Refresh the reference sqrt price at the separately approved deployment-preparation stage; this snapshot must not be reused as a current pool-initialization price.

## Latest refresh — 2026-11-21

- Pinned fork block: 119617306.
- Command, from `contracts/`: `RUN_OPTRA_ROBINHOOD_REAL_ASSET_FORK=true forge test --match-path test/OptraRobinhoodRealAssetFork.t.sol --fork-url https://rpc.mainnet.chain.robinhood.com --fork-block-number 119617306 -vvv`.
- Result: 1 passed, 0 failed, 0 skipped; test gas 655,487.
- Local log: `contracts/.local/optra-mainnet-real-asset-fork-119617306-20261121.log`; SHA-256 `bfa12968b91acf5e8c4a0c3890852e0b230c8ae866543b76e76905559732df23`.
- The test used the live Mainnet PoolManager/USDG and live ETH/USDG reference-pool state. Test balances and candidate-pool liquidity were fork-only overrides; no transaction or real-asset movement occurred.
- This refresh does not establish Safe authorization, approved RPC-provider status, production liquidity, legal eligibility, explorer source verification, or an independent audit.
