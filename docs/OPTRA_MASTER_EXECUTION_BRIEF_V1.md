# OPTRA AGENT — MASTER EXECUTION BRIEF v1.0

**Date:** 2026-11-12 (Asia/Jakarta)  
**Status:** Engineering proposal for Caesar approval; NOT a production authorization  
**Primary source:** `optra-agent-dev-brief.md` supplied 2026-11-11 (25 sections, FORGE draft)  
**Ownership:** Caesar = product approval; Engineering Lead = decision register/integration; Logic Engineer (Codex) = core/API/data; UI Engineer (Claude) = landing and UI within agreed contracts.  
**Highest priority:** Real, testable paper-trading logic; a visually convincing nonfunctional mockup is insufficient.

## A. Product lock

**What:** Optra Agent is an agent-first, rules-driven platform for synthetic stock-price options on Robinhood Chain. Users choose an Optra House Agent or build a Custom Agent through an editable 36-hook recipe, run an honest historical simulation, launch it in virtual-money paper mode, and inspect each decision on an append-only Optra Tape. Manual trading and guarded live execution are later layers; they share risk and portfolio data without giving agents control of manual positions.

**Value in 15 seconds:** The first viewport must answer WHO (AI options agents), WHAT (calls/puts on stock-price underlyings on Robinhood Chain), HOW (configurable hooks + backtest + paper + auditable decision Tape), and NEXT (Launch an agent). An AI model can compose and veto entries; deterministic rules make trading decisions. No guaranteed returns.

**Tech:** Next.js App Router, React, TypeScript strict, Tailwind, `viem`/`wagmi` for EVM, PostgreSQL, deterministic TypeScript engine, background job worker/scheduler, Zod schemas and typed client/API contracts; testing via unit/integration/e2e. Reuse proven patterns in the existing repository; do not replace its package manager, ORM or auth stack without evidence. Robinhood mainnet `4663`, testnet `46630`.

**Mandatory product truths:**
- PAPER and LIVE must be conspicuously separated in UI and data model; never infer production capability from a configured contract address.
- Synthetic stock-price options, Robinhood stock tokens and actual shares are different products.
- 36 product-level hooks are *not* 36 onchain Uniswap hook contracts. Default claim level L0 until real pool/hook deployment evidence supports L1.
- Initial automated actions are paper-only. Live trading cannot be enabled until venue, custody, geo/legal, audit/security and owner approval gates are met.
- House Agent metrics and internal test calls must never be presented as community adoption.

## B. Research findings / source-of-truth links

1. Robinhood network chain IDs and RPC: https://docs.robinhood.com/chain/connecting/ .
2. Robinhood stock tokens: `uiMultiplier()` under ERC-8056; stock-token oracle prices are multiplier adjusted, whereas Robinhood REST `/prices` gives underlying prices: https://docs.robinhood.com/chain/stock-tokens/ and https://docs.robinhood.com/chain/stock-token-apis/ . Do not hardcode an untested share/token conversion; reconcile price units and historical adjustments.
3. Robinhood canonical token allowlist: https://docs.robinhood.com/chain/contracts/ . USDG address is documented as `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`, 6 decimals, but confirm onchain at use time.
4. CallPut supports Robinhood Chain 4663 and synthetic stock/ETF options; open/close requests are async. Track canonical `requestKey`, `Pending/Executed/Cancelled` and ERC-1155 balances rather than tx hash alone: https://docs.callput.app/ , https://docs.callput.app/developers/integration-guide , https://docs.callput.app/developers/request-lifecycle-reference . Write/sell-to-open, cover enforcement, ToS for agents and proven live fills remain OPEN until verified.
5. Zeno documentation states options are **buy-only**, cash-settled European options, with signed opening/closing quotes, early close and a shared vault, subject to liquidity/oracle/operator risks. Therefore it is *not* a live venue for Covered Call or Cash-Secured Put: https://zenomarkets.tech/docs . Check current deployments, permissions and API before building a live adapter.
6. Uniswap v4 pool hooks only apply to pools created with those hooks, not third-party options venue transactions: https://developers.uniswap.org/docs/protocols/v4/concepts/hooks . Validate liquidity, router, swap direction, policy constraints and audit before any production claims.
7. x402 current protocol version is v2, using CAIP-2 network identifiers and `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE` and `PAYMENT-RESPONSE` in HTTP transport. The PM brief's `x402Version:1` response and `maxAmountRequired` are illustrative legacy details, not the final wire contract: https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md and https://docs.x402.org/ . Only build after actual USDG support/facilitator feasibility and replay semantics are verified.
8. Zolva visual reference was supplied via screenshot and an external research path in the PM brief. Its public site did not yield a reliable direct inspection in this research session. Do not treat unverified claims about its internals, agents, adoption or code as established facts. Design should be distinctive, not a clone.

## C. Feature inventory, target order and acceptance

| Order | Feature | Phase | Proof required |
|---|---|---|---|
| 01 | Markets, token allowlist, feed adapter, quote snapshots, data provenance | P0/P1 | Canonical source, units, timestamp, stale-data handling, underlying availability shown |
| 02 | 36-hook registry + typed recipe schema + validator | P1 | Correct 10/7/4/7/3/5 catalog; defaults/ranges/side restrictions; 30 validator fixtures |
| 03 | One deterministic `runTick` engine + global safety breakers | P1 | Same trace for identical recipe/snapshot in paper/backtest; missing data cannot open |
| 04 | Paper execution, positions, orders, cash/holdings ledger | P1 | Open/close/settle/reconcile with no real-money side effects; idempotent |
| 05 | Optra Tape and immutable recipe versions | P1 | One trace per agent/tick, append-only, correct `PAPER` / model labels |
| 06 | Lab 30-day hourly backtest and benchmarks | P1 | No look-ahead; all price/IV/premium assumptions labeled; wins and losses visible |
| 07 | House Agents (4) and Custom Agent lifecycle | P1 | First vertical slice works, then all four paper templates with evidence |
| 08 | Forge manual builder, optionally AI prompt-to-recipe | P1 | AI output validated, editable; cannot launch without same-hash backtest |
| 09 | Public API + Verify + marketing landing | P1 | Live data from app DB; claim-to-proof mapping; 15-second understanding test |
| 10 | The Listing + paper follow | P2 | Follow makes a separate recipe copy, no pooled user funds; stats honest |
| 11 | MCP read/simulation layer | P2 | `tools/list`, schema tests, no live-order tool |
| 12 | x402 paid API | P2 | v2 wire contract, paid settlement receipt, replay prevention; internal/external stats |
| 13 | Sessions with DST/calendar support | P1/P2 | Accurate session gating, timezone-safe display; no hardcoded WITA |
| 14 | Paper Floor + Manual/Agent combined Book | P3 | User/manual/agent controller separation, exposure aggregation |
| 15 | Risk Desk, takeover, global pause, revoke | P3/P4 | Ownership and exit safety; transition tests |
| 16 | Venue live adapter, custody, caps, onchain v4 guard | P4 gated | Complete V1–V12 evidence, chain/account safeguards, security review, owner authorization |
| 17 | Own options AMM/vault | P5 research | No v1 commitment or invented liquidity |

**Recommended vertical slice:** Market feed (start NVDA or another currently supported underlying) → one *buy-only compatible* paper House Agent such as Protective Put (with explicitly simulated holdings and contract-size checks) → real `runTick` → paper position/ledger → Tape → backtest → Forge → `/agents` UI. Then add Covered Call and Cash-Secured Put **paper-only** with clearly labeled modeled short-premium assumptions unless compatible write-side venue prices exist. Earnings Straddle follows after multi-leg rules are verified. P1 is not finished until all four House Agents and 36 hooks meet PM acceptance criteria; it is implemented incrementally, not all at once.

## D. Contradictions and specification amendments pending signoff

1. `Capra.maxPctPerPosition` is specified 1–50%, but Covered Call template uses 100%: adjust cap semantics or template; do not silently accept an out-of-range recipe.
2. Protective Put uses `Coverix` as a *coverage counter* although `Coverix` is described as a *covered-call writing lock*. Split covered-collateral reservation from insured-holding sizing or explicitly add type-aware semantics.
3. Protective Put Gate says `Calmo OR monthly schedule`, while generic Gate is AND except at most one OR group. Provide an explicit group schema and schedule condition.
4. Cash-Secured Put `Rescu` describes roll-out-and-down, while `Rescu` generic hook is specified for short calls with roll to higher strike. Define direction-aware put/call rules.
5. Earnings Straddle requires first expiry after earnings. `Tenora` current schema only describes daily/weekly/monthly target DTE. Add an explicit earnings-aware expiry selector/input.
6. Venue option-chain capabilities must be evaluated per market, per strategy, per operation (buy/write, early close, multi-leg, settlement), not one global venue flag.
7. Do not infer historical option premiums from spot price data. Modeled BS premiums and underlying benchmark are separate provenance classes; do not call them historical fills.
8. A user's stock-token position does not necessarily cover an **independent cash-settled option venue's** short position. A logical token lock is not enforceable venue collateral. Cover claims must be mapped to real collateral rights, wallet/account mechanics, and liquidation/settlement behavior.
9. PM asks an exit to never be blocked by Gate/AI, but a venue can fail or pause early closing. Implement nonblocking *internal policy*, durable retry + alert + reconciliation for actual venue failures. Do not promise guaranteed exits.
10. Order state machine must represent venue-specific request keys, eventual fills, partial fills where supported, cancellation, settlement, and rollback/reconciliation; asynchronous cron retries cannot submit duplicate orders.
11. `currentMultiplier` must be read according to Robinhood docs (`uiMultiplier()` onchain, `/assets` `currentMultiplier`) and priced with units. Preserve `underlyingEquityPrice`, `onchainTokenPrice` and valuation source as distinct typed fields.
12. x402 brief examples must migrate to v2; verify token EIP-3009 compatibility and a facilitator that supports `eip155:4663` before enabling payment.
13. Live mode needs genuine account-abstraction compatibility with selected venue, no unlimited approvals, onchain cap where feasible, revoke path, explicit consent and security review. No money movement in research tasks.
14. PM states L1 v4 guard is target P4 but P1 is an offchain engine. `V4_CLAIM_LEVEL=L0` is the default for early demos; absence of evidence never upgrades claim level.
15. Regulatory/geo restrictions and user eligibility require counsel/owner decisions; no agent may convert a proposal into a production claim or legal conclusion.
16. App times must be UTC at rest and localized via user time zone. PM's fixed WITA examples are presentation samples, not timezone logic. Include DST transition tests.

## E. Architecture and contracts first

Proposed boundaries (adapt to actual repository rather than blindly creating duplicates):

```
app/
  (marketing)/             # Claude exclusively: landing, explainers, public marketing components
  (app)/                   # shared app shell and business UI, integrated only after API contracts
  api/                     # Codex exclusively: private/public API, cron, MCP later
components/marketing/      # Claude exclusively
components/app/            # coordinate ownership per feature
lib/domain/                # Codex: typed entities, Zod schemas, units, enums
lib/engine/                # Codex: pure hook registry, recipe validator, runTick
lib/data/                  # Codex: RH feeds, canonical token map, price + option snapshots
lib/execution/             # Codex: paper adapter, venue interfaces, order state machines
lib/agents/                # Codex: lifecycle, versioning, state transitions
lib/ai/                    # Codex: compose, optional veto; always validated
lib/verify/                # Codex: truthful feature/claim evidence
worker/                    # Codex: scheduled runner; can live elsewhere as runtime requires
tests/                     # feature-owner tests and E2E integration
 docs/                     # decision register, execution plan, task reports
```

Required typed, versioned contracts: `MarketSnapshot`, `OptionChainSnapshot`, `VenueCapabilities`, `HookDefinition`, `HookResult`, `RecipeV1`, `AgentRunContext`, `AgentDecision`, `OrderIntent`, `ExecutionResult`, `PaperLedgerEntry`, `Position`, `BacktestRun`, `ClaimEvidence`. Every price has currency, units, source, `asOf`, and mode. `runTick(context, recipe, snapshot)` is pure: no DB, network, Date.now(), randomness or LLM calls inside. Its intents go through independently guarded execution.

**Canonical behavior:**
- Inputs captured as deterministic snapshots with provenance and stale thresholds.
- Recipe validated and hash locked at launch. Backtest result binds `recipeHash`, market data version and engine version.
- Every live/paper runner tick uses a durable dedupe key (`agentId`, `tickId`), DB constraints, transactional locking and outbox/retry semantics.
- All orders carry `controller`, `owner`, `mode`, `venue`, `sourceDecision` and stable idempotency keys.
- Missing/stale data blocks entry. Exit management still attempts when feasible, recording reasons when it cannot.
- Public Tape / Verification never exposes private agent/personal account data.
- Event sourcing/Tape is append-only; corrections are new events, not row mutation.

## F. Two parallel workstreams; no overlapping work

### STREAM A — Claude: landing + visual UX

**Starts after** canonical copy, route list, status/claim flags and mock data contracts are locked (this can happen while backend builds the engine). Own marketing route, marketing components, shared design tokens if delegated, diagrams, responsive interactions and 15-second UX test. Do not build API, change DB, invent metrics, alter `lib/domain`, or implement toy trade logic in UI. UI text is English. Use shared typed contracts and an explicit fixture adapter that is replaceable by real API. Explicitly label fixtures in dev. Do not copy Zolva identity/layout one-to-one.

**Above the fold message proposal:**
- Eyebrow: `AI Options Agents · Robinhood Chain`
- H1 (PM lock): `Let agents trade the strike.`
- Clarity subhead: `Build or choose an agent for synthetic calls and puts. Backtest its rules, run it on paper, and inspect every decision.`
- CTA: `Launch a paper agent` / `Explore the Tape`.
- Evidence chips: `36 configurable hooks` (when built), `Backtest 30 days` (when built), `Paper first`, `Every decision explained`. Features not yet available get status labels and no dead CTAs.
- Legal micro-line: `Synthetic options on stock prices · USDG settlement where supported · Not shares · Not investment advice.`
- V4 hero copy governed by claim level. At L0: `Inspired by Uniswap v4 hooks`, never `Built on Uniswap v4`.

### STREAM B — Codex/Logic Engineer: core + APIs + persistence

Own feeds, schema, rule engine, hook specs, execution layer, scheduler, backtest, Paper, Tape, agent lifecycle, AI validation and business APIs. Prioritize smallest complete vertical slice over building 36 isolated demo switches. Verify upstream docs and runtime behavior; do not simulate a venue fill as if real. No live transactions, mainnet deployments, payments or permissions without separately approved gates.

### LEAD — Engineering Lead integration only

Lead first inventories current repo, skills/MCP, locks contracts, assigns directory ownership and decisions. At task end, merge/integrate (if needed), run test suite and produce one evidence-backed handoff. No redundant repeated audit agents or mutually conflicting approvals. Keep an `execution-ledger.md` for status, evidence, blockers and file owners. Any phase needs an observable DoD. One agent owns each file. Avoid worktrees by default; use separate worktrees only if actual overlapping parallel file changes require isolation. Never make two agents alter the same lockfile, migration history, global styles or auth provider concurrently.

**Skills/MCP discovery:** Inspect `~/.agents/skills/`, `AGENTS.md`, `.cursor/rules`, actual Claude/Codex MCP listings and available tool registry *before* claiming access. Use locally available skills as relevant (e.g., `writing-plans`, `verification-before-completion`, `security-and-hardening`, `postgres-best-practices`, `documentation-and-adrs`, `ui-ux-pro-max`, `ai-memory`, `codebase-memory-mcp`). Invoking tools and MCP must be confirmed by actual tool output, not names in a prompt. Avoid installing dependencies or new MCP services unless necessary and authorized. No unauthorized secrets access or production side effects.

## G. Phase gates (deliverable-based, not time-based)

**P0 — Audit + evidence + contract lock:**
- Inspect repository, real scripts/environment and current git; avoid destructive cleanup.
- Read all PM sections; produce requirements matrix with status `verified/proposed/blocked`.
- Verify read-only RH market data, CallPut/Zeno capabilities, quote/option feed provenance, multiplier/units, historical-data availability, write support, market scheduling.
- Validate Uniswap hook and x402 v2 feasibility without deploying/charging.
- Fix spec contradictions in ADRs with `pending owner approval` where necessary.
- Publish Zod schemas, route ownership, API response fixtures, known source-of-truth URLs, Phase 1 vertical-slice design.
- Report: `docs/phase-00-discovery.md`, `docs/adr/`, `docs/execution-ledger.md`, `docs/api-contracts.md`.

**P1a — One complete paper agent:**
- Canonical market snapshot, one suitable agent recipe, required hooks and global safety policy, paper ledger, backtest, launch, tick and Tape connected to UI.
- `agentId/tickId` dedupe test, missing price/quote fallback test, negative result shown, restart/replay test.

**P1b — Full P1:**
- All 36 hooks fully specified and tested; four House Agents in paper mode; Forge prompt/manual; Lab 30d; Public API read; Verify and landing driven by actual statuses; end-to-end test.

**P2 — Developer ecosystem:** MCP read/simulation, public Listing/follow paper, x402 only after payment compatibility/replay evidence.

**P3 — Manual:** Paper Floor + Book, global exposure, controller/takeover safeguards and Risk Desk.

**P4 — Guarded live:** Only after separately signed contract/venue/custody/security/legal gates. Default `LIVE_TRADING_ENABLED=false`. Phase 1 does not initiate or enable live trading.

## H. Acceptance checks (must be executed, not merely reported)

1. Click a House template, change an editable parameter, validate; invalid recipe is rejected.
2. Backtest returns deterministic curve with `premiumSource`, engine version, fees/slippage assumptions, agent vs holding vs cash, both losses and gains.
3. Launch binds the exact recipe hash to the successful backtest; changed recipes require a new backtest.
4. Advance paper time twice: exact intended open/hold/close events and Tape traces, with no live wallet effect.
5. Replay same `agentId/tickId` twice under concurrent calls: one decision, no duplicate order.
6. Simulate missing/frozen/oracle mismatch data: no new entry; meaningful readable reason.
7. Simulate breaker: halt new entry and permit policy-compliant exits.
8. Process time zone changes incl. US DST; no WITA hardcode.
9. Simulate expired/stale/pending venue requests and safe retries; no inference from tx hash.
10. Test portfolio ownership / collateral reuse, fees, covered vs long strategy, no naked short option.
11. Run typecheck, lint, unit/integration/e2e and report exact command/output; never mark green without execution.
12. Confirm 15-second hero explanation with new viewers, keyboard/mobile/reduced-motion support, Verify proof and honest disclaimers.

## I. Delivery report format for every task

`Task / Owner / Scope / Files changed / Sources checked / Behavior proven / Test commands + actual results / Screenshots or API traces / Open blockers / Git status / Next task`.

If a dependency is unverified, mark the feature **research-only** or **paper-only**; do not silently implement it as live. If a task fails, report the reproducible issue and a minimal fix path. Work stops at the current task's scope unless the lead authorizes continuation; do not wander into unrelated design refactors.

## J. Decision register (owner signoff required)

- Venue selection for *paper source* versus *live order execution*, separately by capabilities and strategy.
- Whether covered-call/short-put definitions are modeled offchain only or actually supported with collateral at a selected venue.
- Recipe-schema corrections (Capra, Coverix, Rescu, Protective Put Gate, earnings-aware expiry).
- Signer architecture (C2 smart account/session key vs C1 bounded delegated signer) and explicit approval rules.
- V4 L0/L1 future deployment plan and capital/liquidity/audit ownership.
- Pricing, fee share, x402 price, legal geo-gating, public source license and production domain.

**Immediate next step:** Run `OPTRA_00_DISCOVERY_PROMPT.md` with Engineering Lead / Codex in the actual repository. In parallel, provide Claude only the locked copy + landing design task; do not send the entire PM brief as an unrestricted build order to both agents.
