# WineCheck 🍷

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
- `src/lib/capas.js` — una función por fuente oficial
- `src/lib/veredicto.js` — restricciones, semáforo y resumen
- `src/App.jsx` — interfaz
- `api/geo.js` — proxy CORS con lista blanca y caché

## Fuentes de datos
Open-Meteo ERA5-Land (clima, 10 temporadas), CIREN (suelo), DGA/MOP (agua y escasez),
MMA (humedales), SMA (áreas protegidas), Copernicus DEM vía Open-Meteo
(pendiente/mar), OpenStreetMap (cuerpos de agua y búsqueda).
