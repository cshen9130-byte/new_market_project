#!/bin/bash
set -e
echo "=== WEB background-jobs lines ==="
grep -n 'background-jobs' /root/.pm2/logs/new-market-project-out.log 2>/dev/null | tail -n 5 || true
echo
echo "=== computing metrics on WEB error log (count + last) ==="
grep -c 'computing metrics' /root/.pm2/logs/new-market-project-error.log 2>/dev/null || echo 0
grep 'computing metrics' /root/.pm2/logs/new-market-project-error.log 2>/dev/null | tail -n 3 || true
echo
echo "=== computing metrics on WORKER (last 10) ==="
grep -E 'computing metrics|done — 70' /root/.pm2/logs/new-market-project-worker-error.log 2>/dev/null | tail -n 10 || true
echo
echo "=== cache counts ==="
sudo -u postgres psql -d market_data -c "SELECT 'managed' AS t, count(*) FROM ops_managed_products_list_cache UNION ALL SELECT 'fof', count(*) FROM ops_fof_overview_list_cache;"
echo
echo "=== latency ==="
curl -sS -o /dev/null -w 'managed %{http_code} %{time_total}s\n' --max-time 10 \
  'http://127.0.0.1:3000/ma/api/ops/managed-products/list?page=1&pageSize=50'
curl -sS -o /dev/null -w 'fof %{http_code} %{time_total}s\n' --max-time 10 \
  'http://127.0.0.1:3000/ma/api/ops/fof-underlying/list?page=1&pageSize=50&holding_status=holding'
echo
echo "=== process roles ==="
ps -eo pid,pcpu,cmd --sort=-pcpu | head -n 8
