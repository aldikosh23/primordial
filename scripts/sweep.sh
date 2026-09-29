#!/usr/bin/env bash
# Runs the balance check for several seeds in parallel and prints a summary.
# Usage: scripts/sweep.sh [ticks] [seeds...]   (BIO/WORLD env overrides pass through)
ticks=${1:-40000}; shift || true
seeds=${@:-alpha beta gamma delta epsilon zeta}
out=$(mktemp -d)
for s in $seeds; do npx tsx scripts/balance.ts "$s" "$ticks" 5000 > "$out/$s.txt" 2>&1 & done
wait
for s in $seeds; do cat "$out/$s.txt"; echo; done
echo "summary:"; grep -h '^==' "$out"/*.txt
