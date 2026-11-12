# OPTRA Browser Runtime QA Handoff

Updated: 2026-11-13 (Asia/Jakarta)

## Result

The Playwright runtime is now reproducible without using SENTERA's ports or sharing Next.js generated files with the existing OPTRA dev server. The isolated app hydrated, resolved the unauthenticated wallet session, and the full browser suite passed.

## Findings

`AuthSessionProvider` starts in `loading` and only leaves that state after its client effect calls `GET /api/me`. On the existing OPTRA server at `127.0.0.1:3001`, a direct browser probe returned the `/agents` document and all 25 JavaScript chunks with status 200, but stayed on “Checking wallet session…” and issued no `/api/me` request. There were no React page errors, hydration warnings, or failed script requests. The session API itself returned the expected 401 when called directly.

The existing browser did report repeated `ERR_INVALID_HTTP_RESPONSE` HMR WebSocket errors. The same server accepted a valid raw HMR upgrade with `101 Switching Protocols`, so the browser error is not a consistent rejection by the HMR endpoint. It is a separate dev-transport symptom from the API/session path; the evidence does not establish whether it indirectly contributes to the 3001 hydration failure. The browser never issued the client effect's `/api/me` request, so authentication and the session endpoint are not the cause. The lower-level reason that this already-running 3001 browser runtime fails to hydrate was not isolated further, and that process was left running.

The reproducible E2E failure came from sharing one Next.js project root between concurrent dev servers. Changing `distDir` separated `.next` output, but Next 16 still writes `next-env.d.ts` at the project root. The earlier same-checkout E2E server changed that file's route type imports while the existing OPTRA server was active; the failed trace showed repeated Fast Refresh rebuilds and the page remained in its initial loading state. A health check against `/api/public/v1/verify` also allowed Playwright to start before `/agents` had compiled.

The final test server runs from a temporary, non-Git source snapshot. It has its own `next-env.d.ts`, generated output, and local PGlite directory. Dependencies are installed from the lockfile inside the snapshot; a symlink to the checkout's `node_modules` was rejected by Turbopack because it resolves outside the workspace root. The browser therefore exercises the current working tree, including staged and unstaged UI files, without making Next write generated state into the checkout.

## Changes

- `playwright.config.ts` defaults to `127.0.0.1:3100`, rejects 3000/3001/3002, never reuses an existing server, runs serially, and waits for `/agents`.
- `scripts/optra-e2e-isolated-server.ts` copies the current source tree to an OS temporary directory, excludes `.git`, generated output, `.local`, `node_modules`, and secret `.env*` files, installs locked dependencies, and starts Next there.
- `tests/e2e/runtime-smoke.spec.ts` verifies page hydration, session resolution, template API response, script loads, interactivity, browser errors, failed requests, and HMR socket errors. It permits only the dev Strict Mode cancellation of an initial templates request when a successful template response also arrives.

## Verification

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

## Port and working tree boundaries

- SENTERA remained on ports 3000 and 3002. Its listener PIDs were unchanged by the E2E runs.
- The existing OPTRA dev server remained on port 3001 and was not restarted or stopped.
- Playwright used port 3100 and released it after each run.
- The checkout's `next-env.d.ts` SHA-256 was unchanged across the isolated smoke run. Staged Claude UI files were not edited or re-staged.
- No commit, push, or deployment was performed.

The Playwright runner creates one disposable source snapshot under the operating system temporary directory per run; it is not a Git worktree and does not copy the local database or `.env` secrets.

## Reproduction

Run the smoke gate first:

```sh
./node_modules/.bin/playwright test --config=playwright.config.ts --grep 'runtime smoke'
```

After it passes, run the full browser suite:

```sh
bun run test:e2e
```

The original 3001 server remains a separate, already-running degraded dev process. Use the Playwright-managed isolated runtime for QA; do not point browser tests at port 3000, which belongs to SENTERA.
