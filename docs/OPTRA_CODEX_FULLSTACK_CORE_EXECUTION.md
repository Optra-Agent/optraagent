# OPTRA AGENT — CODEX FULLSTACK CORE IMPLEMENTATION

**Agent:** Codex (Engineering Lead + primary Software Engineer)
**Execution order:** Run THIS FIRST; Claude Code runs only after this handoff.
**Window:** 12–13 November 2026 for implementation, 14 November for final QA/handoff.
**Repository:** ONE existing Optra repository / ONE Next.js App Router codebase. No new repo, no monorepo, no automatic worktree.

## Your source-of-truth order

1. Original PM document: `Optra Agent: Developer Product Brief` (25 sections, 11 Nov 2026).
2. `OPTRA_MASTER_EXECUTION_BRIEF_V2.md` (48-hour scope and 10-step work plan).
3. `OPTRA_00_DISCOVERY_PROMPT_V2.md` (use its Step 01 checklist; do NOT stop after Discovery).
4. Existing code, dependencies, Git state, verified data sources and installed skills/MCP.
5. The UI references below are for CLAUDE CODE, not your instruction to reproduce visual mockups:
   - Landing: https://claude.ai/artifact/5tgBa1feTHzEhx3j9CTns6
   - App: https://claude.ai/artifact/V9vce7gc3PW2i51gETjhNW

Do not claim you inspected an artifact or source file unless you actually could access it.

## Mission

Complete the **engineering/backend + minimum functional frontend** for the 48-hour Optra PAPER MVP. This is not a research-only assignment. Work through the relevant steps IN SEQUENCE, verifying each one, until your engineering ownership is completed or you hit a genuine blocker. Do not wait for a fresh prompt at every step. Never mark an untested step complete or move past a missing core dependency by hardcoding fake success.

**Required real user path:** Connect EVM wallet → sign in → choose supported House Agent → inspect/validate recipe → run trustworthy 30-day backtest (only when data supports it) → launch on paper → evaluate an actual deterministic tick → persist paper order/position and append-only Tape decision → view agent state and Tape through real API.

## Hard scope and security rules

- **Wallet-only MVP:** MetaMask + Phantom EVM where supported. The PM mentioned email/Google/embedded wallets as full scope; the user has intentionally reduced the MVP to wallet-only. Document this `MVP CHANGE`, do not add email/Google/Privy. Wallet connect alone does not authenticate the API; use a signed nonce challenge, verification, session cookie, replay and expiry protection, account/chain change handling, and per-owner authorization.
- **Robinhood EVM:** Mainnet chain ID `4663` for verified **read-only** calls and verified data. Configure testnet `46630` only if useful. No real onchain options transaction, token approval, transfer, delegated signer, live trading, contract deployment or new vault. `LIVE_TRADING_ENABLED=false` and `V4_CLAIM_LEVEL=L0`.
- **One repo / one source of truth:** Next.js App Router, TypeScript strict, Tailwind 4, shadcn/ui, viem/wagmi, Postgres/Drizzle, Zod and Vitest/Playwright are defaults **for a new repo**. Inspect existing stack and reuse working dependencies. Node 26.x; Bun 1.3.x, one lockfile. No microservices, new monorepo, or new Redis/queue framework without proven need.
- **No fictional data:** Only genuine fetched data or transparently labeled modeled option-premium estimates. Never invent live fills, agent returns, quote history, IV, backtest successes, decisions or wallet balances. If history is inadequate, expose the real limitation; never unlock paper launch with a fake backtest.
- **Agent-first product:** PM's 36 hooks are 10 Gate, 7 Strike, 4 Size, 7 Pulse, 3 Expiry, 5 Breaker. Preserve the exact catalog but mark every hook `implemented` vs `catalog_only` truthfully. Implement the tested subset necessary for one functioning House Agent; only add more if time/data allow. AI can compose validated rules, not invent decisions or submit orders.
- **Read-side feasibility:** Verify stock price source, multiplier semantics, venue quotes, option premium source and times. CallPut may be asynchronous; Zeno is documented buy-only. Do not imply that a buy-only venue supports covered call / cash-secured put writing. Choose the first House Agent **supported by the real data/recipe you can prove** (e.g. a protective-put paper model if defensible); explain any limitations.
- **No premature automation claims:** A `runTick` callable only by hand is not automatically running 24/7. For paper agents, implement a secure idempotent tick endpoint and simplest compatible scheduler/worker; report clearly if scheduler cannot be tested or configured.
- Preserve uncommitted changes and the existing development process. Do not push, deploy, reset, force checkout, install global tools, or mutate live finance systems without explicit permission.

## Skills and MCP — use what is installed, do not assume

At startup inspect repository instructions plus actual skills and connected MCP facilities available to Codex/Cursor. Apply where available: `writing-plans`, `codebase-memory-mcp`, `ai-memory`, `security-and-hardening`, `postgres-best-practices`, `documentation-and-adrs`, and `verification-before-completion`. Report which were actually invoked, unavailable or skipped; avoid lengthy tool-availability investigations. Anti-Slop and `ui-ux-pro-max` are reserved mainly for Claude's UI pass.

## Ten-step plan: preserve the same numbering as Master Brief v2

**Day 1 — core, Steps 01–05**

### STEP 01 — Repository + wallet session + API contracts
- Read-only preflight: repository, branch, dirty status, Node/Bun, package manifest, deployed code, existing env (never reveal secrets).
- Initialize only if the opened workspace has no application yet. Keep one repo.
- Implement EVM wallet connect and wallet sign-in (signed nonce with expiration/replay protection, authenticated HttpOnly cookie, protected `/api/me`, ownership verification).
- Minimal `/agents` screen with real loading/empty/error/auth states (visually basic is fine; Claude will restyle).
- Define canonical Zod schemas/types and precise typed API contracts; agree route/component ownership for Claude.

### STEP 02 — Verified market data
- Implement smallest verified underlying market feed, source/provenance/timestamp/staleness, multiplier and unit handling where supported.
- Implement corresponding API and a real basic market UI. Missing quote = real unavailable status; do not manufacture data.
- Establish honest modeled/recorded/unavailable premium methodology if option quote history is insufficient.

### STEP 03 — 36-hook catalog + minimum working validators
- Define all 36 hook specifications exactly by PM taxonomy, parameter schemas and explicit availability flags.
- Implement only evaluators required for supported paper strategy, including mandatory breakers/limits or equivalent conservative safe defaults.
- Validate recipe stage composition; canonical hashing and recipe version; invalid/unimplemented recipes cannot launch.

### STEP 04 — deterministic engine + paper ledger + Tape
- Pure `runTick(snapshot, recipe, state)` with deterministic decisions and HookResult traces.
- Paper execution / position and order state, fee/slippage assumptions visible, ownership, idempotency `(agentId,tickId)` and append-only Tape.
- Handle `hold`, `skip`, stale/no data, stop/close, duplicate tick and restart safely. Make exit behavior explicit; never create a real transaction.
- Provide minimal UI: actual decisions, position state and provenance.

### STEP 05 — honest Lab backtest + paper launch
- Replay historical data using the SAME engine; no different strategy implementation in Lab.
- If 30 days/720 hours of valid data are not available, disclose and keep backtest/launch gating truthful. Do not claim complete for non-working flow.
- Show equity/PnL and holding/cash benchmarks only when computable; modeled premiums and assumptions unmistakably labeled.
- After a valid backtest of the same immutable recipe hash, enable real persisted paper launch. Show current status and actual tick decision.

**Day 2 — remaining functional API/core, Steps 06–10**

### STEP 06 — agent management
- Endpoints and basic working UI for list/detail/pause/resume/stop/fork and access control. Fork creates a new recipe version. No duplicate positions or tick runs.

### STEP 07 — Forge
- Functional click-based builder backed by validated schemas; choose an implemented hook/parameter, save draft, backtest, launch where valid.
- AI composer ONLY if provider credentials and strict validation are actually available; otherwise show `Planned` or hide action. Never fake AI success.

### STEP 08 — House Agent templates and hook library
- Catalog four PM House Agent templates with accurate `Paper ready`/`Preview` indicators; only actually executable ones are launchable.
- Real `/hooks` data, parameter details, stage filter, reason if unavailable. Expand actual hook implementations only if data and time support tests.

### STEP 09 — Backend for public proof + UI seams
- Implement minimum read-only public APIs (verified hook catalog, public agents/Tape where safe, claims status/Verify).
- **Do not build or redesign marketing visuals.** Create `docs/ui-handoff-contract.md`: exact real endpoints, request/response schemas, route names, working states, errors, CSS ownership, data claims and user demo flow for Claude Code.
- Provide simple server-connected pages in `app/(app)`; don't generate separate HTML prototypes as the application.

### STEP 10 — Engineering integration / safety regression
- Verify backend/auth/DB/engine APIs, browser tests of functional flow on basic UI, no fabricated numbers, no live writes, no unprotected private endpoints.
- Provide automated unit, integration and (as feasible) Playwright tests, DB idempotency evidence, exact command outputs and realistic gaps.
- Leave UI polish/mobile visual acceptance to Claude Code's second pass. Do not mark the FINAL overall UI milestone done yet.

## Step discipline

At the start of **each** step write 8–12 lines in `docs/execution-ledger.md`:
`USER ACTION / PRIOR DEPENDENCY / BE OUTPUT / BASIC FE OUTPUT / ONE TECHNICAL DECISION / TEST EVIDENCE / OUT OF SCOPE / STATUS / NEXT`.

After each step: execute relevant checks, record changed files and PASS/PARTIAL/BLOCKED with concrete evidence. If blocked, complete only independent safe work and report the missing input; don't spend the entire sprint on unbounded research.

## File ownership and anti-conflict handoff

**Codex owns:** `lib/auth`, `lib/chain`, `lib/domain`, `lib/market`, `lib/hooks`, `lib/engine`, `lib/paper`, `lib/backtest`, `db`, `app/api`, backend-focused tests and auth/session integration. Codex may create **minimal functional** React app pages and contracts that Claude will later style. Codex owns `package.json`, lockfile and final schema initially.

**Claude Code later owns:** `components/marketing`, visual `components/app`, `(marketing)` page files, visual CSS/tokens, animations/assets, UI-only tests; may refine app page layout while keeping contracts/real data intact. Claude cannot alter contracts, migrations, API or engine silently.

Keep logic isolated behind typed APIs and reusable hooks. No hardcoded mock data in functional routes. Make graceful loading, empty, and error states available for Claude to style.

## Required outputs BEFORE handing over to Claude Code

1. Working one-repository Next.js project with scripts for dev, build, typecheck, lint, and test.
2. `docs/execution-ledger.md`: Steps 01–10 status with evidence, including exactly what Codex did not finish.
3. `docs/api-contracts.md` and `docs/ui-handoff-contract.md` with API endpoints, typed schemas, auth expectations, capability flags and known limitations.
4. `docs/final-core-handoff.md`: verified full paper user journey (or precise blockers), DB/storage setup, env variable **names only**, tests, risks, and next actions for Claude.
5. Explicit flags: `LIVE_TRADING_ENABLED=false`, `V4_CLAIM_LEVEL=L0`, `PAPER` prominently labeled.
6. One final concise report: verified routes, endpoints, test outputs, repo/branch/dirty status, actual skills/MCP, and which work Claude must do.

**Do not stop after writing a plan or Step 01. Continue through bounded tasks while safe and feasible. Prioritize real end-to-end paper flow over getting 36 decorative hook cards to appear finished.**
