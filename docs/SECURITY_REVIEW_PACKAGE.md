# OPTRA — External Security Review Package

- **Production Website:** https://optraagent.cc
- **Public GitHub Repository:** https://github.com/Optra-Agent/optraagent
- **Primary Network:** Robinhood Chain Mainnet (`4663`)
- **Explorer:** https://robinhoodchain.blockscout.com
- **Live Trading Switch:** `LIVE_TRADING_ENABLED=false` (paper & wallet-signed manual CallPut only)

---

## 1. Mainnet Contract Directory

See [contracts/README.md](../contracts/README.md) and [lib/chain/mainnet-contracts.ts](../lib/chain/mainnet-contracts.ts) for the complete Mainnet contract directory, Blockscout links, EIP-1967 implementations, and bytecode/verification status.

- **OPTRA-Owned:** `OptraGuardHook` (`0x4089d38251fF25936d778C799d5d3AB5658c2080`, deployed in tx `0xdc17732c4568fb66735a7f240a586fbc8a4d513922b1c70d152e2b467a869fc0`, unaudited, uninitialized, holds no funds).
- **External CallPut Venue & Tokens:** `OptionsMarket`, `PositionManager`, `Controller`, `SettleManager`, `OptionsAuthority`, `TradingAccountFactory`, `USDG` (`0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`), `PoolManager` (`0x8366a39CC670B4001A1121B8F6A443A643e40951`).

---

## 2. Architecture & Implementation Paths

- **Smart Contracts:** `contracts/src/` (`OptraGuardHook.sol`), `contracts/test/`
- **x402 Economic Autonomy:**
  - Core runtime: `lib/economics/` (`policy-engine.ts`, `x402-client.ts`, `x402-signer.ts`, `provider-registry.ts`, `drizzle-repository.ts`, `acquire-volatility-resource.ts`)
  - Paid Volatility Oracle: `app/api/x402/providers/volatility/route.ts`
- **Harmonic Agent Verification:**
  - MCP Connector & Service: `lib/harmonic/` (`client.ts`, `crypto.ts`, `repository.ts`, `service.ts`, `kernels.ts`, `runtime-hook.ts`)
  - APIs: `app/api/agents/[agentId]/harmonic/route.ts`, `app/api/house/[agentId]/harmonic/route.ts`
- **Database Schema & Migrations:** `db/schema.ts`, `drizzle/0009_calm_thing.sql`, `drizzle/0010_silent_madripoor.sql`

---

## 3. Trust Boundaries & Security Controls

1. **Capital Isolation:** `Trading Capital` cannot fund machine-service payments (`allowTradingCapitalForServices = false`).
2. **Deterministic Policy Engine:** AI/LLM layers cannot modify budgets, per-request caps, provider allowlists, or risk limits.
3. **Replay & Duplicate-Charge Protection:** Unique `(agentId, idempotencyKey)` and `(agentId, requestNonce)` constraints in `x402_payment_records`.
4. **Credential Protection:** Harmonic `ag_...` secrets and sealed commitment salts are encrypted at rest with AES-256-GCM and never exposed to LLMs or client responses.
5. **Verifier Provenance:** Local deterministic invariant checks (`P1`, `P5`, `P6`, `P7`) are labeled `verifier=LOCAL_KERNEL`; `ARISTOTLE` is only recorded when an external `verify_request` verdict is returned.

---

## 4. Genuine Transaction & Runtime Evidence

- **x402 Mainnet Pilot Settlement (Protective Put):** `0.02 USDG` via Aeron facilitator (`https://x402.aeron.sh`) on Robinhood Chain Mainnet (`eip155:4663`) — [Blockscout Tx 0x785be081...2325f](https://robinhoodchain.blockscout.com/tx/0x785be0819076ce0f238157be3c273ee114c61187230207f297ffca958b32325f) (recorded in local pilot DB `.local/pilot-db/`).
- **Covered Call Historical Paper Replay:** Separate point-in-time paper execution (`scripts/demo-pilot-strategy-tick.ts`) with persisted economic authorization, resource validation, `OPEN` decision, filled paper order, and Decision Tape correlation.
- **Harmonic Registry:** Live registration of `OPTRA Pilot V3` on `https://harmonicagent.solutions/mcp/registry`.

---

## 5. Reproducible Testing

```sh
# Foundry contract tests
cd contracts && forge test

# TypeScript, unit tests, and production build
npm run typecheck
npx vitest run tests/harmonic/harmonic.test.ts
npm run build
```

---

## 6. Known Limitations & Review Scope

- `OptraGuardHook` is unaudited, uninitialized, and not part of options execution.
- `LIVE_TRADING_ENABLED=false` and `liveSettlementEnabled=false` in production.
- No formal third-party audit has been completed yet; this package is prepared for that review.
