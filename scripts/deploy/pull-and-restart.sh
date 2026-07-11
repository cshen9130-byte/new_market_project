#!/bin/bash
# Run on the production server as root (Aliyun 远程连接):
#   bash /root/new_market_project/scripts/deploy/pull-and-restart.sh
set -eu
PROJECT_ROOT="${1:-/root/new_market_project}"
cd "$PROJECT_ROOT"

echo "==> git pull"
git pull origin main

echo "==> pnpm install"
pnpm install --frozen-lockfile

echo "==> build (lowmem)"
pnpm run build:lowmem

echo "==> product monthly report setup"
bash "$PROJECT_ROOT/scripts/deploy/setup-product-ppt.sh" || true

echo "==> pm2 restart"
pm2 restart new_market_project --update-env
pm2 save

echo "==> SLA063 cache patch"
DB_STATEMENT_TIMEOUT=120000 npx tsx scripts/ma/_fix_sla063_cache.ts

echo "==> done"
