// =====================================================================
//  red.js — utilidades de red
//  - Timeout con AbortController (AbortSignal.timeout crashea en
//    algunos webviews de celular).
//  - Las fuentes del Estado no permiten CORS: van por nuestro proxy.
//  - Detecta respuestas de error de ArcGIS (que llegan con HTTP 200),
//    para no confundir "la fuente falló" con "no hay nada aquí".
// =====================================================================

const PROXY = "/api/geo?url=";
export const viaProxy = (url) => PROXY + encodeURIComponent(url);

// Fuentes que sí aceptan consultas directas desde el navegador (CORS).
const DIRECTO_PRIMERO = ["open-meteo.com", "overpass-api.de", "nominatim.openstreetmap.org"];

export function fetchTimeout(url, ms, opts) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, Object.assign({}, opts, { signal: ctrl.signal })).finally(() =>
    clearTimeout(id)
  );
}

async function leerJSON(r) {
  if (!r.ok) throw new Error("la fuente respondió HTTP " + r.status);
  const j = await r.json();
  // ArcGIS y nuestro proxy informan errores dentro del JSON
  if (j && j.error) {
    const msg = typeof j.error === "string" ? j.error : j.error.message || "error de la fuente";
    throw new Error(msg);
  }
  return j;
}

// Pide un JSON. Si algo falla, LANZA un error (nunca devuelve "vacío"),
// para que la app muestre "Sin dato" en vez de asumir que no hay nada.
export async function fetchJSON(url, ms = 15000) {
  const host = new URL(url).hostname;
  const directo = DIRECTO_PRIMERO.some((d) => host === d || host.endsWith("." + d));
  // Directo y luego proxy; o proxy con un reintento (servidores del Estado).
  const intentos = directo ? [url, viaProxy(url)] : [viaProxy(url), viaProxy(url)];
  let ultimoError = null;
  for (const u of intentos) {
    try {
      return await leerJSON(await fetchTimeout(u, ms));
    } catch (e) {
      ultimoError = e;
    }
  }
  throw ultimoError || new Error("no se pudo consultar la fuente");
}

// Ejecuta fn sobre cada elemento con un máximo de n consultas a la vez.
// Devuelve [{ok:true, v} | {ok:false, e}] en el mismo orden.
export async function enParalelo(items, n, fn) {
  const res = new Array(items.length);
  let idx = 0;
  async function trabajador() {
    while (idx < items.length) {
      const k = idx++;
      try {
        res[k] = { ok: true, v: await fn(items[k], k) };
      } catch (e) {
        res[k] = { ok: false, e };
      }
    }
  }
  const hilos = [];
  for (let i = 0; i < Math.min(n, items.length); i++) hilos.push(trabajador());
  await Promise.all(hilos);
  return res;
}
