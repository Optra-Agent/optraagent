# OPTRA AGENT — MASTER EXECUTION BRIEF v2.0

**Planning baseline:** 12 November 2026, Asia/Jakarta  
**Development window:** 12–13 November 2026 (two development days, five steps/day)  
**14 November:** final regression, demo, release-readiness review and handoff; no uncontrolled feature expansion  
**Status:** 48-hour MVP implementation plan; **PM's full 25-section brief remains the full product roadmap**  
**Owner/approval:** Caesar / PM for scope changes, brand and production go/no-go  
**Primary source:** `Teks yang ditempel (1)(20261111-195353).txt` (Optra Agent Developer Product Brief, 11 Nov 2026)  
**Companion:** `OPTRA_00_DISCOVERY_PROMPT_V2.md` (execution prompt for Step 01, not a separate project)

> **North star:** Within the MVP, a user connects an EVM wallet, chooses one supported House Agent, validates and backtests its immutable recipe, launches it on **paper only**, observes actual deterministic tick decisions, and inspects positions and explanations in Optra Tape. The UI must consume the same persisted records as the engine; no fabricated activity or earnings.

## 1. Source-of-truth hierarchy and non-negotiable scope

1. **PM full brief**: product vision, 36 named hooks, House Agents, Forge, Lab, Tape, Floor, Listing, Public API, MCP, x402, Verify, compliance, future gated live phase. Do **not** discard these features.
2. **This master v2**: engineering decisions and **48-hour reduction** of the PM roadmap. Any deviation from PM is explicitly labeled `MVP CHANGE` and needs owner acknowledgement; this document is not evidence of owner approval.
3. **Repository facts**: actual installed packages, existing code, working API/data and service credentials, checked in Step 01. Prefer reuse over replacement.
4. **ADRs + API contracts** produced in Step 01: implementation truth for the two agents; change only through a short recorded decision, not silent edits.
5. **Test evidence**: only a verified passing behavior may be marked `WORKING`. UI labels must follow real backend capability.

### Product invariants from PM

- **Agent-first:** House Agents, Custom Agents/Forge, hooks, Lab and Tape lead the experience. Manual trading is secondary.
- **Deterministic rule engine:** the AI may *compose* a validated recipe and optionally *veto new risk*. It may not execute orders, override breakers or block exits.
- **36 hooks in 6 stages:** Gate 10, Strike 7, Size 4, Pulse 7, Expiry 3, Breaker 5. Many are offchain rules; they are **not** 36 Uniswap v4 contracts.
- **Paper-first:** `LIVE_TRADING_ENABLED=false` at all times during this MVP. No live orders, token approvals, payments, contract deployment or custody delegation.
- **Truthful data:** options over stock *prices*, RH stock tokens, and actual shares are different instruments. Display data source, timestamp, quote/model status, and uncertainty.
- **Tamper-evident history:** launched recipe hash/version is immutable; Tape decisions are append-only, with idempotent tick IDs.
- **Fail-closed on entry:** stale/missing/invalid price, quote, calendar or collateral input must never silently create a new position. Exit policy and error reporting are separate.
- **One repository** for web, API, engine, DB schema and optional worker. Separate deployment processes are permitted from the *same* codebase, but not separate repos or a monorepo.

## 2. Timeboxed decisions: what we explicitly changed for 48 hours

| Domain | PM full brief | 48-hour MVP decision | Status |
|---|---|---|---|
| Auth | Email / Google / wallet via embedded wallet-like provider (§6.3) | **MVP CHANGE:** EVM **wallet-only**. Support MetaMask and Phantom EVM where supported; message-sign challenge, server-side verification and session for private writes. No email, Google or Privy required. | Pending PM approval of reduction |
| Network | RH Chain mainnet 4663, testnet via docs | **Read-only** mainnet data as verified; no mainnet writes. Allow configured testnet for future tests. | Locked for MVP |
| House Agents | 4 paper agents: Covered Call, Cash-Secured Put, Protective Put, Earnings Straddle | **One full end-to-end agent first.** Display other templates only with accurate working/preview status. Aim to expand if engine/data support; do not fake readiness. | Scoped |
| 36 hooks | All functional, complete parameter ranges and tests | Preserve **all 36 catalog definitions**; implement and test the subset required by working MVP recipes. Mark other hooks `catalog_only`, no runnable claim. | Scoped, full coverage deferred |
| Forge | Click builder + LLM compose | Click/configure MVP. LLM compose only if existing provider, key and validation are ready; otherwise disabled and clearly labeled. | Conditional |
| Lab | 30d hourly backtest and benchmarks | Honest runnable 30d only if historical source is sufficient; otherwise explicitly show data limitation and **do not issue fake pass/launch unlock**. | Priority core |
| Market data | Multi-market onchain/oracle/venue quote feeds | One proven underlying and normalized snapshots; adapt venue/oracle price/quote if available. **Modeled** premiums must be visibly labeled, never historical fills. | Priority core |
| Tape | Public and per-agent append-only decisions | Per-agent real persisted Tape first; public list if safe and feasible. | Priority core |
| Listing / Floor / Book / Risk Desk | Full dual-mode ecosystem | Roadmap. MVP may show working **agent positions only**, not a pretend manual-trading book. | Deferred |
| API / MCP / x402 | Developer layer | Only small read-only API needed by product/Verify. MCP and x402 remain roadmap. | Deferred except reads |
| Uniswap v4 | L1 spot GuardHook after feasibility/audit | `V4_CLAIM_LEVEL=L0` until contract/pool evidence; do not deploy new contracts. | Locked |
| Live trading | V1–V12 venue checks, custody, caps, legal/compliance approval | Entirely disabled, unexposed in action paths, and out of the two-day build. | Locked |

**Scope-change rule:** adding email login, manual options trading, a new contract, x402 payment, extra market support or a second backend is *not allowed* as a spontaneous agent decision. Record as future task first.

## 3. Finalized lean stack (reuse pre-existing repository before replacing anything)

| Layer | Default choice | Do NOT add unless justified |
|---|---|---|
| Codebase | **One Next.js 16 App Router** repo, React, TypeScript strict | Turborepo, separate BE/FE repos |
| Runtime / package | Node.js 26.x, Bun 1.3.x; respect existing lockfile | Multiple package managers/lockfiles |
| Visual | Tailwind CSS 4, shadcn/ui or existing components, minimal Motion only where useful | Three animation/chart frameworks |
| EVM | `viem`, `wagmi`, wallet-standard/injected supported EVM wallet connectors | Solana `@solana/wallet-adapter`, manual `window.solana`, non-EVM Phantom assumptions |
| Wallet auth | Signed nonce with domain, chain/context, expiration, replay protection; server-verified session (secure HttpOnly cookie) | Email/Google auth, Privy, large custom IAM project |
| DB | PostgreSQL + Drizzle, **if repo is new**; reuse working ORM if repo already exists | Redis or another DB by default |
| Validation / engine | Zod, pure TypeScript `runTick(snapshot, recipe, state)` shared by paper and Lab | Different engines per mode |
| Scheduled tick | Minimal secure scheduled invocation + durable DB idempotency; single owner for execution | Distributed queue infrastructure unless needed |
| AI | Existing provider/router only when credentials and structured-output validation exist | New multi-model platform to satisfy a UI screenshot |
| QA | Vitest + Playwright (or repo's existing test stack), typecheck/lint | Rewrite test framework |
| Deployment | Existing project deployment; Railway if already configured | New hosting migration without need |

**Auth security:** `Connect Wallet` alone is *not* authorization to write somebody's `agentId`. Private mutations require challenge signing with nonce/expiry, authenticated cookie, and server-side `ownerId` checks. `signMessage` costs no onchain gas. Don't request token approval or wallet spending signatures.

**Chain & UI behavior:** MetaMask and Phantom EVM are supported only when their EVM connectors are available. Clearly handle missing extension, declined signature, expired nonce, changed account, disconnected wallet, unexpected chain and RPC/service error. Do not silently fall back to an unrelated chain.

## 4. One-repo folder boundaries and ownership

```text
optra-agent/
  app/
    (marketing)/                 # Claude owns marketing pages only
    (app)/                       # Claude builds views; Codex owns route data/actions
    api/                         # Codex owns
  components/
    marketing/                   # Claude owns
    app/                         # Claude owns presentational UI
    ui/                          # shared shadcn, one designated maintainer
  lib/
    auth/                        # Codex
    chain/                       # Codex
    domain/                      # Codex: canonical contracts
    market/                      # Codex
    hooks/                       # Codex
    engine/                      # Codex
    paper/                       # Codex
    backtest/                    # Codex
    ai/                          # Codex, only if enabled
  db/                            # Codex
  tests/                         # Codex; Claude may add isolated UI tests
  docs/                          # Lead owns decisions/ledger
  public/                        # Claude owns visual assets
  package.json                   # ONE designated owner, no concurrent edits
  bun.lock                       # ONE designated owner, no concurrent edits
```

**Same working tree policy:** if two agent terminals point at the same checkout, they must NOT edit the same files or run concurrent installs, migrations, Git reset/checkout, format-all or commits. The Lead owns shared files. No automatic worktrees or extra repositories. Commit/push/deploy require separately authorized action.

### Agent roles

- **Engineering Lead:** read PM + master, lock scope/types/route map, assign owners, keep `docs/execution-ledger.md`, review evidence once per step, integrate. No additional PM/auditor agent swarm.
- **Codex (logic/fullstack):** API, DB, auth, market adapters, recipe engine, paper ledger, Lab, Tape, domain contracts and integration tests. Can provide existing route data/action interfaces but does not redesign landing.
- **Claude Web (art direction only):** research/explore reference styles, critique, layout concept, copy hierarchy, color/typography and design spec. Cannot access actual local skills/MCP unless explicitly connected and verified.
- **Claude Code (UI execution):** convert approved visual spec into Next.js UI using existing local Anti-Slop and relevant global UI skills **if actually installed**; consume typed APIs; never invent backend state or overwrite business logic.

## 5. Definition of DONE for *each* step (fullstack, no fake checkmarks)

A step may be marked `DONE` only when all applicable evidence exists:

1. **Backend/data** behavior exists or there is an explicit no-backend-needed explanation. Authz/validation/error paths included.
2. **Frontend** route/component calls the actual API/service, with loading/empty/error/wallet state. Temporary fixture is marked `DEMO_PREVIEW`, not `WORKING`.
3. At least one **working user action** is exercised in browser or integration test, not merely a screenshot.
4. Relevant **unit/integration test** passes; `typecheck`/lint as applicable. Command and output are recorded.
5. All changed files/route contracts/risks/next owner are written to `docs/execution-ledger.md` (brief, not a long narrative).
6. One **current-step demo path** is available. An incomplete step becomes `PARTIAL`, not `DONE`.

**No-go:** a static chart populated with plausible profits, fake Tape entries, dead CTAs, mocked wallet balances, invented quotes, or claiming 36 hooks implemented because 36 rows are rendered.

## 6. Ten-step execution plan — exactly FIVE STEPS PER DAY

**DAY 1 — Thursday, 12 November: make ONE agent's paper trade path genuinely work.**

### STEP 01 — Foundation, wallet sign-in, contract lock
- **Brainstorm (strict questions):** Does an Optra repo exist? Which stack is already present? Who owns the authenticated user? What exact API types and UI routes will both agents use?
- **BE:** inspect repo and installed skills/MCP; bootstrap only missing essentials; define Zod contract `MarketSnapshot`, `Recipe`, `Decision`, `Position`, `Backtest`, error codes; implement wallet nonce/sign/verify/session and ownership middleware (or a proven minimal existing auth integration).
- **FE:** app shell + `Connect Wallet`/signature/connected states; Claude Web may prepare independent art direction, while Claude Code creates only safely assigned components.
- **DoD:** server rejects unsigned/private write; signing a valid challenge creates a verified session; disconnected/rejected wallet states work; base route loads; ownership and contracts recorded.
- **Output:** `/agents` shell, wallet auth, minimal schema/contracts, `docs/phase-00-discovery.md`, `docs/execution-ledger.md`.
- **Boundary:** no new auth provider, no live trade, no other full features.

### STEP 02 — Proven market data → real market UI
- **Brainstorm:** Which ONE underlying has verified price/quote and history? Are prices stock token or underlying share USD? Is the quote recorded, modeled or unavailable?
- **BE:** market read adapter; normalize units/timestamps; canonical source and stale/zero/missing errors; `GET /api/markets` + one detail; snapshot persistence or minimal cache with provenance. Underlying is chosen from observed support, not hardcoded NVDA if unavailable.
- **FE:** market status card, select supported underlying, source/time/model badge, loading + unavailable state.
- **DoD:** API/UI agree on one real observed normalized snapshot; stale data visibly blocks entry. If option quotes cannot be verified, `modeled` is visibly labeled and not represented as market fill.
- **Output:** first market feed and price/quote UI, sample provenance trace.
- **Boundary:** do not spend the day integrating many markets or starting live adapters.

### STEP 03 — Hook catalog, recipe schema and first usable validator
- **Brainstorm:** Which hooks are needed by the first strategy? Which PM defaults contradict schema? How will unsupported hooks be distinguished from executable hooks?
- **BE:** all 36 hook names/stages/parameters registered with status `implemented|catalog_only`; implement tested minimal subset for first **buy-only-compatible paper** strategy (prefer Protective Put *only if simulated holdings, sizing and quotes are coherent*); `validateRecipe` with version/hash; enforce caps, required strike/expiry selectors, no naked shorts, global breaker defaults.
- **FE:** House Agent selection/template editor with editable allowed params and human-readable validator errors; hook chips/status, no fake live claims.
- **DoD:** valid first recipe passes; invalid recipe, unsupported hook, naked short, missing data and contradictory params fail; UI shows same validation result as backend.
- **Output:** first runnable recipe and visible hook composer/validator.
- **Boundary:** catalog completeness ≠ 36 implemented evaluators.

### STEP 04 — Pure rule engine → paper ledger → real Tape UI
- **Brainstorm:** Does the tick open, hold, close or skip? Can the same tick be processed twice? Can entry happen when data fails?
- **BE:** pure `runTick` returns intents/trace; shared deterministic engine; paper order/position/cash ledger, dedupe `(agentId, tickId)` and transaction-safe writes; `decisions` append-only including hold/skip; private API to run/simulate controlled tick and query Tape/positions. No onchain transaction paths.
- **FE:** first paper positions panel and expandable Tape row using persisted decisions, with explicit `PAPER` + source badges.
- **DoD:** one valid tick gives expected decision, replay produces no duplicated order/decision; missing data blocks new entry; no wallet transaction; UI reflects persisted state.
- **Output:** demonstrable paper state change and real Tape explanation.
- **Boundary:** manual Floor, write-side venue and Uniswap contracts excluded.

### STEP 05 — Lab backtest → same-hash paper launch
- **Brainstorm:** Is 30-day hourly input real and sufficient? Are premiums recorded or modeled? How can the UI know the backtest belongs to the same recipe revision?
- **BE:** replay with exact `runTick`, time-ordered snapshots, no look-ahead, costs and labels; backtest storage keyed to recipe hash/version; launch allowed only after successful backtest on the *same hash* and valid data; one paper agent starts with default or explicitly supplied virtual state.
- **FE:** `/lab` results comparing agent vs holding vs cash, losses and warnings; `Launch on paper` → `/agents/{id}`; 30d claim only when covered by actual input, not fabricated series.
- **DoD:** test parity of one tick between Lab and paper; invalidated backtest blocks changed recipe; first end-to-end flow works **if data availability permits**. If data prevents a credible backtest, mark this step `PARTIAL` and do not bypass launch gate.
- **Output:** **Day 1 milestone: Connect → Choose → Validate → Backtest → Paper Launch → Tick → Tape.**
- **Boundary:** one truthful end-to-end agent is worth more than four fake agents.

**DAY 2 — Friday, 13 November: finish usable product interface and extend only tested capabilities.**

### STEP 06 — Agent lifecycle and dashboard
- **Brainstorm:** Who can pause/stop/fork? Does a running agent restart safely? What state transition is allowed?
- **BE:** authenticated agents list/detail and pause/resume/stop/fork endpoints; immutable launched recipe; prevent duplicate runs and cross-user writes; single tick handler/scheduler with DB idempotency.
- **FE:** `/agents` cards, agent detail, status, equity/positions/Tape tabs, usable lifecycle controls and optimistic state only after API acknowledgement.
- **DoD:** owner control works, non-owner rejected, fork creates a new version, restart does not duplicate tick.
- **Boundary:** no community listing yet.

### STEP 07 — Forge: useful strategy builder, AI only if truly integrated
- **Brainstorm:** Can a user change a hook without creating an invalid/unsafe recipe? Does any LLM provider actually exist and return validated JSON?
- **BE:** save/fork draft recipes; strict schema validation, canonical hash, supported hooks only; optional `compose` route with bounded prompt, explicit provider availability, structured-output validation and no order authority.
- **FE:** `/forge` click-to-configure recipe UI, validation/errors, plain-English explanation, `Backtest first` action; prompt composer only when backend works.
- **DoD:** click-builder recipe can be validated/backtested/launched; changes require another backtest. If AI provider isn't ready, show `AI compose — planned`, never a fake compose response.
- **Boundary:** skip advanced drag-and-drop and multi-model orchestrators.

### STEP 08 — House Agent expansion + honest 36-hook library
- **Brainstorm:** Which House Agent templates are genuinely executable with our data and implemented hooks? Which need write-side or multi-leg pricing?
- **BE:** test and expose working variants; maintain exact 36-catalog coverage (10/7/4/7/3/5) with per-hook `implemented` status. Attempt remaining PM templates **only** if required evaluators and pricing/collateral are verified; otherwise `preview/paper model pending`.
- **FE:** `/hooks`, House Agent catalog/cards with badges `Paper ready` or `Preview`, per-hook details and verified capability reasons.
- **DoD:** no available Launch control for unimplemented template; exposed templates pass recipe validation and runner tests; 36 entries exist as definitions but not conflated with runtime support.
- **Boundary:** don't silently manufacture Covered Call short premium or Earnings Straddle multi-leg fills.

### STEP 09 — Landing + Verify + minimal read API
- **Brainstorm:** Can a new user understand the product in 10–15 seconds? Can each landing claim be tied to a real route/data source/status?
- **BE:** read-only `GET /api/public/v1/hooks`, `/agents` (only explicitly public), `/tape` (only public), `/verify` or minimal equivalent; claim manifest and server-verified `V4_CLAIM_LEVEL=L0`.
- **FE (Claude Code):** implement approved Claude Web design, hero, House/Forge/How it works/Tape/Verify/FAQ/final CTA, mobile and reduced-motion. Use backend data or clearly declared static product descriptions, **not invented performance stats**.
- **DoD:** 15-second message includes agents/options/Robinhood Chain, paper-first, editable rules, viewable decisions and CTA; all buttons lead somewhere honest; mobile usability and proof links pass.
- **Boundary:** no X campaign, animated 3D demo or bespoke graphics rabbit hole.

### STEP 10 — Integrated E2E, safety checks, release review
- **Brainstorm:** Can a newcomer complete flow without developer assistance? Does any page imply live capability? What breaks when wallet/RPC/data/API fails?
- **BE:** run typecheck, lint, unit/integration/E2E, authz and duplicate-tick tests; verify `LIVE_TRADING_ENABLED=false`, no live transaction signing or payment paths; enforce API input validation.
- **FE:** real browser walkthrough at desktop/mobile, a11y/keyboard/reduced-motion, rejected wallet, disconnected, empty data, backtest loss display, responsiveness; fix only blockers.
- **DoD:** reproduce the full flow, record test outputs and screenshots, reconcile visible PnL/Tape with DB, list remaining `PARTIAL` and deferred roadmap items. Deployment only via authorized existing pipeline.
- **Output:** `docs/final-mvp-handoff.md`, stable demo path, remaining risks, Git status.
- **Boundary:** no surprise feature rewrites or live enablement.

### 14 November — Final QA/handoff buffer (not an eleventh feature step)

Close critical bugs found at Step 10, run a clean smoke suite and document what actually works. No new scope, no claim that full PM P1 (four paper templates and all 36 runtime hooks) is complete unless verified by evidence.

## 7. Small brainstorming protocol BEFORE each step (maximum focus, zero wandering)

Each step begins with a **mini-brief**, recorded as 8–12 lines in `docs/execution-ledger.md`:

```text
STEP XX / DAY X
USER ACTION: one concrete behavior a user can complete
DEPENDENCY CHECK: exact working endpoint/types/screens from prior step
BE DELIVERABLE: 1–3 essential capabilities and owner files
FE DELIVERABLE: 1–2 routes/components consuming BE contract
DECISION: choose one implementation, note why (no five-option debate)
TEST / EVIDENCE: specific command, trace and browser path
NOT IN SCOPE: explicit tempting adjacent features
STATUS: TODO | IN_PROGRESS | DONE | PARTIAL | BLOCKED
NEXT: one bounded next step
```

**Mini-brainstorm rules:**
- Answer only three questions: *What is the user action? What is the minimal reliable data/logic? How do we prove it worked?*
- Use PM as reference for semantics; use actual code/data for feasibility. Avoid proposing a new library unless current code cannot do the job.
- If a blocker is research-only (e.g., options chain/historical IV absent), run **one bounded verification**, document the result and use an honest `unavailable` or clearly labeled `modeled` path where methodologically sound. Do **not** repeat open-ended research.
- Do not move past an untested dependency by hardcoding success data. Prefer a real vertical slice over nominal completion of five steps.
- After each step, the Lead reads only the evidence + modified files, confirms ownership and writes the next task. No full repository audit every time.

## 8. Claude Web → Claude Code handoff (parallel, without AI-slop)

**Claude Web work starts during Step 01 and never edits production code.** Ask for: 2–3 distinct visual directions, curated verifiable references (not clones), layout hierarchy in 15 seconds, typography, token palette, component examples, hover/motion, accessibility, and concise English copy. Use PM's Midnight Ink/Azure/Vermilion as starting point, but prefer distinct editorial/data-terminal polish over generic gradients, giant glowing orbs, random glassmorphism or empty 3D decor.

**Approval deliverable (small):** one chosen direction, colors with contrast notes, type scale, fold wireframe, 5 core component patterns (`AgentCard`, `HookChip`, `TapeRow`, `PaperBanner`, `VerifyClaim`), mobile rules, static/dynamic content boundary. **Do not wait for an entire Figma design kit.**

**Claude Code execution:** read the approved visual spec + locked `docs/api-contracts.md`; inspect installed Anti-Slop and global UI skills; work only in assigned UI files; no manual editing of DB/contracts/engine/auth; no placeholder stats on real pages. Respect current Next.js/Tailwind conventions and preserve integration contracts.

### Landing copy baseline (English UI)

- Eyebrow: `OPTIONS AGENTS · ROBINHOOD CHAIN`
- H1 (PM canonical): `Let agents trade the strike.`
- Simple explanation: `Choose an agent or build your own rules for synthetic calls and puts. Backtest the strategy, run it on paper, and inspect every decision.`
- Primary CTA: `Launch a paper agent` → working House/Forge flow.
- Secondary CTA: `Explore the Tape` → real Tape or an explicitly labeled explainer until public Tape exists.
- Provenance: `Paper first. Synthetic options on stock prices; not shares or stock tokens. Not investment advice.`
- **Dynamic capability rule:** if LLM compose is not running, don't present it as active; if hooks are only offchain, say `Hooks inspired by Uniswap v4`, never `built on Uniswap v4`. If product is paper-only, make it unmissable. All UI prose and code names are English.

**Fifteen-second success question:** a new visitor can correctly say, without prompt, that Optra creates rule-driven options agents on Robinhood Chain, supports paper backtesting and displays transparent decisions. Advanced MCP/x402/manual features may be mentioned only with honest status.

## 9. Research notes preserved from v1 — facts to verify, not implementation permission

- RH Chain: mainnet 4663, testnet 46630. Official: https://docs.robinhood.com/chain/connecting/
- Stock tokens, price/multiplier: https://docs.robinhood.com/chain/stock-tokens/ and https://docs.robinhood.com/chain/stock-token-apis/ . Prior research points to `uiMultiplier()` rather than blindly assuming the PM's named `currentMultiplier()` callable ABI. Verify token decimals/units and timestamp.
- Canonical addresses: https://docs.robinhood.com/chain/contracts/
- CallPut request-based asynchronous execution, track `requestKey` not just transaction hash: https://docs.callput.app/developers/integration-guide and https://docs.callput.app/developers/request-lifecycle-reference
- Zeno options documented buy-only/cash settled: https://zenomarkets.tech/docs . Buy-only venues cannot execute selling covered calls or cash-secured puts. Do not generalize across venue versions without current verification.
- Uniswap v4 hooks: https://developers.uniswap.org/docs/protocols/v4/concepts/hooks . A hook on an Optra spot pool does **not** govern third-party options venue transactions.
- x402 protocol reference: https://docs.x402.org/ and https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md . PM's example uses legacy v1; roadmap integration must use verified current protocol.
- Zolva is reference/inspiration only; do not clone or repeat unverified public stats, wallet architecture or partner claims.

### Known PM specification conflicts to preserve for later resolution

1. `Capra` max range (50%) conflicts with Covered Call template's 100%.
2. `Coverix` means covered-write reservation in one section but Protective Put coverage sizing in another.
3. Protective Put `Calmo OR monthly` conflicts with generic Gate AND/group constraints.
4. `Rescu` short-call up-roll conflicts with Cash-Secured Put down-roll.
5. `Tenora` lacks clear earnings-aware selection needed for Earnings Straddle.
6. Multi-leg fills and short-leg cash/token collateral cannot be assumed from a buy-only venue. Logical token locks ≠ venue-enforced security.
7. Historical option premiums cannot be invented from historical stock candles; Black–Scholes modeling, IV assumptions, actual recorded quotes and real fills must remain separately labeled.
8. Fail-open exit intent does not guarantee third-party venue liquidity/close availability.

Only resolve conflicts that block currently implemented hooks. Keep the rest visible in the backlog instead of spawning unrelated contract or venue investigations during a 48-hour MVP.

## 10. Deferred roadmap (PM preserved, not deleted)

**After MVP:** complete/test all 36 hook evaluators and all 4 House Agents; all 30-day hourly/venue-specific research; full Forge AI compose/veto; The Listing, copy-follow and fee share; Sessions/DST; Optra Floor manual mode; Optra Book + Risk Desk; Public API full schemas; MCP Streamable HTTP; x402 v2/USDG/facilitator; Optra Verify full claims, wallets and audit; guarded live venue adapters; wallet signer policy/smart account, legal geo gating; Uniswap v4 `OptraGuardHook` + registry + spot pool after technical review and audit; proprietary options venue only as future research.

**Never silently delete a PM requirement or claim `FULL PM COMPLETE` when only the 48-hour paper MVP is complete.** Each feature gets `WORKING`, `PARTIAL`, `PLANNED`, or `UNVERIFIED` with an evidence link.

## 11. Task completion and handoff format

At the end of each step send exactly:

```text
STEP / USER FLOW
STATUS: DONE | PARTIAL | BLOCKED
BE: endpoints, tables, logic, validation
FE: routes, states, browser-tested action
TESTS: commands + actual pass/fail
EVIDENCE: DB rows / API output / screenshots / trace
RISKS: only unresolved blockers
FILES: changed files and file owner
GIT: branch + dirty state; no unauthorized commit/push
NEXT: Step XX only, scoped
```

**Release acceptance for 14 November:** a repeatable authenticated PAPER path, deterministic and idempotent processing, data provenance, a working backtest/launch gate where historical data is available, trustworthy Tape and status labels, desktop/mobile core navigation, zero live onchain actions, and an honest list of what remains.
