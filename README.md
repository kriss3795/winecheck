# WineCheck — Aptitud vitícola por sector (Chile)

## Cómo busca y qué garantiza (lo que pediste)
BUSCA EXHAUSTIVAMENTE antes de rendirse, pero SOLO muestra lo verificado:

1. Suelo — FASE 1: consulta el punto EXACTO en los servicios de CIREN. Si un
   polígono contiene el punto, muestra ese dato con "✓ dato exacto del punto".
2. Suelo — FASE 2 (buscar como loco): si el punto exacto no tiene estudio
   (borde, hueco cartográfico), busca en radios crecientes 300 m → 1 km → 3 km →
   5 km y muestra el suelo MÁS CERCANO, marcado como "≈ aproximado (~X m)" para
   que sepas que no es exactamente el del punto. Nunca lo presenta como exacto.
3. Solo se muestra si hay campos agronómicos reales (serie, capacidad de uso,
   drenaje, textura, aptitud). Si no, dice "sin dato" y enlaza a la fuente.

## Bugs corregidos en esta versión (causaban datos poco confiables)
- CONSULTA MAL FORMADA que devolvía TODA la capa regional en vez del polígono del
  punto → mostraba suelo de otra ubicación. Corregido: geometría JSON correcta +
  where=1=1, y se RECHAZA la respuesta si trae muchos polígonos (señal de que no
  filtró por punto).
- RESPUESTA HTML del proxy caído que se tragaba como dato → ahora se rechaza todo
  lo que no sea JSON real.
- Campos con nombres distintos por región (RM 2024 vs Maule 2011): la lectura
  ahora capta variantes y solo acepta si hay contenido real.
- Cada dato muestra de qué región/servicio vino y enlaza a la fuente oficial para
  que lo compruebes tú mismo.

## Para que suelo y agua funcionen: activar el proxy en Netlify
El arrastre simple NO activa el proxy. Usa una de estas:
- GitHub: sube esta carpeta a un repo y en Netlify "Import from Git" (recomendado).
- CLI: dentro de la carpeta, `npm install` y `npx netlify-cli deploy --build --prod`.
Comprobar proxy activo: abre TU-SITIO.netlify.app/api/geo?url=https://esri.ciren.cl/server/rest/services/IDEMINAGRI/SUELOS_AGROLOGICOS/MapServer?f=json
Si ves JSON con "layers", funciona.

## Confiabilidad
- CLIMA (Open-Meteo): siempre, real, del punto.
- SUELO (CIREN) y AGUA (DGA): solo si la consulta por coordenada devuelve un dato
  real y del punto (o cercano, marcado como tal). Verificable con el enlace oficial.
- Nada reemplaza una calicata antes de plantar.
