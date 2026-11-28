# OPTRA Mainnet Contract & Integration Directory

**Primary Production Network:** Robinhood Chain Mainnet (Chain ID: `4663`)  
**Explorer:** https://robinhoodchain.blockscout.com  
**Historical Testnet Archive:** See [TESTNET_ARCHIVE.md](./TESTNET_ARCHIVE.md) for historical Robinhood Chain Testnet (`46630`) deployment scripts and instructions.

---

## 1. OPTRA-Owned Contracts (Robinhood Chain Mainnet — 4663)

| Contract | Purpose | Mainnet Address | Blockscout | Deployment Tx | Bytecode & Verification Status | Integration Scope |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **OptraGuardHook** | Experimental Uniswap v4 `beforeInitialize` + `beforeSwap` spot-swap guard (`0x2080`) | `0x4089d38251fF25936d778C799d5d3AB5658c2080` | [Address](https://robinhoodchain.blockscout.com/address/0x4089d38251fF25936d778C799d5d3AB5658c2080) | [0xdc1773...869fc0](https://robinhoodchain.blockscout.com/tx/0xdc17732c4568fb66735a7f240a586fbc8a4d513922b1c70d152e2b467a869fc0) (Block `120,305,454`) | `7,085` bytes (`0x152fcfec4be8caaca32ea621c32b9aafc7bad7d803293e4e0a9321fe58fdc6d7`). Partial match on Blockscout & Sourcify (`bytecode_hash = none`). **Unaudited.** | Deployed, uninitialized, holds no funds, no pool bound, not used in options execution. |

---

## 2. External Infrastructure & Venue Contracts (Robinhood Chain Mainnet — 4663)

> **Ownership Notice:** OPTRA does **not** own, operate, audit, or control any external venue or token contract listed below.

| Contract | Purpose | Mainnet Address | EIP-1967 Implementation | Blockscout |
| :--- | :--- | :--- | :--- | :--- |
| **CallPut OptionsMarket** | Option listings and market state | `0x3271d35afAc70C0D4989F984Abb2d918bf672C7e` | `0xBa75b452131613ABfAc9689342D2a3688c95fC7D` | [Address](https://robinhoodchain.blockscout.com/address/0x3271d35afAc70C0D4989F984Abb2d918bf672C7e) |
| **CallPut PositionManager** | Open/close requests, execution fee, keeper queue | `0x426a6b482893557E58cF38de635fEbB30Fd6a3C3` | `0x642126B59D79C097bE67745d97399b90Aa2e0d46` | [Address](https://robinhoodchain.blockscout.com/address/0x426a6b482893557E58cF38de635fEbB30Fd6a3C3) |
| **CallPut Controller** | USDG approval spender and order router | `0x0D240c1EbEeE7F74B40d6611326f5df98AB00e1B` | `0xd13176DBf89b1AdC43fcede4642336103a16E003` | [Address](https://robinhoodchain.blockscout.com/address/0x0D240c1EbEeE7F74B40d6611326f5df98AB00e1B) |
| **CallPut SettleManager** | Expiry settlement | `0xd328D581f3Fb1Ca86D28D573bA1f17409e5112EF` | `0x81de0057Bc0E0dA66011e42DD58aaD3b0858c444` | [Address](https://robinhoodchain.blockscout.com/address/0xd328D581f3Fb1Ca86D28D573bA1f17409e5112EF) |
| **CallPut OptionsAuthority** | Venue access control | `0x85e00a193d5E340339484336dd9EA09f942A0b7B` | `0x4175CA920Bf9935376Ab45Cd96E60C9348E8f093` | [Address](https://robinhoodchain.blockscout.com/address/0x85e00a193d5E340339484336dd9EA09f942A0b7B) |
| **CallPut TradingAccountFactory** | Venue factory for CallPut Accounts and sessions | `0x23DB9f5fDde30853EC8eBd75E0492c09505a6D1d` | `0x828eFE90b0E48cCEd8a3F7FA9b75EC5dBE19C9ee` | [Address](https://robinhoodchain.blockscout.com/address/0x23DB9f5fDde30853EC8eBd75E0492c09505a6D1d) |
| **USDG Collateral Token** | Settlement & collateral asset | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` | N/A | [Address](https://robinhoodchain.blockscout.com/address/0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168) |
| **Uniswap v4 PoolManager** | Spot pool manager (bound by `OptraGuardHook`) | `0x8366a39CC670B4001A1121B8F6A443A643e40951` | N/A | [Address](https://robinhoodchain.blockscout.com/address/0x8366a39CC670B4001A1121B8F6A443A643e40951) |

---

## 3. Reproducible Verification & Local Testing

```sh
cd contracts
forge test
```

> **Safety Notice:** Do not run deployment scripts against Mainnet without explicit Safe multisig (`0xf9C76ef996C5cbC73E4E23927D6EecB3295c8d45`) authorization. Production `LIVE_TRADING_ENABLED` remains `false`.
