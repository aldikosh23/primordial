#!/usr/bin/env bash
# Parallel wrapper for early.ts: scripts/early.sh <seeds> <ticks>  (BIO/WORLD env pass through)
seeds=${1:-24}; ticks=${2:-12000}; per=3
out=$(mktemp -d)
for ((i=0; i<seeds; i+=per)); do npx tsx scripts/early.ts $i $per $ticks > "$out/$i.txt" 2>&1 & done
wait
cat "$out"/*.txt | awk '{n+=$1; c+=$2; h+=$3} END {printf "worlds %d  collapsed %d  no-hunters %d\n", n, c, h}'
