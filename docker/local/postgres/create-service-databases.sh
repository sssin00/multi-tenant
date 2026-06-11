#!/bin/sh
set -eu

create_database_if_missing() {
  database_name="$1"
  exists="$(psql -h postgres -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '${database_name}'")"

  if [ "$exists" != "1" ]; then
    psql -h postgres -U postgres -d postgres -c "CREATE DATABASE ${database_name}"
  fi
}

create_database_if_missing auth_iam
create_database_if_missing tenant
