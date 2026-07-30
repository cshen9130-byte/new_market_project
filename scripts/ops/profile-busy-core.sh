#!/usr/bin/env bash
# Profile which process owns the busy core while list APIs are hit.
set -euo pipefail
DURATION="${1:-45}"
OUT="/tmp/busy-core-profile.tsv"
echo -e "ts\tcpu_us\tcpu_id\tload1\tnext_pct\tworker_pct\tpg_pct\tmanaged_ms\tfof_ms\ttop_cmd" > "$OUT"

next_pid() { pgrep -n -f 'next-server' || true; }
worker_pid() { pgrep -n -f 'background-worker.ts' || true; }

read_cpu() {
  local pid="$1"
  [[ -n "$pid" && -r "/proc/$pid/stat" ]] || { echo 0; return; }
  awk '{print $14+$15}' "/proc/$pid/stat"
}

read_stat() {
  awk '/^cpu /{print $2+$3+$4,$5}' /proc/stat
}

hz=$(getconf CLK_TCK)
end=$((SECONDS + DURATION))
prev_n=$(read_cpu "$(next_pid)")
prev_w=$(read_cpu "$(worker_pid)")
read -r prev_u prev_i <<<"$(read_stat)"
prev_t=$(date +%s%3N)

while (( SECONDS < end )); do
  sleep 2
  N=$(next_pid); W=$(worker_pid)
  cur_n=$(read_cpu "$N"); cur_w=$(read_cpu "$W")
  read -r cur_u cur_i <<<"$(read_stat)"
  now=$(date +%s%3N)
  dt_ms=$((now - prev_t)); [[ $dt_ms -lt 1 ]] && dt_ms=1
  dt=$(awk -v m="$dt_ms" 'BEGIN{printf "%.3f", m/1000}')
  next_pct=$(awk -v a="$prev_n" -v b="$cur_n" -v d="$dt" -v h="$hz" 'BEGIN{printf "%.0f", (b-a)/d/h*100}')
  worker_pct=$(awk -v a="$prev_w" -v b="$cur_w" -v d="$dt" -v h="$hz" 'BEGIN{printf "%.0f", (b-a)/d/h*100}')
  # sum of top postgres %CPU from ps (instantaneous)
  pg_pct=$(ps -eo pcpu,cmd --sort=-pcpu | awk '/postgres:/{s+=$1} END{printf "%.0f", s+0}')
  cpu_delta=$((cur_u + cur_i - prev_u - prev_i)); [[ $cpu_delta -lt 1 ]] && cpu_delta=1
  cpu_us=$(awk -v a="$prev_u" -v b="$cur_u" -v d="$cpu_delta" 'BEGIN{printf "%.0f", (b-a)/d*100}')
  cpu_id=$(awk -v a="$prev_i" -v b="$cur_i" -v d="$cpu_delta" 'BEGIN{printf "%.0f", (b-a)/d*100}')
  load1=$(awk '{print $1}' /proc/loadavg)
  top_cmd=$(ps -eo pcpu,comm --sort=-pcpu | awk 'NR==2{print $2}')

  t0=$(date +%s%3N)
  code_m=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 25 \
    'http://127.0.0.1:3000/ma/api/ops/managed-products/list?page=1&pageSize=50' || echo ERR)
  t1=$(date +%s%3N)
  code_f=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 25 \
    'http://127.0.0.1:3000/ma/api/ops/fof-underlying/list?page=1&pageSize=50&holding_status=holding' || echo ERR)
  t2=$(date +%s%3N)
  managed_ms=$((t1 - t0))
  fof_ms=$((t2 - t1))

  ts=$(date '+%H:%M:%S')
  echo -e "${ts}\t${cpu_us}\t${cpu_id}\t${load1}\t${next_pct}\t${worker_pct}\t${pg_pct}\t${managed_ms}\t${fof_ms}\t${top_cmd}(${code_m}/${code_f})" | tee -a "$OUT"

  prev_n=$cur_n; prev_w=$cur_w; prev_u=$cur_u; prev_i=$cur_i; prev_t=$now
done

echo "Wrote $OUT"
