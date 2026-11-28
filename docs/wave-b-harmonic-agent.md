# Wave B Handoff — Harmonic Agent Verification (T13–T25)

## 1. Wave A Status (Completed & Verified)

Wave A (**x402 Economic Autonomy**, T1–T12) is implemented on branch `feat/x402-economic-autonomy` and verified:

- **Database Schema & Migration**: `db/schema.ts` + `drizzle/0009_calm_thing.sql` (`economicGlobalControls`, `serviceProviders`, `agentEconomicAccounts`, `agentEconomicBudgetEvents`, `x402PaymentRecords`, `x402TapeEvents`).
- **Core Economic Runtime**: `lib/economics/` (`atomic.ts`, `types.ts`, `policy-engine.ts`, `resource-validator.ts`, `provider-registry.ts`, `x402-signer.ts`, `x402-client.ts`, `drizzle-repository.ts`, `acquire-volatility-resource.ts`).
- **Strategy Integration**: `paidVolatilityResource` wired into `lib/engine/run-tick.ts`, `lib/engine/strategy/run-strategy-tick.ts`, `lib/paper/handlers.ts`, `lib/paper/scheduler.ts`, and `lib/paper/runtime.ts`.
- **x402 Volatility Oracle**: `app/api/x402/providers/volatility/route.ts` (`optra.volatility.v1`).
- **Economics APIs & UI**: `/api/agents/[agentId]/economics`, `/api/house/[agentId]/economics`, `/api/economics/global`, `components/app/economics/AgentEconomicsSection.tsx`, Forge Economic Mandate, and Decision Tape provenance.
- **Mainnet Pilot Evidence (Local Pilot DB)**:
  - Network: Robinhood Chain Mainnet (`eip155:4663`), Asset: `USDG` (`0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`), Facilitator: Aeron (`https://x402.aeron.sh`)
  - Tx: `0x785be0819076ce0f238157be3c273ee114c61187230207f297ffca958b32325f`
  - Payment Record: `e26f479d-1132-4a91-9f94-da780f49b992` (`RECONCILED`, `ONCHAIN_SETTLED`, `VALIDATED`)
  - Pilot Agent: `55ce0382-8e19-44ea-8024-23f19f877bdf` (local PGlite `.local/pilot-db/`)
  - `LIVE_TRADING_ENABLED=false`, `X402_FACILITATOR_MODE=paper` by default.

## 2. Wave B Scope (T13–T25 — Harmonic Agent Verification)

Refer to `docs/update/brief.md` for full requirements and acceptance criteria:

- **T13–T15**: Harmonic Agent registry binding (`https://harmonicagent.solutions/mcp/registry` & HTTP `/api/registry/{agents,file,seal,reveal}`), agent identity & `HarmonicExpectation` schema.
- **T16–T18**: Commitment/seal before execution & reveal after execution, correlated with `decisionId`.
- **T19–T21**: `VerificationPolicy` & `OptraGrade` deterministic scoring/grading of agent decisions against sealed expectations.
- **T22–T24**: Decision Tape verification events (`HARMONIC_SEALED`, `HARMONIC_REVEALED`, `VERIFICATION_GRADED`, etc.) and UI Verification tab on Agent & House Agent detail screens.
- **T25**: End-to-end verification tests (PGlite) + targeted checks + Wave B demo & recording evidence.

## 3. Reusable Patterns from Wave A

- **Paid/External Service Adapter Pattern**: Follow `lib/economics/x402-client.ts` and `lib/economics/acquire-volatility-resource.ts` for idempotent request/response tracking, timeout/failure handling, and correlated `decisionId` Tape events.
- **Drizzle Repository Pattern**: Follow `lib/economics/drizzle-repository.ts` for transactional persistence without nested-transaction deadlocks in PGlite tests.
- **UI Tab Pattern**: `components/app/agents/AgentDetailScreen.tsx` and `components/app/agents/HouseAgentDetail.tsx` already demonstrate adding domain-specific tabs/sections.
