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

## Fuentes de datos
Open-Meteo ERA5 (clima), CIREN (suelo), DGA/MOP (agua y escasez),
MMA (humedales), SMA (áreas protegidas), Copernicus DEM vía Open-Meteo
(pendiente/mar), OpenStreetMap (cuerpos de agua y búsqueda).
