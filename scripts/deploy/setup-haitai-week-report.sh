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
FONT_DOWNLOAD_TIMEOUT="${FOF_FONT_DOWNLOAD_TIMEOUT:-60}"
FONT_URLS=(
  "https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/SubsetOTF/SC/NotoSansSC-Regular.otf"
  "https://github.com/notofonts/noto-cjk/raw/main/Sans/SubsetOTF/SC/NotoSansSC-Regular.otf"
)

SYSTEM_FONT_CANDIDATES=(
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
  "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc"
  "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc"
  "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc"
  "/usr/share/fonts/wqy-microhei/wqy-microhei.ttc"
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

link_system_font() {
  mkdir -p "$FONT_DIR"
  rm -f "$FONT_FILE"

  for src in "${SYSTEM_FONT_CANDIDATES[@]}"; do
    if [[ -f "$src" ]]; then
      ln -sf "$src" "$FONT_FILE" 2>/dev/null || cp -f "$src" "$FONT_FILE"
      echo "Using system font: $src -> $FONT_FILE"
      return 0
    fi
  done
  return 1
}

font_file_is_valid() {
  [[ -f "$FONT_FILE" ]] || return 1
  local size
  size=$(stat -c%s "$FONT_FILE" 2>/dev/null || stat -f%z "$FONT_FILE" 2>/dev/null || echo 0)
  [[ "$size" -ge 100000 ]] || return 1
  local magic
  magic=$(head -c 4 "$FONT_FILE" 2>/dev/null || true)
  [[ "$magic" == "OTTO" || "$magic" == $'\x00\x01\x00\x00' || "$magic" == "ttcf" ]] || return 1
  return 0
}

validate_bundled_font_python() {
  "$PY" - <<'PY'
from pathlib import Path
from matplotlib import ft2font

path = Path("haitai_week_report/fonts/NotoSansSC-Regular.otf")
if not path.is_file() or path.stat().st_size < 100_000:
    raise SystemExit(1)
font = ft2font.FT2Font(str(path))
font.close()
PY
}

repair_bundled_font() {
  if font_file_is_valid && validate_bundled_font_python 2>/dev/null; then
    echo "Bundled font OK: $FONT_FILE"
    return 0
  fi

  if [[ -e "$FONT_FILE" ]]; then
    echo "Removing invalid bundled font: $FONT_FILE"
    rm -f "$FONT_FILE"
  fi

  link_system_font
}

download_bundled_font() {
  mkdir -p "$FONT_DIR"
  if [[ -f "$FONT_FILE" ]]; then
    echo "Bundled font already exists: $FONT_FILE"
    return 0
  fi

  echo "Downloading Noto Sans SC font (timeout ${FONT_DOWNLOAD_TIMEOUT}s)..."
  for url in "${FONT_URLS[@]}"; do
    echo "Trying $url"
    if command -v curl >/dev/null 2>&1; then
      if curl -fsSL --connect-timeout 10 --max-time "$FONT_DOWNLOAD_TIMEOUT" "$url" -o "$FONT_FILE"; then
        return 0
      fi
    elif command -v wget >/dev/null 2>&1; then
      if wget -q --timeout=10 --tries=2 -O "$FONT_FILE" "$url"; then
        return 0
      fi
    else
      echo "警告: 未找到 curl/wget，无法下载中文字体" >&2
      return 1
    fi
    rm -f "$FONT_FILE"
    echo "Download failed, trying next URL..."
  done
  echo "警告: 所有字体下载地址均失败" >&2
  return 1
}

ensure_cn_font() {
  refresh_fc_cache

  if repair_bundled_font; then
    return 0
  fi

  if [[ "${FOF_SKIP_FONT_DOWNLOAD:-}" == "1" ]]; then
    echo "警告: FOF_SKIP_FONT_DOWNLOAD=1 且未找到系统字体" >&2
    return 1
  fi

  download_bundled_font || return 1
  repair_bundled_font
}

refresh_fc_cache() {
  if command -v fc-cache >/dev/null 2>&1; then
    fc-cache -f >/dev/null 2>&1 || true
    echo "fontconfig cache refreshed."
  fi
}

refresh_font_cache() {
  refresh_fc_cache
  if ! "$PY" -c "import matplotlib" >/dev/null 2>&1; then
    echo "Skipping Matplotlib font cache refresh (matplotlib not installed yet)."
    return 0
  fi
  "$PY" - <<'PY'
from matplotlib import font_manager
font_manager._load_fontmanager(try_read_cache=False)
print("Matplotlib font cache refreshed.")
PY
}

echo "Using Python: $PY"
install_system_fonts
ensure_cn_font || true

echo "Installing Python dependencies..."
"$PY" -m pip install --upgrade pip
"$PY" -m pip install -r "$ROOT/haitai_week_report/requirements.txt"

refresh_font_cache

repair_bundled_font || true
refresh_font_cache

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

MONTHLY_EXAMPLE="$ROOT/haitai_week_report/低波稳健FOF 1号月报_20260626.png"
NAV_FILE="$ROOT/haitai_week_report/低波稳健FOF 1号合并净值.xlsx"
if [[ ! -f "$MONTHLY_EXAMPLE" && -f "$NAV_FILE" ]]; then
  echo "Generating monthly report example PNG..."
  "$PY" "$ROOT/haitai_week_report/generate_fof_weekly_report.py" "$NAV_FILE" \
    -o "$ROOT/haitai_week_report" \
    --week-end 2026-06-26 --week-begin 2026-06-01 \
    --report-kind monthly \
    --report-title "低波稳健FOF 1号" \
    --product-name "海泰1号" || true
fi

echo "haitai_week_report setup complete."
