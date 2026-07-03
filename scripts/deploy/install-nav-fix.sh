#!/bin/bash
# Run on production server as root (Aliyun 远程连接):
#   bash /home/george/deploy_nav_fix.sh
set -euo pipefail
APP=/root/new_market_project
cd "$APP"

echo "==> git pull"
git pull origin main

echo "==> install + build"
pnpm install --frozen-lockfile
pnpm run build:lowmem

echo "==> pm2 restart"
pm2 restart new_market_project --update-env
pm2 save

echo "==> SLA063 cache"
export DB_STATEMENT_TIMEOUT=120000
npx tsx scripts/ma/_fix_sla063_cache.ts

echo "Deploy complete. Verify: http://8.154.33.143/ma/dashboard/private-funds/SLA063"
