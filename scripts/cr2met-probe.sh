#!/bin/bash
set -x
B=https://ftp.cr2.cl/download/cr2met
curl -sS -m 30 $B/ | head -60
curl -sS -m 30 $B/v2.5_best/ | head -60
for v in txn pr et0 tmean; do curl -sS -m 30 $B/v2.5_best/$v/ | head -40; done
curl -sSI -m 30 $B/v2.5_best/txn/CR2MET_txn_v2.5_best_day_2025_01_005deg.nc
