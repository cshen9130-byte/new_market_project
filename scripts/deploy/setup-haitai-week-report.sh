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

FONT_DIR="$ROOT/haitai_week_report/fonts"
FONT_FILE="$FONT_DIR/NotoSansSC-Regular.otf"
FONT_URLS=(
  "https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/SubsetOTF/SC/NotoSansSC-Regular.otf"
  "https://github.com/notofonts/noto-cjk/raw/main/Sans/SubsetOTF/SC/NotoSansSC-Regular.otf"
)

install_system_fonts() {
  if command -v apt-get >/dev/null 2>&1; then
    if command -v sudo >/dev/null 2>&1; then
      sudo apt-get update -qq
      sudo apt-get install -y -qq fonts-noto-cjk fonts-wqy-microhei fontconfig || true
    else
      apt-get update -qq
      apt-get install -y -qq fonts-noto-cjk fonts-wqy-microhei fontconfig || true
    fi
  elif command -v yum >/dev/null 2>&1; then
    if command -v sudo >/dev/null 2>&1; then
      sudo yum install -y wqy-microhei-fonts wqy-zenhei-fonts google-noto-sans-cjk-sc-fonts fontconfig || true
    else
      yum install -y wqy-microhei-fonts wqy-zenhei-fonts google-noto-sans-cjk-sc-fonts fontconfig || true
    fi
  elif command -v dnf >/dev/null 2>&1; then
    if command -v sudo >/dev/null 2>&1; then
      sudo dnf install -y wqy-microhei-fonts google-noto-sans-cjk-sc-fonts fontconfig || true
    else
      dnf install -y wqy-microhei-fonts google-noto-sans-cjk-sc-fonts fontconfig || true
    fi
  fi
}

download_bundled_font() {
  mkdir -p "$FONT_DIR"
  if [[ -f "$FONT_FILE" ]]; then
    echo "Bundled font already exists: $FONT_FILE"
    return 0
  fi

  echo "Downloading Noto Sans SC font..."
  for url in "${FONT_URLS[@]}"; do
    echo "Trying $url"
    if command -v curl >/dev/null 2>&1; then
      if curl -fsSL "$url" -o "$FONT_FILE"; then
        return 0
      fi
    elif command -v wget >/dev/null 2>&1; then
      if wget -qO "$FONT_FILE" "$url"; then
        return 0
      fi
    else
      echo "警告: 未找到 curl/wget，无法下载中文字体" >&2
      return 1
    fi
    rm -f "$FONT_FILE"
  done
  echo "警告: 所有字体下载地址均失败" >&2
  return 1
}

refresh_font_cache() {
  if command -v fc-cache >/dev/null 2>&1; then
    fc-cache -f >/dev/null 2>&1 || true
  fi
  "$PY" - <<'PY'
from matplotlib import font_manager
font_manager._load_fontmanager(try_read_cache=False)
print("Matplotlib font cache refreshed.")
PY
}

echo "Using Python: $PY"
install_system_fonts
download_bundled_font || true
refresh_font_cache

echo "Installing Python dependencies..."
"$PY" -m pip install --upgrade pip
"$PY" -m pip install -r "$ROOT/haitai_week_report/requirements.txt"

echo "Verifying imports and Chinese font..."
"$PY" - <<'PY'
import sys
from pathlib import Path

sys.path.insert(0, str(Path("haitai_week_report").resolve()))
from generate_fof_weekly_report import configure_cn_font, find_cn_font_path

path = find_cn_font_path()
fp, _ = configure_cn_font()
if not path or fp is None:
    raise SystemExit("Chinese font not found after setup")

sample = "测试中文：产品周报"
print("Font path:", path)
print("Font family:", fp.get_name())
print("Sample:", sample)
PY

echo "haitai_week_report setup complete."
