// Proxy serverless blindado a prueba de respuestas gigantes.
// Lee el cuerpo en streaming y ABORTA apenas supera un tope seguro, de modo que
// la funcion NUNCA supere el limite de payload de Netlify (6 MB) ni por error.
export async function handler(event) {
  let target = event.queryStringParameters && event.queryStringParameters.url;
  const permitidos = ["esri.ciren.cl", "rest-sit.mop.gob.cl", "rest-sit.mop.gov.cl"];
  const MAX = 4500000; // ~4.5 MB, bien por debajo del limite de Netlify

  try {
    if (!target) throw new Error("falta url");
    const u = new URL(target);
    if (!permitidos.includes(u.hostname)) throw new Error("dominio no permitido");

    // Forzar SIEMPRE sin geometria en consultas /query (la geometria es lo pesado).
    if (u.pathname.toLowerCase().endsWith("/query")) {
      u.searchParams.set("returnGeometry", "false");
      u.searchParams.delete("outSR");
      u.searchParams.delete("outFields"); // pediremos solo lo necesario abajo
      u.searchParams.set("outFields", event.queryStringParameters.fields || "*");
      u.searchParams.set("f", "json");
    }
    target = u.toString();

    const r = await fetch(target, { headers: { "User-Agent": "WineCheck" } });

    // Leer en streaming y cortar si se pasa del tope.
    const reader = r.body && r.body.getReader ? r.body.getReader() : null;
    if (reader) {
      const chunks = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX) {
          // Demasiado grande: abortamos y devolvemos error controlado.
          try { reader.cancel(); } catch (_) {}
          return {
            statusCode: 200,
            headers: cors(),
            body: JSON.stringify({ error: "respuesta-demasiado-grande" }),
          };
        }
        chunks.push(value);
      }
      const text = Buffer.concat(chunks).toString("utf-8");
      return { statusCode: r.status, headers: cors(), body: text };
    }

    // Fallback si no hay stream: leer texto y medir.
    const text = await r.text();
    if (text.length > MAX) {
      return { statusCode: 200, headers: cors(), body: JSON.stringify({ error: "respuesta-demasiado-grande" }) };
    }
    return { statusCode: r.status, headers: cors(), body: text };
  } catch (e) {
    return { statusCode: 502, headers: cors(), body: JSON.stringify({ error: String(e.message || e) }) };
  }
}

function cors() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=86400",
  };
}
