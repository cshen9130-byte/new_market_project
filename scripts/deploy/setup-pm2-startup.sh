#!/usr/bin/env bash
set -euo pipefail

# Fix or install the PM2 systemd startup unit for the correct OS user.
#
# A common failure mode is running `pm2 startup` without `-u`, which makes PM2
# treat the `--hp` flag value as the username and creates a broken unit such as
# `pm2---hp.service` (User=-hp). systemd then retries forever at boot and can
# exhaust CPU/memory.
#
# Usage:
#   sudo bash scripts/deploy/setup-pm2-startup.sh
#   sudo bash scripts/deploy/setup-pm2-startup.sh \
#     --run-user root \
#     --home-dir /root \
#     --project-root /root/new_market_project
#
# Options:
#   --run-user       Linux user that owns the PM2 daemon (default: root)
#   --home-dir       Home directory for PM2_HOME (default: derived from /etc/passwd)
#   --project-root   If set, start apps from ecosystem.config.js after setup
#   --pm2-app-name   PM2 app name to stop before restart (default: new_market_project)
#   --skip-app-start Skip `pm2 start ecosystem.config.js`

RUN_USER="root"
HOME_DIR=""
PROJECT_ROOT=""
PM2_APP_NAME="new_market_project"
SKIP_APP_START="0"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --run-user) RUN_USER="$2"; shift 2 ;;
    --home-dir) HOME_DIR="$2"; shift 2 ;;
    --project-root) PROJECT_ROOT="$2"; shift 2 ;;
    --pm2-app-name) PM2_APP_NAME="$2"; shift 2 ;;
    --skip-app-start) SKIP_APP_START="1"; shift ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo bash $0 ..." >&2
  exit 1
fi

if ! id "$RUN_USER" >/dev/null 2>&1; then
  echo "User '$RUN_USER' does not exist. Create the user or pass --run-user with a valid account." >&2
  exit 1
fi

if [[ -z "$HOME_DIR" ]]; then
  HOME_DIR="$(getent passwd "$RUN_USER" | cut -d: -f6 || true)"
fi

if [[ -z "$HOME_DIR" || ! -d "$HOME_DIR" ]]; then
  echo "Home directory for user '$RUN_USER' not found: ${HOME_DIR:-<empty>}" >&2
  exit 1
fi

PM2_BIN="$(command -v pm2 || true)"
if [[ -z "$PM2_BIN" ]]; then
  for candidate in \
    /usr/lib/node_modules/pm2/bin/pm2 \
    /usr/local/lib/node_modules/pm2/bin/pm2; do
    if [[ -x "$candidate" ]]; then
      PM2_BIN="$candidate"
      break
    fi
  done
fi

if [[ -z "$PM2_BIN" ]]; then
  echo "pm2 not found. Install globally first: npm install -g pm2" >&2
  exit 1
fi

SERVICE_NAME="pm2-${RUN_USER}.service"

echo "Stopping and disabling existing PM2 systemd units..."
for unit_path in /etc/systemd/system/pm2-*.service; do
  [[ -e "$unit_path" ]] || continue
  unit_name="$(basename "$unit_path")"
  systemctl stop "$unit_name" 2>/dev/null || true
  systemctl disable "$unit_name" 2>/dev/null || true
done

# Known bad unit when `--hp` was parsed as the username (User=-hp).
rm -f /etc/systemd/system/pm2---hp.service

systemctl daemon-reload

echo "Killing any existing PM2 daemon so systemd can manage startup..."
"$PM2_BIN" kill 2>/dev/null || true

echo "Installing PM2 startup unit for user=$RUN_USER home=$HOME_DIR ..."
env PATH="${PATH}:/usr/bin:/usr/local/bin" \
  "$PM2_BIN" startup systemd -u "$RUN_USER" --hp "$HOME_DIR"

OVERRIDE_DIR="/etc/systemd/system/${SERVICE_NAME}.d"
mkdir -p "$OVERRIDE_DIR"
cat > "${OVERRIDE_DIR}/10-restart-limits.conf" <<'EOF'
[Service]
Restart=on-failure
RestartSec=15
StartLimitIntervalSec=300
StartLimitBurst=5
EOF

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"

if [[ "$SKIP_APP_START" == "0" && -n "$PROJECT_ROOT" ]]; then
  if [[ ! -f "$PROJECT_ROOT/ecosystem.config.js" ]]; then
    echo "ecosystem.config.js not found under $PROJECT_ROOT; skipping pm2 start." >&2
  else
    cd "$PROJECT_ROOT"

    if [[ -f "$PROJECT_ROOT/.env" ]]; then
      set -o allexport
      # shellcheck disable=SC1091
      source "$PROJECT_ROOT/.env"
      set +o allexport
    fi

    if [[ -f "$PROJECT_ROOT/.choice_env.sh" ]]; then
      # shellcheck disable=SC1091
      source "$PROJECT_ROOT/.choice_env.sh"
    fi

    "$PM2_BIN" stop "$PM2_APP_NAME" 2>/dev/null || true
    "$PM2_BIN" start ecosystem.config.js --update-env
  fi
fi

"$PM2_BIN" save

echo ""
echo "PM2 systemd service ready: $SERVICE_NAME"
systemctl --no-pager --full status "$SERVICE_NAME" || true
