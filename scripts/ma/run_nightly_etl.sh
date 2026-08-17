#!/usr/bin/env bash
# Resilient launcher for nightly_etl.py.
# Always sources Choice/EmQuant env when present, and never depends on a
# vanished .venv path (that previously froze 期货/期权 charts for a week).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if [[ -f "$ROOT/.choice_env.sh" ]]; then
  # shellcheck disable=SC1091
  . "$ROOT/.choice_env.sh"
fi

resolve_python() {
  local candidate
  if [[ -n "${PYTHON_EXE:-}" ]]; then
    candidate="${PYTHON_EXE}"
    if [[ "$candidate" == "python3" || "$candidate" == "python" || "$candidate" == "py" ]]; then
      command -v "$candidate"
      return
    fi
    if [[ -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return
    fi
  fi
  if [[ -x "$ROOT/.venv/bin/python3" ]]; then
    printf '%s\n' "$ROOT/.venv/bin/python3"
    return
  fi
  if [[ -x "$ROOT/.venv/bin/python" ]]; then
    printf '%s\n' "$ROOT/.venv/bin/python"
    return
  fi
  command -v python3
}

PY="$(resolve_python)"
if [[ -z "$PY" ]]; then
  echo "[run_nightly_etl] no python3 found" >&2
  exit 127
fi

exec "$PY" "$ROOT/scripts/ma/nightly_etl.py" "$@"
