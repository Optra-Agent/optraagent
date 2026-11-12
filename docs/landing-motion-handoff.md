# Optra Agent: Landing Motion, Hero Intro Fix and Visual Storytelling

Updated: 2026-11-12. Presentation only. The centered hero, the Premium Neutral Dark system, the shadcn/ui components, the app shell and the paper-trading flow are unchanged. No API, schema, engine, backtest or auth code was touched.

## 1. Root cause of the dim hero

Measured, not guessed. Sampling computed opacity (including every ancestor) at first paint showed the headline, description, both CTAs, the status row and the preview card all at **opacity 0**.

The cause was my own `rise` entrance animation on `.hero-copy > *` and `.hero-card`: it started from `opacity: 0`, had 60 to 280 ms staggered delays, and used `fill-mode: both`, so every element sat invisible until its delay elapsed and then faded in over 620 to 700 ms. That sequence ran at the same moment as React hydration and LaserFlow's WebGL shader compile. The main thread was busy, so the fades looked stretched and the hero read as grey and dim while the beam was already starting.

There was no overlay, mask or z-index fault. The laser layer was already below the copy (`z-index 1` against `3`). So the fix removes the cause instead of adding overrides:

- All hero entrance animation is gone. Copy, CTAs, status row and preview are in their final state at first paint, and the page makes sense with JavaScript disabled.
- A second defect found while reproducing: the pre-hydration CSS beam was a hard-edged rectangle (a vertical gradient with no horizontal falloff) and too faint to read. It is now a soft radial glow with a bright core line.

## 2. LaserFlow presentation

LaserFlow itself, the Ember preset and `HeroStage.tsx` are untouched. Only the surroundings changed.

- **Immediate fall:** the CSS beam is in the server-rendered HTML and falls from the top over 800 ms starting at first paint (a `clip-path` reveal, no opacity). It stays visible for 1.8 s and then yields over 900 ms, by which time LaserFlow's own intro has grown. The hand-off therefore never shows an empty gap.
- **Behind the text:** the laser layer keeps a vertical mask (about 45 to 50 percent behind the copy, full strength at the preview edge). Copy also carries a dark text-shadow and the small lines use the muted token. Foreground legibility was checked by eye on every captured frame including the settled one. The scripted contrast audit samples element colors against their CSS backgrounds, so it cannot measure text over the WebGL haze; treat that part as visual verification only.
- **Landing:** the beam meets the preview's top edge and the glow pours across it, as before.
- Reduced motion, the WebGL2 and Save-Data fallback, 1x DPR on touch and compact screens and paused rendering on low-power compact devices are unchanged.

## 3. First viewport

- Description rewritten: "Rule-driven agents trade synthetic calls and puts on Robinhood Chain. Pick a House Agent or build your own rules, backtest the strategy, run it on paper, and inspect every decision on Optra Tape." The headline is unchanged.
- Spacing tightened (hero top padding 36px, smaller gaps, 18px description). At 1440 by 900 the preview now starts at y 553 instead of 630, so about 350px of the real application is visible without scrolling. On a 390px phone the preview begins at the bottom edge of the first screen.
- The Azure primary CTA and an outline secondary CTA are both at full opacity from the first frame.

## 4. Motion system

No animation library was added. `motion` is not a dependency, and the brief prefers not adding a framework, so the motion is CSS scroll-driven animation: no scroll listeners, no JavaScript, no hydration dependency.

**Vocabulary:** one easing (`cubic-bezier(0.2, 0, 0, 1)`), durations 160, 240 and 420 ms, one rise distance (16px). Only `opacity` and `translate`/`scale` animate. The reveal uses the independent `translate` property so it cannot override the hover `transform`.

| Pattern | Where | Behavior |
|---|---|---|
| Entry (`.reveal`) | Tape figure, ledger, FAQ list, breaker guard, Sessions line, final CTA | Fade and 16px rise tied to scroll position |
| Entry and soft exit (`.reveal-lead`) | Every section head | Same entry; as it leaves the top it settles to 55% opacity and 10px up, never fully hidden |
| Stagger (`.reveal-stagger`) | Agent board, Forge nodes, stage nodes, How it works steps, Lab rows, Dual Mode cards, Forge points | Each child starts 7% of its range later than the one before |
| Drawn connectors | Forge nodes, hook stage nodes, Tape join, How it works rail | Lines draw in with scroll; the rail is scroll-linked |
| Hover and focus | Cards (`.lift`), links, FAQ summary, footer links | 3px lift and border emphasis; colors transition in 160 to 240 ms |
| Press | All buttons | 1px press (`active:translate-y-px`) |
| Accordion | FAQ | Smooth height transition via `::details-content`, plus rotating plus sign |
| Tabs | App agent page | 200 ms content fade |

Because the animations are scroll-linked, scrolling back up replays them in reverse with no state to get stuck. Not-yet-scrolled content below the fold is at its start state until it enters the viewport. Print forces everything visible.

## 5. Visuals added per section (all built from real product concepts)

- **House Agents:** the app's own `TemplateCard` on a board: Protective Put featured (Paper ready, facts, collapsible six-stage recipe), three Preview cards each stating "Not yet available".
- **Forge:** four-node interface workflow: Describe or click (describe-in-words dashed and Coming soon, click Working) → Pick hooks (per-stage counts, 15 of 36 selectable) → Validated recipe (a `sha256:` placeholder that is explicitly "computed once the server validates") → Backtest.
- **36 hooks:** Gate, Strike, Size, Pulse, Expiry as connected nodes, each with a cell per hook (filled = implemented evaluator), true counts and the implemented hook names. The Breaker spans beneath as an always-on guard (5 of 5). Legend: 21 catalog-only, locked.
- **How it works:** four numbered steps on a scroll-drawn rail with small interface fragments (form, 721 plus 720 candle bar, Run paper tick, pass/block/hold trace), labeled illustrative, with "every run is paper".
- **Tape:** four rule verdicts converge on one decision (hold), labeled "Illustrative paper example. Not a recorded trade." No executed trade, price or P/L.
- **Lab:** verified candles (721 warmup plus 720 decisions, source-backed), modeled premiums (Black–Scholes, RV30 × 1.1, 50 bp, fees not modeled), result slots that appear only after a complete run, and "Comparison with holding the stock: Not yet available". No returns or charts.
- **Sessions:** a 24 hour Eastern Time line. Only regular hours (09:30 to 16:00) are "Entries allowed", from the implemented Sessia hook. Opening and Closing Bell choices are labeled Planned.
- **Dual Mode:** You / You + Hook / Agent control switch with only Agent active; Agent mode "Working on paper", Manual Floor dashed and "Planned: no route or service exists yet".
- **Developers:** real read-only public endpoints as live links with honest states (agents and tape "Empty": no public visibility model), MCP and x402 as Planned.
- **Verify:** an evidence ledger rendered from the server's own claims (read through the same handler as the public API, so `v4 claim level` and `Live execution: Disabled` come from the server), each with its evidence path; roadmap rows say "No evidence yet".

Section order follows the PM: House Agents, Forge, Hooks, How it works, Tape, Lab, Sessions, Dual Mode, Developers, Verify, FAQ, final CTA. The nav was updated to real anchors: Agents, Forge, Hooks, How it works, Tape, Lab, Verify.

## 6. Performance and accessibility safeguards

- Reduced motion: every reveal, connector and the CSS beam fall are inside `prefers-reduced-motion: no-preference`; with reduce, all `.reveal*` elements measure opacity 1 without scrolling (tested).
- No JavaScript: the hero, preview, all sections and the CSS beam render (tested).
- No scroll listeners; only compositor-friendly properties (the beam fall uses a one-element `clip-path`). No WebGL outside the hero. Section headings are plain elements (the extra `header` landmarks were removed).
- Layout stability: nothing animates size or position in flow; overflow sweep at 390, 768, 1024 and 1440 passed.
- Browsers without scroll-driven animation (currently Firefox by default) show the same content statically.
- Link targets raised to 32px. The scripted audit found no unnamed controls, unlabeled fields, heading-order problems or CSS-contrast failures on the landing page (it was run before the final link-size tweak and not repeated).

## 7. Browser verification

Chromium (headless, SwiftShader WebGL) against the existing dev server on port 3001. The unrelated project holding port 3000 was left alone; tests used a scratch Playwright config pointing at 3001.

- **Hero frames** (real-time CDP screencast, not screenshots): at 0 ms, about 500 ms, 1.5 s, 3 s and settled (7 s), the headline, description, CTAs and status row are fully readable. The beam is falling at 500 ms, full length by 3 s, and LaserFlow's beam lands on the preview edge by 7 s. See `docs/ui-screenshots/landing-hero-t*.jpg`.
- **Scroll down then back up** through every section: revisited sections render fully. Measured opacity at section heads and agent cards is at least 0.95 once in view, both directions.
- Desktop 1440, tablet 768, mobile 390 for all sections: no horizontal overflow, no page errors.
- The real signed-in flow (wallet session, create draft, Lab backtest, launch, paper tick, Tape) ran again against the real backend on an isolated database after touching the shared `Button`, `Tabs` and `TemplateCard`: zero console errors. The wallet session was created by signing the server's challenge with a test key, because no wallet extension is installed.

## 8. Tests

| Command | Result |
|---|---|
| `bun run typecheck` | passed |
| `bun run lint` | passed |
| `bun run test` | 29 files, 89 tests passed |
| `bun run test:e2e` | 27 of 27 passed (the 11 original specs unchanged; landing, verify and shell specs; 5 new landing specs cover first-paint opacity with no fading animations, no-JavaScript rendering, scroll reveals both directions, reduced motion, and true hook counts) |
| `bun run build` | passed; `/` prerendered |

Run note: `bun run test:e2e` with the repo config cannot run while an unrelated project (cwd `.../SENTERA`) owns port 3000. The same specs were run through the scratch config against port 3001.

## 9. Files

Changed this pass: `components/marketing/sections.tsx`, `components/marketing/data.ts`, `components/marketing/MarketingNav.tsx`, `components/app/agents/TemplateCard.tsx` (children and href props), `app/(marketing)/marketing.css`, `app/(marketing)/page.tsx`, `components/ui/button.tsx` (press feedback), `components/ui/tabs.tsx` (content fade), `tests/e2e/landing.spec.ts`, `docs/ui-screenshots/`, this document.

Untouched: `components/LaserFlow.*`, `components/marketing/HeroStage.tsx`, `app/api/**`, `lib/**`, `db/**`, `drizzle/**`, `package.json`, `next.config.ts`, `playwright.config.ts`, all other existing specs.

## 10. Remaining limitations

- Scroll-driven animation is Chromium-first. Browsers without it get static content, which is by design but means the storytelling is Chromium and recent Safari only. No Safari or Firefox pass was run, and WebGL frame rate was not measured on real devices.
- Below-fold content is at its start state until scrolled into view, so full-page screenshots taken without scrolling, and find-in-page highlights on unseen sections, show the unrevealed state. Print is handled.
- The beam timing in the screencast comes from headless SwiftShader and a dev server. Production hydration should be faster; the first paint no longer depends on it.
- The how-it-works and Forge fragments are illustrative interface sketches, labeled as such, not live data.
- Backend requests from earlier passes (holding and cash benchmarks, public Tape) are unchanged.

## Git

Nothing was committed, pushed or deployed.
