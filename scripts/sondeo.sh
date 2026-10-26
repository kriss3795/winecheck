#!/bin/bash
B="https://esri.ciren.cl/server/rest/services/IDEMINAGRI/AGROCLIMA_IDEMINAGRI/MapServer"
for P in "-70.75,-33.82" "-71.83,-35.38" "-70.71,-30.03" "-71.41,-33.32" "-70.79,-33.39"; do
  x=${P%,*}; y=${P#*,}
  echo "== $P"
  curl -sS -m 60 "$B/identify?geometry=$P&geometryType=esriGeometryPoint&sr=4326&layers=all:16,21,43,36,26&tolerance=0&mapExtent=$(python3 -c "print(f'{$x-0.01},{$y-0.01},{$x+0.01},{$y+0.01}')")&imageDisplay=400,400,96&returnGeometry=false&f=json" | python3 -c "
import json,sys; d=json.load(sys.stdin)
for r in d.get('results',[])[:1]:
  a=r['attributes']; print(r['layerName']); print({k:v for k,v in a.items() if any(s in k.lower() for s in ('etp','evapo','ppa','precip','tem','zona','distrito'))})"
done
