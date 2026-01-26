#!/usr/bin/env bash
set -euo pipefail

# Choice EmQuant API setup script (Linux server)
# Usage:
#   bash scripts/deploy/setup-choice-emquant.sh \
#     --project-root /root/new_market_project \
#     --emq-username "<EMQ_USERNAME>" \
#     --emq-password "<EMQ_PASSWORD>" \
#     --tushare-token "<TUSHARE_TOKEN>"
# Optional:
#   --python-exe /root/new_market_project/.venv/bin/python3
#   --login-type 2
#   --pm2-app-name new_market_project
#   --mom-report-url /mom_report/report.html

PROJECT_ROOT="${PWD}"
EMQ_USERNAME=""
EMQ_PASSWORD=""
PYTHON_EXE=""
LOGIN_TYPE="2"
PM2_APP_NAME="new_market_project"
TUSHARE_TOKEN=""
MOM_REPORT_URL="/mom_report/report.html"

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
EOF

# shellcheck disable=SC1091
source "$PROJECT_ROOT/.choice_env.sh"

# 5) Verify native deps
if command -v ldd >/dev/null 2>&1; then
  ldd "$LIB_DIR/libEMQuantAPIx64.so" | grep "not found" && {
    echo "Missing native deps for EmQuant API"; exit 1;
  } || echo "Native deps OK"
fi

# 6) Install node deps and build with low memory if needed
NODE_OPTIONS=--max-old-space-size=1024 pnpm install --frozen-lockfile
NODE_OPTIONS=--max-old-space-size=1024 pnpm build

# 7) PM2 start (ecosystem.config.js should read env vars)
pm2 stop "$PM2_APP_NAME" || true
pm2 start ecosystem.config.js --update-env
pm2 save

echo "Choice EmQuant setup complete. App restarted via PM2."