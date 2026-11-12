# Optra Core Discovery

Updated: 2026-11-12 (Asia/Jakarta)

> Historical initial discovery before the recovery pass. The original PM brief has since been supplied, all 36 PM hook entries have been cataloged, and a Crius AAPL history capture has been verified. Statements below describe the initial state only; current capability and remaining blockers are in `docs/OPTRA_CODEX_CORE_RECOVERY.md` and `docs/tasks/optra-fullstack-progress.md`.

## Verified workspace

- The supplied workspace was a documents-only directory with no `package.json`, source tree, `.git`, `.env`, or original PM product brief. The V2 discovery prompt references `Teks yang ditempel (1)(20261111-195353).txt`; that source file is absent. V2 execution documents are authoritative over V1.
- A single Next.js App Router application was initialized in this workspace. Verified runtime: Node `v26.12.1`, Bun `1.3.14`, Next.js `16.4.6`, React `19.3.1`, TypeScript `6.0.3`, wagmi `3.7.11`, viem `2.57.18`, Zod `4.6.7`, Drizzle ORM `0.45.4`, PGlite `0.5.16`.
- Local development uses persistent PGlite at `.local/optra-db`; production requires `DATABASE_URL` and PostgreSQL. The local directory is ignored by Git. No Git repository or deployment configuration was supplied.
- The supported wallet session is EVM-only: MetaMask and Phantom EVM when exposed by the browser. Sign-in uses an origin-bound, expiring, single-use challenge on chain ID `4663`, then an opaque, hashed server session in an HttpOnly cookie. Session ownership is derived from that cookie, never request JSON.
- There is no wallet extension in the Playwright browser. Service tests sign with a deterministic EVM test account; browser tests verify the missing-extension state. No transaction or approval API is present.

## Market and product evidence

- Official Robinhood Chain read-only API checks on 2026-11-12 returned 203 listed assets and a timestamped AAPL quote with underlying bid/ask and token price/multiplier fields. The application must verify symbol membership and timestamp freshness before treating a quote as usable.
- The published Robinhood price endpoint is a current quote endpoint. No official historical OHLC source was verified. A 30-day/720-hour backtest must report insufficient history until genuine hourly snapshots accumulate or an independently verified history source is configured.
- The exact PM hook catalog (36 names, stages, parameter schemas) cannot be recovered without the missing original PM brief. The available V2 brief documents only the 10/7/4/7/3/5 stage counts and mentions a few names in specification-conflict notes; it does not provide all definitions. No rows are registered. Definitions must not be invented. Four strategy templates remain Preview until their recipe, option pricing/collateral model, and evaluators are supported.
- There are no verified option premiums in the current feed. Underlying spot quotes cannot be presented as option fills, premiums, or performance. V4 capability remains `L0`; live trading remains disabled.

## Open release constraints

- Obtain the original PM brief before asserting 36-hook completeness or PM-specific parameter compatibility.
- Obtain genuine historical and option quote data before enabling launch. Every backtest result needs source, time coverage, pricing methodology, and the same recipe hash used for launch.
- Configure a persistent PostgreSQL service for multi-instance deployment. PGlite is a local/test convenience, not production hosting.
- Wallet-only authentication is the chosen MVP scope from the V2 execution brief; the brief labels removal of email/Google auth as pending PM signoff.
