#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
COMPOSE_FILE="${REPO_ROOT}/docker/local/docker-compose.yml"

SERVICE_DATABASES=("auth_iam" "tenant" "audit_log")
APP_SERVICES=("gateway-service" "auth-iam-service" "tenant-service" "admin-bff-service")
INIT_SERVICES=("service-databases-init" "auth-iam-db-push" "tenant-service-db-push" "tenant-service-seed" "auth-iam-seed")

log() {
  printf '\n[reset-local-db] %s\n' "$1"
}

compose() {
  docker compose -f "${COMPOSE_FILE}" "$@"
}

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required." >&2
  exit 1
fi

log "Stopping app services so PostgreSQL databases can be recreated"
compose stop "${APP_SERVICES[@]}" >/dev/null 2>&1 || true

log "Starting PostgreSQL"
compose up -d postgres

log "Dropping and recreating service databases: ${SERVICE_DATABASES[*]}"
database_list_sql="$(printf "'%s'," "${SERVICE_DATABASES[@]}")"
database_list_sql="${database_list_sql%,}"

drop_create_sql="$(
  cat <<SQL
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname IN (${database_list_sql})
  AND pid <> pg_backend_pid();
SQL
)"

for database_name in "${SERVICE_DATABASES[@]}"; do
  drop_create_sql+=$'\n'"DROP DATABASE IF EXISTS ${database_name};"
  drop_create_sql+=$'\n'"CREATE DATABASE ${database_name};"
done

compose exec -T postgres psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<< "${drop_create_sql}"

log "Applying Prisma schemas and DB-only seed data"
compose up --build --force-recreate --no-deps "${INIT_SERVICES[@]}"

log "Restarting local API services"
compose up -d --build "${APP_SERVICES[@]}"

log "Inserting API seed data"
node "${REPO_ROOT}/scripts/db/seed-local-api.mjs"

log "Done. Test account: admin@demo.local / Test1234!"
log "TablePlus PostgreSQL: 127.0.0.1:55432, user postgres, password postgres, databases auth_iam, tenant, and audit_log"
