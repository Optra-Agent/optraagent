# OPTRA paper MVP staging

This deployment profile runs the supported Protective Put paper application and its PostgreSQL database as one isolated Docker Compose project. It never submits wallet transactions. It does not include any contract deployment or live execution path.

## Local deployment artifacts

- `../../Dockerfile` builds the production Next.js server with Node `26.12.1` and Bun `1.3.14` for lockfile installation/build.
- `compose.yml` defines the `optra-staging` project, app service, dedicated Postgres service, internal data network, named `optra-staging_pgdata` volume, restart policy, bounded JSON logs, and readiness health check. The app joins the existing reverse-proxy network; PostgreSQL does not.
- `init/001-app-role.sh` creates the unique `optra_staging` database and `optra_staging_app` login on a fresh data volume.
- `install-optra-staging.sh` installs only OPTRA files and directories on a Linux host. It does not start Compose services, create a proxy route, or install the active cron entry.
- `deploy-optra-staging.sh` is the root-owned immutable-image deployment/rollback entrypoint. It backs up PostgreSQL before each app image change and only changes the OPTRA app service.
- `optra-paper-scheduler.sh` and `optra-paper-scheduler.cron` define an authenticated host cron caller. It logs structured, redacted response summaries to syslog and does not put `CRON_SECRET` in a process argument.

The staging image workflow is in `.github/workflows/staging-image.yml`. The GHCR image namespace follows the repository's configured Git remote (`ghcr.io/optra-agent/optraagent`); confirm that the package exists and account permissions with the owner. Do not infer the currently active VPS proxy network from the example value.

## Host-specific values still required

Before this deployment can start, the owner/host administrator must verify the live VPS and supply:

1. The correct host address, OS/architecture, Docker Engine and Compose plugin versions, free disk space, firewall policy, and the existing HTTPS reverse-proxy implementation.
2. An owner-approved staging DNS name with a working TLS certificate and a separate reverse-proxy host mapping that name to `optra-staging-app:3000`.
3. The exact existing proxy Docker network name. Put it in `OPTRA_PROXY_NETWORK`; do not create a second proxy or attach PostgreSQL to the shared proxy network.
4. A dedicated SSH deployment identity, strict pinned host key, and narrowly scoped `sudo` access to the installed OPTRA root scripts. Do not reuse another application's credentials or deploy entrypoint.
5. GHCR package read permission for the VPS and publish permission for the owner/operator. GHCR tokens belong in their respective credential stores, never in repository files.

The example `OPTRA_PROXY_NETWORK` is a deliberate placeholder. The deployment script checks that the selected network exists before starting a container. It does not create or modify a network.

## One-time host preparation, after owner approval

Copy `deploy/staging/` to the VPS using the approved administrative channel, then run the installer as root from that checked-out/copied directory:

```sh
sudo ./deploy/staging/install-optra-staging.sh
```

Create a root-only runtime file. Generate three independent values with `openssl rand -hex 32`; do not reuse values between database administrator, app login, and scheduler secret:

```sh
sudo install -d -o root -g root -m 0700 /srv/platform/applications/staging/optra-paper
sudo install -o root -g root -m 0600 /dev/null /srv/platform/applications/staging/optra-paper/.env
sudoedit /srv/platform/applications/staging/optra-paper/.env
```

Set exactly these keys in `.env`:

```dotenv
APP_BASE_URL=https://OWNER-APPROVED-STAGING-HOSTNAME
OPTRA_PROXY_NETWORK=LIVE-VERIFIED-SHARED-PROXY-NETWORK
OPTRA_STAGING_DB_ADMIN_PASSWORD=__SET_LOCALLY__
OPTRA_STAGING_APP_PASSWORD=a-different-64-lowercase-hex-value
CRON_SECRET=a-third-unique-url-safe-secret-of-at-least-32-characters
```

Use a hostname only for `APP_BASE_URL`: no path, trailing slash, credentials, or port. The Compose profile pins `LIVE_TRADING_ENABLED=false` and `V4_CLAIM_LEVEL=L0`; those keys must not be added to `.env`. `DATABASE_URL` is assembled inside Compose using the private database service and app-specific login. `OPTRA_IMAGE` is supplied by the root deployment command and must be an immutable full commit SHA tag.

The database volume is named `optra-staging_pgdata`; Compose applies project/volume labels and the deploy entrypoint refuses an existing volume without the expected labels. PostgreSQL is reachable only on the internal `optra-staging` data network. There is no host port binding. The shared proxy network contains only the app service.

The init script runs only when PostgreSQL initializes an empty volume. Changing either database password later does not rotate the database role automatically; rotate the role and the root-owned `.env` together during a maintenance window.

## CI image validation and owner-gated GHCR publication

Pull requests and pushes to `main` run the same validation pipeline without registry writes. It pins Node `26.12.1`, Bun `1.3.14`, and the PostgreSQL `17.11` image; applies migrations twice to an ephemeral database; runs the PostgreSQL persistence/lock probes, unit/integration tests, isolated Chromium E2E, typecheck, lint, and production build; validates Compose; builds the production Docker image; and smoke-checks database readiness, liveness, and rejection of an unauthenticated scheduler request. The smoke check sends no authorized cron request and therefore cannot create a paper tick.

Publication is available only through a `workflow_dispatch` run selected on `main`, with `publish=true` and the exact full commit SHA entered as `release_commit`. The validation job checks that SHA is reachable from `main` and tests/builds that commit. The publish job then rechecks the same SHA and refuses an existing registry tag. It is also disabled unless a repository administrator sets `OPTRA_GHCR_PUBLISH_ENABLED=true` and a repository owner creates the `optra-ghcr-publish` environment with a required reviewer and the `main` branch deployment rule. Enable prevent-self-review and disable administrator bypass where the repository plan supports those environment rules. GitHub environment reviewer availability depends on repository visibility and plan; without an enforced reviewer rule, keep the repository variable unset. The job has `packages: write`; all validation jobs have read-only repository permissions.

This workflow only publishes to GHCR. It has no SSH action and never installs or deploys the image to the VPS. GHCR's commit tag is checked before publishing, but the registry itself does not make tags immutable; retain the package's digest as the deploy identity and never republish or retag a reviewed commit. The current CI target is `linux/amd64`; the VPS architecture must be confirmed to match before deployment.

### Local verification status — 2026-11-16

The workflow's source tests, YAML parsing, Compose configuration, host-script syntax, locked dependency install, and production build passed locally. A clean temporary copy matching the Docker context built with Node 26.12.1 and Bun 1.3.14 while `.env*` files and runtime secrets were absent. The local Docker daemon was unavailable, so no container image build or container health smoke was observed. GitHub Actions has not been run; no GHCR package, protected publish environment, or repository publish variable was verified/configured. Do not treat local preparation as a published image or staging deployment.

The full local browser suite passed 78/78, and the full Vitest run passed 140 with 2 opt-in PostgreSQL tests skipped. Those PostgreSQL migration, transaction, worker-lock, and backup/restore checks passed in the separately recorded Nov 15 disposable PostgreSQL 17 drill; they were not rerun on Nov 16 because no PostgreSQL service was attached to the local run. The host scheduler remains disabled until staging app and PostgreSQL readiness both pass.

## Build and publish an image

Use an approved Docker Buildx host and verify its target platform matches `docker info --format '{{.OSType}}/{{.Architecture}}'` on the VPS. The app package path is inferred from the configured Git remote and must be confirmed before first publish. Build only a clean, reviewed commit: this workspace currently contains uncommitted work, so publishing it under the current `HEAD` SHA would misidentify the image. Do not publish from this working tree.

```sh
set -euo pipefail
: "${GHCR_USERNAME:?Set GHCR_USERNAME to the authorized GHCR account}"
test -z "$(git status --porcelain)" || { echo 'Refusing to publish a dirty checkout' >&2; exit 1; }
GIT_SHA="$(git rev-parse --verify HEAD)"
IMAGE="ghcr.io/optra-agent/optraagent:sha-${GIT_SHA}"
read -r -s -p 'GHCR write token: ' GHCR_WRITE_TOKEN
printf '\n'
export GHCR_WRITE_TOKEN
DOCKER_CONFIG="$(mktemp -d)"
chmod 0700 "$DOCKER_CONFIG"
trap 'docker --config "$DOCKER_CONFIG" logout ghcr.io >/dev/null 2>&1 || true; rm -rf -- "$DOCKER_CONFIG"; unset GHCR_WRITE_TOKEN' EXIT
printf '%s\n' "$GHCR_WRITE_TOKEN" | docker --config "$DOCKER_CONFIG" login ghcr.io --username "$GHCR_USERNAME" --password-stdin
GHCR_WRITE_TOKEN=""
if docker --config "$DOCKER_CONFIG" buildx imagetools inspect "$IMAGE" >/dev/null 2>&1; then
  echo 'Refusing to overwrite an existing full-SHA image tag' >&2
  exit 1
fi
docker --config "$DOCKER_CONFIG" buildx build --pull --platform linux/amd64 \
  --label "org.opencontainers.image.source=https://github.com/Optra-Agent/optraagent" \
  --label "org.opencontainers.image.revision=${GIT_SHA}" \
  --tag "$IMAGE" --push .
```

Enter the GHCR write token at the silent prompt and provide `GHCR_USERNAME` in the environment. Replace `linux/amd64` with the verified VPS platform if needed. Do not use `latest` or overwrite an existing SHA tag. If a tag already exists, stop and inspect it rather than publishing different bytes under that tag. The temporary Docker config is removed on exit.

## Controlled deployment and rollback

The first owner-authorized deployment must use a registry token with GHCR package read access. The token is piped over the pinned SSH connection to the root-owned command and is not passed in command arguments. The command pulls the full-SHA tag, checks its OCI source/revision labels, resolves it to the registry manifest digest, and runs/stores that digest rather than continuing to trust a mutable tag:

```sh
set -euo pipefail
: "${GHCR_USERNAME:?Set GHCR_USERNAME to the authorized GHCR account}"
test -z "$(git status --porcelain)" || { echo 'Refusing to deploy from a dirty checkout' >&2; exit 1; }
GIT_SHA="$(git rev-parse --verify HEAD)"
IMAGE="ghcr.io/optra-agent/optraagent:sha-${GIT_SHA}"
read -r -s -p 'GHCR read token: ' GHCR_READ_TOKEN
printf '\n'
printf '%s\n' "$GHCR_READ_TOKEN" | ssh \
  -o StrictHostKeyChecking=yes \
  -o UserKnownHostsFile="$OPTRA_KNOWN_HOSTS_FILE" \
  "$OPTRA_DEPLOY_USER@$OPTRA_STAGING_HOST" \
  "sudo -n /usr/local/sbin/optra-staging-deploy deploy '$IMAGE' --registry-username '$GHCR_USERNAME' --registry-token-stdin"
unset GHCR_READ_TOKEN
```

Use a unique OPTRA deploy identity and a pinned `known_hosts` entry. The remote `sudo` rule should permit only `/usr/local/sbin/optra-staging-deploy` and the installer/scheduler setup commands needed for OPTRA. The command validates the HTTPS origin, independent secrets, external proxy network, project volume labels, and exact SHA tag; starts only the `optra-staging` database; waits for its health check; writes a mode-600 custom-format `pg_dump`; then starts the app and waits for `/api/health/ready`.

If the app fails its health check, the command restores the prior healthy app image when one is recorded. It never deletes the database container or volume. To explicitly roll back the app, invoke the same root command with `rollback` and the GHCR read token. Database rollback is separate and requires a maintenance window; code rollback must not be treated as schema rollback.

The command stores digest-pinned `last-good-image` and `previous-image` values under `/var/lib/optra-staging`. Database backups are under `/srv/platform/backups/optra-staging`. Configure and verify off-host backup copying and retention before treating these local dumps as disaster recovery.

## Health, logs, and basic monitoring

- Liveness: `GET https://OWNER-APPROVED-STAGING-HOSTNAME/api/health/live`.
- Readiness: `GET https://OWNER-APPROVED-STAGING-HOSTNAME/api/health/ready`; a `200` requires valid production settings, completed database setup/migrations, and `SELECT 1`.
- Docker health: the app container probes readiness every 30 seconds; Postgres uses `pg_isready`.
- App/database logs: `docker compose --project-name optra-staging --env-file /srv/platform/applications/staging/optra-paper/.env -f /srv/platform/applications/staging/optra-paper/compose.yml logs --since 30m app db`.
- Host scheduler events: `journalctl -t optra-staging-paper-scheduler --since today`; deploy events: `journalctl -t optra-staging-deploy --since today`.
- Check `docker compose ... ps` and both HTTPS health paths. A cron HTTP `200` does not prove an order occurred: inspect the structured server `paper_scheduler.run_completed` event and the owner's authenticated Tape.

Set up an owner-approved alert to notify on an unhealthy app, readiness failure, missing scheduler invocation, HTTP failure, or scheduler `failures > 0`. No external alert destination was configured in OPTRA, so alert delivery remains a host/operator task.

## Protected scheduler

Install `curl`, `jq`, `flock` (util-linux), cron, and a working local syslog/journald bridge on the VPS. Create `/etc/optra-staging/paper-scheduler.env` as root-owned mode `0600` with only `APP_BASE_URL` and the same unique `CRON_SECRET` used by the app. The caller checks that both secret files match before making the request. Keep the secret out of shell history and deployment logs:

Keep the cron file under `/usr/local/share` and inactive until the app has been deployed, PostgreSQL reports healthy, migrations have completed, and `/api/health/ready` returns `200` over the approved HTTPS origin. Confirm the scheduler secrets match before enabling the recurring entry. The install script does not enable it.

```sh
sudo install -d -o root -g root -m 0700 /etc/optra-staging
sudo install -o root -g root -m 0600 /dev/null /etc/optra-staging/paper-scheduler.env
sudoedit /etc/optra-staging/paper-scheduler.env
curl --fail --silent --show-error "https://OWNER-APPROVED-STAGING-HOSTNAME/api/health/ready"
sudo install -o root -g root -m 0644 /usr/local/share/optra-staging-paper-scheduler.cron /etc/cron.d/optra-staging-paper-scheduler
```

The scheduler file contains exactly these two lines, using the same origin and secret already set in the app `.env`:

```dotenv
APP_BASE_URL=https://OWNER-APPROVED-STAGING-HOSTNAME
CRON_SECRET=OWNER-GENERATED-UNIQUE-URL-SAFE-SECRET
```

The proposed schedule is `5,20,35,50 * * * *`. Host `flock` prevents overlapping invocations; the endpoint also holds the PostgreSQL scheduler advisory lock. The caller uses bounded timeouts and summarizes only counts/status in syslog. It never logs the bearer token or full response body.

The scheduler evaluates only running supported Protective Put agents, with finalized, fresh, complete hourly Crius history and a valid regular US equity session. It uses deterministic paper `runTick` and the existing atomic/idempotent persistence path. If data is stale, absent, incomplete, outside session, or a risk rule blocks entry, that is not an order. Verify one actual scheduled skip and one modeled order only when real provider data and the active recipe/account are genuinely eligible. Confirm both persisted Tape evidence and order/position state. Do not change candles or invoke historical replay to manufacture either result.

## Database backup, restore, migrations, and rollback

The root deploy entrypoint takes a new `pg_dump -Fc` before each app image switch. Check that backup file exists, is nonempty, mode `0600`, and has enough disk space. Backups are local to the VPS until an owner-approved off-host backup policy is configured.

Run restore rehearsals against an isolated disposable PostgreSQL instance/project, never production or the live staging database. The Nov 15 drill already verified migration records and a persisted row in a second disposable database. For an explicitly approved recovery of staging itself, restore a backup into a new separate database in the dedicated OPTRA Postgres service. Keep the app running against its current database while restoring and validating the separate copy:

```sh
RESTORE_SUFFIX="$(date -u +%Y%m%dT%H%M%SZ)"
RESTORE_DB="optra_staging_restore_${RESTORE_SUFFIX}"
OLD_DB="optra_staging_before_restore_${RESTORE_SUFFIX}"
docker compose --project-name optra-staging --env-file /srv/platform/applications/staging/optra-paper/.env \
  -f /srv/platform/applications/staging/optra-paper/compose.yml exec -T db \
  createdb -U optra_staging_admin -O optra_staging_app "$RESTORE_DB"
docker compose --project-name optra-staging --env-file /srv/platform/applications/staging/optra-paper/.env \
  -f /srv/platform/applications/staging/optra-paper/compose.yml exec -T db \
  pg_restore --exit-on-error --no-owner --role=optra_staging_app \
  --dbname="$RESTORE_DB" - < /secure/path/optra-staging.dump
```

Validate the migration table and representative paper account/agent/order/position/Tape rows in `RESTORE_DB` before switching anything. For an explicitly approved maintenance restore, keep the app serving its current database while restoring/validating the separate copy, then stop it and rename the current database and restored database in two separate commands while connected to `postgres`:

```sh
RESTORE_SUFFIX="$(date -u +%Y%m%dT%H%M%SZ)"
RESTORE_DB="optra_staging_restore_${RESTORE_SUFFIX}"
OLD_DB="optra_staging_before_restore_${RESTORE_SUFFIX}"
docker compose --project-name optra-staging --env-file /srv/platform/applications/staging/optra-paper/.env \
  -f /srv/platform/applications/staging/optra-paper/compose.yml stop app
docker compose --project-name optra-staging --env-file /srv/platform/applications/staging/optra-paper/.env \
  -f /srv/platform/applications/staging/optra-paper/compose.yml exec -T db \
  psql -v ON_ERROR_STOP=1 -U optra_staging_admin -d postgres \
  -c "ALTER DATABASE optra_staging RENAME TO ${OLD_DB}"
docker compose --project-name optra-staging --env-file /srv/platform/applications/staging/optra-paper/.env \
  -f /srv/platform/applications/staging/optra-paper/compose.yml exec -T db \
  psql -v ON_ERROR_STOP=1 -U optra_staging_admin -d postgres \
  -c "ALTER DATABASE ${RESTORE_DB} RENAME TO optra_staging"
```

Keep the old database until the restored app image passes readiness and ledger checks. Start the owner-approved image only after confirming its migration compatibility. Do not use `--clean` against the active database as an automatic rollback. The previously reported disposable PostgreSQL drill covered a fresh migration, a repeated migration, rollback behavior, cross-connection scheduler locking, and custom-format backup/restore; no production database was used.

The application applies Drizzle migrations under the existing migration lock on first database access/readiness. Review the migration diff and backup before deploying an image with migrations. PostgreSQL and app container restarts use `unless-stopped`; persistent database files live only in the OPTRA named volume.

## Genuine wallet and scheduled acceptance still pending

Automated signer/session tests are not real wallet extension acceptance. From a clean Chrome profile on the staging HTTPS origin:

1. Unlock MetaMask and Phantom EVM, select an already-connected account, and sign in. Confirm one ownership signature, `/api/me` remains authenticated after refresh, and no wallet transaction/order appears.
2. Repeat for both extensions after disconnect/reconnect. Reject one signature and confirm no session is created; switch account and chain and confirm stale authentication is invalidated/refreshed safely.
3. On the required Robinhood Chain network, open the Protective Put workspace, validate the recipe, run the coverage-gated backtest, launch paper, then wait for a scheduled run. Inspect Tape and database-backed order/position state.
4. Verify one actual fresh-data/risk-gated skip and, only under genuinely passing rule/account conditions, one modeled PAPER order. A `200`, `202 already_running`, stale-data deferral, or closed-session response is not evidence of an order.

The Chrome extension prompt and live scheduled staging execution have not been accepted yet. Keep both gates pending until observed on this staging host.
