#!/bin/bash
# Sondeo de servicios externos (solo diagnóstico; el resultado queda en public/clima/sondeo.txt)
B="https://esri.ciren.cl/server/rest/services/IDEMINAGRI/USO_DE_LA_TIERRA_CUT_CONAF/MapServer"
curl -sS -m 60 "$B?f=json" | python3 -c "import json,sys; d=json.load(sys.stdin); [print(l['id'],l['name'],l.get('subLayerIds')) for l in d['layers']]"
for id in 1 2 3 4 5 6 7 16 17 18 19 20 21 22; do
  echo "== capa $id"; curl -sS -m 60 "$B/$id?f=json" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('name'), d.get('extent',{}).get('ymin'), d.get('extent',{}).get('ymax'), d.get('extent',{}).get('spatialReference')); print([f['name'] for f in d.get('fields',[])])"
done
# Identify en Paine (polígono pequeño) y en Pencahue
for P in "-70.75,-33.82" "-71.83,-35.38" "-72.6,-38.7"; do
  echo "== identify $P"
  curl -sS -m 60 "$B/identify?geometry=$P&geometryType=esriGeometryPoint&sr=4326&layers=all&tolerance=1&mapExtent=-76,-56,-66,-17&imageDisplay=1000,1000,96&returnGeometry=false&f=json" | python3 -c "
import json,sys; d=json.load(sys.stdin)
for r in d.get('results',[]):
  a=r['attributes']; print(r['layerId'], r['layerName'], {k:v for k,v in a.items() if any(s in k.lower() for s in ('uso','t_f','des','anio','año','sub','f_','tipo'))})"
done
