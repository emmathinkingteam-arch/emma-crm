#!/usr/bin/env bash
# STEP 4 — Compare row counts OLD vs NEW so nothing got dropped.
set -euo pipefail
cd "$(dirname "$0")"
set -a; source .env.migrate; set +a
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"

Q="select 'customers' t, count(*) c from customers
 union all select 'orders', count(*) from orders
 union all select 'interactions', count(*) from interactions
 union all select 'sms_log', count(*) from sms_log
 union all select 'commercial_statement', count(*) from commercial_statement
 union all select 'auth.users', count(*) from auth.users
 union all select 'storage.objects', count(*) from storage.objects
 order by t;"

echo "===== OLD ====="; psql "$OLD_DB_URL" -A -F' | ' -c "$Q"
echo "===== NEW ====="; psql "$NEW_DB_URL" -A -F' | ' -c "$Q"
