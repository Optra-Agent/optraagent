# Landing story section and Protective Floor 3D: design

Status: approved by the owner on 2026-11-18 ("A, dan improve 3d ya!"). Not committed.

## Intent
The sections the owner accepted (intro, floor, app, agents, agent, final) each show one object. The sections after the Agent section (Forge, How, Tape, Risk, API, Verify, FAQ) share one shape: a centered heading over a dense app-style card. They tell the same journey three times and mix audiences. The owner called them unclear and generic. The 3D Floor object is a bare bar chart that does not connect to the agent story.

## Goals
- One pinned story, built like the Floor: the Protective Put character and its rule-stage characters walk four steps: Build, Backtest, Run on paper, Read why. Replaces Forge, How it works, Tape and the Sessions/Risk section.
- One compact Proof section (claims from the server, one real public API call, Paper vs Live) replacing Developers and Verify.
- 3D Floor re-themed to the product: the Protective Put character stands beside the object and reacts to the strike slider, orange and white columns, labels that never overlap columns, the strike slider named after the Strike stage.

## Non-goals
Payoff math, API contracts, wallet, scheduler, backend, the app screens. No new financial data.

## Anti-goals
Invented returns, prices, trades or next-run times. Any claim that Live works. Cards that look like a screenshot of the app with chrome.

## Approaches considered
A. Merge into one pinned story plus a Proof section (chosen). B. Redesign all seven sections one by one (more work, keeps the repetition). C. Delete only the duplicates (leaves Risk and API jargon).

## Decisions
- Story: `#story`, four steps on the existing PinnedStory scroll mechanics. Without scroll-pinning it becomes tabs, without JavaScript everything is stacked, as before.
- Illustrative content stays labeled illustrative. Backtest step shows the 721 + 720 candle split and empty result lanes only. Tape step reuses the three labeled example ticks.
- Proof: `#proof`. Paper vs Live block is kept (an earlier owner requirement).
- Navigation and rail: Floor, Agents, How it works (#story), Hooks, Lab, Verify (#proof).
- Dead components (ForgeDemo, HowWalkthrough, TapeTimeline, story.tsx) are deleted with their e2e tests; the app's own Forge, Lab, Tape and Verify routes are untouched.
