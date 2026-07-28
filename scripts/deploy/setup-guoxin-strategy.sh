#!/usr/bin/env bash
# Install Python deps for 国信期货 Word 报告 (settlement-analysis download).
# Usage:
#   bash scripts/deploy/setup-guoxin-strategy.sh
#   bash scripts/deploy/setup-guoxin-strategy.sh --project-root /root/new_market_project
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
if [[ "${1:-}" == "--project-root" && -n "${2:-}" ]]; then
  ROOT="$2"
fi
cd "$ROOT"

PY="${PYTHON_EXE:-}"
if [[ -z "$PY" || ! -x "$PY" ]]; then
  if [[ -x "$ROOT/.venv/bin/python3" ]]; then
    PY="$ROOT/.venv/bin/python3"
  elif [[ -x "$ROOT/.venv/bin/python" ]]; then
    PY="$ROOT/.venv/bin/python"
  elif command -v python3 >/dev/null 2>&1; then
    PY="$(command -v python3)"
  else
    echo "错误: 未找到 python3，请先创建项目 .venv 或设置 PYTHON_EXE" >&2
    exit 1
  fi
fi

REQ="$ROOT/guoxin_strategy/requirements.txt"
if [[ ! -f "$REQ" ]]; then
  echo "错误: 缺少 $REQ" >&2
  exit 1
fi

echo "Using Python: $PY"
"$PY" -m pip install --upgrade pip
"$PY" -m pip install -r "$REQ"

echo "Verifying imports…"
"$PY" -c "import matplotlib, pandas, numpy, docx, psycopg2; print('ok', matplotlib.__version__)"
echo "guoxin_strategy setup complete."
