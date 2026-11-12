# Optra Agent Network: Progressive Redesign (Step 09 refinement)

Updated: 2026-11-12. Presentation only. The hero, Ember LaserFlow, the app shell, the paper-trading flow, the APIs, auth, schema, engine and backtest math are untouched. No dependency was added.

This replaces the earlier graph (four House Agents around a logo, a framed canvas and a permanent side panel). That concept was not approved.

## 1. The new concept

One real agent, Protective Put, is the root. It grows outward into its actual rule system. This is a picture of one agent's decisions, not a network of agents talking to each other, and nothing in it says otherwise.

| State | What is on screen | What moves |
|---|---|---|
| 01 One agent | Only the Protective Put node: an Azure ring, a dashed orbit, a payoff glyph above an Ember strike line, `PAPER AGENT`. Two faint orbit guides mark the room to grow into. | The camera is close (1.6x). A slow dashed orbit turns. |
| 02 First branches | Gate, Strike and Size grow out of the root. | Branches draw from the root. Each stage node travels out along its branch from the root's position. The camera eases back to 1.38x. A pulse travels each branch. |
| 03 Strategy network | Pulse and Expiry branch. The Breaker closes around everything as an Ember ring labeled `BREAKER · ALWAYS ON`. | The ring draws once around the whole network (about 1.8 s), then a scan point circles it continuously. The camera eases out to 1.08x. |
| 04 Hooks | The 15 implemented hooks of the real recipe grow from their stages: Gate 3, Strike 2, Size 2, Pulse 1, Expiry 2, and the 5 Breaker hooks seated on the ring. Each stage also gets one dashed "N locked" satellite (7, 5, 2, 6 and 1) for its catalog-only hooks. | Hook nodes start at their stage and travel to their place, staggered, while the branch to them draws. |
| 05 Decision and Tape | Rules converge: the ring links down to Paper decision, then Optra Tape. A persistent `ILLUSTRATIVE ONLY · NO RECORDED TRADE` line sits under them. | The decision and Tape nodes grow from the ring. An illustrative flow can then play (below). |

The Breaker is a ring around the whole network, not a node at the end of a chain, and its scan point never stops while the network is on screen. The final state spans about 1100 by 740 units and holds 28 nodes. The first state holds one.

## 2. Interaction

- **Entry:** `Explore agent` (top right, and centered under the root before anything grows), or activate the root node (click, Enter or Space).
- **Auto-play:** the first time the network is at least half on screen it grows once by itself. `Pause` and `Play`, `Replay` and `Back to start` control it. Reduced motion never auto-plays.
- **Stepper:** numbered buttons "State 1" to "State 5" jump to any state and stop playback.
- **Agent selector:** a compact row of the four House Agents. Protective Put is the only one that is Paper ready. Selecting Covered Call, Cash-Secured Put or Earnings Straddle shows that agent as a single dashed `PREVIEW` node and a card saying "Not yet available" with the template's real reason. Nothing grows from it and its controls are removed.
- **Select a stage or hook:** a floating card appears on the side away from the selection, the camera eases to center the selection in the free space, and other stages dim. A hook card shows its summary, its recipe parameters from the catalog, an implementation note, and a labeled illustrative output. A stage card lists its hooks (each opens its card) and has `Hide its hooks` and `Show its hooks`.
- **Locked satellites:** open a card listing every catalog-only hook in that stage with its real "why it is locked" reason. Locked hooks have no node of their own, never light up and cannot take part in the flow.
- **Decision flow:** `View decision flow` (controls bar, or the agent card). It steps through Gate, Strike, Size, Pulse, Expiry, Breaker, Paper decision and Optra Tape, lighting hooks with verdicts as each stage is reached, and the ring carries two converging pulses into the decision. "Entry blocked" ends in `skip` ("Entry blocked by calmo."); "Entry opens" ends in `open`.
- **Collapse:** `Back to start`, `Escape` (closes the card, then the flow), clicking the selected node again.
- **Keyboard and touch:** every node is a `role="button"` with an `aria-label` and `aria-pressed`, a visible focus ring, and Enter or Space activation. Everything is a click, nothing needs hover.

## 3. How the growth is built

All geometry is in `components/marketing/network-layout.ts` (pure, tested). `AgentGraph.tsx` renders it.

- Each node has its own position and a `from` position, which is its parent's. Hidden, it sits on the parent, small and transparent. Shown, it transitions to its own place with a stagger. This is what makes it spread outward instead of fading in place.
- Branches are gentle quadratic curves drawn with `stroke-dashoffset`, timed with the node that rides them.
- A camera group (`translate · scale · translate`) zooms out from 1.6x to 1x across states, and slides and shrinks the network into the free side when a card is open so the card never covers what it describes.
- Pulses are short dashes moving along real branches, one after another with fixed delays. Nothing random, no particles.
- Only transform, opacity and stroke-dashoffset animate. There is no physics, canvas or animation library. Pulses, the ring scan and the orbit pause when the network is off screen.

## 4. Data provenance (checked against `docs/agent-graph-data-contract.md`)

- Agents, availability and reasons: `getHouseAgentTemplates()`. Hooks, stages, counts, parameters, locked reasons: `getHookCatalog()`. Recipe membership and values: `PAPER_PROTECTIVE_PUT_HOOK_IDS` and `buildProtectivePutRecipe()`. Nothing is copied by hand.
- Fifteen hooks are drawn as operational and all 15 are implemented. The 21 catalog-only hooks appear only as dashed satellites and in cards, always labeled locked.
- Public Tape: read on the server from the public handler. It is empty, so only illustrative examples exist. If it ever returns a record, a "Public Tape record" example is added and replayed with its canonical hook statuses kept.
- Illustration rules from the contract: the earlier sample observed values (such as an RV ratio) were removed. Hook cards show the engine's own wording, a recipe limit, and a status, under "Illustrative only. Engine wording for a typical result. Not a Tape record." The flow card carries an `Illustrative only` chip for the whole scenario, and the canvas carries `ILLUSTRATIVE ONLY · NO RECORDED TRADE` under the decision whenever it is visible. No agent id, decision id, timestamp, price or result is shown.
- Private routes (`/api/agents`, tape, positions) are not used. There is no agent-to-agent edge.
- Premiums are modeled, live trading is disabled, and the network never shows a trade, fill, price or return.

## 5. Responsive, reduced motion, no JavaScript

- **Desktop (1000px and up):** the full network on a frameless canvas capped to the viewport height, so the whole graph fits one screen.
- **Below 1000px:** the canvas is replaced by a vertical branching sequence: the root card, a spine that grows with each state, stage rows that appear in order, hooks as 44px touch targets, locked chips, an Ember-ruled Breaker group, then the decision and Tape. The same state, stepper, cards and flow drive it. The desktop network is never shrunk onto a phone.
- **Reduced motion:** the complete, readable network is shown at once at identity camera, with no growth, pulses, orbit or scan, and no auto-play. Selection still works and the flow shows its result immediately. The state caption reads "Complete network".
- **No JavaScript:** the server HTML already contains the full network, shown by `@media (scripting: none)`.
- The earlier hook workbench, Forge demo, Tape trail, Lab pipeline, risk rails and API excerpt are unchanged in design and are described in the previous pass.

## 6. Visual verification

Captured in Chromium against the existing dev server and inspected frame by frame: the one-agent state; first branching at about 0.35, 0.9, 1.7 and 2.7 s; the Strategy network state with the ring mid-draw; the Hooks state; the decision flow in progress; a selected hook (Calmo); the locked-hook card; the collapsed state; mobile at 390px for each of these; reduced motion at desktop and mobile; and no JavaScript.

Findings that changed the build: the root's label collided with the Pulse stage once it grew, so it now fades after state 02; the Gate and Strike locked chips collided, so each stage got its own offset; the flow card covered the Tape node, so the network now shrinks into the free side whenever a card is open; Corpax and Sessia nearly touched, so the hook fan was widened (a layout test now fails on any overlap); and reduced motion initially left hidden nodes unclickable and out of the tab order, which was fixed.

The first and last states are unmistakably different: one node against 28, and the network spans more than 2.5 times the width (asserted in a test). The screenshot files were disposable and were deleted; this section and the tests are the record.

## 7. Tests

| Command | Result |
|---|---|
| `bun run typecheck` | passed |
| `bun run lint` | passed |
| `bun run test` | 31 files, 102 tests passed (4 new layout tests; the paper-flow integration test is included) |
| `bun run test:e2e` | 43 of 43 passed through a scratch Playwright config on port 3001 (the repo config needs port 3000, held by an unrelated SENTERA server I did not touch) |
| `bun run build` | passed, `/` still prerendered |

New e2e coverage: initial one-agent state, growth through all five states with children starting at their parent, widening and densifying, hook cards, locked satellites, hiding and showing a stage's hooks, the labeled decision flow, auto-play then Pause and Back to start, Preview agents, keyboard operation, the compact layout, reduced motion, and no JavaScript.

The supported journey (wallet session, draft, backtest, launch, paper tick, Tape) is covered by the paper-flow integration test and the existing agents, forge, lab, tape, hooks, market and verify e2e specs, all passing. I did not repeat the manual signed-in browser run, and none of those files changed in this pass. During the run, `lib/backtest/run.ts`, `lib/domain/contracts.ts`, `tests/backtest/run.test.ts` and `tests/e2e/lab.spec.ts` were being edited by someone else; one backtest unit test failed once mid-edit and passed on the next run. I did not touch those files.

## 8. Screenshot cleanup

All 39 files in `docs/ui-screenshots/` (`app-*`, `landing-*`, `graph-*`, `visual-*`) were generated by my own browser scripts in this and the two previous UI passes. None was tracked in git, referenced by code or tests, or user-supplied. I listed them, deleted exactly those 39 files by name, and removed the now-empty folder. No broad cleanup command was run. References were removed from `final-ui-handoff.md`, `ui-consistency-handoff.md` and `landing-motion-handoff.md`, with findings kept as text. Scratch captures now go to a temporary folder outside the repository, which is emptied afterwards.

## 9. Files

New: `components/marketing/network-layout.ts`, `app/(marketing)/network.css`, `tests/marketing/network-layout.test.ts`. Rewritten: `components/marketing/AgentGraph.tsx`, `tests/e2e/graph.spec.ts`. Edited: `graph-data.ts` (locked hooks, no sample values), `graph-flow.ts` (canonical status kept), `app/(marketing)/graph.css` (old graph rules removed), `layout.tsx`, `tests/e2e/landing.spec.ts`, `tests/marketing/graph-data.test.ts`, the three older handoff documents, and `docs/tasks/optra-fullstack-progress.md` (10-step tracker).

## 10. Remaining limitations

- Chromium only. No Safari, Firefox or real touch device pass, and no frame rate measured on real hardware. The idle load is a few dashed-line animations that pause off screen.
- The decision flow is illustrative by design. A real record can replay only after a public Tape record exists, and that path is covered by a unit test but has not been seen with real data.
- The camera uses a composite CSS transform transition. It is smooth in Chromium; other engines may interpolate it slightly differently.
- The stage is capped to the viewport height, so on very short windows the labels get small. Below 1000px the vertical layout takes over.
- Covered Call and Cash-Secured Put glyphs look alike because those payoffs are equivalent in theory.

## 11. Status

- **2026-11-12:** redesign implemented and verified as above.
- **2026-11-13:** planned. Review the motion pacing with the product owner, check Safari, Firefox and a real phone, and fix what that finds.
- **2026-11-14:** planned. Final QA and handoff: rerun every command, walk the supported journey in a browser, and close this document.

## Git

Nothing was committed, pushed or deployed.
