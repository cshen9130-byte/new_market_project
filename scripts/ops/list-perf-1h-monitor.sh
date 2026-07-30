#!/bin/bash
# 1-hour monitor: list API latency + CPU/worker/postgres + worker job + pg activity + nginx hits
set -eu
OUT=/tmp/list_perf_1h.tsv
PROG=/tmp/list_perf_1h.progress
EVENTS=/tmp/list_perf_1h.events.log
SAMPLES=180          # 180 * 20s ≈ 60 minutes
INTERVAL=19          # +~1s CPU sample ≈ 20s cadence

CUTOFF=$(date -u +%Y-%m-%d)   # same as UI: toISOString().slice(0,10) UTC

rm -f "$OUT" "$PROG" "$EVENTS"
echo -e "ts\tmanaged_ms\tfof_ms\tmanaged_code\tfof_code\tclass\tcpu_us\tcpu_id\tload1\tnext_pct\tworker_pct\tpg_pct\tpg_active\tpg_waiting\tnginx_1m\tworker_job" > "$OUT"

echo "START $(date -Iseconds) cutoff=$CUTOFF samples=$SAMPLES interval~20s" | tee "$PROG"

read_cpu() {
  read -r _ user nice system idle iowait irq softirq steal _ _ < /proc/stat
  echo "$user $nice $system $idle $iowait $irq $softirq $steal"
}

curl_ms() {
  # prints: code ms
  local url="$1"
  local tmp
  tmp=$(mktemp)
  local t0 t1 code ms
  t0=$(date +%s%3N)
  code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 25 "$url" || echo ERR)
  t1=$(date +%s%3N)
  ms=$((t1 - t0))
  rm -f "$tmp"
  echo "$code $ms"
}

worker_job_hint() {
  # Last meaningful job line from worker logs (out+error)
  local line
  line=$(tail -n 80 /root/.pm2/logs/new-market-project-worker-out.log /root/.pm2/logs/new-market-project-worker-error.log 2>/dev/null \
    | grep -E 'computing metrics|managed-cache-15m|email-parse|5m-etl|fof-overview-cache|detail sync|writing cache|done —' \
    | tail -n 1 | sed 's/\x1b\[[0-9;]*m//g' | tr '\t' ' ' | cut -c1-120)
  echo "${line:-none}"
}

pg_stats() {
  sudo -u postgres psql -d market_data -tAc \
    "SELECT count(*) FILTER (WHERE state='active'), count(*) FILTER (WHERE wait_event_type='Lock' OR wait_event='ClientRead' IS FALSE AND state='active' AND wait_event IS NOT NULL) FROM pg_stat_activity WHERE datname=current_database();" \
    2>/dev/null | tr '|' ' ' | awk '{print $1+0, $2+0}'
}

nginx_hits_1m() {
  local f
  for f in /var/log/nginx/access.log /var/log/nginx/access.log.1; do
    if [ -f "$f" ]; then
      # rough: lines with timestamp in last ~60s (depends on log format)
      awk -v cutoff="$(date -u -d '60 seconds ago' '+%d/%b/%Y:%H:%M' 2>/dev/null || date -u '+%d/%b/%Y:%H:%M')" '
        $0 ~ cutoff {c++}
        END{print c+0}
      ' "$f" 2>/dev/null | tail -n 1
      return
    fi
  done
  echo 0
}

classify() {
  local m="$1" f="$2"
  local worst=$m
  if [ "$f" -gt "$worst" ]; then worst=$f; fi
  if [ "$worst" -lt 500 ]; then echo FAST
  elif [ "$worst" -lt 2000 ]; then echo MID
  else echo SLOW
  fi
}

for i in $(seq 1 "$SAMPLES"); do
  TS=$(date +%Y-%m-%dT%H:%M:%S%z)

  C1=$(read_cpu)
  sleep 1
  C2=$(read_cpu)
  set -- $C1
  u1=$1 n1=$2 s1=$3 i1=$4 w1=$5 ir1=$6 so1=$7 st1=$8
  set -- $C2
  u2=$1 n2=$2 s2=$3 i2=$4 w2=$5 ir2=$6 so2=$7 st2=$8
  t1=$((u1 + n1 + s1 + i1 + w1 + ir1 + so1 + st1))
  t2=$((u2 + n2 + s2 + i2 + w2 + ir2 + so2 + st2))
  dt=$((t2 - t1)); [ "$dt" -le 0 ] && dt=1
  cpu_us=$(( (u2 - u1) * 100 / dt ))
  cpu_id=$(( (i2 - i1) * 100 / dt ))
  read -r L1 _ _ _ < /proc/loadavg

  next_pct=$(ps -eo pcpu,cmd | awk '/next-server/ && !/awk/{c+=$1} END{printf "%.0f", c+0}')
  worker_pct=$(ps -eo pcpu,cmd | awk '/background-worker\.ts/ && !/awk/{c+=$1} END{printf "%.0f", c+0}')
  pg_pct=$(ps -eo pcpu,cmd | awk '/postgres:/ && !/awk/{c+=$1} END{printf "%.0f", c+0}')

  read -r pg_active pg_waiting <<<"$(pg_stats)"
  nginx_1m=$(nginx_hits_1m)
  job=$(worker_job_hint | tr '\t' ' ' | tr -s ' ')

  # Match common UI: today cutoff, running, company strategy, pageSize 50
  read -r m_code m_ms <<<"$(curl_ms "http://127.0.0.1:3000/ma/api/ops/managed-products/list?page=1&pageSize=50&run_status=running&strategy_source=company&cutoff=${CUTOFF}")"
  read -r f_code f_ms <<<"$(curl_ms "http://127.0.0.1:3000/ma/api/ops/fof-underlying/list?page=1&pageSize=50&holding_status=holding&strategy_source=company&cutoff=${CUTOFF}")"

  # numeric guard
  [[ "$m_ms" =~ ^[0-9]+$ ]] || m_ms=25000
  [[ "$f_ms" =~ ^[0-9]+$ ]] || f_ms=25000
  cls=$(classify "$m_ms" "$f_ms")

  echo -e "${TS}\t${m_ms}\t${f_ms}\t${m_code}\t${f_code}\t${cls}\t${cpu_us}\t${cpu_id}\t${L1}\t${next_pct}\t${worker_pct}\t${pg_pct}\t${pg_active}\t${pg_waiting}\t${nginx_1m}\t${job}" >> "$OUT"

  line="sample ${i}/${SAMPLES} $(date +%H:%M:%S) ${cls} managed=${m_ms}ms fof=${f_ms}ms idle=${cpu_id}% next=${next_pct}% worker=${worker_pct}% pg=${pg_pct}%"
  echo "$line" >> "$PROG"

  if [ "$cls" = "SLOW" ] || [ "$cls" = "MID" ]; then
    {
      echo "==== $TS $cls ===="
      echo "$line"
      echo "job: $job"
      ps -eo pid,pcpu,pmem,cmd --sort=-pcpu | head -n 12
      sudo -u postgres psql -d market_data -c "SELECT pid, state, wait_event_type, wait_event, left(query,80) AS q FROM pg_stat_activity WHERE datname=current_database() AND state <> 'idle' ORDER BY state, pid;" 2>/dev/null || true
      echo
    } >> "$EVENTS"
  fi

  if [ "$i" -lt "$SAMPLES" ]; then
    sleep "$INTERVAL"
  fi
done

echo "DONE $(date -Iseconds)" | tee -a "$PROG"
# summary
awk -F'\t' 'NR>1 {
  n++;
  if($6=="FAST") f++;
  else if($6=="MID") m++;
  else s++;
  if($2+0>maxm) maxm=$2+0;
  if($3+0>maxf) maxf=$3+0;
}
END{
  print "SUMMARY samples=" n " FAST=" f+0 " MID=" m+0 " SLOW=" s+0 " max_managed_ms=" maxm+0 " max_fof_ms=" maxf+0
}' "$OUT" | tee -a "$PROG"
