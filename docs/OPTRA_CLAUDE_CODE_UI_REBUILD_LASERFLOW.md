# OPTRA AGENT — CLAUDE CODE PREMIUM UI REBUILD & REACT BITS LASERFLOW

**Agent:** Claude Code extension inside Cursor (visual execution owner).
**Run only AFTER Codex completes its backend/core handoff.**
**Repository:** use the SAME Optra Next.js repository/worktree opened in Cursor. No new project/repo, no parallel dummy application, no automatic worktree.

## Read first, in this exact order

1. Original PM: `Optra Agent: Developer Product Brief` (25 sections).
2. `OPTRA_MASTER_EXECUTION_BRIEF_V2.md`, and latest approved UI visual brief `OPTRA_CLAUDE_WEB_UI_DIRECTION_BRIEF_V1_1.md` (**Premium Neutral Dark**, not navy/Midnight).
3. Codex's **actual** `docs/ui-handoff-contract.md`, `docs/api-contracts.md`, `docs/execution-ledger.md`, `docs/final-core-handoff.md`.
4. Existing Next.js route/component structure, package versions, global CSS, tests and uncommitted changes.
5. Two Claude Web artifacts (**inspiration only, NOT final UI**):
   - Landing: https://claude.ai/artifact/5tgBa1feTHzEhx3j9CTns6
   - App / Launch: https://claude.ai/artifact/V9vce7gc3PW2i51gETjhNW
   - Preferred: inspect exported original artifact HTML/CSS/screenshots if provided under `docs/design-reference/` or `design-reference/`. If the artifact URLs are inaccessible, be transparent; use their supplied screenshots + briefs instead. Never claim to have read inaccessible source.

## Mission

The existing Claude Web prototypes are not visually good enough. **Redesign them into a distinctive, premium, high-end, credible options-agent product** while retaining the PM's user flow and all actual integrations that Codex has built. Your task is an IMPLEMENTATION, not a design report.

Priority: landing with compelling product clarity in the first 10–15 seconds; clean, dense, legible, functional app/dashboard; smooth responsive UI; and honest product states. Use **Anti-Slop** plus appropriate actually installed global UI/design skills (`ui-ux-pro-max`, any relevant local design skill). Inspect available MCP tools/skills first; do not claim usage unless executed. Do not spend time reinstalling global tools or researching a dozen alternatives.

## Product identity and aesthetics

- Brand: **Optra Agent**. Primary H1: `Let agents trade the strike.`
- User understanding within 10–15 seconds: AI options agents on Robinhood Chain; calls/puts; choose House Agent or build a custom rule-based agent; backtest; paper first; explanations on the Tape.
- Theme: **Premium Neutral Dark**, NOT Midnight/Navy. Use near-black graphite surfaces, off-white editorial typography, precise grids and restrained decorative cues.
- Starting tokens: background `#0B0C0E`, surface `#131518`, borders `#2B2E33`, high-contrast text; primary Azure `#1E8FFF`; Ember/Vermilion `#FF5A1F` (hero laser), with PM's `#E8492A` usable as restrained app accent. Do not replace the whole product color identity with glowing orange.
- Keep a serious trading floor / professional editorial look; strong asymmetrical hierarchy is welcome if it works on mobile. Avoid AI-slop: giant gradient orbs, excessively rounded cards, glassmorphism, generic dashboard templates, random useless graphs, purple AI aesthetics, fake profits and fake integrations.
- Typeface: thoughtful sans + legible mono for numeric data/ticker. Use existing fonts if suitable; avoid adding excessive font dependencies.
- Animations should reinforce the hierarchy. Support keyboard focus, reduced motion, no horizontal overflow and touch-friendly mobile interactions.

## Mandatory React Bits integration: `<LaserFlow />` (TS-CSS)

- Official docs: https://reactbits.dev/animations/laser-flow
- Exact registry item: https://reactbits.dev/r/LaserFlow-TS-CSS.json
- User-selected installation command (run in the EXISTING repo after checking current dependencies):

```bash
bun x --bun shadcn@latest add @react-bits/LaserFlow-TS-CSS
```

- If the alias command is unavailable, read the registry JSON and use the direct registry URL with the shadcn CLI. Do NOT use the Tailwind variant; requested variant is **TypeScript + plain CSS**. Let the registry install its actual dependencies and keep one lockfile. Prefer the official source, not a hand-invented approximation.
- Use it **once, intentionally, for the landing hero** as an Ember beam landing on a tangible interactive preview / agent terminal surface. It is NOT a full-screen overlay on dashboards or tables.
- Preserve these props as the target user-approved Ember preset:

```tsx
'use client';

import { useRef } from 'react';
import LaserFlow from '@/components/LaserFlow'; // Adjust only to the real installed path.

export default function OptraLaserHero() {
  const cardRef = useRef<HTMLDivElement>(null);

  return (
    <div className="relative h-[600px] overflow-hidden">
      <LaserFlow
        surfaceRef={cardRef}
        beamPosition={0.63}
        color="#ff5a1f"
        intensity={1.8}
        flare={1.25}
        spread={1.5}
        spill={1}
        fog={0.5}
        dust={1.6}
        revealRadius={220}
        revealOpacity={0.6}
        beamWidth={0.55}
        theme="dark"
      />
      <div
        ref={cardRef}
        className="absolute left-[18%] right-[28%] top-[52%] bottom-[-24px] rounded-[14px] bg-[#0b0b0d]"
      >
        {/* Real agent UI preview / product content, not a placeholder box. */}
      </div>
    </div>
  );
}
```

- `revealImage` was `/your-ui.png` in the example: **do not ship a broken placeholder**. Only set `revealImage="/path-to-real-asset.png"` after creating/confirming the actual UI screenshot asset in `public/`; otherwise omit the prop. Keep `revealRadius` and `revealOpacity` configured as above.
- Keep the beam landing edge and `surfaceRef` aligned at 1440px, 1024px, 768px and 390px; adapt the card geometry responsively while preserving the desktop preset. Use real text above/floating alongside the visual, do not let canvas cover CTAs.
- WebGL2 effects: provide a still, elegant CSS/HTML visual fallback for unsupported/failed contexts; avoid hydration errors by loading client-only where necessary. Pause or reduce nonessential motion for off-screen / reduced-motion / lower-power devices; protect scroll performance and mobile usability. Test that layout remains readable and usable without WebGL.
- This component uses a canvas and may be expensive: do not duplicate it across sections or keep multiple renderers alive in the app dashboard.

## Exact UI scope

### A. Premium landing (`/`)

Maintain PM's **agent-first narrative** and feature coverage while simplifying visual repetition for a 48-hour MVP:

1. Sticky / responsive navigation with Optra identity and truthful `Launch App` / `Connect Wallet` navigation.
2. Above the fold: tagline, clear explanatory subhead, `Launch a paper agent` CTA, `Watch the Tape`, Paper first label, distinct real product preview. **Ember LaserFlow** behind/onto preview in deliberate composition.
3. House Agents (4 PM types, with supported vs Preview statuses from actual backend).
4. Forge (rules are editable and validated), 36 Hooks / six stages (catalog vs implemented distinction).
5. How It Works: `Choose / Configure → Backtest → Launch Paper → Review Tape`.
6. Tape & Lab (show real permitted data; no fabricated performance).
7. Sessions, Dual Mode, Developers, Listing and Verify as **accurate product roadmap or real routes**. Never imply live execution, x402, MCP or onchain v4 guards are shipped if not.
8. FAQ / risk disclosure / final CTA / footer.

Use the PM's broader section order as reference, but avoid 16 nearly identical cards/sections. Reduce page length through good information architecture, not by deleting key features from the story. `V4_CLAIM_LEVEL=L0`: say `Inspired by Uniswap v4 hooks` when referencing this concept; not `Built on Uniswap v4 hooks`.

### B. Actual App / Launch Experience

Restyle and finish Codex's REAL routes instead of creating a separate fake interactive app:

- `/agents`: strong overview, House Agent selection, actual wallet state, running/paper cards, empty state and useful CTA.
- `/agents/[id]`: clear paper agent status, positions, limits, decision history and actual lifecycle controls, with safe error handling.
- `/forge`: beautiful but usable recipe builder; obvious Gate / Strike / Size / Pulse / Expiry / Breaker structure, validator feedback, supported hooks and disabled nonworking options.
- `/lab` or actual Codex route: 30-day replay where valid, compare vs holding and cash, risks and modeled/recorded source labels.
- `/tape`: ticker/log with collapsible actual hook trace and source refs, not fake sample executions.
- `/hooks`: visually organized exact 36-hook library, filters, and correct implementation badges.
- `/verify`: truthful claims and feature statuses.
- Common: global nav, purposeful app header, wallet connection, robust skeleton/loading, error and disconnected states, paper banner, mobile menu and readable dense tables.

For roadmap-only features (Floor, Book, Listing, MCP, x402, live trading), provide graceful factual explanations instead of deceptively clickable actions.

## Integration rules: Claude owns visuals, Codex owns logic

**Must NOT break:** existing API schemas, session/auth checks, Drizzle migrations, engine, backtest, idempotency, risk guards, event timestamps, recipe hash semantics, paper/live flags and user ownership. **Do not rewrite backend/business logic** to make visuals easier.

- Work in `(marketing)` pages, visual components, app presentation pages, styling/tokens and visual assets. Use existing typed hooks/clients where defined.
- Avoid importing DB code directly into client components. Respect Next.js server/client boundaries.
- For UI data, consume actual API/route data and honor `loading`, `empty`, `not supported`, `error`, `paper`, `partial` states. **Mock fixtures only in isolated story/demo/test components, never displayed as live stats or real activity.**
- When a needed field/endpoint is absent, document an exact contract request in `docs/ui-integration-requests.md` rather than privately redefining API or hardcoding a success response.
- If new UI package install or shared file edit is needed, check existing owner/package/lockfile and preserve working project. Do not overwrite Codex work blindly.
- Keep source/reference copyrights respected: take product concepts, not copied branding, code from private artifacts, or another site's unique layout. React Bits registry source is to be installed from its specified official source.

## Implementation workflow (no endless redesign loop)

1. Audit current app + Codex handoff; list actual routes and data contracts.
2. Inspect installed Anti-Slop, UI skills and applicable MCP; use only verified available tools.
3. Draft **one** concise visual implementation plan with exact file paths; choose premium neutral dark system, no second design-research marathon.
4. Install and validate TS-CSS LaserFlow from official registry, implement landing hero with exact Ember preset and responsible fallbacks.
5. Build/refine full landing and responsive navigation.
6. Rebuild UI of existing app routes around live typed data/contracts; prioritize Connect → Choose → Validate → Backtest → Paper Launch → Tick → Tape.
7. Validate responsive viewports (390 / 768 / 1024 / 1440), reduced-motion, no horizontal scrolling, no fake stats, usable controls, WebGL fallback.
8. Run typecheck, lint, build, browser tests and actual full flow; fix UI regressions; document any backend dependency instead of suppressing errors.

## Definition of Done / handoff

Deliver code, not merely a visual concept. The landing must express the product in 10–15 seconds, Hero LaserFlow must look like the supplied Ember preset without making the page unusable, and app interactions must be tied to Codex's real backend. A paper-only product must never look like live real-money trading.

Produce `docs/final-ui-handoff.md` documenting: routes completed, visual system/tokens, React Bits installed version/dependencies, screenshot/viewport checks, exact test results, accessibility/performance findings, any non-working API seams, files changed and Git state. No unauthorized commit/push/deploy.

Final reply must show: `UI STATUS`, `LASERFLOW`, `WORKING ROUTES`, `DATA CONTRACT INTEGRATION`, `TEST COMMANDS/RESULTS`, `BLOCKERS`, `FILES CHANGED`, `GIT`. Be factual; do not mark visual or functional acceptance as done without verification.
