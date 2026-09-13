// Proxy serverless: corre en Netlify (no en el navegador), así evita el bloqueo
// CORS de los servidores estatales (CIREN, DGA). La app llama a /api/geo?url=...
// y esta función trae el dato y lo devuelve con cabeceras CORS abiertas.
export async function handler(event) {
  const target = event.queryStringParameters && event.queryStringParameters.url;
  // Lista blanca: solo dominios oficiales, por seguridad.
  const permitidos = ["esri.ciren.cl", "rest-sit.mop.gob.cl", "rest-sit.mop.gov.cl"];
  try {
    if (!target) throw new Error("falta url");
    const host = new URL(target).hostname;
    if (!permitidos.includes(host)) throw new Error("dominio no permitido");
    const r = await fetch(target, { headers: { "User-Agent": "WineCheck" } });
    const text = await r.text();
    return {
      statusCode: r.status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=86400",
      },
      body: text,
    };
  } catch (e) {
    return {
      statusCode: 502,
      headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
      body: JSON.stringify({ error: String(e.message || e) }),
    };
  }
}
