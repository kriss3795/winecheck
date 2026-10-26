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
//   - En consultas ArcGIS /query e /identify se fuerza returnGeometry=false
//     para que la respuesta no traiga polígonos gigantes.
//   - Si la respuesta supera ~4.5 MB se corta, para no exceder
//     el límite de Vercel.
// =============================================================

// Dominios oficiales permitidos (fuentes verificadas en el proyecto)
const DOMINIOS_OK = [
  "rest-sit.mop.gob.cl",        // DGA / MOP (agua, restricciones, escasez)
  "esri.ciren.cl",              // CIREN (suelos, erosión, agroclima)
  "arclim.mma.gob.cl",          // ARClim (MMA)
  "arcgis.mma.gob.cl",          // MMA (humedales, cuencas, hidrografía, uso de suelo)
  "gis.mma.gob.cl",             // MMA (humedales, respaldo)
  "ideserver.sma.gob.cl",       // SMA (áreas protegidas oficiales)
  "archive-api.open-meteo.com", // Open-Meteo ERA5 (clima histórico)
  "api.open-meteo.com",         // Open-Meteo (elevación)
  "customer-archive-api.open-meteo.com", // Open-Meteo plan de pago (futuro)
  "nominatim.openstreetmap.org",// Buscador de lugares
  "geoide.minvu.cl",            // MINVU (límites urbanos, áreas de riesgo)
  "rest.isric.org",             // ISRIC SoilGrids (propiedades del suelo)
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
  const ruta = urlObj.pathname.toLowerCase();
  if (ruta.includes("/query") || ruta.includes("/identify")) {
    urlObj.searchParams.set("returnGeometry", "false");
  }

  try {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), 25000); // 25 s (la función tiene 30 s)

    const r = await fetch(urlObj.toString(), {
      headers: {
        // Nominatim pide identificar la aplicación
        "User-Agent": "WineCheck/2.0 (+https://github.com/kriss3795/winecheck)",
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

    // Caché en la red de Vercel: respuestas correctas se guardan 6 h.
    // Así, consultas repetidas de la misma zona no vuelven a golpear
    // a los servidores del Estado ni a Open-Meteo (clave para escalar).
    const esError = !r.ok || /^\s*\{\s*"error"/.test(texto);
    res.setHeader(
      "Cache-Control",
      esError ? "no-store" : "public, s-maxage=21600, stale-while-revalidate=86400"
    );
    res.status(r.status).send(texto);
  } catch (e) {
    res.setHeader("Cache-Control", "no-store");
    res.status(502).json({
      error: "no se pudo consultar la fuente",
      detalle: String(e && e.message ? e.message : e),
    });
  }
}
