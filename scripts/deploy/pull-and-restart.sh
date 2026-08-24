#!/bin/bash
# Run on the production server as root (Aliyun 远程连接):
#   bash /root/new_market_project/scripts/deploy/pull-and-restart.sh
set -eu
PROJECT_ROOT="${1:-/root/new_market_project}"
cd "$PROJECT_ROOT"

echo "==> git sync"
# Crawl-email credentials live in a tracked JSON file. Preserve/restore via
# EXIT trap so a mid-script `git reset --hard` cannot drop UI-added mailboxes.
CRAWL_EMAIL_JSON="data/ops_crawl_emails.json"
CRAWL_EMAIL_PRESERVE="/tmp/ops_crawl_emails.json.preserve"
restore_crawl_emails() {
  if [ -f "$CRAWL_EMAIL_PRESERVE" ]; then
    mkdir -p data
    cp -a "$CRAWL_EMAIL_PRESERVE" "$CRAWL_EMAIL_JSON"
    git update-index --skip-worktree "$CRAWL_EMAIL_JSON" 2>/dev/null || true
    echo "    restored $CRAWL_EMAIL_JSON"
  fi
}
if [ -f "$CRAWL_EMAIL_JSON" ]; then
  cp -a "$CRAWL_EMAIL_JSON" "$CRAWL_EMAIL_PRESERVE"
  echo "    preserved $CRAWL_EMAIL_JSON"
fi
trap restore_crawl_emails EXIT

git fetch origin main
# Production should match GitHub exactly — discard lockfile drift and any hotfix edits.
if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
  echo "    discarding local tracked changes (deploy uses repo only)"
  git reset --hard HEAD
fi
git reset --hard origin/main
restore_crawl_emails

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
pm2 delete new_market_project_worker 2>/dev/null || true
pm2 delete ctp_market 2>/dev/null || true
pm2 start ecosystem.config.js --update-env
pm2 save

# Sanity: expect 2 cluster workers named new_market_project
WEB_N=$(pm2 jlist | python3 -c 'import sys,json; print(sum(1 for a in json.load(sys.stdin) if a.get("name")=="new_market_project"))')
echo "    new_market_project processes: ${WEB_N} (want 2)"
if [[ "${WEB_N}" -lt 2 ]]; then
  echo "WARN: web cluster has ${WEB_N} process(es); check ecosystem.config.js WEB_INSTANCES" >&2
fi

# One-off SLA063 / Ruinai cache patches were removed (405d039c); list NAV
# ingestion now covers those cases without post-deploy scripts.

echo "==> done"
