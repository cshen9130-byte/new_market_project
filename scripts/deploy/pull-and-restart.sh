#!/bin/bash
# Run on the production server as root (Aliyun 远程连接):
#   bash /root/new_market_project/scripts/deploy/pull-and-restart.sh
set -eu
PROJECT_ROOT="${1:-/root/new_market_project}"
cd "$PROJECT_ROOT"

echo "==> git sync"
git fetch origin main
# Production should match GitHub exactly — discard lockfile drift and any hotfix edits.
if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
  echo "    discarding local tracked changes (deploy uses repo only)"
  git reset --hard HEAD
fi
git reset --hard origin/main

echo "==> pnpm install"
pnpm install --frozen-lockfile

echo "==> build (lowmem)"
pnpm run build:lowmem

echo "==> product monthly report setup"
bash "$PROJECT_ROOT/scripts/deploy/setup-product-ppt.sh" || true

echo "==> pm2 restart (web cluster + background worker)"
# startOrReload alone can leave an old single-fork next-server after switching
# ecosystem to cluster mode — delete+start the web app so instances=2 always applies.
pm2 delete new_market_project 2>/dev/null || true
pm2 start ecosystem.config.js --update-env
pm2 save

# Sanity: expect 2 cluster workers named new_market_project
WEB_N=$(pm2 jlist | python3 -c 'import sys,json; print(sum(1 for a in json.load(sys.stdin) if a.get("name")=="new_market_project"))')
echo "    new_market_project processes: ${WEB_N} (want 2)"
if [[ "${WEB_N}" -lt 2 ]]; then
  echo "WARN: web cluster has ${WEB_N} process(es); check ecosystem.config.js WEB_INSTANCES" >&2
fi

echo "==> SLA063 cache patch"
DB_STATEMENT_TIMEOUT=120000 npx tsx scripts/ma/_fix_sla063_cache.ts

echo "==> ruinai tracking cache patch (SBDF95 / BDF95A)"
DB_STATEMENT_TIMEOUT=120000 npx tsx scripts/ma/_fix_tracking_ruinai.ts

echo "==> done"
