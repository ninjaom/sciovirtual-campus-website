#!/usr/bin/env bash
# Run the security tests on a plain local Postgres (no Docker).
# Usage: supabase/tests/run_local.sh "postgresql://postgres@localhost:5432/postgres"
set -euo pipefail
ADMIN_URL="$1"
DB=campus_test_$$
cd "$(dirname "$0")/.."
psql "$ADMIN_URL" -q -c "create database $DB"
trap 'psql "$ADMIN_URL" -q -c "drop database if exists $DB"' EXIT
URL=$(echo "$ADMIN_URL" | sed -E "s#/postgres(\?|$)#/$DB\1#")
psql "$URL" -q -v ON_ERROR_STOP=1 -f tests/local_stub.sql
for f in migrations/*.sql; do psql "$URL" -q -v ON_ERROR_STOP=1 -f "$f"; done
psql "$URL" -q -v ON_ERROR_STOP=1 -f tests/security_test.sql 2>&1 | grep -E '^(psql:.*)?(NOTICE:  )?(ok|FAILED)|ERROR' | sed 's/.*NOTICE:  //'
