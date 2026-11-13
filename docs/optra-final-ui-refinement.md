# Optra: Final UI Refinement (landing storytelling, graph, Launch App, Lab benchmarks)

Updated: 2026-11-13 (second pass: sections after House Agents). Presentation only. No engine, backtest math, auth, schema, paper execution or API contract changed. No dependency was added (`lucide-react`, shadcn/ui and Radix were already installed).

## 1. Work recovered and continued

The 12 and 13 November sessions were interrupted by usage limits. Before resuming I read the Codex handoffs, `git status` and the committed diffs, and checked that nothing had been overwritten. The UI work was already committed by the owner (`fddab24` and earlier), so this pass only added to it: the final responsive fixes, the development-server diagnosis, the lint scope fix, tests and documentation.

## 2. What changed

### Landing

- **Interactive product preview (hero).** `ProductPreview` renders the app's own `SidebarView`, `TopbarView`, `JourneyRail`, `TemplateCard` and `Panel`, so it cannot drift from the real app. The visitor can switch Agents, Forge, Lab and Tape (sidebar on desktop, tabs on phones), pick a House Agent, and toggle hooks. Every screen links to its real route and the topbar has a prominent `Open app`. It never runs anything: Forge shows "Not run in preview", Lab and Tape show no numbers, the Tape sample is labeled "Illustrative only", and the journey rail starts at "Connect wallet" with nothing marked done. The first screen is in place at first paint (no entrance fade); only a screen the visitor switches to eases in. Tests confirm no private API request is made while using it.
- **Agent graph.** Cubic Bézier branches that end exactly on their nodes (nodes bloom at the branch tip), a hexagonal strategy-module root with a six-arc stage and Breaker ring and a validated badge, a labeled icon toolbar with tooltips, a four-tile agent selector, and a decision timeline (result summary, stage rail with pass, block and idle counts, hooks on demand, focus on the canvas). See `docs/agent-graph-ui-handoff.md`.
- **Forge section.** A workflow rail (Choose agent, Configure hooks, Validate recipe, Backtest) that uses the same classes as the real `/forge` screen, four agent tiles (only Protective Put can be built), hook chips for all 36 hooks, a validation card that shows the real validator's messages and hash, and a backtest card that stays locked until the recipe validates.
- **Hooks section.** A six-stage workbench: five stations with their own icons and a traveling highlight on the connecting lines, an Ember Breaker rail that every station drops a guard tick into, progressive disclosure of hooks and parameters, and counts that stay true (3/10, 2/7, 2/4, 1/7, 2/3, 5/5).
- **Motion.** Drawn connectors, branch growth, rail progress, tab and chip transitions, hover lift, and scroll-linked reveals from the earlier pass. The hero is untouched and fully visible at first paint. Reduced motion shows a complete static state; without JavaScript the full network is in the HTML.

### Launch App

- **Shell.** Icon sidebar (Layers, Hammer, FlaskConical, ScrollText, Webhook, Activity, ShieldCheck) with an original brand mark, grouped Workspace and Reference sections, a filled active state, and a Paper mode card. The topbar shows where you are (Optra / page), the network, a PAPER chip with the disclosure in its tooltip, and the wallet. The long disclosure no longer repeats on every screen.
- **Agents.** A compact numbered journey rail with checks, a connect card in place of the plain "No agent session" block, a featured Protective Put card (payoff mark, hooks, strike, tenor, one primary action) and dashed locked Preview cards with the reason one click away, and a configure form with inline validation, a live strategy summary, and the recipe outline collapsed by default.
- **Forge.** The same workflow rail and chip-style hook toggles as the landing demo (checkboxes remain real inputs), with locked hooks dashed and explained.
- **Tape.** A decision timeline: one node per persisted decision, pass and block counts, a source line, and the trace on demand. Records are unchanged.
- **Hooks.** Stage tiles gained icons and remain filters. Market and Verify use the new shell and were checked at desktop, tablet and phone widths.

### Lab benchmark integration

`BenchmarkComparison` reads only `run.metrics.benchmarks` as returned by the server. It shows the strategy, buy and hold (price only), and flat USD cash on one diverging scale, the two percentage-point differences, start and end values, the 720-candle window, and three disclosures: price-only holding excludes dividends, fees and slippage; flat USD is a zero-yield accounting baseline, not a measured USDG return; the strategy uses modeled premiums with 50 bp slippage and no venue fees. Nothing is computed or reconstructed in the UI. Older runs without the field show "Benchmark comparison unavailable". The previous "Comparison with holding: Not yet available" line is gone.

## 3. Development server on port 3001

The active OPTRA dev server (pid 10584, working directory the OPTRA checkout) was not stale. Probing it showed that `http://localhost:3001` hydrates and makes its `/api/me` and template requests, while `http://127.0.0.1:3001` never hydrates: the HMR WebSocket handshake fails with `ERR_INVALID_HTTP_RESPONSE`, no `/api/me` request is made, and the page stays on "Checking wallet session…". `127.0.0.1` is a different origin from `localhost`, and Next 16 blocks dev resources from origins that are not listed. The fix is `allowedDevOrigins: ["127.0.0.1"]` in `next.config.ts` (already in the repository). After Next restarted itself, `127.0.0.1:3001` hydrates and issues `/api/me` (401 while signed out). No other process was touched; SENTERA on ports 3000 and 3002 was not affected.

One thing I did that may have contributed to earlier flakiness: I ran `bun run build` against the checkout's `.next` while the dev server was running. This pass builds into a separate output directory (`OPTRA_E2E_DIST_DIR`) and restores the two files Next rewrites (`next-env.d.ts`, `tsconfig.json`).

## 4. Verification

Run against the latest source on 2026-11-13.

| Check | Result |
|---|---|
| `bun run typecheck` | passed |
| `bun run lint` | passed. It first failed with 11,366 findings, all in `.local/optra-next-e2e` (the git-ignored runner snapshot with its own `node_modules`). I added `.local/**` to the ESLint ignores in `eslint.config.mjs`. |
| `bun run test` | 31 files, 103 tests passed |
| `bun run test:e2e` | 51 of 51 passed on the isolated server at port 3100, including the runtime smoke test |
| `bun run build` | passed, with `OPTRA_E2E_DIST_DIR=.local/optra-build-ui` so the running dev server's `.next` was not touched. `/` is prerendered. The output folder was deleted afterwards. |

New browser coverage: interactive preview (screens, Preview agent, hook toggles, no private requests, phone tabs), app shell and Agents polish (sidebar icons, topbar, connect card, featured card, form validation), Lab benchmarks (present, and unavailable for an older run), and the graph and landing specs updated for the new behavior (branches end on their nodes, labeled timeline).

Browser inspection (Chromium, desktop 1440, tablet 820, phone 390): landing hero and preview screens, graph states, Forge and Hooks sections, Agents (signed out and signed in), Forge, Lab with a benchmark result, Tape timeline, Hooks, Market, Verify, the wallet dialog with its "no wallet found" state, and horizontal overflow (none). Defects found and fixed in this pass: locked agent tiles overlapping their lock icon on narrow widths, preview content fading in at first paint, the dev origin block, and the lint scope. Screenshots were kept outside the repository and deleted.

The supported journey (wallet session, draft, backtest, launch, paper tick, Tape) is covered by the paper-flow integration test and the isolated browser suite. The wallet session is created with a signed test challenge; a real extension prompt was not exercised because no wallet extension is installed in the test browser.

## 5. Remaining limitations

- No real wallet-extension prompt, Safari, Firefox or real touch-device pass. Chromium only.
- The Lab benchmark view was verified against mocked server responses and the contract schema; a live end-to-end run with a real captured window belongs to the 14 November QA.
- Public Tape is empty, so the graph's "Public Tape record" replay is covered by a unit test only.
- The Forge landing demo looks up validator results for single-hook removals on the server; combinations are the union of those results, which matches the validator's rules today but is not a live call.
- Another agent's staged and committed files were left as they were. `.DS_Store` appears untracked; I did not remove it.

## 6. Readiness for 14 November

Ready for final QA: source, tests and docs agree. Left for that day: the coordinated full run with Codex, a real wallet signing pass, a live Lab run to compare against stored `BacktestRun.metrics`, and cross-browser and touch checks.

Nothing was committed, pushed or deployed.

## 7. Second pass (2026-11-13): storytelling after House Agents

Reference studied: the PM's Zolva page, as a model for structure only (promise, then proof, then action; real product previews rather than decoration; plain declarative headlines; a decision log in plain words; explicit Live and Planned labels). Nothing was copied: no layout, asset, copy, figure or brand. Optra keeps its own identity.

### What changed

- **Forge, as a strategy studio.** Only the 15 rules that run are shown by default, grouped by stage with the question each answers. The 21 locked rules sit behind one disclosure and explain themselves when selected. A "Your strategy" card on the right states the strategy in plain language from the real Protective Put defaults, with a Valid or Blocked status. Remove a rule and that line goes away and the real validator's message appears. The hash is under "Technical details", not the headline. Backtest in Lab unlocks only when the recipe is valid. The agent tiles lock Covered Call, Cash-Secured Put and Earnings Straddle with their real reasons, and "Describe in words" is labeled Coming soon. The workflow rail uses the same classes as `/forge`.
- **Hooks, as a workbench.** A vertical rail of five stations (own icon, question, true counts) with a traveling highlight between them, one Ember guard line running beside all of them with a tick into each, and the Breaker docked at the bottom. A station opens a wide panel: what the stage decides, then the rules a Protective Put checks there, each with its one-line meaning from the real recipe and a drawer for summary, implementation note and parameters. Locked hooks are one disclosure away. 15 implemented of 36 cataloged is unchanged.
- **How it works, as a walkthrough.** A step list on the left and the screen it leads to on the right: strategy builder, historical replay with benchmark slots, the agent lifecycle with a tick that lights all 15 rules, and a decision with its trace. Each step has a link to its real route (`/agents#configure`, `/lab`, `/agents`, `/tape`). Arrow keys move between steps. Every picture is labeled illustrative and shows no return, balance or trade.
- **Tape, as a decision journal.** A list of three illustrative ticks and a detail card that answers in plain words ("The market was closed...", "Volatility was not calm enough...", "Every rule agreed...") with a large Waited or Opened verdict, the engine's own line underneath, a 15-segment rule bar, a pass and block tally, "Show every rule" for the stage rows, provenance (source, recipe, PAPER) and a link to the real Tape. "Illustrative example. Not a recorded trade." stays on screen. No wallet-specific record is ever shown.
- **Supporting sections.** The Lab pipeline's last card now names the benchmarks the server returns (strategy, buy and hold, flat USD) instead of the outdated "comparison not yet available". The Tape and Lab copy was rewritten in plain sentences. Sessions, Dual Mode, Developers, Verify, FAQ and the final CTA were reviewed at three widths and left as they were: they already state what is Working, Planned or Empty.
- **Cleanup.** 157 unused CSS rules from replaced visuals were removed. New styles live in `app/(marketing)/studio.css`.

### Launch App and the supported journey

The real journey was run end to end in a browser against the isolated runner's real backend (live Crius candles, real PGlite): signed test session, create the Protective Put draft, open Lab, backtest (720 decisions, 2 modeled entries), launch, open the agent, run a paper tick, and read the Tape (the tick was a `skip`, "Entry blocked by sessia", with all 15 hook results). No console errors. The Lab rendered the server's benchmarks from that real run: strategy -0.017068%, buy and hold AAPL +4.097409%, flat USD 0%, versus holding -4.114477 pp and versus flat USD -0.017068 pp, with the three disclosures. Wallet states: the "no compatible wallet" error was seen in a browser; the rejected request, wrong network, wallet or network changed and connecting states were read from `AuthSessionProvider` and `WalletSession` and have accurate copy, but they were not exercised without an extension. The only frontend integration defect found in this pass was the 127.0.0.1 development origin (section 3).

### Verification (latest source)

| Check | Result |
|---|---|
| `bun run typecheck` | passed |
| `bun run lint` | passed |
| `bun run test` | 31 files, 103 tests passed |
| `bun run test:e2e` | 52 of 52 passed on the isolated server (port 3100) |
| `bun run build` | passed, into a separate output directory; `next-env.d.ts` and `tsconfig.json` restored afterwards |

New or rewritten browser specs: Forge studio (validator message, locked disclosure, locked agents), hook workbench (true counts, locked drawer, station switch), how-it-works walkthrough (steps, links, keyboard), and decision journal (plain wording, label, rule bar, link). Widths checked by eye: 390, 820 and 1440 for Forge, Hooks, How it works and Tape. Defects fixed from that pass: the stage list and step list shrank to the middle of the column on narrow screens (grid centering from the shadcn tab list), and the Forge agent tiles were uneven on phones.

### Limits and deferrals

- Still not done: a real wallet-extension prompt, Safari, Firefox and a real touch device. The signed-in flow used a test key signature.
- The Lab benchmark percentages are shown exactly as the server returns them (six decimals), which is precise but long; shortening them would be a presentation choice for the PM.
- Deferred by design (backend or roadmap, not frontend): the other 21 hooks, the three Preview House Agents, AI composition, manual Floor and the public Tape.
- Each Playwright run leaves a disposable source snapshot (with its own `node_modules`) in the OS temporary directory. I removed the one from my manual run and left the others, which belong to the runner and to Codex's runs.
- `docs/ui-screenshots` was not recreated. Temporary captures stay outside the repository.

## 8. Third pass (2026-11-13): final visual experience, Markets and wallet onboarding

### Landing (Package 1)

- **Forge** runs a labeled demonstration when it scrolls into view: Protective Put is selected, its rules light up stage by stage, the recipe moves to "Validating…", then "Valid", and the Backtest in Lab button pulses. It has Pause, Resume and Replay, runs only while the section is on screen, stops the moment a rule is clicked, never runs a backtest or a paper tick, and is skipped under reduced motion. Before hydration the studio is already in its settled, valid state.
- **Hooks** is now a strategy architecture: five stations on one continuous SVG path with traveling evaluation pulses, and the Breaker docked underneath with a guard tick dropping from every station into it. The selected station lifts and glows; the others stay visible. A wide panel below explains the stage and lists its rules. On tablet and phone it becomes a compact grid. Counts stay 15 implemented and 21 catalog-only.
- **How it works** is a scroll-pinned story. Desktop: a sticky step list on the left and a sticky app window on the right whose screen crossfades with the step (Agents configure, Lab replay with benchmark slots, the agent lifecycle with a tick lighting 15 rules, a decision with its trace). A window bar shows the route. It uses native `position: sticky`, an IntersectionObserver on four invisible beats, no scroll hijack and no snap, releases at the end, and reverses on the way up. Under 1000px it becomes buttons switching one screen; with no JavaScript every screen is shown. Each step links to its real route.
- **Tape** is a living journal: pick a tick and a marker travels the real path (Market input, Hook evaluations, Risk guard, Paper decision, Tape record). The blocking hook is named on the node that stopped it and the line turns Ember after it. Below: a large Waited or Opened verdict, a plain sentence, a rule bar, the engine wording and every rule behind a disclosure, provenance and a link to the real Tape. "Illustrative example. Not a recorded trade." stays.
- **Lab** ("Test the strategy before you run it."): four stages (historical prices, premium modeling, strategy replay, benchmark comparison) over a chart with a 721/720 split, a modeled-premium layer and a replay head. The chart is labeled "Illustrative shape. Not market data." Result slots read "After a run". No number is shown.
- **Sessions** is an interactive 24 hour Eastern Time bar (selectable bands, only regular hours allowed, a one-time sweep marker) with a note that it does not show whether the market is open now. **Risk** is a Breaker panel: pick Haltr, Daylo, Drawra, Exposa or Venux, see the recipe default and the catalog range, and try a value on an "illustration only" slider that changes nothing. Venux explains the data-health check and the missing venue checks.
- **Dual Mode** compares Agent mode (working, four supported capabilities) with Manual mode (planned, dashed, no control). The old do-nothing tab switch is gone.
- **Developers** is a mini documentation view: an endpoint navigator, request and response with copy buttons and light JSON highlighting, auth and format, real responses from the same handlers the API uses, and MCP and x402 as non-interactive Planned entries.
- **Verify** is an evidence center: counts, grouped claims (what works with its limits, safety boundaries, roadmap), each claim a row with its status and first sentence that opens to the full statement and evidence link. Rows enter with the existing staggered scroll reveal and are readable immediately.
- **Closing** has a curtain-style reveal: two halves slide apart as the section scrolls in (scroll-linked, pointer-events none, off under reduced motion or when unsupported), Ember edge light, a large headline, `Launch app` and "Inspect what is verified", and the footer in the same dark composition.

### Markets (Package 2)

`/market` is now an explorer: search, filters (All, Standard multiplier, Multiplier ≠ 1), sort (symbol both ways, company, multiplier), a 203-row table with a "Show more" pager, and a details panel with the live quote, provenance and backtest coverage for the opened asset. **Data decisions:** the API returns the market list and one quote per symbol, and no price series, so there are no 1h, 24h or 7d columns and no sparklines, and the panel says so. Quotes and coverage are loaded only for the opened asset (not 203 calls). "Build a Protective Put on SYMBOL" is enabled only when coverage is ready and the quote is fresh, and links to `/agents?symbol=SYMBOL#configure`, which now preselects that market; sign-in, backtest and validation are unchanged. Stale, halted, blocked-coverage, empty and error states are handled and tested. **Missing contract for Codex, if change columns and sparklines are wanted:** a public `GET /api/markets/{symbol}/candles?limit=` (or a bulk summary) returning validated `MarketCandle` rows or precomputed 1h/24h/7d changes with coverage flags. Nothing was invented in its place.

### Wallet onboarding and the app (Package 3)

The wallet dialog now shows the sign-in steps, large MetaMask and Phantom EVM rows (accessible names unchanged), a waiting state, and separate error blocks: "No wallet found" (install and reload), "Request rejected", "Wrong network" (with a Switch to Robinhood Chain action when a wallet is connected), and a generic failure. Only MetaMask and Phantom EVM are offered; no email, Google or Privy. The Lab now displays percentages to two decimals (full precision in the tooltip), for the strategy, the benchmarks and the point differences. The values come from the server unchanged.

### Verification (Package 4)

| Check | Result |
|---|---|
| `bun run typecheck` | passed |
| `bun run lint` | passed |
| `bun run test` | 31 files, 103 tests passed |
| `bun run test:e2e` | 63 of 63 passed on the isolated server (new: Markets 5, Forge demo, pinned story forward and reverse, phone walkthrough, Lab, Sessions, Breaker panel, Dual Mode, Developers copy, Verify, closing) |
| `bun run build` | passed, into a separate output directory; `next-env.d.ts` and `tsconfig.json` restored |
| Live journey | On the isolated runner with the real backend: session, draft, Lab backtest, launch, paper tick, Tape, with no console errors. The Lab showed the real benchmarks: strategy -0.02%, buy and hold AAPL +4.49%, flat USD 0.00%, versus holding -4.51 pp. |

Browser inspection at 1440, 820 and 390 for every new section, Markets and the wallet dialog: no horizontal overflow, no page errors. The pinned story was checked scrolling down and back up (steps 0 to 3 and back, the pin stays at the same place, then releases).

### Honest limits

- Not verified: a real wallet-extension prompt (none installed in the test browser; the "no wallet" and error states were seen, rejected and wrong-network were exercised only in code), Safari, Firefox, a real touch device. Scroll-linked effects (the curtain, the pinned story's reveal) use CSS scroll timelines in Chromium and recent Safari; other browsers get static content.
- Markets has no change columns or sparklines (no price series API, see above). Per-asset backtest support is checked at runtime: the app does not claim any asset other than what coverage reports.
- Screenshots were kept outside the repository and deleted. One isolated runner snapshot from my live run was removed; older `optra-e2e-*` snapshots in the OS temp folder belong to other runs.

## 9. Fourth pass (2026-11-13): pinned storytelling and asset logos

### The pinned-story pattern

`components/marketing/PinnedStory.tsx` is the one reusable pattern. On wide, tall screens (1000px and up, 720px and taller) the pin is native `position: sticky` under the nav at 104px; the track is only the pin plus `(steps - 1) x beat` (30 to 38vh), so it releases naturally. Scroll progress through the track picks the active step, forward and back. There is no scroll hijacking and no snapping. `go(i)` (a step click or Enter) scrolls to that step's place and activates it; for a moment scroll progress is ignored so the two never fight. Views are stacked in one grid cell, so the stage keeps the height of its tallest view (no layout jump, no blank frame). Below 1000px, on short screens, with no JavaScript or under reduced motion's lack of transitions, the pin is a normal block and the steps are tabs; with no JavaScript every view is shown stacked. Inactive views are `inert`.

### Sections

- **Forge** (pinned, stack): scrolling drives the same demonstration phases (select, configure, validate, continue to Lab). Autoplay still starts when the studio is on screen, has Pause, Resume and Replay, and stops the moment scroll, the rail or a rule click takes over. Once the visitor edits a rule, scroll no longer replays the demo over their edit until Restore or Replay. The validator lookups and the 15 and 21 split are unchanged.
- **Hooks** (pinned): left, the five stages plus the Breaker with true counts; right, a sticky path (smooth cubic line, the active stage lit, a pulse that travels to it, and an Ember rail with a guard tick from every stage), then that stage's explanation and its rules. Rules open to full catalog detail; locked hooks are one disclosure away.
- **Tape** (pinned): the three illustrative ticks are buttons and never change on their own. Steps: Market input, Hook evaluations, Risk guard, Paper decision, Tape record. The path turns Ember where a hook blocked, and the panel for each step says what the engine reads, which rule passed or blocked, the action, and what the Tape would write. "Illustrative example. Not a recorded trade." is always in the pane.
- **Lab** (pinned): four stages over the existing chart (721 and 720 candles, modeled premium layer, replay head, benchmark slots). The chart is labeled illustrative, no number is shown, and the CTA goes to `/lab`.
- **How it works** now uses the same component. **Sessions** got a Sessia explanation card beside the selected session and smoother selection. **Risk** was already one selector, one illustration and a labeled slider whose allowed or blocked outcome follows the real rule semantics (Haltr and Exposa block above the limit, Daylo and Drawra at or above it), so it was kept without a pin.
- Shared pieces: `FlowPath.tsx` (the path), `story.tsx` (Lab, Sessions, Breaker, Developers, Verify).

### Markets: asset logos (data-integrity finding)

Both sources the brief names were checked against real responses:

| Source | Result |
|---|---|
| Robinhood registry `GET /rhj/assets` (the feed the app already reads) | 203 of 203 active chain 4663 tokens have a `logoUrl`, all on `cdn.robinhood.com`, each file named after that token's deployment address, 195 of 203 URLs returned 200 `image/png` after retries (the other 8 kept hitting connection resets from this network and were not confirmed). **But 13 of 13 downloaded files were byte-identical** (same SHA-256, 180x180): it is Robinhood's own feather mark, not a company logo. |
| Crius token profile `GET /v1/robinhood/token/{address}` | `data.metadata.logo` and `logo_original` are `null` for all 12 stock tokens sampled (AAPL, MSFT, NVDA, TSLA, AMD, GOOGL, AMZN, META, NFLX, DIS, HIMS, ADBE). |

So no allowed source supplies genuine per-asset logos today, and guessing URLs, favicons or other sites' images is out of bounds. I did **not** show the identical Robinhood mark on 203 rows: it would label every asset with Robinhood's brand while the footer states OPTRA is not affiliated with it. Coverage of genuine per-asset logos is therefore **0 of 203**, and every row shows an accessible ticker monogram.

What was built so a real source can be plugged in without rework: `verifiedLogoUrl()` in `lib/market/robinhood-feed.ts` (https only, trusted host, path exactly `/ncw_assets/logos/<chain 4663 deployment address>.png`, no credentials, port, query or fragment); an additive optional `logoUrl` on `MarketAsset` (`lib/domain/contracts.ts`); a feed option `logos: "none" | "registry"` that defaults to `"none"`; and `AssetLogo` in the app, which re-checks the host, lazy-loads without a referrer, and falls back to initials on error. Unit tests cover default-off, verified, missing, wrong host, scheme, address, query, credentials and malformed URLs. Browser tests cover a verified logo rendering (mocked image), a missing logo, an untrusted host never being requested, and a failed load falling back. No logo files are stored in the repository and no per-row provider calls are made. **Decision for the PM:** flip `logos` to `"registry"` only if showing Robinhood's generic mark is acceptable.

Codex-owned files touched, minimally and additively, under the brief's allowance for a small metadata adapter: `lib/domain/contracts.ts` (one optional field), `lib/market/robinhood-feed.ts`, `tests/market/adapter.test.ts`.

### Verification (latest source)

| Check | Result |
|---|---|
| `bun run typecheck` | passed |
| `bun run lint` | passed |
| `bun run test` | 31 files, 108 tests passed (5 new for logos) |
| `bun run test:e2e` | 67 of 67 passed on the isolated server (new or rewritten: Forge pinned and scroll-driven, Hooks pinned plus phone, Tape replay, How pinned with release and click, Lab pinned, logos x2) |
| `bun run build` | passed, separate output directory, `next-env.d.ts` and `tsconfig.json` restored |
| Live journey | Isolated runner and real backend: session, draft, backtest, launch, paper tick, Tape, no console errors. Lab showed strategy -0.02%, buy and hold +4.11%, flat USD 0.00%, versus holding -4.13 pp. The live `/api/markets` returned 203 markets, none with a logo. |

Pinned sections were checked at 1440x900 for forward and reverse scroll, pin offset (104px at every step), release past the end, click and Enter, and fit in the viewport (Forge 679px, Hooks 752px, Tape 656px, Lab 575px, How 508px, all under the 796px available). At 820 and 390 they are stacked tabs with no overflow. Defects found and fixed: Forge (903px) and Lab (859px) were taller than the screen and were compacted, Lab result slots were stacked by a stale rule, and scrolling was resetting a visitor's own rule edits in the Forge demo.

### Limits

- Genuine per-asset logos: not available from the allowed sources (above). The Markets rows use monograms.
- Not verified: a real wallet-extension prompt, Safari, Firefox, a real touch device. Scroll progress uses `getBoundingClientRect` in an animation-frame throttled listener, so it works in any browser, but only Chromium was tested.
- Reduced motion shows the pinned stories with no transitions rather than removing the pin; content is complete either way.
