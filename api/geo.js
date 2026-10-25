// =============================================================
//  WineCheck — Proxy CORS (Vercel Serverless Function)
// -------------------------------------------------------------
//  Los servidores oficiales del Estado chileno (DGA, CIREN, MMA,
//  SMA) y Open-Meteo no permiten que el navegador los consulte
//  directamente (bloqueo CORS). Esta función actúa de intermediaria:
//  el navegador le pide a /api/geo?url=... y ella reenvía la
//  consulta desde el servidor (donde no hay bloqueo) y devuelve
//  la respuesta.
//
//  Reglas de seguridad:
//   - Solo se permiten dominios de una lista blanca (abajo).
//   - En consultas ArcGIS /query se fuerza returnGeometry=false
//     para que la respuesta no traiga polígonos gigantes.
//   - Si la respuesta supera ~4.5 MB se corta, para no exceder
//     el límite de Vercel.
// =============================================================

// Dominios oficiales permitidos (fuentes verificadas en el proyecto)
const DOMINIOS_OK = [
  "rest-sit.mop.gob.cl",        // DGA / MOP (agua, restricciones, escasez)
  "esri.ciren.cl",              // CIREN (suelos agrológicos)
  "arcgis.mma.gob.cl",          // MMA (humedales)
  "gis.mma.gob.cl",             // MMA (humedales, respaldo)
  "ideserver.sma.gob.cl",       // SMA (áreas protegidas oficiales)
  "archive-api.open-meteo.com", // Open-Meteo ERA5 (clima histórico)
  "api.open-meteo.com",         // Open-Meteo (elevación)
  "customer-archive-api.open-meteo.com", // Open-Meteo plan de pago (futuro)
  "overpass-api.de",            // OpenStreetMap Overpass (cuerpos de agua)
  "nominatim.openstreetmap.org",// Buscador de lugares
];

export default async function handler(req, res) {
  // Permitir que el navegador use esta función
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const destino = req.query.url;
  if (!destino) {
    res.status(400).json({ error: "falta el parametro url" });
    return;
  }

  let urlObj;
  try {
    urlObj = new URL(destino);
  } catch {
    res.status(400).json({ error: "url invalida" });
    return;
  }

  // Lista blanca: solo dominios oficiales
  const permitido = DOMINIOS_OK.some(
    (d) => urlObj.hostname === d || urlObj.hostname.endsWith("." + d)
  );
  if (!permitido) {
    res.status(403).json({ error: "dominio no permitido", dominio: urlObj.hostname });
    return;
  }

  // En consultas ArcGIS, nunca traer geometría (evita respuestas enormes)
  if (urlObj.pathname.toLowerCase().includes("/query")) {
    urlObj.searchParams.set("returnGeometry", "false");
  }

  try {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), 20000); // 20 s máximo

    const r = await fetch(urlObj.toString(), {
      headers: {
        "User-Agent": "WineCheck/1.0 (agronomia; contacto via app)",
        Accept: "application/json, text/plain, */*",
      },
      signal: ctrl.signal,
    });
    clearTimeout(id);

    const tipo = r.headers.get("content-type") || "application/json";
    res.setHeader("Content-Type", tipo);

    // Leer en texto y cortar si es demasiado grande
    const texto = await r.text();
    const MAX = 4_500_000; // ~4.5 MB
    if (texto.length > MAX) {
      res.status(502).json({
        error: "respuesta demasiado grande",
        detalle: "la capa devolvio mas datos de los permitidos",
      });
      return;
    }

    res.status(r.status).send(texto);
  } catch (e) {
    res.status(502).json({
      error: "no se pudo consultar la fuente",
      detalle: String(e && e.message ? e.message : e),
    });
  }
}
