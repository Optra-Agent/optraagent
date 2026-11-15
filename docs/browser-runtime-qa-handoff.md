# OPTRA Browser Runtime QA Handoff

Updated: 2026-11-15 (Asia/Jakarta)

## Current-source recovery run — 2026-11-15

The isolated Playwright snapshot ran on port 3100 without restarting SENTERA or existing OPTRA processes. The current source completed **78/78 Chromium tests**, including the Forge workflow, Hooks, Tape, Lab, How, app shell, runtime hydration, and the browser-to-database paper journey. Forge checks cover all five workflow screens, keyboard selection, forward/reverse pinned scrolling, 390px/820px/1440px layouts, reduced motion, read-only behavior, and autoplay pause/resume/replay. The final run had no failed tests.

The runtime smoke loaded 25 scripts, issued `GET /api/me` and received the expected signed-out 401, recorded zero HMR errors, and allowed a dev Strict Mode cancellation. The browser journey obtains a server-verified session with a test signer, then uses real UI/API handlers for draft, backtest, benchmark, launch, paper tick, and Tape refresh against disposable PGlite. Its captured quote is correctly treated as stale, so that tick records a zero-order skip; the Vitest PGlite integration covers a successful modeled order and persisted position. This is not extension acceptance. The journey confirms sign-in alone creates no agent. E2E also asserts the Lab draft selector remains controlled as `/api/agents` loads.

Forge, Hooks, Tape, and Lab were captured and visually reviewed at 1440×900, 820×900, and 390×844. Forge now presents an app-like Protective Put walkthrough: agent, selected rules, validator result, Lab readiness, and an illustrative decision leading to Tape. It uses the real hook catalog and validator feedback; direct rule edits synchronize with the demo editor. Screenshot captures for the five steps and three viewport sizes remain in ignored `.local/optra-e2e-results/`. Browser checks confirm responsive widths and no horizontal overflow.

The isolated browser environment did not expose an actual MetaMask or Phantom extension prompt. The supplied Chrome screenshot shows both wallet toolbar icons, but the current Chrome process had no remote-debugging endpoint, so no extension-backed target was available. Real extension signing remains unverified. Wallet lifecycle tests cover connector reuse and session transitions, and isolated browser tests verify the no-extension state. Manual acceptance steps are in `docs/tasks/optra-fullstack-progress.md`.

Production build passed from a temporary source snapshot after installing the locked dependencies. It generated 14 static pages and compiled dynamic API routes without changing the checkout's `.next` or TypeScript config. The missing `db:migrate` script was added with a tested PostgreSQL-target guard; no database migration was run.

## Result

The Playwright runtime is reproducible without using SENTERA's ports or sharing Next.js generated files with the existing OPTRA dev server. The isolated app hydrated, resolved the unauthenticated wallet session, and the final full browser suite passed. One intermediate run timed out while loading `/agents`; its isolated repeat and the subsequent full run passed.

## Historical port-3001 investigation (superseded for current QA by the recovery run above)

### Findings

`AuthSessionProvider` starts in `loading` and only leaves that state after its client effect calls `GET /api/me`. On the existing OPTRA server at `127.0.0.1:3001`, a direct browser probe returned the `/agents` document and all 25 JavaScript chunks with status 200, but stayed on “Checking wallet session…” and issued no `/api/me` request. There were no React page errors, hydration warnings, or failed script requests. The session API itself returned the expected 401 when called directly.

The existing browser did report repeated `ERR_INVALID_HTTP_RESPONSE` HMR WebSocket errors. The same server accepted a valid raw HMR upgrade with `101 Switching Protocols`, so the browser error is not a consistent rejection by the HMR endpoint. It is a separate dev-transport symptom from the API/session path; the evidence does not establish whether it indirectly contributes to the 3001 hydration failure. The browser never issued the client effect's `/api/me` request, so authentication and the session endpoint are not the cause. The lower-level reason that this already-running 3001 browser runtime fails to hydrate was not isolated further, and that process was left running.

The reproducible E2E failure came from sharing one Next.js project root between concurrent dev servers. Changing `distDir` separated `.next` output, but Next 16 still writes `next-env.d.ts` at the project root. The earlier same-checkout E2E server changed that file's route type imports while the existing OPTRA server was active; the failed trace showed repeated Fast Refresh rebuilds and the page remained in its initial loading state. A health check against `/api/public/v1/verify` also allowed Playwright to start before `/agents` had compiled.

The final test server runs from a temporary, non-Git source snapshot. It has its own `next-env.d.ts`, generated output, and local PGlite directory. Dependencies are installed from the lockfile inside the snapshot; a symlink to the checkout's `node_modules` was rejected by Turbopack because it resolves outside the workspace root. The browser therefore exercises the current working tree, including staged and unstaged UI files, without making Next write generated state into the checkout.

### Changes

- `playwright.config.ts` defaults to `127.0.0.1:3100`, rejects 3000/3001/3002, never reuses an existing server, runs serially, and waits for `/agents`.
- `scripts/optra-e2e-isolated-server.ts` copies the current source tree to an OS temporary directory, excludes `.git`, generated output, `.local`, `node_modules`, and secret `.env*` files, installs locked dependencies, and starts Next there with a disposable PGlite path and loopback market fixture server. It removes inherited `DATABASE_URL` so this test server cannot target a developer database.
- `tests/e2e/paper-flow-live-api.spec.ts` signs a server challenge with a test key, then covers the real browser/API route workflow and verifies the persisted skip in Tape after refresh. It is not real MetaMask or Phantom acceptance.
- `tests/e2e/runtime-smoke.spec.ts` verifies page hydration, session resolution, template API response, script loads, interactivity, browser errors, failed requests, and HMR socket errors. It permits only the dev Strict Mode cancellation of an initial templates request when a successful template response also arrives.

### Verification

| Command / probe | Result |
|---|---|
| `./node_modules/.bin/playwright test --config=playwright.config.ts --grep 'runtime smoke'` | Passed: 1 test. 25 script responses; `GET /api/me` returned 401; templates returned 200; loading state cleared; wallet dialog opened; 0 HMR socket errors. One aborted initial template request was followed by a successful 200 response. |
| `bun run test:e2e` | Passed: 51 tests in 2.0 minutes. The Agents/app-polish cases that previously remained in the loading state passed. |
| `bunx eslint playwright.config.ts tests/e2e/runtime-smoke.spec.ts scripts/optra-e2e-isolated-server.ts` | Passed. |
| `bunx tsc --noEmit --incremental false` | Passed. |
| `git diff --check && git diff --cached --check` | Passed. |
| Read-only browser probe of `127.0.0.1:3001/agents` | Confirmed the existing server still does not hydrate: loading remains, no `/api/me` request, 25 script responses are 200, no React/page errors, repeated browser HMR handshake errors. |
| HMR upgrade probe on port 3001 | Valid raw upgrade returned `101 Switching Protocols`; direct `GET /api/me` returned the expected 401. |

Backend tests and build were not rerun. This pass changed only test/runtime setup, and the existing OPTRA dev server owns the checkout's `.next/dev/lock`. The accepted backend audit remains the prior 103-test result.

### Port and working tree boundaries

- SENTERA remained on ports 3000 and 3002. Its listener PIDs were unchanged by the E2E runs.
- The existing OPTRA dev server remained on port 3001 and was not restarted or stopped.
- Playwright used port 3100 and released it after each run.
- The checkout's `next-env.d.ts` SHA-256 was unchanged across the isolated smoke run. Staged Claude UI files were not edited or re-staged.
- No commit, push, or deployment was performed.

The Playwright runner creates one disposable source snapshot under the operating system temporary directory per run; it is not a Git worktree and does not copy the local database or `.env` secrets.

### Reproduction

Run the smoke gate first:

```sh
./node_modules/.bin/playwright test --config=playwright.config.ts --grep 'runtime smoke'
```

After it passes, run the full browser suite:

```sh
bun run test:e2e
```

The original 3001 server remains a separate, already-running degraded dev process. Use the Playwright-managed isolated runtime for QA; do not point browser tests at port 3000, which belongs to SENTERA.
