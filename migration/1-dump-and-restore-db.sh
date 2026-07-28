#!/usr/bin/env bash
# ============================================================
#  STEP 1 — Move the database (schema + data + auth users)
#  Requires pg_dump / psql 17:  brew install postgresql@17
#  Run from the migration/ folder:  ./1-dump-and-restore-db.sh
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env.migrate ] || { echo "Missing .env.migrate (copy from .env.migrate.example)"; exit 1; }
set -a; source .env.migrate; set +a

# Make sure we use the v17 client tools (Homebrew keg-only path)
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
command -v pg_dump >/dev/null || { echo "pg_dump not found. Run: brew install postgresql@17"; exit 1; }

mkdir -p dump
echo "==> 1/4 Dumping roles..."
pg_dump "$OLD_DB_URL" --roles-only 2>/dev/null > dump/roles.sql || \
  pg_dumpall -d "$OLD_DB_URL" --roles-only > dump/roles.sql || true

echo "==> 2/4 Dumping PUBLIC schema (structure + data)..."
pg_dump "$OLD_DB_URL" \
  --schema=public \
  --no-owner --no-privileges \
  --quote-all-identifiers \
  -f dump/public.sql

echo "==> 3/4 Dumping AUTH users (data only: keeps passwords)..."
# Only the user-facing auth tables; GoTrue owns the rest on the new project.
pg_dump "$OLD_DB_URL" \
  --data-only --no-owner --no-privileges \
  --table='auth.users' \
  --table='auth.identities' \
  --table='auth.mfa_factors' \
  --table='auth.mfa_challenges' \
  -f dump/auth.sql || echo "   (some auth tables empty/absent — fine)"

echo "==> 4/4 Restoring into NEW project..."
psql "$NEW_DB_URL" -v ON_ERROR_STOP=0 -f dump/public.sql
psql "$NEW_DB_URL" -v ON_ERROR_STOP=0 -f dump/auth.sql || true

echo ""
echo "DB migration done. Verify row counts with: ./4-verify.sh"
echo "NOTE: storage FILE BYTES are NOT in this dump — run ./2-migrate-storage.mjs next."
