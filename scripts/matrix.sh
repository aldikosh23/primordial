#!/usr/bin/env bash
# Compare tuning variants: each line of the matrix file is "name|BIO json|WORLD json".
# Usage: scripts/matrix.sh matrix.txt [ticks] [seeds...]
file=$1; ticks=${2:-30000}; shift 2 || true
seeds=${@:-alpha beta gamma delta}
out=$(mktemp -d)
while IFS='|' read -r name bio world; do
  [ -z "$name" ] && continue
  for s in $seeds; do
    BIO="$bio" WORLD="$world" npx tsx scripts/balance.ts "$s" "$ticks" 5000 > "$out/$name.$s.txt" 2>&1 &
  done
done < "$file"
wait
while IFS='|' read -r name bio world; do
  [ -z "$name" ] && continue
  echo "## $name  $bio $world"
  for s in $seeds; do
    f="$out/$name.$s.txt"
    printf '  %-8s %s | hunters@t: %s\n' "$s" "$(head -1 "$f" | sed -E 's/.*(peak [0-9]+).*alive ([0-9]+), hunters ([0-9]+)/\1 alive \2 hunters \3/')" \
      "$(grep -E '^t' "$f" | awk '{print $6+$8}' | tr '\n' ' ')"
  done
done < "$file"
