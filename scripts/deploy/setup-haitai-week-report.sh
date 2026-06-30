#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

PY="${PYTHON_EXE:-}"
if [[ -z "$PY" || ! -x "$PY" ]]; then
  if [[ -x "$ROOT/.venv/bin/python3" ]]; then
    PY="$ROOT/.venv/bin/python3"
  elif command -v python3 >/dev/null 2>&1; then
    PY="$(command -v python3)"
  else
    echo "错误: 未找到 python3，请先安装 Python 3.10+ 或配置 PYTHON_EXE" >&2
    exit 1
  fi
fi

echo "Using Python: $PY"
"$PY" -m pip install --upgrade pip
"$PY" -m pip install -r "$ROOT/haitai_week_report/requirements.txt"

echo "Verifying imports..."
"$PY" - <<'PY'
import akshare
import matplotlib
import openpyxl
import pandas
print("OK:", pandas.__version__, matplotlib.__version__)
PY

echo "haitai_week_report Python dependencies installed."
