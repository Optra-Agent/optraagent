# ADR 0001: Single Next.js paper-trading core

- Status: Accepted for MVP implementation; wallet-only auth waiver remains pending PM signoff.
- Date: 2026-11-12.

> **Recovery update:** The PM brief has since been supplied and the recovery added the Crius Robinhood Chain hourly candle adapter plus an explicitly modeled Black–Scholes Protective Put path. Initial context/consequence notes below describe the decision point; see `docs/tasks/optra-fullstack-progress.md` for as-built evidence and limits.

## Context

The supplied workspace contained only project documents and no application or Git repository. The V2 execution brief requires one Next.js application, read-only Robinhood data, owner-scoped persistence, deterministic evaluation, paper-only execution, and contracts shared with a later UI pass. The source brief containing the exact 36 hooks is absent.

## Decision

- Keep one Next.js 16 App Router repository for browser pages, JSON APIs, and same-source scheduled paper workers.
- Use strict TypeScript, React, Tailwind CSS 4, Zod schemas as the canonical API/domain types, wagmi + viem for EVM wallet access and signature verification, Drizzle ORM for persistence, PGlite for local/test storage, and PostgreSQL via `DATABASE_URL` for production.
- Authenticate with an origin-bound, expiring, one-time wallet challenge and a hashed opaque session token in an HttpOnly cookie. Derive owners only from the verified session.
- Read Robinhood Chain market information through its documented read-only API. Treat all price history and option pricing as unavailable unless a verified source supplies them.
- Keep `LIVE_TRADING_ENABLED=false`, `V4_CLAIM_LEVEL=L0`, and prohibit transaction signing, approvals, transfers, contract deployment, custody, and payment paths.
- Keep the initial app UI functional and plain for a later Claude Code visual integration. Backend/domain contracts, authentication, routes, persistence, and tests remain owned by Codex.

## Consequences

- Local development does not require an external database, but multi-instance production requires PostgreSQL and migration execution.
- Wallet-only sign-in is an MVP reduction noted as awaiting PM signoff in the source brief. Do not claim other login methods.
- Missing PM hook definitions and verified history prevent honest catalog completeness and real launch eligibility. The API must report these limits and fail closed.
- No Git metadata existed at initialization; no branch, commit, or clean/dirty state can be reported.

## Alternatives considered

- Separate frontend/backend projects or a worktree: rejected by the one-repository requirement and absent Git repository.
- Production SQLite or PGlite: rejected for production concurrency/deployment; PGlite is local/test only.
- Invented history, simulated option premium, or placeholder hook rows: rejected because they would misstate verified product capability.
