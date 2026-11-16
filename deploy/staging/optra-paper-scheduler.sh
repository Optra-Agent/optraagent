#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly ENV_FILE="/etc/optra-staging/paper-scheduler.env"
readonly LOG_TAG="optra-staging-paper-scheduler"

log_event() {
  logger -t "$LOG_TAG" -- "$1" 2>/dev/null || true
}

log_failure() {
  logger -p user.err -t "$LOG_TAG" -- "$1" 2>/dev/null || true
}

fail() {
  local code="$1"
  local curl_status="${2:-0}"
  log_failure "{\"event\":\"paper_scheduler.request_failed\",\"reason\":\"$code\",\"http_status\":$curl_status}"
  exit 1
}

[[ "$(id -u)" -eq 0 ]] || fail "must_run_as_root"
[[ -f "$ENV_FILE" && ! -L "$ENV_FILE" ]] || fail "scheduler_environment_missing"
[[ "$(stat -c '%u:%a' "$ENV_FILE")" == "0:600" ]] || fail "scheduler_environment_permissions_invalid"

if grep -Ev '^(APP_BASE_URL|CRON_SECRET)=[^[:space:]]+$' "$ENV_FILE" | grep -q .; then
  fail "scheduler_environment_must_contain_only_origin_and_secret"
fi
mapfile -t scheduler_origins < <(sed -n 's/^APP_BASE_URL=//p' "$ENV_FILE")
mapfile -t scheduler_secrets < <(sed -n 's/^CRON_SECRET=//p' "$ENV_FILE")
[[ "${#scheduler_origins[@]}" -eq 1 && "${#scheduler_secrets[@]}" -eq 1 ]] || fail "scheduler_environment_keys_invalid"
APP_BASE_URL="${scheduler_origins[0]}"
CRON_SECRET="${scheduler_secrets[0]}"
[[ "$APP_BASE_URL" =~ ^https://[A-Za-z0-9.-]+$ ]] || fail "app_origin_invalid"
[[ "$CRON_SECRET" =~ ^[A-Za-z0-9._~\-]{32,}$ ]] || fail "cron_secret_invalid"
app_environment_file="/srv/platform/applications/staging/optra-paper/.env"
[[ -f "$app_environment_file" && ! -L "$app_environment_file" ]] || fail "app_environment_missing"
[[ "$(stat -c '%u:%a' "$app_environment_file")" == "0:600" ]] || fail "app_environment_permissions_invalid"
app_cron_secret="$(sed -n 's/^CRON_SECRET=//p' "$app_environment_file" | tail -n 1)"
app_origin="$(sed -n 's/^APP_BASE_URL=//p' "$app_environment_file" | tail -n 1)"
[[ -n "$app_cron_secret" && "$app_cron_secret" == "$CRON_SECRET" ]] || fail "scheduler_secret_mismatch"
[[ -n "$app_origin" && "$app_origin" == "$APP_BASE_URL" ]] || fail "scheduler_origin_mismatch"
command -v curl >/dev/null 2>&1 || fail "curl_unavailable"
command -v jq >/dev/null 2>&1 || fail "jq_unavailable"

curl_config="$(mktemp /run/optra-staging-paper-scheduler-curl.XXXXXX)"
response_file="$(mktemp /run/optra-staging-paper-scheduler-response.XXXXXX)"
cleanup() {
  CRON_SECRET=""
  rm -f -- "$curl_config" "$response_file"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

cat > "$curl_config" <<EOF
silent
show-error
connect-timeout = 10
max-time = 600
retry = 2
retry-delay = 1
retry-max-time = 30
request = "POST"
header = "Authorization: Bearer $CRON_SECRET"
url = "$APP_BASE_URL/api/cron/paper-evaluations"
EOF
chmod 0600 "$curl_config" "$response_file"
CRON_SECRET=""

http_status=""
if http_status="$(curl --config "$curl_config" --output "$response_file" --write-out '%{http_code}')"; then
  :
else
  fail "curl_or_scheduler_transport_error" "${http_status:-0}"
fi
[[ "$http_status" =~ ^2[0-9][0-9]$ ]] || fail "scheduler_http_error" "$http_status"

summary="$(jq -ce --arg http_status "$http_status" '
  {
    event: (if .status == "already_running" then "paper_scheduler.overlap" else "paper_scheduler.response" end),
    http_status: ($http_status | tonumber),
    status: (.status // "unknown"),
    agents_considered: (.agentsConsidered // 0),
    evaluated: (.evaluated // 0),
    opened: (.opened // 0),
    skipped: (.skipped // 0),
    duplicates: (.duplicates // 0),
    deferred: (.deferred // 0),
    failures: (.failures // 0),
    error_code: (.error.code // null)
  }
' "$response_file")" || fail "scheduler_response_invalid_json" "$http_status"
log_event "$summary"
