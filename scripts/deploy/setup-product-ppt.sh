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

install_libreoffice() {
  if command -v soffice >/dev/null 2>&1 || command -v libreoffice >/dev/null 2>&1; then
    echo "LibreOffice already available."
    return 0
  fi

  echo "Installing LibreOffice for headless PPTX -> PDF conversion..."
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -qq
    apt-get install -y -qq libreoffice-impress libreoffice-writer fonts-noto-cjk fonts-wqy-microhei fontconfig
  elif command -v yum >/dev/null 2>&1; then
    yum install -y libreoffice-impress libreoffice-writer wqy-microhei-fonts google-noto-sans-cjk-sc-fonts fontconfig
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y libreoffice-impress libreoffice-writer wqy-microhei-fonts google-noto-sans-cjk-sc-fonts fontconfig
  else
    echo "警告: 未找到 apt/yum/dnf，请手动安装 LibreOffice (soffice)" >&2
    return 1
  fi
}

echo "Using Python: $PY"
install_libreoffice || true

echo "Installing Python dependencies..."
"$PY" -m pip install --upgrade pip
"$PY" -m pip install -r "$ROOT/product_ppt/requirements.txt"

SOFFICE="$(command -v soffice || command -v libreoffice || true)"
if [[ -z "$SOFFICE" ]]; then
  echo "错误: 未找到 soffice/libreoffice，PDF 转换将不可用" >&2
  exit 1
fi

echo "Verifying imports and LibreOffice..."
"$PY" - <<PY
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path("product_ppt").resolve()))
import pandas, matplotlib, pptx, reportlab, pypdf, openpyxl
from generate_product_report import _find_soffice

soffice = _find_soffice()
if not soffice:
    raise SystemExit("LibreOffice not found on PATH")
print("Imports OK")
print("LibreOffice:", soffice)
PY

EXAMPLE_DIR="$ROOT/product_ppt/output"
EXAMPLE_PDF="$EXAMPLE_DIR/私募产品历史业绩_20260618.pdf"
EXAMPLE_CONFIG="$ROOT/product_ppt/report_config.example.json"
SAMPLE_NAV="$ROOT/product_ppt/稳强8_净值.xlsx"
HAITAI_NAV="$ROOT/haitai_week_report/低波稳健FOF 1号合并净值.xlsx"
if [[ ! -f "$EXAMPLE_PDF" && -f "$EXAMPLE_CONFIG" ]]; then
  mkdir -p "$EXAMPLE_DIR"
  if [[ ! -f "$SAMPLE_NAV" && -f "$HAITAI_NAV" ]]; then
    cp -f "$HAITAI_NAV" "$SAMPLE_NAV"
  fi
  if [[ -f "$SAMPLE_NAV" ]]; then
    echo "Generating product monthly report example PDF..."
    "$PY" "$ROOT/product_ppt/generate_product_report.py" \
      --workspace "$ROOT/product_ppt" \
      --config "$EXAMPLE_CONFIG" \
      -o "$EXAMPLE_DIR" \
      --pdf-name "私募产品历史业绩_20260618.pdf" \
      --pptx-name "私募产品历史业绩_20260618.pptx" || true
  fi
fi

echo "product_ppt setup complete."
