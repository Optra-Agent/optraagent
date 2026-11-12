# OPTRA AGENT — CLAUDE WEB UI/UX DIRECTION BRIEF v1.1

**Purpose:** Art direction and implementable product UI specification only. No application coding yet.
**Project:** Optra Agent, Robinhood Chain (EVM), chain ID 4663.
**Development constraints:** Two effective engineering days, 12–13 November 2026; 14 November is final QA/handoff.
**Source of truth, in priority order:** (1) Original PM `Optra Agent: Developer Product Brief` (§0–25); (2) `OPTRA_MASTER_EXECUTION_BRIEF_V2.md` (approved or proposed 48-hour MVP scope); (3) original PM screenshot of Zolva. Highlight conflicts instead of silently changing requirements.
**Next step after approval:** Claude Code implements UI inside the SAME repository as Codex; this document must be a compact handoff, not a new repository or app.

---

## ROLE AND MISSION

You are Claude Web acting as **Senior Product Designer + Art Director for a premium fintech / Web3 trading app**. Study the original PM brief before suggesting visual concepts. Research Zolva and complementary product UI references where publicly accessible, but DO NOT copy Zolva's logo, styling signature, page composition, assets, copy, or component designs. The **interaction logic can follow the PM's Zolva-inspired workflow**, while visual identity must be unmistakably Optra.

Deliver a design that makes users understand the product **within 10–15 seconds** and is straightforward for a Next.js / Tailwind / shadcn engineer to build quickly. Avoid an inflated design exercise. **This is not a request to implement code, change architecture, or invent financial features.**

## PRODUCT: WHAT OPTRA IS (AND IS NOT)

Optra is an **agent-first synthetic options platform** on Robinhood Chain, centered on rule-driven agents using 36 named hooks across six stages: Gate (10), Strike (7), Size (4), Pulse (7), Expiry (3), Breaker (5). Users choose a House Agent or assemble a Custom Agent via Forge; validate a strategy; run a 30-day backtest when credible data exists; start in paper mode; and read every decision on Optra Tape.

AI may help translate a natural-language strategy into an editable recipe and optionally veto an entry later. **The deterministic rule engine makes decisions.** Manual Floor is a secondary future flow. Optra does not give stock ownership. Live real-money execution, Uniswap v4 deployed hooks, Listing fee-share, x402, and production MCP must not be visually represented as working merely because the full PM roadmap includes them.

**48-hour MVP north star:**
`Connect EVM Wallet (MetaMask / Phantom EVM) → Choose one supported House Agent → Inspect / Validate Recipe → Backtest → Launch PAPER Agent → Evaluate Tick → See Positions and Decision Tape`.

Other PM modules remain in the full information architecture but may be visibly labeled *Preview* / *Planned*, omitted from the primary CTA, or introduced as supporting content depending on actual runtime readiness.

## RESEARCH TASK — BOUNDED, VISUAL AND EVIDENCE-BASED

Review these references, with a maximum of **five useful sources**:

1. **PM-provided Zolva screenshot** — authoritative aesthetic benchmark: controlled dark surfaces, strong simple type, crisp hierarchy, restrained accent; not an instruction to clone Zolva's purple brand.
2. **https://zolvaagent.app/** — if accessible, analyze information architecture, agent browse/build/backtest/Tape pathways and what feels premium. If not accessible, say so and use the screenshot + PM descriptions. **Do not invent observations.**
3. **https://github.com/zolvaagent/zolva** — read public product descriptions/flows, not an instruction to reuse source code.
4. **https://docs.callput.app/** — only to understand the semantic representation of options, strike, expiry, premium, and request states; not to copy branding.
5. **One exceptional, relevant interface reference of your choice** — editorial fintech hierarchy, financial data density, or builder interaction. Explain what is useful and what must not be copied. Do not use unrelated crypto landing pages merely because they look flashy.

For each relevant source provide: **URL / what you learned / safe-to-adapt UX principle / what would be copying or inappropriate**. Distinguish what you actually inspected from suggestions.

## BRAND LOCKS FROM PM

- Product: **Optra Agent** / Optra.
- Category: **AI options agents · Robinhood Chain**.
- Canonical H1: **“Let agents trade the strike.”** (do not casually replace).
- PM signature: **“Hooked agents. Every strike explained.”**
- PM dual-mode line: **“Two modes. One book.”** — but only secondary, not hero-led.
- PM truthful AI line: **“Rules decide. AI writes them with you, and can veto.”** Explain the available MVP capability if AI Compose is not integrated.
- First fold must make **agent + synthetic call/put options + Robinhood Chain + paper-first + explainable decisions** clear.
- No investment promise, no fictional performance numbers, no invented volume, no fake public community agents, no Robinhood/Uniswap/NYSE affiliation claims.
- Correct product distinction: synthetic options settled per venue rules are **not shares or tokenized stock ownership**. Do not imply confirmed USDG settlement for a venue until verified for that product.
- Uniswap v4 copy **must start at claim level L0** unless verified deployed contracts justify another level: *“Hooks inspired by Uniswap v4”*. Never say *“all 36 hooks are onchain”*.

## VISUAL LANGUAGE — PREMIUM DARK THEME, NOT AI SLOP

**Approved UI direction change:** Use a **neutral Dark Theme**, not a navy-leaning / Midnight Ink aesthetic. The PM originally proposed "Midnight Ink"; this art-direction change intentionally supersedes the *background/surface appearance only*, not the product vision, content, user flows, or the Azure/Vermilion accent identities. Claude Web should refine contrast, but the foundation should visibly read **near-black / charcoal / graphite**, not dark blue.

**Starting palette for exploration (design proposal, not hardcoded product requirement):**

- Main background `#0B0C0E` — neutral dark charcoal, no blue cast
- Elevated background `#131518` — refined graphite surfaces
- Card/background alternative `#191B1F` — restrained depth
- Borders/dividers `#2B2E33` — subtle neutral separation
- Primary Azure `#1E8FFF`; hover `#4AA8FF` — actions, agent signals, and calls
- Secondary Vermilion `#E8492A`; hover `#FF6A47` — limited accents, puts, alerts
- Primary text `#F3F4F6`; secondary `#A1A6B0` — readable on near-black
- Gains `#2BD47D`; losses `#FF5D73` **only for PnL**; never use Vermilion Put to mean loss

Use dark neutral surfaces across landing and app; avoid blue-tinted full-page gradients, atmospheric purple glows, or the word "Midnight" as a design theme. Azure and Vermilion stay as restrained accents rather than turning the UI into neon. Treat the original PM colors as proposals to reconcile with this founder-approved change, and explicitly record the difference in the design handoff. Test meaningful text contrast, especially muted text and small labels. Choose ONE production-ready typographic pair with a distinctive, legitimate commercial-use license (PM candidates IBM Plex Sans + IBM Plex Mono or Inter + JetBrains Mono). Numbers/Tape should align in monospaced type. Favor clean rectangular geometry, subtle 4–12px corner radii, intentional whitespace, thoughtful density, precise borders, quiet motion (120–180ms), and `prefers-reduced-motion`.

**Prohibited generic output:** random glowing orbs, blurry purple gradients resembling Zolva, giant stock chart with made-up profit, decorative 3D AI head/brain, repeated floating glass cards, default crypto neon, generic SaaS bento sections, excessive icon badges, meaningless moving tickers, fake testimonials, fake audits, and whole page in the same anonymous Inter-only style.

Create **only two concise visual directions** with the newly approved neutral dark base and restrained PM Azure/Vermilion accents, for example:
- **A: Exchange Editorial** — institutional trading floor, editorial rhythm, strong headline, confident information hierarchy.
- **B: Agent Control Room** — precise system status, modular but calm, real decision trail as the motif.

State differences in hero composition, nav, type, data layout, component density, and motion. Recommend **one** based on feasibility and uniqueness; do not create five open-ended concepts.

## UX FLOW (MUST PRESERVE THE BUSINESS LOGIC)

1. Visitor lands on `/` and immediately knows what Optra does and that the MVP is **PAPER**.
2. `Launch a paper agent` directs to the actually functioning agent-selection / builder route (`/agents` or `/forge?template=...`, adjust to approved route contracts).
3. When authentication is required, user connects **MetaMask or Phantom EVM**. No Email/Google login as part of the 48-hour MVP. Wrong chain, no extension, reject-signature and disconnected states deserve concise UI.
4. User selects a House Agent and sees: underlyings, exact structure/call-put direction, rules, primary risks, and **Paper-ready** versus **Preview** status grounded in implementation.
5. User reviews the recipe (six stages) and validation; unsupported hook or unsafe option structure cannot masquerade as launchable.
6. Lab displays a 30-day backtest only when sufficient data exists, with `Modeled premiums` / `Recorded quotes` provenance and an explicit comparison to holding and cash; include negative results, not only winning trajectories.
7. User launches the **same recipe hash** on paper; show clear `PAPER · virtual USDG`, never a live/capital-deposit visual.
8. Agent Detail / Tape shows actual persisted decisions and per-hook reasoning. Empty/hold/skip/error statuses are meaningful, not artificially populated.

**Only these are required interactive MVP screens:**
- Landing `/`
- House Agent browse `/agents`
- Forge / recipe setup `/forge` (click builder first; AI input only if actually enabled)
- Backtest `/lab`
- Agent Detail `/agents/[id]`
- Decision Tape `/tape`
- Hook library `/hooks` (catalog can show planned/evaluator readiness)
- Verify `/verify` (minimal honest status)

**Full PM navigation remains:** Agents, Forge, Hooks, Listing, Tape, Lab, Floor, Developers, Verify. Handle unbuilt features responsibly: no dead primary CTA and no phantom trading dashboards. Nav may distinguish active vs roadmap items without pretending they operate. Do not create additional marketing routes just to fill space.

## LANDING: 15-SECOND RULE + PM SECTION ORDER

The PM asks for this sequence of **16 elements** in the eventual landing:
1. Ticker bar
2. Hero
3. House Agents
4. Forge / Custom Agents
5. Hooks
6. How it works
7. Tape
8. Lab
9. Listing
10. Sessions
11. Dual Mode
12. Developers
13. Verify
14. FAQ
15. Final CTA
16. Footer

For 48-hour development, produce **detailed design for the first fold + six highest-value sections** (Hero, House Agents, Forge, How It Works, Tape, Lab, Verify), then a **compact section map** for the remaining PM sections. Do not discard the roadmap; do not demand 16 bespoke animated modules before the paper engine works.

**Mandatory hero copy hierarchy:**

Eyebrow: `AI OPTIONS AGENTS · ROBINHOOD CHAIN`

H1: `Let agents trade the strike.`

Preferred simplified description: `Choose an agent or build your own rules for synthetic calls and puts. Backtest the strategy, run it on paper, and inspect every decision.`

Primary CTA: `Launch a paper agent`

Secondary CTA: `Watch the Tape` (only route to public live data if available; otherwise an honest explainer)

Required microcopy near CTA: `Paper first. Synthetic options on stock prices. Not shares. Not investment advice.`

Hero proof is the **actual workflow**: an agent preview + a compact, credible example of a decision trace. Any static example must explicitly say `Illustrative PAPER example` and not pretend to be a real trade, PnL, TVL, or live market feed.

**10–15 second comprehension test:** An unfamiliar visitor should be able to say: *“Optra lets me build or choose rules-driven agents for synthetic calls and puts on Robinhood Chain, test them with virtual money, and inspect each decision.”* The term `strike` is less familiar; subordinate explanatory copy must resolve it without making users read a full page.

## HIGH-VALUE COMPONENT SPEC (FEASIBLE IN TAILWIND/SHADCN)

Design only patterns that can be reused, with variants and states:

- `AgentCard`: House/Custom, paper readiness, risk, structure, next action, summary; no fabricated ROI.
- `RecipeStage` / `HookChip`: stages, one edited parameter, validation success/error, evaluator support, onchain/offchain location honestly.
- `TapeRow`: decision/time/underlying, hook trace expandable, `PAPER`, data provenance, hold/skip as first-class actions.
- `PaperBanner`: always visible in the agent, Lab and positions context; explain virtual balances, differentiate planned Live safely.
- `BacktestComparison`: 3-way agent/holding/cash comparison, modeled/recorded premium warning, loss visibility, loading/insufficient-data.
- `VerifyClaim`: `Working/Paper/Planned/Unverified`, evidence link when real, last verified, no fictional audits.
- `WalletConnectState`: MetaMask/Phantom EVM, chain mismatch, missing extension, rejected signature, loading.

Include desktop 1440px and mobile 390px behavior: nav collapse, tables/cards, CTA visibility, no horizontal scrolling, Tape readability, touch targets, keyboard focus, reduced motion. Sketch a **single desktop first fold and single mobile first fold**, not a full screen collection.

## NO FALSE UI / CONTENT POLICY

- A descriptive sentence about a future planned feature is fine, but no working button that has no backing route/service.
- Distinguish `Paper`, `Preview`, `Planned` and `Verified`. Only actual source data can populate stats. Static educational examples must be labeled as such.
- Avoid disclosing unpublished wallets or secrets in mockups. Do not invent addresses, chain-specific token values or historical option prices.
- No claim that Optra already executes options live. No token project promotion; it is not in PM scope.
- Risk copy should be present but not overwhelm the hero. Primary paper state must remain explicit.

## OUTPUT FORMAT — CONCISE, ACTIONABLE, NO CODE YET

Deliver in exactly this order:

1. **PM fidelity audit (max 12 bullets):** What is locked, what is merely proposed, what MVP changed; distinguish PM requirements from your own design ideas.
2. **Reference analysis (max 5 sources):** URLs, observed ideas, no-clone boundary; admit unavailable references.
3. **Two design directions (one short comparison table):** A vs B with benefits/tradeoffs; choose one as the definitive recommendation.
4. **Locked design tokens (one table):** Color roles/hex/contrast concerns, typography, spacing/grid/radius/motion. No endless options.
5. **15-second landing plan:** hierarchy, copy, detailed desktop/mobile hero wireframes (ASCII or structured layout). Clear CTA destinations, honest proof and paper label.
6. **PM 16-section map:** one row per section with message, priority `Build MVP` vs `Roadmap visual`, and real/static data requirement. Follow PM order.
7. **App information architecture:** route → what user does → data needed → critical UI states. Must follow the core flow above and avoid creating backend architecture.
8. **Six reusable component blueprints:** visual anatomy, states and responsive behavior; include AgentCard, RecipeStage/HookChip, TapeRow, PaperBanner, BacktestComparison, WalletConnectState (mention VerifyClaim if space).
9. **Claude Code implementation handoff, max one page:** file ownership limited to `app/(marketing)`, app presentation routes and `components/marketing`, `components/app`, `components/ui` subject to actual repo structure; design token CSS/Tailwind recommendations; stable data props/contracts; what NOT to edit (engine, auth, DB, execution); skills/MCP usage only if available locally (Anti-Slop, ui-ux-pro-max). No new repo, no new stack and no live transactions.
10. **Five-point founder approval checklist:** Only actionable yes/no decisions (direction, colors, hero, layout, realistic scope). Do not ask a large discovery questionnaire.

**Stop when this is delivered.** Do not produce React code, deploy anything, create a separate frontend repository, or hand off to coding agents until the UI direction is approved. If your web/visualization tools support mockups, one static hero concept can supplement the written output, but must not replace the design specification.
