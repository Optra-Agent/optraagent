# Optra Agent: Final UI Handoff

Updated: 2026-11-12. Scope: premium landing page and application UI on top of the verified Codex Protective Put paper core. No API, schema, migration, engine, backtest, paper-execution or auth code was changed.

## UI STATUS

Delivered and verified in a real browser (details below). One known visual gap: positions and orders with real values could not be produced live because the US market is closed today; that layout was checked with schema-valid mocked responses only.

Design read: options-agent product for technical retail traders, Premium Neutral Dark, institutional tone. Dials: landing ENERGY 2 / RHYTHM 3 / MOTION 2, app ENERGY 1 / RHYTHM 2 / MOTION 1. Identity motif: the decision trace, a stage-by-stage rule ladder, repeated in the hero card, the hook-coverage ladder, the journey rail and the Tape trace.

### Visual system

| Role | Value | Reason |
|---|---|---|
| Background / surface / raised | `#0B0C0E` / `#131518` / `#191B1F` | Neutral graphite, no blue cast. |
| Line | `#2B2E33` | Quiet separation instead of shadows. |
| Text / muted / dim | `#F3F4F6` / `#A1A6B0` / `#868C97` | All pass AA on every surface they sit on (sampled, see Accessibility). |
| Azure | `#1E8FFF` (hover `#4AA8FF`) | Actions, calls, implemented status, journey progress. Primary buttons use near-black text (6:1) because white on Azure fails AA. |
| Ember | `#FF5A1F` (text `#FF6A47`) | The hero beam, puts, modeled-premium labels, blocked and disabled states. |
| Gain / Loss | `#2BD47D` / `#FF5D73` | P/L numbers only. |
| Type | IBM Plex Sans Condensed (display), IBM Plex Sans (UI), IBM Plex Mono (numbers, hashes, timestamps) | One OFL superfamily from the PM candidate list. The condensed cut gives the headline a trading-floor voice; mono keeps columns aligned. Loaded with `next/font/google`. |
| Radius | 4px chips and inputs, 8px controls, 12px cards | Variation encodes hierarchy; nothing is pill-shaped. |

Shadows appear only on floating layers (wallet popover). There is no glassmorphism and no background grid. Gradients are limited to the hero beam and two hierarchy washes (featured template, next-step card).

## LASERFLOW

- Installed from the official registry with `bun x --bun shadcn@latest add @react-bits/LaserFlow-TS-CSS --yes`. Variant TypeScript + CSS. Files: `components/LaserFlow.tsx`, `components/LaserFlow.css`. The registry item lists no dependencies and the component uses raw WebGL2, so `package.json` and `bun.lock` are unchanged. A minimal `components.json` was created so the `@react-bits` alias resolves.
- One local edit to the vendor file: an `eslint-disable-next-line react-hooks/refs` comment above `settingsRef.current = settings` (upstream "latest props" pattern; the repo lint rule rejects it).
- Used once, in `components/marketing/HeroStage.tsx`, loaded with `next/dynamic` (`ssr: false`). Not used anywhere in the app.
- Approved Ember preset, exactly: `beamPosition={0.63} color="#ff5a1f" intensity={1.8} flare={1.25} spread={1.5} spill={1} fog={0.5} dust={1.6} beamWidth={0.55} revealRadius={220} revealOpacity={0.6} theme="dark"`.
- `revealImage` is omitted. `public/` has no UI screenshot asset, and the brief forbids referencing a missing one. The card is opaque, so no reveal image would show through it anyway.
- The beam lands on the top edge of a real Protective Put recipe card (`surfaceRef`). Desktop at 1100px and up is a split hero with the beam inside the first viewport. Below 1100px the card sits in flow under the copy and the laser is confined to the stage so it never crosses text.
- Safeguards:
  - WebGL2 probe plus Save-Data check. If either fails, a static CSS Ember beam and card-edge glow render instead (`data-laser="fallback"`). The CSS beam also renders during SSR and the first paint.
  - Reduced motion: LaserFlow renders a still frame (the component honors the media query itself) and `intro` is off.
  - Compact and touch screens: render at 1x DPR, pointer lens off. Compact screens on 4 cores or fewer render a paused still frame.
  - LaserFlow already pauses off-screen (IntersectionObserver) and in hidden tabs.
- Not measured: frame rate or GPU cost on real devices, and rendering in Safari or Firefox. Verified in headless Chromium with SwiftShader only.

## WORKING ROUTES

| Route | What changed |
|---|---|
| `/` | New landing page (route group `app/(marketing)`). The old redirect to `/agents` is removed, as requested for this pass. Sections: hero, House Agents, Forge and hooks (coverage ladder from the catalog), How it works and Lab, Tape, Status table, FAQ, final CTA, footer. |
| `/agents` | Journey rail, wallet-aware states, owned agent cards with status-specific next action, template catalog with the paper-ready Protective Put featured and three labeled Previews, sticky configure form with a recipe outline. |
| `/agents/{id}` | Status-aware next-step card (backtest, tick, resume, fork), structured paper tick result, lifecycle controls, recipe overview with hook chips, positions, orders table, Tape with collapsible trace. Data stays on screen while it refreshes. |
| `/forge` | Six stage groups, implemented hooks selectable, catalog-only hooks locked with reasons, live recipe outline, server validation with canonical hash, Save draft locked until valid, AI composition shown as Planned (no button). |
| `/lab` | Coverage meter, assumptions, backtest result tiles (negative results shown plainly), launch, success panel with links. `?agent={id}` preselects a draft and pins the symbol to the draft's underlying so coverage and backtest agree. |
| `/tape` | Agent picker when no agent is selected, summary tiles, action filter, stage-ordered trace with the data each rule used, positions, orders. |
| `/hooks` | Stage tiles with live counts, stage filter (tiles and select), cards with implementation notes and blocked reasons. |
| `/market` | Quote board with underlying and token quotes separated, stale and halt callouts. |
| `/verify` | New. Renders `/api/public/v1/verify` claims with evidence links, safety switches, and a labeled list of unshipped features. |

Shared pieces: paper banner on every app and landing page, responsive header with menu (Escape closes), wallet popover (Escape and outside click close, explains that sign-in sends no transaction), `JourneyRail` (Connect, Choose and configure, Backtest, Launch paper, Run paper tick, Inspect Tape), `StateBlock` for loading, empty, error, blocked and info states, `DecisionTrace`.

## DATA CONTRACT INTEGRATION

- Every screen reads the existing endpoints and parses them with the existing Zod schemas. No mock or fixture data is rendered in product code.
- The landing page derives hook counts and the hero recipe from `getHookCatalog()`, `getHouseAgentTemplates()` and `buildProtectivePutRecipe()`, the same sources the API serves.
- Honest labels used: `Paper`, `Modeled premiums`, `Paper ready`, `Preview`, `Not yet available`, `Coming soon`, `Planned`, `Disabled`. Protective Put is the only House Agent that is selectable. 15 hooks are selectable; 21 are locked. Uniswap v4 copy stays at L0 (`Inspired by Uniswap v4 hooks. None is deployed onchain.`). Venue fees are stated as not modeled.
- The landing Tape sample is labeled `Illustrative paper example. Not a recorded trade.` and uses no P/L, price or fill.
- Parse failures show a readable message (`errorText` in `components/app/format.ts`) instead of raw validation JSON.
- One UI-only context change: `AuthSessionProvider` now exposes `walletMenuOpen` and `setWalletMenuOpen` so in-page buttons can open the header wallet menu. Session, challenge, signature and cookie logic are untouched.

## FUNCTIONAL FLOWS VERIFIED

Real browser (Chromium), real Next dev server, real backend and live Crius candles, isolated PGlite database. The session cookie was minted by signing the server's challenge with a test key and injecting it, because no wallet extension is installed. The extension signature prompt itself was therefore not exercised.

Desktop 1440 and mobile 390 both completed: `/agents` signed in, create Protective Put draft, agent page shows the Backtest next step, `Backtest in Lab`, coverage 1499 of 1441 candles ready, run backtest (720 decisions, 2 modeled entries, 1 exit, total return -0.02%, drawdown 0.05%), launch paper agent, open agent, run paper tick (recorded `skip`, entry blocked by Sessia because the US market is closed), Tape with the 15-rule trace. Zero console errors. A final regression pass of the desktop flow ran after the last code edits.

Also verified: signed-out states on every route, wallet popover with no extension (error shown), stale and halted quote messaging (e2e), Forge validation block for unsupported recipes (e2e), WebGL fallback and reduced motion on the landing page (e2e).

## ACCESSIBILITY AND RESPONSIVENESS

- Horizontal overflow sweep: 11 routes by 4 widths (390, 768, 1024, 1440). One real overflow was found and fixed (Market quote values at 768 and 1024); the sweep then passed.
- In-page audit at 1440 across 9 routes: one `h1`, `lang`, header, nav, main and footer landmarks, every button and link named, every field labeled, no skipped heading levels, sampled text contrast at or above AA. Titles are unique per route. Standalone link and summary targets raised to 32px (44px on touch widths).
- Keyboard: logical Tab order with a visible 2px focus ring on every stop (landing, agents, forge, hooks), skip link on the landing page, Escape closes menus and the wallet popover.
- `prefers-reduced-motion` disables CSS motion globally and stills the beam.
- axe-core was not run: the harness blocked injecting remote scripts. The checks above are a self-contained substitute, not a full WCAG audit.
- Not measured: Lighthouse, Core Web Vitals, bundle size.

## REMAINING LIMITATIONS

- Positions and orders with real values were verified only through schema-valid mocked responses (market closed). The database integration test from the core handoff covers the backend side.
- Backtests do not compare with holding or cash; the Lab says `Not yet available`.
- No public Tape or agent list exists, so the landing page cannot link a live Tape.
- Premiums are modeled and venue fees are not modeled. Real-money execution is disabled.
- No `revealImage`; no cross-browser or real-device WebGL check.
- Backend requests are in `docs/ui-integration-requests.md`. None blocks the supported flow.

## TEST RESULTS

Final run, 2026-11-12:

| Command | Result |
|---|---|
| `bun run typecheck` | passed |
| `bun run lint` | passed, no findings |
| `bun run test` | 29 files, 89 tests passed |
| `bun run test:e2e` | 19 passed (11 existing, unchanged; 8 new in `landing.spec.ts` and `verify.spec.ts`) |
| `bun run build` | passed; `/`, `/agents`, `/forge`, `/hooks`, `/market`, `/verify` prerendered, `/agents/[agentId]`, `/lab`, `/tape` dynamic |

Environment note: a `next start` process (PID 72815, started before this session) was holding port 3000 on IPv6 and returned 404 for app routes. Playwright's `reuseExistingServer` picks up whatever answers on `127.0.0.1:3000`, so `bun run test:e2e` fails whenever that stale process is the only listener. Stop it, or let Playwright start its own server, before running e2e. I did not kill it.

## FILES CHANGED

Added: `app/(marketing)/` (layout, page, `marketing.css`), `app/(app)/verify/page.tsx`, `components/marketing/` (`HeroStage`, `MarketingNav`, `sections`, `data`), `components/app/ui.tsx`, `components/app/paper.tsx`, `components/app/format.ts`, `components/app/verify/VerifyScreen.tsx`, `components/LaserFlow.tsx`, `components/LaserFlow.css`, `components.json`, `tests/e2e/landing.spec.ts`, `tests/e2e/verify.spec.ts`, `docs/final-ui-handoff.md`, `docs/ui-integration-requests.md`, `docs/ui-screenshots/` (7 evidence images).

Rewritten or restyled: `app/globals.css`, `app/layout.tsx` (fonts, metadata), `app/(app)/layout.tsx`, every `app/(app)/*/page.tsx` (titles; `/lab` reads `?agent=`), `components/app/AppNav.tsx`, `WalletSession.tsx`, `AuthSessionProvider.tsx` (menu state only), and the agents, forge, hooks, lab, market and tape screens. `docs/landing-content-contract.md` updated to the shipped copy.

Removed: `app/page.tsx` (redirect).

Departures from `docs/ui-handoff-contract.md`, all required by this pass: `/` is now the landing page; `app/layout.tsx`, `components/LaserFlow.*`, `components/marketing/**` and `components.json` are new or changed outside the original ownership list; two new test files were added (no existing test was edited). Not touched: `app/api/**`, `db/**`, `drizzle/**`, `lib/**`, `next.config.ts`, `package.json`, `bun.lock`, `.env.example`, existing tests.

## GIT

Nothing was committed, pushed or deployed. The repository already had staged Codex files from before this pass; this pass's changes are unstaged and untracked on `main`.
