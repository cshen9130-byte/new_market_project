#!/usr/bin/env bash
# Install CFMMC 监控中心 fetch deps (playwright + chromium) into the app venv.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

PY="${PYTHON_EXE:-${PYTHON_EXECUTABLE:-}}"
if [[ -z "$PY" || ! -x "$PY" ]]; then
  if [[ -x "$ROOT/.venv/bin/python3" ]]; then
    PY="$ROOT/.venv/bin/python3"
  elif [[ -x "$ROOT/.venv/bin/python" ]]; then
    PY="$ROOT/.venv/bin/python"
  elif command -v python3 >/dev/null 2>&1; then
    PY="$(command -v python3)"
  else
    echo "错误: 未找到 python3，请先安装 Python 3.10+ 或配置 PYTHON_EXE" >&2
    exit 1
  fi
fi

echo "Using Python: $PY"
"$PY" -m pip install -r "$ROOT/scripts/ma/requirements-cfmmc.txt"
"$PY" -m playwright install chromium
if [[ "$(uname -s)" == "Linux" ]]; then
  "$PY" -m playwright install-deps chromium || true
fi
"$PY" -c "from playwright.sync_api import sync_playwright; import ddddocr, requests, xlrd; print('CFMMC fetch deps OK')"
echo "Done. Restart PM2 (pm2 restart new_market_project new_market_project_worker) then retry 立即获取."
