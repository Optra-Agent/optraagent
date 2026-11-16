#!/bin/sh
set -eu

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=ON_ERROR_STOP=1 <<'SQL'
\getenv app_password OPTRA_STAGING_APP_PASSWORD
CREATE ROLE optra_staging_app LOGIN PASSWORD :'app_password';
CREATE DATABASE optra_staging OWNER optra_staging_app;
SQL
