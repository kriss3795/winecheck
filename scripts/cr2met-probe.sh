#!/bin/bash
set -x
B=https://ftp.cr2.cl
curl -sS -m 30 $B/browse/cr2met/ | grep -o 'href="[^"]*"' | head -80
for d in v2.5_best v2.5_R1 v2.5_best/txn v2.5_best/tmean v2.5_best/pr v2.5_best/et0 v2.5_best/txn/2025; do
  echo "== $d"; curl -sS -m 30 "$B/browse/cr2met/$d/" | grep -o 'href="[^"]*"' | head -60
done
