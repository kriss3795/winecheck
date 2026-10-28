# WineCheck 🍷

**Web:** https://wine-check.vercel.app

App web que evalúa si un terreno en Chile es apto para plantar viñas,
combinando datos oficiales (clima, suelo, agua, humedales, áreas
protegidas, pendiente/mar) en un veredicto tipo semáforo.

**Empieza por el archivo [`EMPIEZA-AQUI.md`](./EMPIEZA-AQUI.md).**

## Stack
- React + Vite
- Leaflet / react-leaflet (mapa)
- Proxy CORS en Vercel (`api/geo.js`)

## Desarrollo local (opcional)
```bash
npm install
npm run dev      # servidor local
npm run build    # construye para producción (carpeta dist/)
```

## Estructura del código
- `src/lib/red.js` — red, timeout y proxy
- `src/lib/geometria.js` — área, grilla de muestreo, polígonos
- `src/lib/capas.js`, `clima.js`, `territorio.js`, `suelo.js`, `tiempo.js` — una función por fuente oficial
- `scripts/arclim.mjs` — genera `public/clima/b*.json` desde ARClim (GitHub Actions)
- `scripts/cr2met.py` — genera `public/clima/a*.json`: clima actual (CR2MET, últimas 10 temporadas)
- `scripts/escasez.mjs` — copia semanal de los decretos de escasez vigentes de la DGA (`public/escasez.json`)
- `pruebas/sim100.py` — simulación de 100 terrenos en todo Chile con control independiente (GitHub Actions)
- `pruebas/e2e.py` — prueba de punta a punta con terrenos reales (GitHub Actions)
- `src/lib/veredicto.js` — restricciones, semáforo y resumen
- `src/App.jsx` — interfaz
- `api/geo.js` — proxy CORS con lista blanca y caché

## Fuentes de datos
Todas oficiales o científicas, con enlace para verificar dentro de la app (panel "Fuentes y cómo leerlas"):
CR2MET del (CR)2, Universidad de Chile (clima de las últimas 10 temporadas) · ARClim del Ministerio del Medio
Ambiente (cambio climático proyectado a 2035–2065) · CIREN (capacidad de uso del suelo, erosión, agroclima) ·
CONAF vía CIREN (uso del suelo y bosque nativo) · DGA/MOP (agua subterránea, agotamiento, decretos de escasez) ·
MMA (humedales, cuencas, red hidrográfica) · SMA (áreas protegidas) · MINVU (límites urbanos y áreas de riesgo) ·
Decreto 464 (denominaciones de origen) · ISRIC SoilGrids (propiedades estimadas del suelo) · FAO-56 (riego) ·
Copernicus DEM vía Open-Meteo (pendiente) · Open-Meteo y Windy (pronóstico).

## Control de calidad
- Simulación automática de 100 terrenos al azar en todo Chile: la app se compara con consultas
  independientes a las fuentes (comuna 100/100, clase de suelo en el centro del terreno 100%,
  áreas protegidas 9/9 vetadas, elevación 100%, sin textos con errores).
- Prueba de punta a punta en celular y PC con 13 terrenos conocidos en cada cambio.
- Regla de diseño: si una fuente falla, la app lo dice ("Veredicto incompleto"); nunca rellena con supuestos.

## Para uso comercial (revisar antes de vender)
- **Open-Meteo** (elevación y pronóstico): el plan gratuito es solo para uso no comercial
  (10.000 llamadas al día). Una app que se vende necesita un plan pagado (API Standard: 1 millón de
  llamadas al mes, sin límite por minuto). Cada análisis usa 2–3 llamadas.
- **Mapa satelital y de relieve de Esri**: revisar los términos de uso de Esri para uso comercial.
- **Nominatim** (buscador de lugares): su política de uso limita a 1 consulta por segundo; con muchos
  usuarios conviene un servicio de geocodificación propio o pagado.
- **CR2MET** (licencia CC BY 4.0) y **SoilGrids** (CC BY 4.0): se pueden usar citando la fuente, como ya hace la app.
- Las capas del Estado (DGA, CIREN, MMA, SMA, MINVU) son servicios públicos; el proxy guarda en caché
  6 horas cada respuesta para no sobrecargarlos.
