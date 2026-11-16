# OPTRA Railway staging

This configuration describes three separate Railway resources in one staging environment:

| Service | Runtime | Configuration |
| --- | --- | --- |
| OPTRA Web | Persistent Next.js app | Root `Dockerfile`; Node 26.12.1 and Bun 1.3.14; `/api/health/ready` probe |
| OPTRA PostgreSQL | Railway-managed PostgreSQL | Private service networking; app connects through its `DATABASE_URL` reference |
| OPTRA Paper Cron | Short-lived scheduled service | Root `Dockerfile`, overridden start command `node scripts/railway-paper-cron.mjs`, opt-in schedule `*/15 * * * *` UTC |

The cron is a separate Railway service. It does not start `next start`; it sends one authenticated HTTPS POST to the web app, consumes the response, closes its one-shot connection, and exits. It has no database URL and no public domain. The existing scheduler owns finalized-candle checks, PostgreSQL advisory locking, deterministic paper decisions, and idempotent persistence. IaC leaves the recurring schedule unset and sets `PAPER_CRON_ENABLED=false` by default; an initial service run therefore logs `paper_cron.disabled` and exits without contacting Web. Only the local config-evaluation variable `OPTRA_ENABLE_PAPER_CRON=true` adds `*/15 * * * *` and sets the runtime kill switch to true. Leave it unset until the owner separately authorizes activation after readiness checks.

## Status and apply boundary

The Railway CLI was authenticated locally, but this repository is not linked to a Railway project, and no OPTRA project appeared in the account project list. No service was created, no project was linked, no IaC plan was applied, and no deployment was triggered.

The Railway account owner must first select the workspace, create or identify an `OPTRA Staging` project and a `staging` environment, approve the billable Web/Cron/PostgreSQL resources, and confirm the region and public web domain. Then link this repository to that exact project and review `railway config plan` before applying it. Do not link this checkout to an unrelated project.

Railway's current Infrastructure as Code workflow is used because the older `railway.toml`/`railway.json` Config as Code is deprecated for new services. GitHub automatic deployment is a dashboard setting and is not represented by this file. Keep auto-deploy disabled while connecting the source and until the owner separately approves the deployment path. The IaC file points at `main`; merge the validated release and Railway follow-up before selecting a deployment commit. `railway config apply` provisions billable resources and may start an initial build; do not run it without the owner's provisioning/deployment approval.

## Variables

Set two shared variables in the staging environment. The IaC references these same values in Web and Cron; it does not store literal credentials.

| Variable | Required value |
| --- | --- |
| `APP_BASE_URL` | The final public HTTPS origin, exactly `https://<Railway-generated-or-owner-domain>` with no path, credentials, query, or trailing slash. Set it after generating/confirming the Web domain. |
| `CRON_SECRET` | A unique random URL-safe secret with at least 32 characters. Store it in Railway's secret variable UI; never put it in this repository, a build argument, or a command line. |

Railway-managed variables set by the configuration:

- `DATABASE_URL` on Web references `OPTRA PostgreSQL.DATABASE_URL`, which is the private in-project database connection.
- `NODE_ENV=production` and `PORT=3000` on Web.
- `LIVE_TRADING_ENABLED=false` and `V4_CLAIM_LEVEL=L0` on both application services.
- Cron receives only `APP_BASE_URL`, `CRON_SECRET`, and runtime safety flags; it does not receive `DATABASE_URL`.
- No separate market API credential is currently required by the configured Crius history provider. Do not add credentials unless the owner selects a provider that requires them.

## Build, migration, and health

Both repository-backed services use the existing root `Dockerfile`, which pins `node:26.12.1-bookworm-slim` and installs Bun `1.3.14` for the frozen-lockfile build. Web keeps the image's normal `next start` command; Cron overrides it with the one-shot Node script copied into the runtime image.

The database client applies the existing Drizzle migrations when it first opens a production PostgreSQL connection. Railway probes Web at `/api/health/ready`; that route opens the connection and returns `200` only after migrations finish and `SELECT 1` succeeds. Migration or database failures keep readiness non-200, and the deployment healthcheck allows 300 seconds. Do not mark the Web service healthy or activate Cron before this probe returns `200` over the final HTTPS origin.

Cron uses `*/15 * * * *` (UTC). Railway skips an invocation if the previous execution has not exited; the app also holds its PostgreSQL advisory lock. A complete evaluation exits `0`; a partial run, HTTP/auth failure, malformed response, or transport timeout exits nonzero and appears as a failed Cron run. An `already_running` response is a logged safe no-op. A later scheduled invocation retries through existing per-candle idempotency; do not fabricate candles or force a market-open state.

## Operations

- Keep PostgreSQL private; do not add a public TCP proxy for the app.
- Before deployment, enable a Railway PostgreSQL daily backup schedule. Consider PostgreSQL point-in-time recovery if its cost and retention are appropriate for this staging environment.
- Verify a backup from the database service's Backups tab. Test restore by provisioning a separate restored database/service in the same project/environment, pointing a non-live staging deployment at that private URL, then checking `/api/health/ready` and authenticated persisted state. Do not restore over the active database as a routine rollback.
- Roll back the Web service to the previous healthy Railway deployment. A code rollback does not reverse database migrations; review migration compatibility and restore into a separate service if data recovery is needed.
- Inspect Web and Cron deployment logs in Railway's Logs/Observability views. Cron logs are single-line structured JSON events such as `paper_cron.run_completed`, `paper_cron.run_partial`, and `paper_cron.request_failed`; the bearer secret and response body are never logged. Check the Cron Runs list for crashed or skipped executions. Railway log retention depends on workspace plan; no external alert destination is configured by this change.
- After owner approval and readiness, run one genuine scheduled skip check and one modeled-order check only when live provider data and the actual recipe/account are eligible. Confirm decisions, Tape evidence, and order/position state in the authenticated app. A successful cron response by itself is not evidence that an order opened.
- Keep the scheduled service disabled until app/DB readiness, session handling, and initial paper-flow checks are accepted. Keep real-money execution disabled permanently for this MVP.

## Owner steps still required

1. Merge the already validated web release, then include this Railway-specific follow-up after its CI validation.
2. Authorize/select the Railway workspace, staging project, region, billable resources, and app domain; set shared `APP_BASE_URL` and `CRON_SECRET` in Railway.
3. Disable GitHub auto-deploy for the services, review the IaC plan, and explicitly authorize provisioning/deployment.
4. Confirm healthy migrations, wallet sessions, and the Protective Put draft-to-Tape flow. Only after separate scheduler approval, apply with `OPTRA_ENABLE_PAPER_CRON=true` to set the 15-minute UTC schedule.
5. Perform real MetaMask and Phantom extension acceptance. Mocked signer tests do not satisfy this gate.
