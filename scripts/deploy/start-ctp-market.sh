#!/usr/bin/env bash
set -euo pipefail

# Start/restart only the SimNow CTP sidecar. Does not rebuild Next.js.
#
#   bash scripts/deploy/start-ctp-market.sh \
#     --ctp-user-id "257515" \
#     --ctp-password 'YOUR_SIMNOW_PASSWORD'
#
# Password must be in single quotes if it contains ! 

PROJECT_ROOT="${PROJECT_ROOT:-/root/new_market_project}"
CTP_USER_ID="${CTP_USER_ID:-}"
CTP_PASSWORD="${CTP_PASSWORD:-}"
CTP_PROFILE="${CTP_PROFILE:-simnow}"
CTP_BROKER_ID="${CTP_BROKER_ID:-9999}"
CTP_INSTRUMENTS="${CTP_INSTRUMENTS:-IM2609,IM2608,IF2609,IF2608,IH2609,IH2608,IC2609,IC2608}"
SIMNOW_MD_FRONT="${SIMNOW_MD_FRONT:-tcp://182.254.243.31:30011}"
CTP_MARKET_URL="${CTP_MARKET_URL:-http://127.0.0.1:8000}"
CHART_HOST="${CHART_HOST:-127.0.0.1}"
CHART_PORT="${CHART_PORT:-8000}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-root) PROJECT_ROOT="$2"; shift 2 ;;
    --ctp-user-id) CTP_USER_ID="$2"; shift 2 ;;
    --ctp-password) CTP_PASSWORD="$2"; shift 2 ;;
    --ctp-profile) CTP_PROFILE="$2"; shift 2 ;;
    --ctp-instruments) CTP_INSTRUMENTS="$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

cd "$PROJECT_ROOT"
ENV_FILE="$PROJECT_ROOT/.env"

_resolve_python() {
  if [[ -n "${PYTHON_EXE:-}" && -x "${PYTHON_EXE}" ]]; then
    printf '%s\n' "$PYTHON_EXE"
    return
  fi
  if [[ -f "$ENV_FILE" ]]; then
    local from_env
    from_env="$(sed -n 's/^PYTHON_EXE=//p' "$ENV_FILE" | tail -n 1 | tr -d '\r')"
    if [[ -n "$from_env" && -x "$from_env" ]]; then
      printf '%s\n' "$from_env"
      return
    fi
  fi
  local candidate
  for candidate in \
    "$PROJECT_ROOT/.venv/bin/python3" \
    "$PROJECT_ROOT/.venv/bin/python" \
    "$(command -v python3 || true)" \
    "$(command -v python || true)"; do
    if [[ -n "$candidate" && -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return
    fi
  done
  return 1
}

VENV_PY="$(_resolve_python || true)"

_upsert_env() {
  local key="$1" val="$2"
  [[ -z "$val" ]] && return
  if [[ -f "$ENV_FILE" ]]; then
    sed -i "/^${key}=/d" "$ENV_FILE"
  fi
  printf '%s=%s\n' "$key" "$val" >> "$ENV_FILE"
}

_upsert_env "CTP_MARKET_URL"  "$CTP_MARKET_URL"
_upsert_env "CTP_PROFILE"     "$CTP_PROFILE"
_upsert_env "CTP_BROKER_ID"   "$CTP_BROKER_ID"
_upsert_env "CTP_USER_ID"     "$CTP_USER_ID"
_upsert_env "CTP_PASSWORD"    "$CTP_PASSWORD"
_upsert_env "CTP_INSTRUMENTS" "$CTP_INSTRUMENTS"
_upsert_env "SIMNOW_MD_FRONT" "$SIMNOW_MD_FRONT"
_upsert_env "CHART_HOST"      "$CHART_HOST"
_upsert_env "CHART_PORT"      "$CHART_PORT"

if [[ -z "$VENV_PY" || ! -x "$VENV_PY" ]]; then
  echo "Python not found. Checked PYTHON_EXE, .venv/bin/python3, .venv/bin/python, and PATH." >&2
  ls -l "$PROJECT_ROOT/.venv/bin/python"* 2>/dev/null || true
  grep '^PYTHON_EXE=' "$ENV_FILE" 2>/dev/null || true
  command -v python3 || true
  exit 1
fi
echo "Using Python: $VENV_PY"
_upsert_env "PYTHON_EXE" "$VENV_PY"

# CTP MdApi hardcodes zh_CN.GB18030; libstdc++ aborts if that locale is missing.
if [[ -f /etc/locale.gen ]] && ! locale -a 2>/dev/null | grep -qi 'zh_cn\.gb18030'; then
  echo "==> generating zh_CN.GB18030 locale for openctp"
  sed -i 's/^# *zh_CN.GB18030 GB18030/zh_CN.GB18030 GB18030/' /etc/locale.gen
  locale-gen zh_CN.GB18030 || true
fi

echo "==> installing sidecar deps"
"$VENV_PY" -m pip install -r "$PROJECT_ROOT/services/ctp_market/requirements.txt"

echo "==> restarting pm2 app ctp_market"
export LANG=C
export LC_ALL=C
export LC_CTYPE=C
pm2 delete ctp_market 2>/dev/null || true
pm2 start ecosystem.config.js --only ctp_market --update-env
pm2 save

echo "==> waiting for http://127.0.0.1:${CHART_PORT}/api/state"
sleep 3
if curl -fsS "http://127.0.0.1:${CHART_PORT}/api/state"; then
  echo
  echo "ctp_market is listening"
else
  echo
  echo "sidecar did not respond; last logs:"
  pm2 logs ctp_market --lines 80 --nostream || true
  exit 1
fi

pm2 list
echo "Done. Refresh /ma/dashboard/realtime-quotes"
