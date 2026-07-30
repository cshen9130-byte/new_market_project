#!/bin/bash
set -eu
cd /root/new_market_project

LOG=/tmp/rebuild_bench.log
OUT=/tmp/rebuild_api_samples.tsv
rm -f "$LOG" "$OUT"
echo -e "ts\tidle\tnext_pcpu\trebuild_pcpu\tmanaged_code\tmanaged_s\tfof_code\tfof_s" > "$OUT"

nohup env DB_POOL_MAX=4 DB_STATEMENT_TIMEOUT=180000 RUN_BACKGROUND_JOBS=1 \
  ./node_modules/.bin/tsx scripts/ops/run-incremental-cache-refresh.ts \
  >"$LOG" 2>&1 &
REBUILD_PID=$!
echo "REBUILD_PID=$REBUILD_PID"
sleep 2

for i in $(seq 1 14); do
  TS=$(date +%H:%M:%S)
  IDLE=$(top -bn1 | awk '/Cpu\(s\)/{print $8}')
  NEXT=$(ps -eo pcpu,cmd | awk '/next-server/ && !/awk/{print $1; exit}')
  REB=$(ps -eo pcpu,pid,cmd | awk -v p="$REBUILD_PID" '($2==p){print $1; found=1} END{if(!found) print 0}')

  MLINE=$(curl -sS -o /tmp/bm_m2.json -w '%{http_code} %{time_total}' --max-time 20 \
    'http://127.0.0.1:3000/ma/api/ops/managed-products/list?page=1&pageSize=50&cutoff=2026-07-29&run_status=running' \
    || echo '000 20.000')
  FLINE=$(curl -sS -o /tmp/bm_f2.json -w '%{http_code} %{time_total}' --max-time 20 \
    'http://127.0.0.1:3000/ma/api/investment/fof-overview/list?page=1&pageSize=50&cutoff=2026-07-29&holding_status=holding' \
    || echo '000 20.000')

  MCODE=$(echo "$MLINE" | awk '{print $1}')
  MT=$(echo "$MLINE" | awk '{print $2}')
  FCODE=$(echo "$FLINE" | awk '{print $1}')
  FT=$(echo "$FLINE" | awk '{print $2}')

  echo -e "${TS}\t${IDLE}\t${NEXT}\t${REB}\t${MCODE}\t${MT}\t${FCODE}\t${FT}" | tee -a "$OUT"

  if ! kill -0 "$REBUILD_PID" 2>/dev/null; then
    echo "rebuild process exited"
    break
  fi
  sleep 12
done

wait "$REBUILD_PID" || true
echo "==== rebuild log ===="
tail -n 40 "$LOG"
echo "==== samples ===="
cat "$OUT"
