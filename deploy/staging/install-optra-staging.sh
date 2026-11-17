#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[[ "$(id -u)" -eq 0 ]] || { printf 'optra-staging: installer must run as root\n' >&2; exit 1; }
readonly SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly STAGING_ROOT="/srv/platform/applications/staging/optra-paper"

install -d -o root -g root -m 0750 "$STAGING_ROOT" "$STAGING_ROOT/init" \
  /var/lib/optra-staging /srv/platform/backups/optra-staging /etc/optra-staging
chown root:root "$STAGING_ROOT" "$STAGING_ROOT/init" /var/lib/optra-staging /srv/platform/backups/optra-staging /etc/optra-staging
chmod 0750 "$STAGING_ROOT" "$STAGING_ROOT/init" /srv/platform/backups/optra-staging
chmod 0700 /var/lib/optra-staging /etc/optra-staging
install -o root -g root -m 0644 "$SOURCE_DIR/compose.yml" "$STAGING_ROOT/compose.yml"
install -o root -g root -m 0750 "$SOURCE_DIR/init/001-app-role.sh" "$STAGING_ROOT/init/001-app-role.sh"
install -o root -g root -m 0644 "$SOURCE_DIR/.env.example" "$STAGING_ROOT/.env.example"
install -o root -g root -m 0750 "$SOURCE_DIR/deploy-optra-staging.sh" /usr/local/sbin/optra-staging-deploy
install -o root -g root -m 0750 "$SOURCE_DIR/optra-paper-scheduler.sh" /usr/local/sbin/optra-paper-scheduler.sh
install -o root -g root -m 0644 "$SOURCE_DIR/optra-paper-scheduler.cron" /usr/local/share/optra-staging-paper-scheduler.cron

if [[ ! -e "$STAGING_ROOT/.env" ]]; then
  printf 'Installed OPTRA staging files. Provision a root-owned mode-600 %s/.env; no service was started.\n' "$STAGING_ROOT"
else
  [[ "$(stat -c '%u:%a' "$STAGING_ROOT/.env")" == "0:600" ]] || {
    printf 'OPTRA .env exists but is not root-owned mode 600; no service was started.\n' >&2
    exit 1
  }
  printf 'Installed OPTRA staging files. Existing .env was preserved; no service was started.\n'
fi
