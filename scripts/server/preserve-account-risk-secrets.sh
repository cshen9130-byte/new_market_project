#!/bin/bash
# Keep 监控中心 / mailbox secrets outside the git checkout and restore
# the in-repo path as a symlink after git pull / checkout / rebase.
set -euo pipefail
REPO="$(git rev-parse --show-toplevel 2>/dev/null || echo /root/new_market_project)"
STORE="${MARKET_DASHBOARD_STORAGE_DIR:-/root/market_dashboard_storage}/account-risk"
LEGACY="$REPO/data/account-risk"
mkdir -p "$STORE" "$LEGACY"

preserve() {
  local name="$1"
  local legacy="$LEGACY/$name"
  local store="$STORE/$name"
  if [ -L "$legacy" ]; then
    if [ ! -e "$legacy" ] && [ -f "$store" ]; then
      ln -sfn "$store" "$legacy"
    fi
    return 0
  fi
  if [ -f "$legacy" ]; then
    cp -a "$legacy" "$store"
    rm -f "$legacy"
    ln -s "$store" "$legacy"
    return 0
  fi
  if [ -f "$store" ] && [ ! -e "$legacy" ]; then
    ln -s "$store" "$legacy"
  fi
}

preserve cfmmc_config.json
preserve email_config.json