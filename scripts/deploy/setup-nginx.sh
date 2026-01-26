#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   sudo bash scripts/deploy/setup-nginx.sh \
#     --domain your.domain.com \
#     --app-port 3000 \
#     --project-root /srv/market_dashboard_website
#
# Notes:
# - Requires nginx installed and sudo/root privileges.
# - This script writes /etc/nginx/sites-available/market_dashboard_website.conf
#   and enables it via sites-enabled symlink, then reloads nginx.

DOMAIN=""
APP_PORT="3000"
PROJECT_ROOT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain)
      DOMAIN="$2"; shift 2 ;;
    --app-port)
      APP_PORT="$2"; shift 2 ;;
    --project-root)
      PROJECT_ROOT="$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$DOMAIN" ]]; then
  echo "--domain is required" >&2
  exit 1
fi

if [[ -z "$PROJECT_ROOT" ]]; then
  # Default to current working directory if not provided
  PROJECT_ROOT="$(pwd)"
fi

MOM_PATH="$PROJECT_ROOT/public/mom_report"
if [[ ! -d "$MOM_PATH" ]]; then
  echo "mom_report directory not found at: $MOM_PATH" >&2
  exit 1
fi

TEMPLATE="$PROJECT_ROOT/deploy/nginx/market_dashboard_website.conf.template"
if [[ ! -f "$TEMPLATE" ]]; then
  echo "Template not found: $TEMPLATE" >&2
  exit 1
fi

CONF_OUT="/etc/nginx/sites-available/market_dashboard_website.conf"

echo "Generating nginx config at: $CONF_OUT"
TMP_CONF="$(mktemp)"
sed \
  -e "s#__DOMAIN__#${DOMAIN}#g" \
  -e "s#__APP_PORT__#${APP_PORT}#g" \
  -e "s#__ABS_MOM_PATH__#${MOM_PATH}#g" \
  "$TEMPLATE" > "$TMP_CONF"

install -Dm644 "$TMP_CONF" "$CONF_OUT"
rm -f "$TMP_CONF"

ENABLED="/etc/nginx/sites-enabled/market_dashboard_website.conf"
if [[ ! -L "$ENABLED" ]]; then
  ln -sfn "$CONF_OUT" "$ENABLED"
fi

echo "Testing nginx configuration..."
nginx -t
echo "Reloading nginx..."
systemctl reload nginx || service nginx reload || nginx -s reload

echo "Done. Verify: http://$DOMAIN/mom_report/report.html"
