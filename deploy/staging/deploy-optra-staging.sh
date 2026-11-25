#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly PROJECT="optra-staging"
readonly STAGING_ROOT="/srv/platform/applications/staging/optra-paper"
readonly STATE_ROOT="/var/lib/optra-staging"
readonly BACKUP_ROOT="/srv/platform/backups/optra-staging"
readonly IMAGE_RE='^ghcr\.io/optra-agent/optraagent:sha-[0-9a-f]{40}$'

usage() {
  cat >&2 <<'USAGE'
Usage:
  deploy-optra-staging.sh deploy ghcr.io/optra-agent/optraagent:sha-<40 lowercase hex> --registry-username USER --registry-token-stdin
  deploy-optra-staging.sh rollback --registry-username USER --registry-token-stdin

The registry token is read from stdin. This command manages only the OPTRA staging app and database project.
USAGE
}

fail() {
  printf 'optra-staging: %s\n' "$1" >&2
  exit 1
}

log_event() {
  local event="$1"
  shift
  logger -t optra-staging-deploy -- "{\"event\":\"$event\",\"project\":\"$PROJECT\",\"details\":\"$*\"}" 2>/dev/null || true
}

operation="${1:-}"
requested_tag=""
requested_revision=""
case "$operation" in
  deploy)
    [[ $# -ge 2 ]] || { usage; exit 2; }
    requested_tag="$2"
    [[ "$requested_tag" =~ $IMAGE_RE ]] || fail "image must use an immutable full-SHA image tag: ghcr.io/optra-agent/optraagent:sha-<40 lowercase hex>"
    requested_revision="${requested_tag##*:sha-}"
    target_image=""
    shift 2
    ;;
  rollback)
    target_image=""
    shift
    ;;
  *)
    usage
    exit 2
    ;;
esac

registry_username=""
registry_token_stdin="false"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --registry-username)
      [[ $# -ge 2 && -n "$2" ]] || { usage; exit 2; }
      registry_username="$2"
      shift 2
      ;;
    --registry-token-stdin)
      registry_token_stdin="true"
      shift
      ;;
    *)
      usage
      exit 2
      ;;
  esac
done

[[ "$registry_token_stdin" == "true" && -n "$registry_username" ]] || { usage; exit 2; }
[[ "$registry_username" =~ ^[A-Za-z0-9][A-Za-z0-9-]{0,38}$ ]] || fail "registry username is invalid"
[[ "$(id -u)" -eq 0 ]] || fail "must run as root on the provisioned VPS"
command -v flock >/dev/null 2>&1 || fail "flock from util-linux is required"
exec 9>/run/lock/optra-staging-deploy.lock
flock -n 9 || fail "another OPTRA staging deploy or rollback is already running"

readonly COMPOSE_FILE="$STAGING_ROOT/compose.yml"
readonly ENV_FILE="$STAGING_ROOT/.env"
readonly LAST_GOOD_FILE="$STATE_ROOT/last-good-image"
readonly PREVIOUS_FILE="$STATE_ROOT/previous-image"

[[ -f "$COMPOSE_FILE" && -f "$ENV_FILE" && ! -L "$ENV_FILE" ]] || fail "OPTRA staging configuration is not installed as regular files"
[[ "$(stat -c '%u:%a' "$ENV_FILE")" == "0:600" ]] || fail "staging .env must be owned by root with mode 600"
if grep -Eq 'replace-with-|^APP_BASE_URL=https?://[^[:space:]]+\.invalid([:/]|$)' "$ENV_FILE"; then
  fail "staging .env still contains placeholder configuration"
fi
env_value() {
  local key="$1"
  local -a values=()
  mapfile -t values < <(sed -n "s/^${key}=//p" "$ENV_FILE")
  [[ "${#values[@]}" -eq 1 ]] || fail "staging .env must contain exactly one $key"
  printf '%s' "${values[0]}"
}
app_base_url="$(env_value APP_BASE_URL)"
[[ "$app_base_url" =~ ^https://[A-Za-z0-9.-]+$ ]] || fail "APP_BASE_URL must be a canonical HTTPS origin without a path or port"
admin_password="$(env_value OPTRA_STAGING_DB_ADMIN_PASSWORD)"
app_password="$(env_value OPTRA_STAGING_APP_PASSWORD)"
cron_secret="$(env_value CRON_SECRET)"
[[ "$admin_password" =~ ^[0-9a-f]{64}$ ]] || fail "OPTRA_STAGING_DB_ADMIN_PASSWORD must be a unique 64-character hexadecimal secret"
[[ "$app_password" =~ ^[0-9a-f]{64}$ && "$app_password" != "$admin_password" ]] || fail "OPTRA_STAGING_APP_PASSWORD must be a different unique 64-character hexadecimal secret"
[[ "$cron_secret" =~ ^[A-Za-z0-9._~\-]{32,}$ && "$cron_secret" != "$admin_password" && "$cron_secret" != "$app_password" ]] || fail "CRON_SECRET must be a unique URL-safe secret of at least 32 characters"

# The deployment profile itself pins the safety flags; reject attempted override values in the file.
if grep -Eq '^LIVE_TRADING_ENABLED=' "$ENV_FILE" || grep -Eq '^V4_CLAIM_LEVEL=' "$ENV_FILE"; then
  fail "remove runtime safety flags from .env; the OPTRA compose profile pins paper-only L0"
fi

proxy_network="$(env_value OPTRA_PROXY_NETWORK)"
[[ "$proxy_network" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$ ]] || fail "OPTRA_PROXY_NETWORK is missing or invalid"
docker network inspect "$proxy_network" >/dev/null 2>&1 || fail "configured reverse-proxy network is not present"

expected_volume="${PROJECT}_pgdata"
if docker volume inspect "$expected_volume" >/dev/null 2>&1; then
  volume_labels="$(docker volume inspect --format '{{ index .Labels "com.docker.compose.project" }}|{{ index .Labels "com.docker.compose.volume" }}' "$expected_volume")"
  [[ "$volume_labels" == "$PROJECT|pgdata" ]] || fail "refusing to use an existing volume without the OPTRA project labels"
fi

mkdir -p "$STATE_ROOT" "$BACKUP_ROOT"
chown root:root "$STATE_ROOT" "$BACKUP_ROOT"
chmod 0700 "$STATE_ROOT"
chmod 0750 "$BACKUP_ROOT"

if [[ "$operation" == "rollback" ]]; then
  [[ -f "$PREVIOUS_FILE" ]] || fail "no previous successful image is recorded"
  IFS= read -r target_image < "$PREVIOUS_FILE" || true
  [[ "$target_image" =~ ^ghcr\.io/Optra-Agent/optraagent@sha256:[0-9a-f]{64}$ ]] || fail "recorded previous image digest is invalid"
fi

token=""
IFS= read -r token || [[ -n "$token" ]] || fail "registry token is required on stdin"
if IFS= read -r _extra; then fail "provide exactly one registry token line on stdin"; fi
[[ -n "$token" ]] || fail "registry token is empty"

docker_config="$(mktemp -d /run/optra-staging-docker-config.XXXXXX)"
chmod 0700 "$docker_config"
cleanup() {
  token=""
  rm -rf -- "$docker_config"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
export DOCKER_CONFIG="$docker_config"

printf '%s' "$token" | docker login ghcr.io --username "$registry_username" --password-stdin >/dev/null
token=""
if [[ "$operation" == "deploy" ]]; then
  docker pull "$requested_tag" >/dev/null
  while IFS= read -r candidate_digest; do
    if [[ "$candidate_digest" =~ ^ghcr\.io/Optra-Agent/optraagent@sha256:[0-9a-f]{64}$ ]]; then
      target_image="$candidate_digest"
      break
    fi
  done < <(docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$requested_tag")
  [[ "$target_image" =~ ^ghcr\.io/Optra-Agent/optraagent@sha256:[0-9a-f]{64}$ ]] || fail "could not resolve the requested tag to a GHCR manifest digest"
else
  docker pull "$target_image" >/dev/null
fi
docker logout ghcr.io >/dev/null 2>&1 || true
image_revision="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$target_image")"
image_source="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.source" }}' "$target_image")"
[[ "$image_revision" =~ ^[0-9a-f]{40}$ && "$image_source" == "https://github.com/Optra-Agent/optraagent" ]] || fail "image source/revision labels are missing or invalid"
if [[ "$operation" == "deploy" ]]; then
  [[ "$image_revision" == "$requested_revision" ]] || fail "image revision label does not match the requested commit SHA"
fi

compose_for_image() {
  local image="$1"
  shift
  OPTRA_IMAGE="$image" docker compose --project-name "$PROJECT" --env-file "$ENV_FILE" --file "$COMPOSE_FILE" "$@"
}

wait_healthy() {
  local service="$1"
  local attempts="$2"
  local container_id=""
  local status=""
  local attempt
  for (( attempt=1; attempt<=attempts; attempt+=1 )); do
    container_id="$(compose_for_image "$target_image" ps --quiet "$service" 2>/dev/null || true)"
    if [[ -n "$container_id" ]]; then
      status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$container_id" 2>/dev/null || true)"
      [[ "$status" == "healthy" ]] && return 0
      [[ "$status" == "unhealthy" || "$status" == "missing" ]] && return 1
    fi
    sleep 2
  done
  return 1
}

backup_database() {
  local timestamp destination temporary
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  destination="$BACKUP_ROOT/optra-staging-$timestamp-$$.dump"
  temporary="$(mktemp "$BACKUP_ROOT/.optra-staging-$timestamp.dump.XXXXXX")"
  if ! compose_for_image "$target_image" exec -T db pg_dump -U optra_staging_admin -d optra_staging -Fc > "$temporary"; then
    rm -f -- "$temporary"
    fail "database backup failed; application image was not changed"
  fi
  [[ -s "$temporary" ]] || { rm -f -- "$temporary"; fail "database backup was empty; application image was not changed"; }
  chmod 0600 "$temporary"
  mv -- "$temporary" "$destination"
  log_event database_backup_created "$destination"
}

rollback_app() {
  local image="$1"
  [[ -n "$image" ]] || return 1
  compose_for_image "$image" up -d --no-deps app >/dev/null 2>&1 || return 1
  target_image="$image"
  wait_healthy app 120
}

log_event deploy_started "$operation $target_image"
compose_for_image "$target_image" config --quiet
compose_for_image "$target_image" up -d db >/dev/null
wait_healthy db 60 || fail "OPTRA PostgreSQL did not become healthy; application image was not changed"
backup_database

old_image=""
if [[ -f "$LAST_GOOD_FILE" ]]; then
  IFS= read -r old_image < "$LAST_GOOD_FILE" || true
  [[ "$old_image" =~ ^ghcr\.io/Optra-Agent/optraagent@sha256:[0-9a-f]{64}$ ]] || fail "recorded last-good image digest is invalid"
fi

if ! compose_for_image "$target_image" up -d --no-deps app >/dev/null || ! wait_healthy app 120; then
  log_event app_health_failed "$target_image"
  if [[ -n "$old_image" ]]; then
    if rollback_app "$old_image"; then
      log_event previous_app_restored "$old_image"
    else
      log_event previous_app_restore_failed "$old_image"
      printf 'optra-staging: new app image is unhealthy and the previous app image could not be restored; inspect only the OPTRA staging app with docker compose logs. Database remains intact.\n' >&2
    fi
  else
    compose_for_image "$target_image" stop app >/dev/null 2>&1 || true
  fi
  exit 1
fi

if [[ -n "$old_image" && "$old_image" != "$target_image" ]]; then
  printf '%s\n' "$old_image" > "$PREVIOUS_FILE.tmp"
  chmod 0600 "$PREVIOUS_FILE.tmp"
  mv -f -- "$PREVIOUS_FILE.tmp" "$PREVIOUS_FILE"
fi
printf '%s\n' "$target_image" > "$LAST_GOOD_FILE.tmp"
chmod 0600 "$LAST_GOOD_FILE.tmp"
mv -f -- "$LAST_GOOD_FILE.tmp" "$LAST_GOOD_FILE"
log_event deploy_succeeded "$target_image"
printf 'OPTRA staging app is healthy on %s. Database backup: latest file in %s.\n' "$target_image" "$BACKUP_ROOT"
