#!/bin/sh
set -eu

: "${APP_DB_PASSWORD:?APP_DB_PASSWORD must be set}"
: "${MIGRATION_DB_PASSWORD:?MIGRATION_DB_PASSWORD must be set}"
: "${TEMPORAL_DB_PASSWORD:?TEMPORAL_DB_PASSWORD must be set}"
: "${WORKER_DB_PASSWORD:?WORKER_DB_PASSWORD must be set}"

app_password="$APP_DB_PASSWORD"
migration_password="$MIGRATION_DB_PASSWORD"
temporal_password="$TEMPORAL_DB_PASSWORD"
worker_password="$WORKER_DB_PASSWORD"

psql --set ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  --set=app_password="$app_password" --set=migration_password="$migration_password" \
  --set=temporal_password="$temporal_password" --set=worker_password="$worker_password" <<-'SQL'
SELECT format('CREATE ROLE onholidai_web LOGIN PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'onholidai_web') \gexec

SELECT format('CREATE ROLE onholidai_migration LOGIN PASSWORD %L', :'migration_password')
WHERE NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'onholidai_migration') \gexec

SELECT format('CREATE ROLE onholidai_worker LOGIN PASSWORD %L', :'worker_password')
WHERE NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'onholidai_worker') \gexec

SELECT format('CREATE ROLE temporal LOGIN CREATEDB PASSWORD %L', :'temporal_password')
WHERE NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'temporal') \gexec

-- The Temporal auto-setup only creates its own database when its name differs from
-- POSTGRES_USER (both default to "temporal"), so the shared cluster must provide it.
SELECT 'CREATE DATABASE temporal OWNER temporal'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'temporal') \gexec

SELECT 'CREATE ROLE onholidai_test_untrusted NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE'
WHERE NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'onholidai_test_untrusted') \gexec

SELECT 'CREATE DATABASE onholidai OWNER onholidai_migration'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'onholidai') \gexec

ALTER DATABASE onholidai OWNER TO onholidai_migration;
REVOKE CONNECT ON DATABASE onholidai FROM PUBLIC;
GRANT CONNECT ON DATABASE onholidai TO onholidai_migration, onholidai_web, onholidai_worker;
SQL

psql --set ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname onholidai <<-'SQL'
CREATE EXTENSION IF NOT EXISTS postgis;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SQL
