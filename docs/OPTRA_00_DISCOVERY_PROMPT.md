# OPTRA AGENT — TASK 00: DISCOVERY, FEASIBILITY & CONTRACT LOCK

You are the Engineering Lead coordinating a focused Optra Agent implementation. This is Task 00 only. **Do not implement the entire project**, open production trades, deploy contracts, submit x402 payments, or modify unrelated repositories.

## Inputs

1. Read the PM's full `optra-agent-dev-brief.md` (25 sections). If the exact file path differs, locate it in the opened workspace; do not guess.
2. Read `OPTRA_MASTER_EXECUTION_BRIEF_V1.md` and treat its corrective findings as engineering proposals pending owner review.
3. Confirm actual repository root, branch, dirty files, scripts, Node/package manager, Next.js version, DB/ORM and existing providers. Never overwrite uncommitted changes.

## Workflow — one lead, two disjoint workstreams

- **You (Lead):** repo/skills/MCP discovery, contract lock, ownership, ADRs, integration report. Do not multiply audit agents.
- **Logic engineer (Codex):** read-only verification of markets, venue behavior, historical data, prices, USDG decimals, `uiMultiplier`, request lifecycle and paper engine seams; define typed Zod contracts, target database entities and failing acceptance tests. Own `lib/domain`, `lib/engine`, `lib/data`, `lib/execution`, APIs, DB and tests.
- **UI engineer (Claude):** after copy/flag/route contracts are locked, begin independently on landing/marketing components. Own `app/(marketing)` and `components/marketing` (or existing equivalents), respecting existing design-system ownership. Do not change backend, DB, domain types, auth, package lock or risk logic. Use English UI copy and clearly labeled fixtures.
- No worktrees by default. If actual file ownership overlaps, pause and reassign before editing. Keep a shared `docs/execution-ledger.md` for assignments and completed evidence.

## Mandatory research (official sources first)

- Robinhood Chain 4663/46630, canonical stock-token addresses, chain price feeds, `/rhj/assets` and `/rhj/prices`, multiplier (`uiMultiplier`/REST `currentMultiplier`), session capabilities.
- CallPut Robinhood: request-based execution; capture `requestKey`, `Pending/Executed/Cancelled`; inspect write-to-open/covered/cash-secured support, early close, programmatic limits, quote provenance, costs, historical quote availability, contract source/ABI, custody.
- Zeno: documented buy-only cash-settled options, early close, option-chain data, signed quote API, protocol vault/oracle limitations, verified contract and custody compatibility.
- Uniswap v4 hook scope, Optra-controlled pool feasibility, liquidity and security needs. Default copy claim level L0.
- x402 **v2** wire format and facilitator/network/token support; no assumptions from old v1 examples.
- Zolva screenshot as inspiration only; if its live site or code cannot be independently inspected, report it as unverified.

## Spec ambiguities to resolve as ADR candidates

- `Capra` range vs House Covered Call default 100%.
- `Coverix` covered-write lock vs Protective Put sizing.
- Protective Put `Calmo OR monthly` rule vs generic AND-only Gate.
- `Rescu` short call up-roll vs cash-secured put down-roll.
- `Tenora` earnings-aware expiry selection.
- Accurate modeled-versus-recorded premium provenance and no look-ahead.
- Correct source/units of price and stock-token multiplier.
- Async request/position state machine and idempotent duplicate submission prevention.
- Agent-only control, manual position restrictions, collateral reservation and risk guards.
- Claim flags `PAPER`, `LIVE`, `V4_CLAIM_LEVEL` controlled by verified server-side evidence.

## Produce exact outputs

1. `docs/phase-00-discovery.md`: concise verified facts vs open issues; link each major technical fact to source and inspected output. Distinguish read-only evidence from successful live fills.
2. `docs/adr/`: minimal ADRs for first paper data source, venue capability matrix, multiplier/price unit model, execution mode boundaries, engine purity, and schema contradictions. Mark owner decisions explicitly.
3. `docs/api-contracts.md`: versioned Zod types for `RecipeV1`, `HookResult`, `MarketSnapshot`, `OptionChainSnapshot`, `VenueCapabilities`, `AgentDecision`, `OrderIntent`, `ExecutionResult`, `BacktestRun`, and `ClaimEvidence`. Document units, nullable fields, timestamps and error codes.
4. `docs/execution-ledger.md`: stream owner / files / current status / evidence / next action; no duplicate work.
5. `docs/phase-01-vertical-slice.md`: exact file-by-file implementation tasks and DoD for a single end-to-end **paper** House Agent (prefer a buy-only-compatible Protective Put if actual data/simulated holdings support it), then expansion to four House Agents and all 36 hooks.
6. `docs/landing-content-contract.md`: locked first-viewport English copy, feature status flags, route targets, data contract and 15-second comprehension checklist for Claude.

## Success criterion

Task 00 is complete only when a developer can start implementing the paper agent without guessing venue capabilities, data units, recipe validation or API shapes; Claude can begin the landing without inventing metrics or touching logic; and the owner can see exactly what is verified, unverified, or awaiting approval. Run all locally available relevant tests / typecheck for changed files and provide the exact commands and actual results.

## Local skills / MCP rule

Inventory what is *actually installed and callable* through repository instructions, global skills (`~/.agents/skills/`), Cursor/Claude/Codex MCP discovery commands, and active tool listings. Prefer relevant verified skills such as `writing-plans`, `verification-before-completion`, `security-and-hardening`, `postgres-best-practices`, `documentation-and-adrs`, `ui-ux-pro-max`, `ai-memory`, and `codebase-memory-mcp`. Do not claim a skill/MCP was used unless logs show it. Do not install or modify global tooling, open secret stores, or enable production integrations without authorization.

## Final response format

`VERIFIED / GAPS / DECISIONS NEEDED / CONTRACTS LOCKED / PARALLEL FILE OWNERSHIP / TEST OUTPUT / NEXT IMPLEMENTATION TASK / GIT STATUS`.

Do not create a git commit or push automatically unless it is explicitly requested in the current run. Do not run live trading or real payment actions.
