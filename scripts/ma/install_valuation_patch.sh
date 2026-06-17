#!/bin/bash
# Run on production server as root:
#   bash /home/george/install_valuation_patch.sh
set -euo pipefail
APP=/root/new_market_project
PATCH=/home/george/valuation_patch
mkdir -p "$PATCH"
tar -xzf /home/george/deploy_valuation_patch.tar.gz -C "$PATCH"
cp -r "$PATCH"/* "$APP"/
cd "$APP"
pnpm build
pkill -f 'next-server' || true
sleep 2
cd "$APP" && pnpm start &
echo "Deployed. Verify: curl -s 'http://127.0.0.1:3000/ma/api/ops/managed-products/list?page=1&pageSize=10' | grep 恒盈2号"
