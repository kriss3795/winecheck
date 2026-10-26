// =====================================================================
//  territorio.js — ubicación, uso actual del suelo, cauces, límites
//  urbanos, áreas de riesgo y declaración de agotamiento.
//  Todas las capas fueron verificadas en vivo (octubre 2026).
// =====================================================================
import { fetchJSON, enParalelo } from "./red.js";
import { URLS, CONCURRENCIA, urlQueryPoligono, urlQueryPunto, fecha, normal } from "./capas.js";
import { denominacionDeOrigen } from "./denominaciones.js";

// ---------------------------------------------------------------------
//  1) UBICACIÓN: comuna/provincia/región (DPA oficial, MOP-IDE),
//     cuenca y subcuenca (MMA) y Denominación de Origen (Decreto 464)
// ---------------------------------------------------------------------
export async function pedirUbicacion(centro) {
  const [dpa, cuenca, subcuenca] = await Promise.all([
    fetchJSON(urlQueryPunto(URLS.dpaComunas, centro, "CUT_REG,CUT_COM,COMUNA,PROVINCIA,REGION"), 12000),
    fetchJSON(urlQueryPunto(URLS.mmaCuencas + "/0", centro, "NOM_CUEN,COD_CUEN"), 12000).catch(() => null),
    fetchJSON(urlQueryPunto(URLS.mmaCuencas + "/1", centro, "*"), 12000).catch(() => null),
  ]);
  const a = dpa.features?.[0]?.attributes;
  if (!a) return { enChile: false };
  const sub = subcuenca?.features?.[0]?.attributes || {};
  const nomSub = sub.NOM_SUBC || sub.NOM_SUBCUEN || sub.nom_subc || null;
  return {
    enChile: true,
    comuna: a.COMUNA,
    provincia: a.PROVINCIA,
    region: a.REGION,
    cutReg: a.CUT_REG,
    cutCom: a.CUT_COM,
    cuenca: cuenca?.features?.[0]?.attributes?.NOM_CUEN || null,
    subcuenca: nomSub,
    do: denominacionDeOrigen({ comuna: a.COMUNA, provincia: a.PROVINCIA, cutReg: a.CUT_REG }),
  };
}

// ¿Cada punto está dentro de alguna comuna? (para distinguir mar de tierra)
export async function puntosEnTierra(lls) {
  const res = await enParalelo(lls, CONCURRENCIA, (ll) => fetchJSON(urlQueryPunto(URLS.dpaComunas, ll, "OBJECTID"), 12000));
  return res.map((r) => (r.ok ? (r.v.features || []).length > 0 : null));
}

// ---------------------------------------------------------------------
//  2) USO ACTUAL DEL SUELO — Catastro de Uso de Suelo y Vegetación
//     (CONAF), síntesis nacional publicada por el MMA (SIMBIO).
// ---------------------------------------------------------------------
const limpiarUso = (s) =>
  String(s || "")
    .replace(/^\d+\.-?/, "")
    .trim()
    .toLowerCase()
    .replace(/^\w/, (x) => x.toUpperCase());

export async function pedirUsoSuelo(pts, lls) {
  const j = await fetchJSON(
    urlQueryPoligono(URLS.mmaUsoSuelo, pts, "NIVEL_1,NIVEL_2,ANIO_FUENTE", "&returnDistinctValues=true"),
    20000
  );
  const distintos = (j.features || []).map((f) => f.attributes);
  if (!distintos.length) return { clases: [], anios: [] };
  const anios = [...new Set(distintos.map((d) => d.ANIO_FUENTE).filter(Boolean))].sort();
  const niveles = [...new Set(distintos.map((d) => d.NIVEL_1))];

  let conteo = {};
  let total = lls.length;
  if (niveles.length === 1) {
    conteo[niveles[0]] = lls.length;
  } else {
    const res = await enParalelo(lls, CONCURRENCIA, (ll) =>
      fetchJSON(urlQueryPunto(URLS.mmaUsoSuelo, ll, "NIVEL_1,NIVEL_2"), 12000)
    );
    total = 0;
    for (const r of res) {
      if (!r.ok) continue;
      const a = r.v.features?.[0]?.attributes;
      if (!a) continue;
      total++;
      conteo[a.NIVEL_1] = (conteo[a.NIVEL_1] || 0) + 1;
    }
  }
  const clases = Object.entries(conteo)
    .map(([n, c]) => ({
      nombre: limpiarUso(n),
      pct: total ? (100 * c) / total : 0,
      bosque: /BOSQUE/i.test(n),
      agricola: /AGRICOLA/i.test(n),
      urbano: /URBAN/i.test(n),
    }))
    .sort((a, b) => b.pct - a.pct);
  const tiposBosque = [
    ...new Set(distintos.filter((d) => /BOSQUE/i.test(d.NIVEL_1) && /NATIVO|MIXTO/i.test(d.NIVEL_2)).map((d) => limpiarUso(d.NIVEL_2))),
  ];
  return { clases, anios, tiposBosque, hayBosqueNativo: tiposBosque.length > 0 };
}

// ---------------------------------------------------------------------
//  3) RED HIDROGRÁFICA OFICIAL (MMA): ríos, esteros, quebradas y
//     canales que cruzan el terreno.
// ---------------------------------------------------------------------
export async function pedirHidrografia(pts) {
  const j = await fetchJSON(urlQueryPoligono(URLS.mmaHidrografia, pts, "TIPO_DREN,NOMBRE"), 15000);
  const vistos = new Map();
  for (const f of j.features || []) {
    const a = f.attributes;
    const tipo = String(a.TIPO_DREN || "").trim() || "Curso de agua";
    const nombre = String(a.NOMBRE || "").trim() || null;
    const k = tipo + "|" + (nombre || "");
    // Evita "Río Río Elqui": si el nombre ya empieza con el tipo, se usa solo el nombre
    const etiqueta = nombre ? (normal(nombre).startsWith(normal(tipo)) ? nombre : `${tipo} ${nombre}`) : tipo;
    if (!vistos.has(k)) vistos.set(k, { tipo, nombre, etiqueta, artificial: /canal|zanj/i.test(tipo) });
  }
  return { cauces: [...vistos.values()] };
}

// ---------------------------------------------------------------------
//  4) LÍMITES URBANOS (MINVU — Instrumentos de Planificación Territorial)
//     Dentro del límite urbano el uso del suelo lo fija el plan regulador.
// ---------------------------------------------------------------------
const CAPAS_LU = [0, 1, 2, 3, 4];
function aLimite(layerId, a) {
  const com = a.COM || a.Comuna || "";
  const nom = a.NOM || a.LOCALIDAD || "";
  const inst = a.INSTRUM || a.Instrumento || "";
  return [nom || (com ? "Límite urbano de " + com : "Límite urbano"), inst].filter(Boolean).join(" — ");
}

export async function pedirLimiteUrbano(pts, lls) {
  const res = await Promise.all(
    CAPAS_LU.map((id) => fetchJSON(urlQueryPoligono(`${URLS.minvuLimUrbano}/${id}`, pts, "*"), 15000).then((j) => ({ id, j })))
  );
  const encontrados = [];
  const capasCon = [];
  for (const { id, j } of res) {
    if ((j.features || []).length) capasCon.push(id);
    for (const f of j.features || []) encontrados.push(aLimite(id, f.attributes));
  }
  if (!capasCon.length) return { encontrados: [], pct: 0 };
  const porPunto = await enParalelo(lls, CONCURRENCIA, async (ll) => {
    for (const id of capasCon) {
      const j = await fetchJSON(urlQueryPunto(`${URLS.minvuLimUrbano}/${id}`, ll, "OBJECTID"), 12000);
      if ((j.features || []).length) return true;
    }
    return false;
  });
  const ok = porPunto.filter((r) => r.ok);
  const pct = ok.length ? (100 * ok.filter((r) => r.v).length) / ok.length : 0;
  return { encontrados: [...new Set(encontrados)], pct, dentro: porPunto.map((r) => (r.ok ? r.v : null)) };
}

// ---------------------------------------------------------------------
//  5) ÁREAS DE RIESGO de los planes reguladores (MINVU)
//     Cobertura parcial: solo comunas cuyos planes están digitalizados.
// ---------------------------------------------------------------------
export async function pedirRiesgoIPT(pts) {
  const res = await Promise.all(
    [0, 2].map((id) => fetchJSON(urlQueryPoligono(`${URLS.minvuRiesgo}/${id}`, pts, "*"), 15000))
  );
  const vistos = new Set();
  const zonas = [];
  for (const j of res) {
    for (const f of j.features || []) {
      const a = f.attributes;
      // Verificado: NOM = nombre de la zona, CAT = tipo de riesgo
      // (inundación, remoción en masa, antrópico, etc.)
      const nombre = String(a.NOM || a.ZONA || "").trim();
      const cat = String(a.CAT || "").trim();
      const k = nombre + "|" + cat;
      if (vistos.has(k) || (!nombre && !cat)) continue;
      vistos.add(k);
      zonas.push({ nombre: nombre || "Zona de riesgo", cat: cat ? cat.toLowerCase() : null, comuna: a.COM || null });
    }
  }
  return { zonas };
}

// ---------------------------------------------------------------------
//  6) DECLARACIÓN DE AGOTAMIENTO (DGA) — aguas superficiales
//     Art. 282 del Código de Aguas: declarado el agotamiento de una
//     fuente, no pueden concederse nuevos derechos consuntivos permanentes.
// ---------------------------------------------------------------------
export async function pedirAgotamiento(pts) {
  const j = await fetchJSON(urlQueryPoligono(URLS.dgaAgotamiento, pts, "NOM_AGOTA,RES_DGA,F_RES_DGA"), 15000);
  const vistos = new Set();
  const fuentes = [];
  for (const f of j.features || []) {
    const a = f.attributes;
    if (vistos.has(a.NOM_AGOTA)) continue;
    vistos.add(a.NOM_AGOTA);
    fuentes.push({ nombre: a.NOM_AGOTA, resolucion: a.RES_DGA, fecha: a.F_RES_DGA ? fecha(a.F_RES_DGA) : null });
  }
  return {
    fuentes,
    estado: fuentes.length ? "riesgo" : "apto",
    nota: fuentes.length
      ? "Fuente superficial declarada agotada por la DGA: no se otorgan nuevos derechos consuntivos permanentes de agua superficial (Art. 282 del Código de Aguas). El riego debe venir de derechos existentes."
      : "El terreno no está en una fuente superficial declarada agotada por la DGA.",
  };
}

export { normal };
