# OPTRA Intelligence Core Implementation Plan

> **For agentic workers:** Native execution is specified by the user. Implement this plan task by task; do not create another worktree or delegate.

**Goal:** Replace Forge's isometric board with a five-state, scroll-morphed Intelligence Core built from the real hook catalog.

**Architecture:** A pure deterministic model maps the real five strategy stages, 36 hooks, and five Breakers to stable 3D particle positions at five keyframes. A small Canvas 2D client component interpolates those positions from a mutable progress ref exposed by the existing `PinnedStory`; server-rendered SVG remains the first-paint and no-Canvas fallback.

**Tech Stack:** Existing Next.js App Router, React, TypeScript, CSS, Canvas 2D, and Playwright. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-15-optra-intelligence-core-design.md`

## Global Constraints

- Preserve the approved Premium Neutral Dark palette, Azure active signal, Ember risk signal, existing typography, and shadcn/ui.
- Preserve the existing `PinnedStory` architecture and Forge validator; do not change paper-trading logic or API contracts.
- Keep 36 hook counts, 15 implemented, 21 catalog-only, and five Breaker identities derived from the real server catalog.
- Do not render actual/fake Tape events, balances, orders, returns, or live trading claims.
- Respect reduced motion, Save-Data, keyboard use, mobile layout, offscreen pause, and hydration-stable rendering.
- Do not add dependencies, use Gyevo assets/branding, or deploy.

## Review Focus

- Scroll positions within one pinned step still update the canvas progress; tests verify forward and reverse interpolation, not only step labels.
- Canvas context unavailable or JavaScript disabled leaves the server SVG visible without changing layout.
- 390px mobile keeps all five state controls reachable and no horizontal overflow.
- Reduced motion and Save-Data stop autonomous frames while preserving a usable static state.
- Catalog changes preserve exact live/catalog-only counts and never turn a catalog-only hook into an active signal.

### Task 1: Deterministic topology and morph math

**Files:** Create `components/marketing/intelligence-core-model.ts`; create `tests/marketing/intelligence-core.test.ts`.

- [x] Add unit tests for five strategy stages, 36 catalog hooks, the 15/21 split, five Breakers, five unique state endpoints, and fractional interpolation.
- [ ] The initial red run was not retained as final release evidence; no current-source failure is claimed.
- [x] Implement `buildIntelligenceCoreModel(data)` and `sampleIntelligenceCore(model, progress)` with stable catalog points and 3D interpolation.
- [x] Rerun the focused test; catalog counts and changing topology pass.

### Task 2: Scroll progress and Canvas renderer

**Files:** Modify `components/marketing/PinnedStory.tsx`; create `components/marketing/IntelligenceCore.tsx`; create `components/marketing/intelligence-core-canvas.ts` or a focused Canvas module; modify `app/(marketing)/studio.css`; create focused browser checks in `tests/e2e/forge.spec.ts`.

- [x] Add browser assertions for normalized progress, server SVG fallback, reduced-motion snap behavior, offscreen pause, Save-Data, and Canvas-unavailable fallback.
- [ ] The original red run is not used as final release evidence; no current-source failure is claimed.
- [x] Expose a mutable progress ref from `PinnedStory`; update it on scroll frames and on direct state selection without per-frame React state updates.
- [x] Implement the Canvas renderer, SVG fallback, visibility/preference gates, and direct state controls.
- [x] Run focused Core and full Forge tests; inspect screenshots from actual Chromium at all target widths.

### Task 3: Replace the Forge board and wire five states

**Files:** Modify `components/marketing/sections.tsx`, `components/marketing/ForgeDemo.tsx`, and Forge styles; remove the superseded `components/marketing/anatomy/` implementation and its tests.

- [x] Update E2E checks to capture Core, Strategy, Hooks, Risk, and Evidence states and verify no trade writes.
- [ ] The prior rejected-board red run was not retained as final release evidence.
- [x] Integrate the Core with the existing `PinnedStory`, preserve the four Forge workflow actions, and derive five visual states from the actual catalog.
- [x] Run Forge, responsive, reduced-motion, keyboard, Save-Data, offscreen, and marketing no-trade checks; inspect every captured state visually.

### Task 4: Release verification and tracker

**Files:** Update `docs/tasks/optra-fullstack-progress.md`, `docs/codex-final-engineering-handoff.md`, `docs/browser-runtime-qa-handoff.md`, `docs/nov13-nov14-completion-report.md`, and `docs/execution-ledger.md`.

- [x] Run focused checks and capture inspection, then complete the full unit/E2E/type/lint/build verification on November 15.
- [x] Reconcile all 10 original steps with the allowed statuses, evidence, remaining work, and next action.
- [x] Record production environment, migration, existing runtime smoke route, absence of a dedicated DB health endpoint, and backup/restore requirements without inventing host credentials or infrastructure.
- [x] Run `git diff --check`; report web readiness and real-wallet/contract limitations without claiming deployment.
