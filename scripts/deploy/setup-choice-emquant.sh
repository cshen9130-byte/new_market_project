#!/usr/bin/env bash
set -euo pipefail

# Choice EmQuant API setup script (Linux server)
# Usage:
#   bash scripts/deploy/setup-choice-emquant.sh \
#     --project-root /root/new_market_project \
#     --emq-username "<EMQ_USERNAME>" \
#     --emq-password "<EMQ_PASSWORD>" \
#     --tushare-token "<TUSHARE_TOKEN>" \
#     --database-url "postgresql://user:pass@host:5432/dbname"
# Optional:
#   --python-exe /root/new_market_project/.venv/bin/python3
#   --login-type 2
#   --pm2-app-name new_market_project
#   --mom-report-url /mom_report/report.html
#   --dashscope-api-key "<key>"   # AI 知识库 + vision chat
#   --deepseek-api-key "<key>"    # AI 助手 text chat

PROJECT_ROOT="${PWD}"
EMQ_USERNAME=""
EMQ_PASSWORD=""
PYTHON_EXE=""
LOGIN_TYPE="2"
PM2_APP_NAME="new_market_project"
TUSHARE_TOKEN=""
MOM_REPORT_URL="/mom_report/report.html"
DASHSCOPE_API_KEY="${DASHSCOPE_API_KEY:-}"
DASHSCOPE_BASE_URL="${DASHSCOPE_BASE_URL:-https://dashscope.aliyuncs.com/compatible-mode/v1}"
DASHSCOPE_CHAT_MODEL="${DASHSCOPE_CHAT_MODEL:-qwen-plus}"
DASHSCOPE_EMBEDDING_MODEL="${DASHSCOPE_EMBEDDING_MODEL:-text-embedding-v4}"
DASHSCOPE_VISION_MODEL="${DASHSCOPE_VISION_MODEL:-qwen-vl-plus}"
DEEPSEEK_API_KEY="${DEEPSEEK_API_KEY:-}"
DATABASE_URL="${DATABASE_URL:-}"
BUILD_MEMORY_MB="1024"
BUILD_MEMORY_USER_SET="0"
TEMP_SWAP_GB="4"
DEBUG_BUILD="0"
BUILD_DEBUG_INTERVAL_SEC="30"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-root) PROJECT_ROOT="$2"; shift 2 ;;
    --emq-username) EMQ_USERNAME="$2"; shift 2 ;;
    --emq-password) EMQ_PASSWORD="$2"; shift 2 ;;
    --python-exe) PYTHON_EXE="$2"; shift 2 ;;
    --login-type) LOGIN_TYPE="$2"; shift 2 ;;
    --pm2-app-name) PM2_APP_NAME="$2"; shift 2 ;;
    --tushare-token) TUSHARE_TOKEN="$2"; shift 2 ;;
    --mom-report-url) MOM_REPORT_URL="$2"; shift 2 ;;
    --dashscope-api-key) DASHSCOPE_API_KEY="$2"; shift 2 ;;
    --dashscope-base-url) DASHSCOPE_BASE_URL="$2"; shift 2 ;;
    --dashscope-chat-model) DASHSCOPE_CHAT_MODEL="$2"; shift 2 ;;
    --dashscope-embedding-model) DASHSCOPE_EMBEDDING_MODEL="$2"; shift 2 ;;
    --dashscope-vision-model) DASHSCOPE_VISION_MODEL="$2"; shift 2 ;;
    --deepseek-api-key) DEEPSEEK_API_KEY="$2"; shift 2 ;;
    --build-memory-mb) BUILD_MEMORY_MB="$2"; BUILD_MEMORY_USER_SET="1"; shift 2 ;;
    --temp-swap-gb) TEMP_SWAP_GB="$2"; shift 2 ;;
    --debug-build) DEBUG_BUILD="1"; shift ;;
    --build-debug-interval-sec) BUILD_DEBUG_INTERVAL_SEC="$2"; shift 2 ;;
    --database-url) DATABASE_URL="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

if [[ -z "$EMQ_USERNAME" || -z "$EMQ_PASSWORD" ]]; then
  echo "EMQ_USERNAME/EMQ_PASSWORD are required."
  exit 1
fi

mkdir -p "$PROJECT_ROOT"
cd "$PROJECT_ROOT"

# 1) Python venv (robust creation)
PY_CMD="python3"
if ! command -v python3 >/dev/null 2>&1; then
  if command -v python >/dev/null 2>&1; then
    PY_CMD="python"
  else
    echo "python3/python not found. Please install Python 3 and rerun."; exit 1
  fi
fi
if [[ ! -d "$PROJECT_ROOT/.venv" ]]; then
  set +e
  "$PY_CMD" -m venv "$PROJECT_ROOT/.venv"
  VENV_CREATE_RC=$?
  set -e
  if [[ $VENV_CREATE_RC -ne 0 || ! -f "$PROJECT_ROOT/.venv/bin/python" ]]; then
    echo "Failed to create venv using $PY_CMD -m venv. Trying virtualenv..."
    "$PY_CMD" -m pip install --user virtualenv >/dev/null 2>&1 || true
    "$PY_CMD" -m virtualenv "$PROJECT_ROOT/.venv" || echo "virtualenv fallback not available; proceeding without venv"
  fi
fi
VENV_PY="$PROJECT_ROOT/.venv/bin/python"
if [[ -x "$VENV_PY" ]]; then
  "$VENV_PY" -m pip install --upgrade pip || true
else
  echo "Venv python not found; proceeding with system $PY_CMD"
  VENV_PY="$PY_CMD"
  "$VENV_PY" -m pip install --upgrade pip || true
fi

# 2) Download EmQuant API package (idempotent)
EMQ_DIR="$PROJECT_ROOT/EMQuantAPI_Python"
ZIP_URL="https://cftdlcdn.eastmoney.com/Choice/EMQuantAPI/EMQuantAPI_Python.zip"
if [[ ! -d "$EMQ_DIR/EMQuantAPI_Python/python3" ]]; then
  curl -fSL "$ZIP_URL" -o EMQuantAPI_Python.zip
  rm -rf "$EMQ_DIR"
  mkdir -p "$EMQ_DIR"
  unzip -q EMQuantAPI_Python.zip -d "$EMQ_DIR"
fi

# 3) Install EmQuant Python bindings
INSTALLER="$EMQ_DIR/EMQuantAPI_Python/python3/installEmQuantAPI.py"
if [[ ! -f "$INSTALLER" ]]; then
  echo "Installer not found: $INSTALLER"; exit 1
fi
"$VENV_PY" "$INSTALLER"

# 3.5) Install Python data libraries required by project scripts (idempotent)
"$VENV_PY" -m pip install -U tushare pandas requests lxml || {
  echo "Failed to install Python data libraries via pip"; exit 1;
}

# 4) Export environment vars to a profile.d file for PM2 and shell logins
LIB_DIR="$EMQ_DIR/EMQuantAPI_Python/python3/libs/linux/x64"
PY_PATH="$EMQ_DIR/EMQuantAPI_Python/python3"
if [[ -x "$PROJECT_ROOT/.venv/bin/python3" ]]; then
  PY_EXE_PATH="${PYTHON_EXE:-$PROJECT_ROOT/.venv/bin/python3}"
else
  PY_EXE_PATH="${PYTHON_EXE:-$PY_CMD}"
fi

cat > "$PROJECT_ROOT/.choice_env.sh" <<EOF
export EMQ_USERNAME="$EMQ_USERNAME"
export EMQ_PASSWORD="$EMQ_PASSWORD"
export EMQ_OPTIONS_EXTRA="LoginType=${LOGIN_TYPE}"
export PYTHON_EXE="$PY_EXE_PATH"
export PYTHONPATH="$PY_PATH"
export LD_LIBRARY_PATH="$LIB_DIR:${LD_LIBRARY_PATH:-}"
export TUSHARE_TOKEN="$TUSHARE_TOKEN"
export NEXT_PUBLIC_MOM_REPORT_URL="$MOM_REPORT_URL"
export DASHSCOPE_API_KEY="$DASHSCOPE_API_KEY"
export DASHSCOPE_BASE_URL="$DASHSCOPE_BASE_URL"
export DASHSCOPE_CHAT_MODEL="$DASHSCOPE_CHAT_MODEL"
export DASHSCOPE_EMBEDDING_MODEL="$DASHSCOPE_EMBEDDING_MODEL"
export DASHSCOPE_VISION_MODEL="$DASHSCOPE_VISION_MODEL"
export DEEPSEEK_API_KEY="$DEEPSEEK_API_KEY"
EOF

# shellcheck disable=SC1091
source "$PROJECT_ROOT/.choice_env.sh"

# 5) Verify native deps
if command -v ldd >/dev/null 2>&1; then
  ldd "$LIB_DIR/libEMQuantAPIx64.so" | grep "not found" && {
    echo "Missing native deps for EmQuant API"; exit 1;
  } || echo "Native deps OK"
fi

# 6) Stop running app and kill lingering build processes (low RAM safety)
pm2 stop "$PM2_APP_NAME" || pm2 stop all || true
pkill -f "next build" || true
pkill -f "pnpm build" || true
pkill -f "node .*next" || true

# Wait for stopped processes to release memory back to the OS, then flush the
# page cache. Without this, the former Next.js server (1–1.5 GiB) still occupies
# physical RAM when webpack starts, pushing the build past 3.2 GiB on 3.4 GiB hosts.
sleep 5
sync
echo 3 > /proc/sys/vm/drop_caches 2>/dev/null || true
echo "Memory after stop + cache drop:"
free -h || true

TEMP_SWAP_FILE="/swapfile.market-dashboard"
TEMP_SWAP_CREATED="0"

cleanup_swap() {
  if [[ "$TEMP_SWAP_CREATED" == "1" ]]; then
    swapoff "$TEMP_SWAP_FILE" >/dev/null 2>&1 || true
    rm -f "$TEMP_SWAP_FILE" >/dev/null 2>&1 || true
  fi
}

trap cleanup_swap EXIT

ensure_temp_swap() {
  if ! command -v swapon >/dev/null 2>&1; then
    return
  fi

  local mem_total_kb="0"
  local swap_total_kb="0"

  if [[ -r /proc/meminfo ]]; then
    mem_total_kb=$(awk '/MemTotal/ { print $2 }' /proc/meminfo)
    swap_total_kb=$(awk '/SwapTotal/ { print $2 }' /proc/meminfo)
  fi

  if [[ -z "$mem_total_kb" || "$mem_total_kb" -ge 2500000 ]]; then
    return
  fi

  if [[ -n "$swap_total_kb" && "$swap_total_kb" -ge 1000000 ]]; then
    return
  fi

  if [[ -f "$TEMP_SWAP_FILE" ]]; then
    return
  fi

  echo "Low-memory server detected; creating temporary ${TEMP_SWAP_GB}G swap for build..."
  if command -v fallocate >/dev/null 2>&1; then
    fallocate -l "${TEMP_SWAP_GB}G" "$TEMP_SWAP_FILE"
  else
    dd if=/dev/zero of="$TEMP_SWAP_FILE" bs=1M count="$((TEMP_SWAP_GB * 1024))" status=progress
  fi

  chmod 600 "$TEMP_SWAP_FILE"
  mkswap "$TEMP_SWAP_FILE" >/dev/null
  swapon "$TEMP_SWAP_FILE"
  TEMP_SWAP_CREATED="1"
}

auto_tune_build_settings() {
  local mem_total_kb="0"

  if [[ -r /proc/meminfo ]]; then
    mem_total_kb=$(awk '/MemTotal/ { print $2 }' /proc/meminfo)
  fi

  # On ~3.4 GiB hosts, 1024 MB heap OOMs but 1536 MB is enough headroom (~3 min builds).
  # Do not jump to 2048 — that thrashes swap and makes webpack sit silent for 10+ min.
  if [[ "$BUILD_MEMORY_USER_SET" == "0" && -n "$mem_total_kb" ]]; then
    if   [[ "$mem_total_kb" -ge 6000000 ]]; then
      BUILD_MEMORY_MB="2048"
    elif [[ "$mem_total_kb" -ge 3000000 ]]; then
      BUILD_MEMORY_MB="1536"
    fi
  fi

  # --debug-build adds heartbeats + build-debug.log only; never shrink the heap here
  # (previously forced 1024 MB on <4.5 GiB hosts, overriding --build-memory-mb).

  echo "Build settings: memory=${BUILD_MEMORY_MB}MB, temp_swap=${TEMP_SWAP_GB}G, debug=${DEBUG_BUILD}, interval=${BUILD_DEBUG_INTERVAL_SEC}s"
}

# Ensure we are in the project root
cd "$PROJECT_ROOT"

auto_tune_build_settings
ensure_temp_swap

monitor_build_progress() {
  local build_pid="$1"

  while kill -0 "$build_pid" >/dev/null 2>&1; do
    echo ""
    echo "[$(date '+%F %T')] Build heartbeat"
    free -h || true
    swapon --show || true
    ps -eo pid,ppid,%mem,%cpu,rss,etime,cmd | grep -E "${build_pid}|next build|node .*next|webpack|pnpm" | grep -v grep || true
    du -sh "$PROJECT_ROOT/.next" 2>/dev/null || true
    sleep "$BUILD_DEBUG_INTERVAL_SEC"
  done
}

# Install node deps and build with low memory
# Use --no-frozen-lockfile to avoid failures when package.json changes but lockfile is not yet updated
MALLOC_ARENA_MAX=1 NODE_OPTIONS="--max-old-space-size=${BUILD_MEMORY_MB}" pnpm install --no-frozen-lockfile

if [[ "$DEBUG_BUILD" == "1" ]]; then
  BUILD_LOG_FILE="$PROJECT_ROOT/build-debug.log"
  echo "Debug build enabled; logging to $BUILD_LOG_FILE"
  rm -f "$BUILD_LOG_FILE"

  set +e
  (
    set -o pipefail
    # Heartbeats come from monitor_build_progress; skip webpack --debug (much slower).
    # MALLOC_ARENA_MAX=1 reduces glibc arena fragmentation across webpack child processes.
    FORCE_COLOR=0 MALLOC_ARENA_MAX=1 \
    CI=1 NEXT_TELEMETRY_DISABLED=1 NEXT_BUILD_LOW_MEMORY=1 NODE_OPTIONS="--max-old-space-size=${BUILD_MEMORY_MB}" \
      pnpm exec next build --webpack 2>&1 | tee "$BUILD_LOG_FILE"
  ) &
  BUILD_PID=$!
  monitor_build_progress "$BUILD_PID" &
  MONITOR_PID=$!
  wait "$BUILD_PID"
  BUILD_RC=$?
  kill "$MONITOR_PID" >/dev/null 2>&1 || true
  wait "$MONITOR_PID" 2>/dev/null || true
  set -e

  if [[ "$BUILD_RC" -ne 0 ]]; then
    exit "$BUILD_RC"
  fi
else
  echo "Starting Next.js build (heap=${BUILD_MEMORY_MB}MB; expect ~3 min with little webpack output)..."
  MALLOC_ARENA_MAX=1 \
  CI=1 NEXT_TELEMETRY_DISABLED=1 NEXT_BUILD_LOW_MEMORY=1 NODE_OPTIONS="--max-old-space-size=${BUILD_MEMORY_MB}" \
    pnpm exec next build --webpack
fi

# 7) Persist credentials to .env so all Python scripts find them without PM2
ENV_FILE="$PROJECT_ROOT/.env"

# Helper: remove any existing KEY= line then append the new value (idempotent)
_upsert_env() {
  local key="$1" val="$2"
  [[ -z "$val" ]] && return
  if [[ -f "$ENV_FILE" ]]; then
    sed -i "/^${key}=/d" "$ENV_FILE"
  fi
  printf '%s=%s\n' "$key" "$val" >> "$ENV_FILE"
}

_upsert_env "DATABASE_URL"              "$DATABASE_URL"
_upsert_env "EMQ_USERNAME"              "$EMQ_USERNAME"
_upsert_env "EMQ_PASSWORD"              "$EMQ_PASSWORD"
_upsert_env "TUSHARE_TOKEN"             "$TUSHARE_TOKEN"
_upsert_env "DASHSCOPE_API_KEY"         "$DASHSCOPE_API_KEY"
_upsert_env "DASHSCOPE_BASE_URL"        "$DASHSCOPE_BASE_URL"
_upsert_env "DASHSCOPE_CHAT_MODEL"      "$DASHSCOPE_CHAT_MODEL"
_upsert_env "DASHSCOPE_EMBEDDING_MODEL" "$DASHSCOPE_EMBEDDING_MODEL"
_upsert_env "DASHSCOPE_VISION_MODEL"    "$DASHSCOPE_VISION_MODEL"
_upsert_env "DEEPSEEK_API_KEY"          "$DEEPSEEK_API_KEY"
_upsert_env "PYTHON_EXE"               "$PY_EXE_PATH"

echo "Credentials written to $ENV_FILE"

# Source .env so DATABASE_URL is visible to ecosystem.config.js at pm2 start time
if [[ -f "$ENV_FILE" ]]; then
  set -o allexport
  # shellcheck disable=SC1091
  source "$ENV_FILE"
  set +o allexport
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "WARNING: DATABASE_URL is not set. PostgreSQL features will fail."
  echo "Pass --database-url <connection-string> to fix this."
fi

# 8) Ensure PM2 survives reboot with a valid systemd unit (fixes pm2---hp.service loop)
if [[ "$(id -u)" -eq 0 ]]; then
  bash "$PROJECT_ROOT/scripts/deploy/setup-pm2-startup.sh" \
    --run-user root \
    --home-dir /root \
    --project-root "$PROJECT_ROOT" \
    --pm2-app-name "$PM2_APP_NAME"
else
  pm2 stop "$PM2_APP_NAME" || true
  pm2 start ecosystem.config.js --update-env
  pm2 save
  echo "WARNING: not running as root; skipped PM2 systemd startup fix."
  echo "On the server run: sudo bash scripts/deploy/setup-pm2-startup.sh --project-root $PROJECT_ROOT"
fi

echo "Choice EmQuant setup complete. App restarted via PM2."