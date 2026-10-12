#!/bin/bash
# Run on the production server as root (Aliyun 远程连接):
#   bash /root/new_market_project/scripts/deploy/pull-and-restart.sh
set -eu
PROJECT_ROOT="${1:-/root/new_market_project}"
cd "$PROJECT_ROOT"

echo "==> git sync"
# These tracked JSON files are edited on the server (mailbox passwords, 直投
# visibility). Copy them out before `git reset --hard` and put them back after,
# or a deploy replaces them with the empty/stale copies committed in git.
PRESERVE_JSON_FILES=(
  "data/ops_crawl_emails.json"
  "data/ops_direct_email_visibility.json"
)
preserve_server_json() {
  local rel dest
  for rel in "${PRESERVE_JSON_FILES[@]}"; do
    dest="/tmp/$(basename "$rel").preserve"
    if [ -f "$rel" ]; then
      cp -a "$rel" "$dest"
      echo "    preserved $rel"
    fi
  done
}
restore_server_json() {
  local rel src
  mkdir -p data
  for rel in "${PRESERVE_JSON_FILES[@]}"; do
    src="/tmp/$(basename "$rel").preserve"
    if [ -f "$src" ]; then
      cp -a "$src" "$rel"
      git update-index --skip-worktree "$rel" 2>/dev/null || true
      echo "    restored $rel"
    fi
  done
}
preserve_server_json
trap restore_server_json EXIT

git fetch origin main
# Production should match GitHub exactly — discard lockfile drift and any hotfix edits.
if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
  echo "    discarding local tracked changes (deploy uses repo only)"
  git reset --hard HEAD
fi
git reset --hard origin/main
restore_server_json

echo "==> pnpm install"
CI=1 pnpm install --frozen-lockfile </dev/null

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
