# WineCheck — Aptitud vitícola por sector (Chile)

## Conclusión verificada sobre los datos de suelo (CIREN)
Tras probar los servidores reales de CIREN, quedó confirmado con datos:
CIREN entrega por su API pública SOLO la capacidad de uso del suelo (clase I a
VIII). No expone serie, textura, drenaje, pH ni aptitud por este medio — esos
datos están en sus informes/calicatas, no en el servicio web.

Por eso WineCheck ahora presenta la CAPACIDAD DE USO como dato principal, bien
explicada: es el mejor resumen único de la aptitud de un suelo, el que usan los
agrónomos. Clases I–IV: suelos cultivables (aptos para vid). V–VIII: limitaciones
crecientes. Es un dato real, verificado y del punto exacto.

## Estado de cada capa (todo verificado con los servidores reales)
- CLIMA — Open-Meteo ERA5, 25 años, del punto. Completo.
- AGUA — DGA (ArcGIS oficial del MOP): si el punto está en área de restricción o
  prohibición de aguas subterráneas. Del punto exacto.
- SUELO — CIREN: capacidad de uso del punto (búsqueda exhaustiva: punto exacto y,
  si no hay, radios de 300 m a 5 km marcados como aproximados).

## Búsqueda exhaustiva pero honesta
Busca el dato del punto exacto; si no existe, amplía a 5 km y lo marca como
aproximado. Solo cuando de verdad no hay estudio (alta cordillera, zonas sin
levantar) dice "sin dato" — nunca inventa.

## Despliegue
Ya está en GitHub y Netlify con el proxy activo (confirmado: las consultas a
CIREN responden). Para actualizar: sube los cambios al repositorio y Netlify
reconstruye solo.

## Honestidad de fondo
Nada reemplaza una calicata antes de plantar. WineCheck es orientación con datos
oficiales del punto.
