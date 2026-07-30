#!/bin/bash
# Sample host metrics every ~30s for 30 minutes (60 samples).
set -eu
OUT=/tmp/hw_monitor_30m.tsv
PROG=/tmp/hw_monitor_30m.progress
SAMPLES=60
INTERVAL=29

rm -f "$OUT" "$PROG"
echo -e "ts\tload1\tload5\tload15\tcpu_us\tcpu_sy\tcpu_id\tcpu_wa\tmem_total_mb\tmem_used_mb\tmem_avail_mb\tswap_used_mb\tnext_cpu\tnext_rss_mb\tworker_cpu\tworker_rss_mb\tpostgres_cpu" > "$OUT"

read_cpu() {
  # shellcheck disable=SC2034
  read -r _ user nice system idle iowait irq softirq steal guest guest_nice < /proc/stat
  echo "$user $nice $system $idle $iowait $irq $softirq $steal"
}

for i in $(seq 1 "$SAMPLES"); do
  TS=$(date +%Y-%m-%dT%H:%M:%S%z)
  read -r L1 L5 L15 _ < /proc/loadavg

  C1=$(read_cpu)
  sleep 1
  C2=$(read_cpu)
  set -- $C1
  u1=$1 n1=$2 s1=$3 i1=$4 w1=$5 ir1=$6 so1=$7 st1=$8
  set -- $C2
  u2=$1 n2=$2 s2=$3 i2=$4 w2=$5 ir2=$6 so2=$7 st2=$8
  t1=$((u1 + n1 + s1 + i1 + w1 + ir1 + so1 + st1))
  t2=$((u2 + n2 + s2 + i2 + w2 + ir2 + so2 + st2))
  dt=$((t2 - t1))
  if [ "$dt" -le 0 ]; then dt=1; fi
  cpu_us=$(( (u2 - u1) * 100 / dt ))
  cpu_sy=$(( (s2 - s1) * 100 / dt ))
  cpu_id=$(( (i2 - i1) * 100 / dt ))
  cpu_wa=$(( (w2 - w1) * 100 / dt ))

  read -r mem_total mem_used mem_avail <<< "$(free -m | awk '/^Mem:/{print $2, $3, $7}')"
  swap_used=$(free -m | awk '/^Swap:/{print $3}')

  next_cpu=$(ps -eo pcpu,rss,cmd | awk '/next-server/ && !/awk/{c+=$1; r+=$2} END{printf "%.1f", c+0}')
  next_rss=$(ps -eo pcpu,rss,cmd | awk '/next-server/ && !/awk/{r+=$2} END{printf "%.0f", r/1024}')
  worker_cpu=$(ps -eo pcpu,rss,cmd | awk '/background-worker\.ts|scripts\/background-worker/ && !/awk/{c+=$1; r+=$2} END{printf "%.1f", c+0}')
  worker_rss=$(ps -eo pcpu,rss,cmd | awk '/background-worker\.ts|scripts\/background-worker/ && !/awk/{r+=$2} END{printf "%.0f", r/1024}')
  postgres_cpu=$(ps -eo pcpu,cmd | awk '/postgres:/ && !/awk/{c+=$1} END{printf "%.1f", c+0}')

  echo -e "${TS}\t${L1}\t${L5}\t${L15}\t${cpu_us}\t${cpu_sy}\t${cpu_id}\t${cpu_wa}\t${mem_total}\t${mem_used}\t${mem_avail}\t${swap_used}\t${next_cpu}\t${next_rss}\t${worker_cpu}\t${worker_rss}\t${postgres_cpu}" >> "$OUT"
  echo "sample ${i}/${SAMPLES} $(date +%H:%M:%S) load=${L1} idle=${cpu_id}% next=${next_cpu}% worker=${worker_cpu}%" >> "$PROG"
  if [ "$i" -lt "$SAMPLES" ]; then
    sleep "$INTERVAL"
  fi
done

echo DONE >> "$PROG"
pm2 jlist > /tmp/hw_monitor_30m_pm2.json 2>/dev/null || true
nproc > /tmp/hw_monitor_30m_nproc.txt
free -h > /tmp/hw_monitor_30m_free.txt
echo "finished $(date -Iseconds)" >> "$PROG"
