wc -l /tmp/list_perf_1h.progress /tmp/list_perf_1h.tsv
echo '---PROGRESS---'
tail -n 12 /tmp/list_perf_1h.progress
echo '---COUNTS---'
awk -F'	' 'NR>1{n++; if($6=="FAST")f++; else if($6=="MID")m++; else s++; if($2+0>maxm)maxm=$2; if($3+0>maxf)maxf=$3} END{print "n=" n " FAST=" f+0 " MID=" m+0 " SLOW=" s+0 " max_m=" maxm+0 " max_f=" maxf+0}' /tmp/list_perf_1h.tsv
echo '---MONITOR---'
pgrep -af list-perf || echo NOT_RUNNING
