#!/bin/bash
# Run on production server as root:
#   bash /home/george/deploy_nav_fix.sh
#
# Uses credentials already in /root/new_market_project/.env from prior deploys.
# Same build path as setup-choice-emquant.sh (--debug-build, auto memory tuning).
set -eu
APP=/root/new_market_project
cd "$APP"

echo "==> git pull"
git pull origin main

if [[ ! -f .env ]]; then
  echo "ERROR: $APP/.env not found. Run setup-choice-emquant.sh once with full credentials first."
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

: "${EMQ_USERNAME:?EMQ_USERNAME missing in .env}"
: "${EMQ_PASSWORD:?EMQ_PASSWORD missing in .env}"

bash scripts/deploy/setup-choice-emquant.sh \
  --project-root "$APP" \
  --emq-username "$EMQ_USERNAME" \
  --emq-password "$EMQ_PASSWORD" \
  --tushare-token "${TUSHARE_TOKEN:-}" \
  --dashscope-api-key "${DASHSCOPE_API_KEY:-}" \
  --deepseek-api-key "${DEEPSEEK_API_KEY:-}" \
  --database-url "${DATABASE_URL:-}" \
  --mom-report-url "${NEXT_PUBLIC_MOM_REPORT_URL:-/mom_report/report.html}" \
  --pm2-app-name new_market_project \
  --debug-build \
  --build-debug-interval-sec 30

# SLA063 one-off cache patch removed (405d039c); covered by email NAV ingestion.

echo "Deploy complete. Verify: http://8.154.33.143/ma/dashboard/private-funds/SLA063"
