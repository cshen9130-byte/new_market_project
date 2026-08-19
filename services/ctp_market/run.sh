#!/usr/bin/env bash
# PM2 entrypoint: POSIX C locale before loading openctp (CTP C++ ABI).
# Do not use C.UTF-8 / en_US.UTF-8 here — many cloud images never generated them.
set -euo pipefail

unset LANGUAGE LC_ALL LC_CTYPE LC_NUMERIC LC_TIME LC_COLLATE LC_MONETARY \
  LC_MESSAGES LC_PAPER LC_NAME LC_ADDRESS LC_TELEPHONE LC_MEASUREMENT \
  LC_IDENTIFICATION LANG || true
export LANG=C
export LC_ALL=C
export LC_CTYPE=C
export PYTHONUNBUFFERED=1

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if [[ -n "${PYTHON_EXE:-}" && -x "${PYTHON_EXE}" ]]; then
  PY="$PYTHON_EXE"
elif [[ -x /root/new_market_project/.venv/bin/python ]]; then
  PY=/root/new_market_project/.venv/bin/python
elif [[ -x /root/new_market_project/.venv/bin/python3 ]]; then
  PY=/root/new_market_project/.venv/bin/python3
elif command -v python3 >/dev/null; then
  PY="$(command -v python3)"
else
  PY=python3
fi

exec "$PY" -u "$ROOT/server.py"
