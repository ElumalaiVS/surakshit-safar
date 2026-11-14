#!/usr/bin/env bash
# Rebuild the schema from scratch in database $DB and run the workflow test.
# Usage: DB=safar PGHOST=/tmp ./run_tests.sh
set -euo pipefail
cd "$(dirname "$0")"
DB="${DB:-safar}"
PSQL=(psql -v ON_ERROR_STOP=1 -q -d "$DB")
PGOPTIONS='-c client_min_messages=warning' "${PSQL[@]}" -c "DROP SCHEMA IF EXISTS safar CASCADE;"
export PGOPTIONS='-c client_min_messages=warning'
for f in 001_schema.sql 002_taxonomy_seed.sql 003_functions.sql 004_api.sql; do
  echo "== loading $f"
  "${PSQL[@]}" -f "$f"
done
echo "== running tests/workflow_test.sql"
psql -v ON_ERROR_STOP=1 -d "$DB" -f tests/workflow_test.sql 2>&1 | sed -E 's/^psql:[^ ]+ //'
echo "== running tests/api_test.sql"
psql -v ON_ERROR_STOP=1 -d "$DB" -f tests/api_test.sql 2>&1 | sed -E 's/^psql:[^ ]+ //'
