#!/bin/bash
# Run on the production server as root (Aliyun 远程连接):
#   bash /root/new_market_project/scripts/deploy/pull-and-restart.sh
set -eu
PROJECT_ROOT="${1:-/root/new_market_project}"
cd "$PROJECT_ROOT"

echo "==> git pull"
# Servers sometimes drift pnpm-lock.yaml after a non-frozen install; discard before pull.
if ! git diff --quiet -- pnpm-lock.yaml 2>/dev/null; then
  echo "    discarding local pnpm-lock.yaml changes (use repo lockfile)"
  git checkout -- pnpm-lock.yaml
fi
git pull origin main

echo "==> pnpm install"
pnpm install --frozen-lockfile

echo "==> build (lowmem)"
pnpm run build:lowmem

echo "==> product monthly report setup"
bash "$PROJECT_ROOT/scripts/deploy/setup-product-ppt.sh" || true

echo "==> pm2 restart (web + background worker)"
# Reloads existing apps and creates new_market_project_worker on first deploy after split.
pm2 startOrReload ecosystem.config.js --update-env
pm2 save

echo "==> SLA063 cache patch"
DB_STATEMENT_TIMEOUT=120000 npx tsx scripts/ma/_fix_sla063_cache.ts

echo "==> ruinai tracking cache patch (SBDF95 / BDF95A)"
DB_STATEMENT_TIMEOUT=120000 npx tsx scripts/ma/_fix_tracking_ruinai.ts

echo "==> done"
