# Optra Agent: UI Consistency and Layout Refinement Handoff

Updated: 2026-11-12. This pass changed presentation only. No API, schema, migration, engine, backtest, paper-execution or auth logic was touched. The wallet flow, recipe validation and Zod contracts are as the Codex core left them.

## Summary

- The landing hero is now a centered composition: eyebrow, one-line headline, description, CTAs, compact scope indicators, then a large read-only preview of the real Agents screen that the Ember beam lands on.
- The preview is rendered from the app's own components (`SidebarView`, `JourneyRail`, `TemplateCard`, `Panel`, `Chip`, `Input`, `Button`), so it cannot drift from the product. The oversized recipe card is gone from the hero; the six-stage breakdown moved into the House Agents section behind a disclosure.
- The authenticated app uses one shell: persistent sidebar on desktop, a Sheet drawer below 1024px, one compact topbar with the Paper label and the wallet controls.
- Controls are shadcn/ui throughout, themed from the Optra tokens.

## Landing hero

- Layout: `components/marketing/sections.tsx` (`Hero`), `app/(marketing)/marketing.css`. The headline is a single line from about 700px up (`clamp(44px, 6.6vw, 94px)`) and balances onto two lines on phones.
- Copy keeps the PM hierarchy: `AI OPTIONS AGENTS · ROBINHOOD CHAIN`, `Let agents trade the strike.`, House Agents and custom rules, backtest, paper, Optra Tape, then `Paper first. Synthetic options on stock prices. Not shares. Not investment advice.` The scope row states only catalog-derived facts (1 of 4 House Agents paper ready, 15 of 36 hooks implemented, modeled premiums, venue fees not modeled, live trading disabled).
- LaserFlow: not reinstalled or modified. The Ember preset is byte-for-byte what `HeroStage.tsx` already passed. Only the surroundings changed: the laser layer spans the whole hero, the preview card is the `surfaceRef`, and the beam lands on its top edge with the spill pouring around its corners.
- Readability: a vertical mask dims the laser to about 30 to 36 percent behind the copy and restores it to full strength at the preview edge. Text carries a dark text-shadow and the small lines use the muted token. Reduced motion, the WebGL2 and Save-Data CSS fallback, 1x DPR on touch and compact screens, and paused rendering on low-power compact devices are unchanged.
- Preview honesty: it is `aria-hidden` and `inert`, captioned `Read-only preview of the Agents screen inside the app. Availability and counts come from the live hook and template catalog.` It shows the signed-out screen with the form's own defaults. It contains no balance, quote, fill, P/L or live record.
- Mobile: the sidebar and the configure panel drop out of the preview below 900px; the card height is capped and fades out.

## App shell

- `components/app/AppShell.tsx` (client) wraps every `(app)` route from `app/(app)/layout.tsx`. `components/app/Sidebar.tsx` holds `SidebarView`, used by both the real shell and the landing preview.
- Desktop: 248px sidebar with Workspace (Agents, Forge, Lab, Tape) and Reference (Hooks, Market, Verify) groups, active state via `aria-current`, and a Paper mode note. Topbar: `PAPER` label with the virtual-USDG note on the left, wallet and network controls on the right, always in the same place.
- Below 1024px: the sidebar becomes a shadcn Sheet opened from `Menu`, closes on navigation and Escape. Content keeps full width.
- Wallet: the connect menu is now a Dialog (MetaMask, Phantom EVM, an explicit "no transaction is sent" note, inline error). `walletMenuOpen` in `AuthSessionProvider` lets in-page `Choose a wallet` buttons open it. Network switching and sign-in logic are untouched.
- Page rhythm: content max-width 1120px, one `PageHeader`, one `JourneyRail`, one `Panel` surface, shared state blocks.

## shadcn/ui and design tokens

- Added with the shadcn CLI: Button, Input, Label, Select, Textarea, Dialog, Sheet, DropdownMenu, Tabs, Badge, Card, Table, Tooltip, Skeleton, Alert, Separator (`components/ui/`). The CLI wired the `cn` import to an unrelated npm package named `cn`; I replaced that with `lib/utils.ts` (clsx plus tailwind-merge) and removed the stray package.
- New dependencies: `radix-ui`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react` (used by the shadcn primitives), `tw-animate-css`.
- Theming (`app/globals.css`): shadcn's semantic colors map onto the existing Optra tokens through `@theme inline`, so there is one palette. Azure is primary, Ember is the destructive and error color, red stays reserved for P/L. `<html class="dark">` makes the dark variants unconditional. Radii are 4, 6, 8 and 12px; button and input heights are 44px on touch and 40px on desktop; shadows only on floating layers.
- Customized shadcn: Button sizes, Input height, Badge radius (no pills), Select trigger height, table header tone.
- Added `components/ui/native-select.tsx`: a real `<select>` styled like the Input. The Hooks stage filter keeps a native select because an existing e2e test drives it with `selectOption`.
- Shared wrappers in `components/app/ui.tsx`: `Chip` (Badge), `Panel` (Card), `StateBlock` (Alert for error and blocked, Card for empty, info and loading), `Skeleton`, `JourneyRail`, `DecisionTrace`.
- A real bug found and fixed along the way: my unlayered global `a` and `button` color resets overrode the utility classes, so primary buttons rendered white on Azure (2.97:1). The resets now live in `@layer base`; primary buttons use the dark ink (about 6:1).

## Screens

- Agents: `TemplateCard` is shared by the catalog and the landing preview; creator uses Select, Input, Label; owned agents use Card.
- Agent detail: Tabs (Overview, Positions, Orders, Tape with counts), `More actions` DropdownMenu (fork, stop), a Dialog that confirms Stop, Table for orders.
- Forge: Select and Input for the recipe basics, hooks grouped by stage with catalog-only hooks locked and explained, outline and validation panels.
- Lab: Select for symbol and draft (symbol pinned to the draft), coverage meter, assumptions, result tiles, launch.
- Tape: Tabs as the action filter with counts, expandable stage-ordered traces, Table for orders.
- Hooks, Market, Verify: shared Panel, Chip, Select and typography.

## Verification

All commands run on 2026-11-12 against this working tree.

| Command | Result |
|---|---|
| `bun run typecheck` | passed |
| `bun run lint` | passed, no findings |
| `bun run test` | 29 files, 89 tests passed |
| `bun run test:e2e` | 22 of 22 passed: the 11 original specs unchanged, 8 landing and verify specs from the first pass (landing spec updated for the new hero), 3 new shell specs |
| `bun run build` | passed; `/`, `/agents`, `/forge`, `/hooks`, `/market`, `/verify` prerendered |

How the e2e suite was run: port 3000 is held by an unrelated process (cwd `.../FIRST PROJECT/SENTERA`) that answers 404 for OPTRA routes, and `playwright.config.ts` reuses whatever answers there. I did not kill it. An OPTRA dev server owned by you was already running on port 3001 for this directory, which also blocks a second `next dev` here. I therefore ran the same spec files from `tests/e2e` with a scratch Playwright config (outside the repo) pointing at `http://localhost:3001` and no web server. To reproduce with the repo config, free port 3000 or start OPTRA's dev server on it.

Browser verification (Chromium, headless, SwiftShader WebGL):

- Full real flow on the new UI: wallet session, create Protective Put draft, agent page, Lab coverage (1499 of 1441 candles), backtest, launch, paper tick, Tape with the 15-rule trace. Zero console errors. It ran against a throwaway dev server on port 3100 built from a temporary copy of the repo with its own PGlite database (needed because `next start` forces production mode, which requires Postgres). The copy and database were deleted afterwards; your dev database was not written to. The wallet session was created by signing the server challenge with a test key because no wallet extension is installed; the extension prompt itself was not exercised.
- Overflow sweep: 11 routes by 390, 768, 1024 and 1440px: no horizontal overflow.
- In-page accessibility audit: names, labels, heading order, landmarks, unique titles, sampled text contrast. After the contrast fix the only finding is Radix's internal `aria-hidden` `<select>` inside the Select primitive, which is not a user control. axe-core was not run (the harness blocks injecting remote scripts), so this is a self-written check, not a full WCAG audit.
- Keyboard: logical Tab order, visible focus rings, Escape closes the drawer, the wallet dialog and the landing menu.
- Compared the landing preview with the live Agents screen: same sidebar, topbar, journey rail, template cards, configure panel and terminology (see the screenshots).

## Screenshots

`docs/ui-screenshots/`: `landing-hero-desktop-1440`, `landing-app-preview-1440`, `landing-hero-tablet-768`, `landing-hero-mobile-390`, `app-agents-signed-in`, `app-agent-detail`, `app-lab-result`, `app-tape-trace`, `app-forge`, `app-wallet-dialog`, `app-mobile-drawer-390`. The signed-in captures are from the real backend with live candles.

## Files changed

Added: `components/app/AppShell.tsx`, `components/app/Sidebar.tsx`, `components/app/agents/TemplateCard.tsx`, `components/marketing/AppPreview.tsx`, `components/ui/*` (17 files), `lib/utils.ts`, `tests/e2e/shell.spec.ts`, `docs/ui-consistency-handoff.md`.

Modified: `app/globals.css`, `app/layout.tsx`, `app/(app)/layout.tsx`, `app/(marketing)/marketing.css`, `components/app/{WalletSession,ui,paper}.tsx`, the agents, forge, hooks, lab, market, tape and verify screens, `components/marketing/{MarketingNav,sections}.tsx`, `tests/e2e/landing.spec.ts`, `docs/final-ui-handoff.md` (note corrected), `package.json`, `bun.lock`.

Removed: `components/app/AppNav.tsx` (replaced by `AppShell` and `Sidebar`).

Untouched: `app/api/**`, `db/**`, `drizzle/**`, `lib/**` except the new `lib/utils.ts`, `components/LaserFlow.*`, `components/marketing/HeroStage.tsx`, `next.config.ts`, `playwright.config.ts`, and all pre-existing e2e specs.

## Remaining limitations

- The hero beam, shell and dialogs were verified in headless Chromium only; no Safari or Firefox pass, no real-device WebGL or frame-rate measurement.
- Positions and orders with real values are still verified only through mocked responses, because the US market is closed and a paper tick records a `skip`.
- The Skill tooling named in the brief: I applied Anti-Slop and the frontend-design guidance. I did not run ui-ux-pro-max, which is documented as an internal module.
- Backend requests from the first pass (`docs/ui-integration-requests.md`) are unchanged: holding and cash benchmarks, a paper account summary, a public Tape model.

## Git

Nothing was committed, pushed or deployed.
