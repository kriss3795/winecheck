# 🍷 WineCheck — Cómo empezar de nuevo (paso a paso)

Hola Kriss. Esta guía te lleva de cero a tener WineCheck funcionando
**gratis en Vercel** y organizado en un **Proyecto de Claude**. Está
escrita simple, para seguir sin saber programar.

Son **3 partes**:
1. Crear el Proyecto de Claude (la memoria).
2. Subir el código a GitHub.
3. Publicar en Vercel (gratis).

Cuando termines, tendrás una página web pública (ej:
`winecheck.vercel.app`) que se actualiza sola cada vez que cambies algo.

---

## 📦 ¿Qué hay en esta carpeta?

```
winecheck/
├── api/
│   └── geo.js                  ← el "proxy" (esquiva bloqueos del Estado)
├── public/
│   └── logo.png                ← el logo WineCheck
├── src/
│   ├── App.jsx                 ← el cerebro de la app (lógica + pantalla)
│   ├── main.jsx                ← arranque de React
│   └── estilos.css             ← colores y diseño (celular y compu)
├── index.html                  ← página base
├── package.json                ← lista de piezas que usa la app
├── vite.config.js              ← configuración de construcción
├── vercel.json                 ← configuración de Vercel
├── INSTRUCCIONES-DEL-PROYECTO.txt  ← TEXTO para pegar en el Proyecto Claude
└── EMPIEZA-AQUI.md             ← esta guía
```

No necesitas tocar casi nada a mano. Claude hace los cambios; tú subes.

---

## PARTE 1 — Crear el Proyecto de Claude 🧠

Un Proyecto de Claude es una carpeta con memoria. Le pones instrucciones
fijas y le subes los archivos como "conocimiento". Así, cada vez que me
escribas ahí, ya sé todo el contexto y no se pierde cuando la
conversación se llena.

1. Entra a **claude.ai** → barra lateral izquierda → **Proyectos** →
   **Crear proyecto**.
2. Nombre: `WineCheck`.
3. Abre el archivo **`INSTRUCCIONES-DEL-PROYECTO.txt`** de esta carpeta,
   copia TODO su contenido y pégalo en el campo **"Instrucciones"** del
   proyecto. (Es el cerebro: fuentes, reglas, cómo trabajar.)
4. En el proyecto, busca **"Agregar conocimiento"** (o el clip 📎) y sube
   estos archivos como referencia:
   - `src/App.jsx`
   - `api/geo.js`
   - `src/estilos.css`
   - `INSTRUCCIONES-DEL-PROYECTO.txt`

   > Esto me deja ver el código actual cuando me pidas cambios.

Listo. De ahora en adelante, trabaja **dentro de ese proyecto**.

---

## PARTE 2 — Subir el código a GitHub 📤

GitHub es donde vive el código. Vercel lo lee de ahí.

1. Entra a **github.com** e inicia sesión (o crea cuenta gratis).
2. Arriba a la derecha: **+** → **New repository**.
3. Nombre: `winecheck`. Déjalo **Public**. No marques nada más.
   → **Create repository**.
4. En la página que aparece, haz clic en **"uploading an existing file"**
   (subir un archivo existente).
5. Arrastra **TODO el contenido de esta carpeta** (las carpetas `api`,
   `public`, `src` y todos los archivos sueltos). 
   > Importante: arrastra el CONTENIDO, no la carpeta `winecheck` entera.
6. Abajo, botón verde **"Commit changes"**.

Ya tienes el código en GitHub. ✅

---

## PARTE 3 — Publicar en Vercel (gratis) 🚀

1. Entra a **vercel.com** → **Sign up** → elige **"Continue with GitHub"**
   (así se conectan solos).
2. En Vercel: **Add New…** → **Project**.
3. Busca tu repositorio `winecheck` y pulsa **Import**.
4. Vercel detecta que es **Vite** automáticamente. No cambies nada.
   > Framework Preset: Vite · Build Command: `npm run build` · Output: `dist`
5. Pulsa **Deploy**.
6. Espera 1–2 minutos. Te dará una dirección tipo
   **`winecheck.vercel.app`**. ¡Esa es tu app pública!

El proxy (`api/geo.js`) se activa solo en Vercel. No hay que configurar
nada extra.

---

## 🔁 ¿Cómo hago cambios después?

1. Me pides el cambio **dentro del Proyecto de Claude**.
2. Yo te doy el archivo corregido (o te digo qué línea cambiar).
3. En GitHub: entras al archivo → lápiz ✏️ (editar) → pegas → **Commit**.
   (O subes el archivo nuevo con "Add file → Upload files".)
4. Vercel reconstruye solo en ~1 minuto. Recargas la página y listo.

> Regla de oro que aprendimos: **los cambios solo se ven en la web
> después de subirlos a GitHub.** Si editas y no subes, no pasa nada.

---

## ❓ Si algo falla

- **La página sale en blanco:** mándame el error. Abre la app, clic
  derecho → "Inspeccionar" → pestaña "Console", y cópiame lo que salga
  en rojo.
- **"No se pudo calcular el clima":** suele ser el límite gratis de
  Open-Meteo (error 429). Se arregla con el plan de pago cuando haya
  muchos usuarios. Mientras tanto, reintenta en un minuto.
- **El proxy da "dominio no permitido":** es seguridad; significa que se
  intentó una fuente fuera de la lista oficial. Avísame y la reviso.

---

## 💰 Sobre escalabilidad (para la presentación)

Sí, WineCheck es escalable. Las capas del Estado (DGA, CIREN, MMA, SMA)
no tienen límite práctico de uso. El único cuello de botella es la API
de clima gratis (Open-Meteo), que con muchos usuarios a la vez daría
error. Se soluciona con su plan de pago (~10–30 EUR/mes) más guardar en
caché los resultados por zona. Es un costo bajo y predecible — buen
argumento frente a inversionistas.

¡Éxito en la presentación! 🍷
