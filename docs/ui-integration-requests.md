# UI Integration Requests (for backend review)

The premium UI pass did not change any API, schema, engine or persistence code. These requests record the UI/backend seams; check the current UI source before treating an item as outstanding. The UI must label unavailable data rather than inventing values.

| # | Request | Why the UI needs it | Current UI behavior |
|---|---|---|---|
| 1 | Paper account summary on `GET /api/agents/{id}/positions` or a new route: cash, equity, realized and unrealized P/L, peak equity. | The agent page can show position-level marks only. A trader expects one equity line per agent. | Shows per-position unrealized P/L and the backtest `endingCashUsd`. No equity total is computed client-side. |
| 2 | ~~Benchmark metrics on `BacktestRun`~~ Implemented in the backend contract for new completed runs. | The PM brief requires a same-window comparison. | Claude's current `BenchmarkComparison` consumes `BacktestMetrics.benchmarks`, displays legacy rows as unavailable, and labels cash flat USD/no yield. Browser verification remains pending; no client benchmark calculation or measured USDG claim is allowed. |
| 3 | Public visibility opt-in for an agent and its Tape (`/api/public/v1/agents`, `/tape`). | The landing page cannot offer `Watch the Tape` as a live feed. | `Read the Tape` scrolls to an illustrative, labeled example. |
| 4 | `underlyingSymbol`, `lastDecisionAt` and `lastDecisionAction` on `Agent` list items. | Lab fetches each draft's detail to learn its underlying; the list cannot show the last decision. | Lab loads `GET /api/agents/{id}` for the selected draft. |
| 5 | A readiness flag before a paper tick (for example `GET /api/agents/{id}/tick-readiness` returning market session and data freshness). | Users learn the market is closed only after running a tick, which records a `skip`. | The next-step card explains that a tick records why it held or skipped. |
| 6 | `parameters` summaries per hook in `HookDefinition` (a one-line human description of defaults). | The landing recipe preview maps hook ids to short descriptions in `components/marketing/data.ts`. | Descriptions are derived from the recipe defaults in `buildProtectivePutRecipe()`. |
