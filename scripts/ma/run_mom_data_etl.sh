#!/usr/bin/env bash
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
  command -v python3
}
PY="$(resolve_python)"
exec "$PY" "$ROOT/scripts/ma/mom_data_etl.py" "$@"
