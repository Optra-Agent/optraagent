# OPTRA AGENT — STEP 01 / TASK 00 DISCOVERY & FOUNDATION (v2)

**Paste this in Cursor / Codex as the FIRST implementation instruction.** It is a bounded Step 01 of **one 10-step plan**, not a second application, a second repository, a research-only week, or permission to implement every PM feature.

## Mission and time window

We are building **Optra Agent** in **one existing or newly initialized Next.js repository**, over **12–13 November 2026**; 14 November is QA/handoff. There are **5 steps each day**. You own **Step 01 only** and may prepare only the exact contracts/ownership required for Step 02.

**Read in order:**
1. The PM's original full 25-section `Optra Agent: Developer Product Brief` in the workspace (filename may differ). Locate; do not invent the file path.
2. `OPTRA_MASTER_EXECUTION_BRIEF_V2.md` (full 10-step sequence, scope and architectural decisions).
3. Existing repository instructions, `package.json`, lockfile, git status, DB schemas, auth/wallet/provider and existing UI conventions.

**Product north star:** `Connect Wallet → Choose House Agent → Validate → Backtest → Launch PAPER → runTick → Positions/Tape`. We are **not** executing live options, sending tokens, deploying Uniswap contracts, or building MCP/x402 during these two days.

## Critical source decisions (do not negotiate repeatedly)

- **ONE repository:** one Next.js App Router web/API codebase. Optional scheduled execution runs from same source. No new frontend/backend repositories, monorepo or automatic worktree.
- **Preferred stack for a new repo:** Next.js 16, React, TypeScript strict, Node 26.x, Bun 1.3.x, Tailwind CSS 4, shadcn/ui, `viem`/`wagmi` for EVM, PostgreSQL + Drizzle, Zod and existing tests or Vitest/Playwright. **Reuse an existing functional stack instead of gratuitous migration.**
- **MVP CHANGE from PM §6.3:** wallet-only EVM sign-in (MetaMask, Phantom EVM if available), not email/Google/Privy. This is an owner-proposed 48-hour reduction **awaiting PM approval**; document it. Connect alone is not backend auth: signed nonce/expiry and ownership check are mandatory for private writes.
- **EVM chain:** Robinhood Mainnet 4663 for **read-only verified data**; do not broadcast mainnet transactions. Testnet 46630 can be configured but isn't required to show paper trading.
- **Live trading is hard-disabled:** `LIVE_TRADING_ENABLED=false`; `V4_CLAIM_LEVEL=L0`. No real spending approvals, key delegation, contract deployment, or x402 charging.
- **Execution truth:** 36 catalog definitions from PM, but only proven/implemented hook evaluators can run. One working paper House Agent precedes all other templates. Avoid made-up IV/premium, Tape or performance.
- **Auth/service credentials:** never print, commit or share secrets. Don't install global packages/MCP/skills without approval.

## Brief 5-minute brainstorm: answer only these 3 questions

1. **User action:** what is the simplest reliable `Connect Wallet → Sign In → see /agents` flow in this repo?
2. **Contract:** what are the *minimal* typed entities/endpoints this first flow and the next market-data step require?
3. **Proof:** which exact browser path and tests will demonstrate a real authenticated session and reject an unauthenticated/cross-owner write?

Write answers as 8–12 lines at the top of `docs/execution-ledger.md`. Do not open a giant planning/research rabbit hole. The PM's broader V1–V12 venue checklist is a deferred release gate, not a prerequisite to start paper-only auth.

## Actions in strict sequence

### 1. Read-only repository preflight

- Verify `pwd`, repo root, `git status --short --branch`, installed Node/Bun, manifest and lockfile, existing scripts.
- If no repo exists in opened workspace, initialize **one** repo in that workspace only. Never create a duplicate tree under `~/worktrees` or an unrelated directory.
- Find actual local/global skills (`~/.agents/skills/` if present), current repo instructions, and available Claude/Codex/Cursor MCP tools. Prefer `writing-plans`, `codebase-memory-mcp`, `ai-memory`, `verification-before-completion`, `security-and-hardening`, `postgres-best-practices`, `documentation-and-adrs`, and for Claude UI `ui-ux-pro-max` and **Anti-Slop**, only where installed and applicable. Do not assert a tool was used unless executed.
- Preserve uncommitted changes. No blind dependency upgrades, no git reset, no package-manager switches.

### 2. Lock ONE lean implementation and file ownership

- Write a tiny ADR or decision table for stack, wallet sign-in, API contract ownership, and read-only chain configuration. Record **MVP waiver pending PM signoff for email/Google**.
- Codex owns `lib/auth`, `lib/domain`, `lib/market`, `lib/hooks`, `lib/engine`, `lib/paper`, `lib/backtest`, `db`, `app/api`, backend tests.
- Claude Code owns `components/marketing`, `components/app` presentation and `app/(marketing)`, subject to agreed route layout; Claude Web is art direction only.
- Assign **one owner** for `package.json`, `bun.lock`, `app/layout.tsx`, global CSS, generated components and shared API types. The other agent must request changes through the owner. Never run concurrent install/build/migrations/git commits from both agents in a shared working tree.
- Shared contracts should be written once as Zod schemas + inferred TS types, with zero duplicated manual types.

### 3. Minimum contracts; avoid modeling the whole PM roadmap now

Provide only types required by Step 01 and ready seams for Step 02–05:

- `AuthenticatedWalletUser` and `Session` (address, session expiry, `ownerId`)
- `MarketSnapshot` (symbol, source, observedAt, underlyingPrice, optional quote, pricingMethod `recorded|modeled|unavailable`, stale/error)
- `RecipeV1` and `HookDefinition` (`implemented|catalog_only` status), `HookResult`
- `Agent`, `AgentDecision` (`agentId + tickId` unique), `PaperPosition`, `PaperOrder`
- `BacktestRun` (recipeHash, data window, `premiumSource`, actual status)
- discriminated error shape (`UNAUTHORIZED`, `DATA_MISSING`, `STALE_MARKET_DATA`, `UNSUPPORTED_HOOK`, etc.)

Use a single UTC/ISO timestamp convention; label monetary units (USDG, USD share price, quote units) precisely. Do **not** invent venue addresses, Greeks, implied vol, backtest sample returns or live eligibility.

### 4. Implement STEP 01 FULLSTACK only

**Backend:**
- Wallet nonce/challenge endpoint with expiry and one-time replay protection.
- Signature verify using viem-compatible EVM verification; strict domain/origin and valid nonce; server-minted secure HttpOnly session cookie (local-development appropriate cookie settings).
- Protected `GET /api/me` (or existing equivalent) and a minimal protected test mutation/ownership test. Prefer existing auth provider if it already meets wallet-only security; do not build an entire IAM system.
- Production data isolation by authenticated owner; no `ownerId` trust from JSON request body.

**Frontend:**
- Minimal app shell and real EVM wallet connect UI for MetaMask and Phantom EVM where supported.
- Connect → sign challenge → authenticated state; disconnect/logout, loading, rejected signature, missing wallet, expired session, wrong account/chain, backend unavailable.
- Empty `/agents` screen and a *truthful* link/place for the first House Agent; NO fake live actions.

**No live approvals/transfers.** Do not hand-roll unsupported wallet extension injection, and do not use Solana-specific wallet adapters for an EVM product.

### 5. Run tests + publish tight evidence

- Execute actual `typecheck`, lint, relevant auth unit tests and browser/manual happy/error-path checks (respect repo scripts).
- Demonstrate: valid sign-in works; missing/replayed/expired nonce rejected; unsigned request rejected; ownership not bypassed; no live transaction prompted.
- Clearly report environmental blockers such as no DB URL, unavailable wallet extension, missing installed packages; do not present simulated passing tests as real.
- Record changed files and exact script output in `docs/execution-ledger.md`.

## Deliverables (keep short)

1. **Working Step 01**: one repo, one wallet auth flow, connected UI and guarded session API.
2. `docs/phase-00-discovery.md`: verified repository facts, important open market data/custody/quote questions for later; max ~1 page.
3. `docs/api-contracts.md`: concise Zod type/interface list and endpoint agreements; **not** a full 36-hook implementation.
4. `docs/execution-ledger.md`: status table with Step 01–10 rows (`TODO/DONE/PARTIAL/BLOCKED`), file owners, evidence links; Step 01 mini-brief.
5. `docs/landing-content-contract.md`: minimal hero text, `PAPER`/`V4_CLAIM_LEVEL=L0` claims and routes for Claude Web/Code. No fabricated user metrics.
6. If Step 01 is successful, one next-turn prompt titled **`STEP 02 — Market Data`**, scoped to only Step 02 of the master. Do not execute Step 02 until explicitly assigned.

## Source verification scope — bounded, not a second research phase

Use PM's sources and the existing master bibliography. You may check official RH 4663/46630 and relevant wallet integration for auth; **do not** spend Step 01 reproducing the entire CallPut/Zeno/Uniswap/x402 analysis. Venue capabilities, multiplier behavior, price/IV data and modeled premium provenance are resolved only as needed in Step 02–05. Keep old PM assumptions marked unverified.

## Completion report — exact format

```text
STEP 01 — Foundation / Wallet-only Auth
STATUS: DONE | PARTIAL | BLOCKED
ONE REPO: path / branch / dirty state
STACK: actual verified versions and reused components
AUTH: signed challenge, session, ownership, error states
FE: route, wallet UI and tested action
CONTRACTS: paths/types and next Step 02 dependency
SKILLS/MCP: verified used; unavailable noted
TESTS: exact commands + actual output
FILES CHANGED: paths, respecting owner assignments
GAPS: only blockers relevant to Step 02
NEXT: scoped Step 02 instruction (not executed)
```

**Do not claim completion before running tests. Do not do extra exploration, create extra agents, rename the repository, commit/push/deploy automatically, or enable real-money trading.**
