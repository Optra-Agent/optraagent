# OPTRA Staging Readiness Implementation Plan

> **Execution mode:** Sole executor, inline implementation. Do not commit, push, run the deployment workflow, or modify the VPS.

**Goal:** Prepare an isolated, owner-triggered Docker/GHCR staging release for the paper-only Protective Put application.

**Architecture:** Build one immutable full-commit GHCR image, run it under Node.js with a separate persistent PostgreSQL database, and attach the app only to the externally verified reverse-proxy network plus a private DB network. A host cron script invokes the existing protected scheduler endpoint; only a manual workflow can request staging deployment.

**Tech Stack:** Next.js 16, Node.js 26.12.1, Bun 1.3.14 for frozen dependency installation/build, PostgreSQL 17.11, Docker Compose, GitHub Actions/GHCR.

**Spec:** Current user request, `docs/tasks/optra-fullstack-progress.md`, `docs/final-core-handoff.md`, `docs/browser-runtime-qa-handoff.md`, and existing OMNI staging conventions.

## Global Constraints

- Preserve the existing OPTRA source baseline and dirty changes.
- No remote deployment, contract work, production database, or real-money execution.
- Do not reuse OMNI/SENTERA credentials, database names, app services, volumes, or host ports.
- Keep all deploy actions manual and require the exact full-SHA image tag.
- Preserve `LIVE_TRADING_ENABLED=false` and `V4_CLAIM_LEVEL=L0`.
- Leave actual-wallet and timed live-market worker acceptance pending until observed.

## Review Focus

- A missing reverse-proxy network or host setting must fail before the stack can start.
- The app must not become healthy before PostgreSQL readiness and the existing migrations succeed.
- Cron output and workflow logs must never print bearer tokens, passwords, or SSH private keys.
- Failed application upgrades must not remove or reset the PostgreSQL volume.
- An unavailable or stale market feed must remain a deferred/failed evaluation, never a fabricated decision.

---

### Task 1: Image and isolated staging stack

**Files:** `Dockerfile`, `.dockerignore`, `deploy/staging/compose.yml`, `deploy/staging/init/001-app-role.sh`, `deploy/staging/.env.example`.

- [ ] Pin the Node and Bun build versions to the inspected local runtime and install from `bun.lock` with `--frozen-lockfile`.
- [ ] Run Next.js with Node.js, unprivileged, without publishing a host port.
- [ ] Create an OPTRA-only PostgreSQL role/database and project-scoped persistent volume.
- [ ] Require an explicitly supplied reverse-proxy network and safety environment.
- [ ] Add database and application health checks, restart policy, and bounded JSON logs.

### Task 2: Protected scheduled invocation and operator procedure

**Files:** `deploy/staging/optra-paper-scheduler.sh`, `deploy/staging/optra-paper-scheduler.cron`, `deploy/staging/README.md`.

- [ ] Invoke the existing endpoint every 15 minutes using a root-owned environment file and an unlogged bearer header.
- [ ] Document Nginx Proxy Manager routing, secret creation, migration, database backup/restore, forward rollback, health checks, and real scheduled skip/open acceptance.

### Task 3: Manual GHCR staging release

**Files:** `.github/workflows/ci.yml`, `.github/workflows/deploy-staging.yml`.

- [ ] Run locked typecheck, lint, Vitest, production build, and isolated Playwright before building the Docker image.
- [ ] Smoke-test the image against disposable PostgreSQL; publish only the tested image under `sha-<full commit>` on `main`.
- [ ] Keep deployment `workflow_dispatch` only, validate immutable image input, use unique OPTRA host settings/secrets, strict SSH host checking, and a dedicated root-owned OPTRA entrypoint.
- [ ] Do not dispatch the workflow or connect to remote Docker.

### Task 4: Tracker and local verification

**Files:** `docs/tasks/optra-fullstack-progress.md`.

- [ ] Record the November 16 artifacts while keeping staging deployment, wallet extension acceptance, and real scheduled market execution pending.
- [ ] Validate Compose/YAML and shell syntax locally. If the Docker daemon remains unavailable, record that Docker image build/health cannot be verified in this workspace.

