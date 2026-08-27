#!/bin/bash
# ============================================================================
# scripts/finish-env.sh
# ============================================================================
# Adds the last two secrets to migration/.env.migrate and pushes them to the
# new Vercel project (production + preview), then redeploys.
#
#   bash scripts/finish-env.sh
#
# Values are typed in by you and never echoed to the screen or written to your
# shell history.
# ============================================================================

set -u
cd "$(dirname "$0")/.." || exit 1

FILE="migration/.env.migrate"

echo ""
echo "  Paste each value and press Return. Nothing is displayed as you type."
echo ""

read -rsp "  ANTHROPIC_API_KEY  : " ANTHROPIC_KEY; echo ""
read -rsp "  TEXT_LK_API_TOKEN  : " TEXTLK_KEY;    echo ""
echo ""

if [ -z "$ANTHROPIC_KEY" ] || [ -z "$TEXTLK_KEY" ]; then
  echo "  Both values are required — nothing changed."
  exit 1
fi

# Update the local file in place (used if the env ever needs re-pushing).
python3 - "$FILE" "$ANTHROPIC_KEY" "$TEXTLK_KEY" <<'PY'
import sys, pathlib
path, anthropic, textlk = sys.argv[1], sys.argv[2], sys.argv[3]
p = pathlib.Path(path)
out = []
for line in p.read_text().split('\n'):
    if line.startswith('ANTHROPIC_API_KEY='):
        out.append('ANTHROPIC_API_KEY=' + anthropic)
    elif line.startswith('TEXT_LK_API_TOKEN='):
        out.append('TEXT_LK_API_TOKEN=' + textlk)
    else:
        out.append(line)
p.write_text('\n'.join(out))
print("  local file updated")
PY

# Push to Vercel. --force overwrites if the key already exists.
for env in production preview; do
  printf '%s' "$ANTHROPIC_KEY" | npx vercel env add ANTHROPIC_API_KEY "$env" --force >/dev/null 2>&1 \
    && echo "  ANTHROPIC_API_KEY -> $env" \
    || echo "  FAILED ANTHROPIC_API_KEY -> $env"
  printf '%s' "$TEXTLK_KEY" | npx vercel env add TEXT_LK_API_TOKEN "$env" --force >/dev/null 2>&1 \
    && echo "  TEXT_LK_API_TOKEN -> $env" \
    || echo "  FAILED TEXT_LK_API_TOKEN -> $env"
done

unset ANTHROPIC_KEY TEXTLK_KEY

echo ""
echo "  Redeploying so the new values take effect..."
npx vercel deploy --prod 2>&1 | tail -3
echo ""
echo "  Done. Tell Claude to verify."
