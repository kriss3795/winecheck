#!/bin/bash
B=https://ftp.cr2.cl
for v in txn tmean pr et0; do
  echo "== $v"; curl -sS -m 60 "$B/browse/cr2met/v2.5_best/$v/v2.5_best_day/" | grep -o 'href="[^"]*"' | grep -v static | tail -8
done
L=$(curl -sS -m 60 "$B/browse/cr2met/v2.5_best/txn/v2.5_best_day/" | grep -o 'href="[^"]*\.nc"' | tail -1 | cut -d'"' -f2)
echo "ultimo: $L"
U=$(curl -sS -m 60 "$B/browse/cr2met/v2.5_best/txn/v2.5_best_day/" | grep -o 'href="[^"]*2024_01[^"]*"' | head -3); echo "ene2024: $U"
F=$(echo "$U" | head -1 | cut -d'"' -f2)
curl -sSIL -m 60 "$B$F" | head -20
curl -sSL -m 300 -o /tmp/x.nc "$B$F"; ls -la /tmp/x.nc; file /tmp/x.nc
pip install -q netCDF4 >/dev/null 2>&1
python3 -c "
import netCDF4 as n; d=n.Dataset('/tmp/x.nc'); print(d)
for k,v in d.variables.items(): print(k, v.dimensions, v.shape, {a:v.getncattr(a) for a in v.ncattrs()})
import numpy as np
lat=d['lat'][:]; lon=d['lon'][:]; print(lat[:3], lat[-3:], lon[:3], lon[-3:])
"
