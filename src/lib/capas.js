// =====================================================================
//  capas.js — consultas a cada fuente oficial
//
//  Regla de oro: si una fuente FALLA, la función LANZA un error.
//  Nunca se interpreta un fallo como "no hay nada aquí".
//  Los nombres de campos fueron verificados contra cada servicio
//  (octubre 2026).
// =====================================================================

import { fetchJSON, enParalelo } from "./red.js";
import { anilloArcGIS, caja } from "./geometria.js";

export const URLS = {
  elevacion: "https://api.open-meteo.com/v1/elevation",
  cirenSuelos: "https://esri.ciren.cl/server/rest/services/IDEMINAGRI/SUELOS_AGROLOGICOS/MapServer",
  cirenErosion: "https://esri.ciren.cl/server/rest/services/IDEMINAGRI/EROSION/MapServer",
  cirenAgroclima: "https://esri.ciren.cl/server/rest/services/IDEMINAGRI/AGROCLIMA_IDEMINAGRI/MapServer",
  dgaAgotamiento: "https://rest-sit.mop.gob.cl/arcgis/rest/services/DGA/Declaracion_de_Agotamiento/MapServer/0",
  dpaComunas: "https://rest-sit.mop.gob.cl/arcgis/rest/services/INTEROP/SERVICIO_DPA/MapServer/1",
  mmaComunas: "https://arcgis.mma.gob.cl/server/rest/services/SIMBIO/SIMBIO_DIVISION_ADMINISTRATIVA/MapServer/2",
  mmaCuencas: "https://arcgis.mma.gob.cl/server/rest/services/SIMBIO/SIMBIO_DIVISION_CUENCA/MapServer",
  mmaHidrografia: "https://arcgis.mma.gob.cl/server/rest/services/SIMBIO/SIMBIO_HIDROGRAFIA/MapServer/0",
  mmaUsoSuelo: "https://arcgis.mma.gob.cl/server/rest/services/SIMBIO/SIMBIO_CATASTRO_BN/MapServer/0",
  minvuLimUrbano: "https://geoide.minvu.cl/server/rest/services/IPT/Limites_Urbanos/MapServer",
  minvuRiesgo: "https://geoide.minvu.cl/server/rest/services/IPT/IPT_AREA_RIESGO/MapServer",
  soilgrids: "https://rest.isric.org/soilgrids/v2.0/properties/query",
  pronostico: "https://api.open-meteo.com/v1/forecast",
  dgaAgua:
    "https://rest-sit.mop.gob.cl/arcgis/rest/services/DGA/Areas_de_Restriccion_y_Zonas_de_Prohibicion/MapServer/0",
  dgaEscasez: "https://rest-sit.mop.gob.cl/arcgis/rest/services/DGA/Decretos_Escasez_Hidrica/MapServer/0",
  mmaHumedales: "https://arcgis.mma.gob.cl/server/rest/services/SIMBIO/SIMBIO_HUMEDALES/MapServer/0",
  smaProteccion: "https://ideserver.sma.gob.cl/arcgis/rest/services/IDE/Areas_proteccion_oficial2/MapServer",
  nominatim: "https://nominatim.openstreetmap.org/search",
};

export const CONCURRENCIA = 6;
const fmt = (n, d = 0) =>
  n == null || !isFinite(n) ? "—" : Number(n).toLocaleString("es-CL", { maximumFractionDigits: d, minimumFractionDigits: d });
const fecha = (ms) => (ms ? new Date(ms).toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" }) : "—");

// ---------------------------------------------------------------------
//  Constructores de consultas ArcGIS
// ---------------------------------------------------------------------
export function geomPoligono(pts) {
  return JSON.stringify({ rings: [anilloArcGIS(pts)], spatialReference: { wkid: 4326 } });
}
export function urlQueryPoligono(base, pts, campos, extra = "") {
  return (
    `${base}/query?geometry=${encodeURIComponent(geomPoligono(pts))}` +
    `&geometryType=esriGeometryPolygon&inSR=4326&spatialRel=esriSpatialRelIntersects` +
    `&outFields=${campos}&returnGeometry=false&f=json${extra}`
  );
}
export function urlQueryPunto(base, [lat, lon], campos) {
  return (
    `${base}/query?geometry=${lon.toFixed(6)},${lat.toFixed(6)}` +
    `&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects` +
    `&outFields=${campos}&returnGeometry=false&f=json`
  );
}

// =====================================================================
//  1) ELEVACIÓN — Copernicus DEM GLO-90 (vía Open-Meteo)
// =====================================================================
export async function pedirElevaciones(lls) {
  const out = [];
  for (let k = 0; k < lls.length; k += 100) {
    const t = lls.slice(k, k + 100);
    const url =
      `${URLS.elevacion}?latitude=${t.map((p) => p[0].toFixed(5)).join(",")}` +
      `&longitude=${t.map((p) => p[1].toFixed(5)).join(",")}`;
    const j = await fetchJSON(url, 15000);
    if (!Array.isArray(j.elevation) || j.elevation.length !== t.length)
      throw new Error("respuesta de elevación incompleta");
    out.push(...j.elevation);
  }
  return out;
}

// Clases de pendiente: FAO, Guidelines for Soil Description (2006), Tabla 7
export function claseFAO(p) {
  if (p <= 2) return "plano a casi plano";
  if (p <= 5) return "suavemente inclinado";
  if (p <= 10) return "inclinado";
  if (p <= 15) return "fuertemente inclinado";
  if (p <= 30) return "moderadamente escarpado";
  if (p <= 60) return "escarpado";
  return "muy escarpado";
}

const RUMBOS = ["Norte", "Noreste", "Este", "Sureste", "Sur", "Suroeste", "Oeste", "Noroeste"];

export function calcularPendiente(grid, elev, indices) {
  const s = grid.espaciado;
  if (!s || indices.length < 3) return { estado: "nd", nota: "Muy poca superficie disponible para estimar la pendiente." };
  const mapa = new Map();
  grid.puntos.forEach((p, k) => mapa.set(p.i + "," + p.j, k));

  // Pendiente local en cada punto (diferencias con los vecinos de la grilla)
  const locales = [];
  for (const k of indices) {
    const p = grid.puntos[k];
    const deriv = (di, dj) => {
      const a = mapa.get(p.i + di + "," + (p.j + dj));
      const b = mapa.get(p.i - di + "," + (p.j - dj));
      if (a != null && b != null) return (elev[a] - elev[b]) / (2 * s);
      if (a != null) return (elev[a] - elev[k]) / s;
      if (b != null) return (elev[k] - elev[b]) / s;
      return null;
    };
    const gx = deriv(1, 0);
    const gy = deriv(0, 1);
    if (gx == null && gy == null) continue;
    locales.push(Math.hypot(gx || 0, gy || 0) * 100);
  }
  if (!locales.length) return { estado: "nd", nota: "No se pudo estimar la pendiente." };

  // Plano de ajuste (mínimos cuadrados) para la exposición general
  let n = 0, sx = 0, sy = 0, sz = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0;
  for (const k of indices) {
    const { x, y } = grid.puntos[k];
    const z = elev[k];
    n++; sx += x; sy += y; sz += z; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z;
  }
  const mx = sx / n, my = sy / n, mz = sz / n;
  const cxx = sxx / n - mx * mx, cyy = syy / n - my * my, cxy = sxy / n - mx * my;
  const cxz = sxz / n - mx * mz, cyz = syz / n - my * mz;
  const det = cxx * cyy - cxy * cxy;
  let exposicion = null;
  let pendPlano = null;
  if (Math.abs(det) > 1e-9) {
    const a = (cxz * cyy - cyz * cxy) / det; // dz/dx (hacia el este)
    const b = (cyz * cxx - cxz * cxy) / det; // dz/dy (hacia el norte)
    pendPlano = Math.hypot(a, b) * 100;
    if (pendPlano >= 2) {
      const az = ((Math.atan2(-a, -b) * 180) / Math.PI + 360) % 360; // dirección hacia donde baja
      exposicion = RUMBOS[Math.round(az / 45) % 8];
    }
  }

  const orden = [...locales].sort((x, y) => x - y);
  const media = locales.reduce((a, v) => a + v, 0) / locales.length;
  const pct = (u) => (100 * locales.filter((v) => v > u).length) / locales.length;
  const e = indices.map((k) => elev[k]);

  let estado = "apto";
  let nota = `Pendiente media ${fmt(media)}% (${claseFAO(media)}, clases FAO).`;
  if (media > 60) {
    estado = "veto";
    nota += " Terreno muy escarpado: no apto para establecer viña.";
  } else if (media > 30 || pct(30) >= 30) {
    estado = "riesgo";
    nota += " Sectores escarpados: requiere terrazas o plantación en curvas de nivel; mecanización muy limitada.";
  } else if (media > 15) {
    estado = "riesgo";
    nota += " Pendiente moderada: considerar manejo de erosión y limitaciones de maquinaria.";
  }

  let notaExposicion = null;
  if (exposicion) {
    if (/^(Norte|Noreste|Noroeste)$/.test(exposicion))
      notaExposicion = "En el hemisferio sur, las laderas con exposición norte reciben más radiación solar.";
    else if (/^(Sur|Sureste|Suroeste)$/.test(exposicion))
      notaExposicion = "En el hemisferio sur, las laderas con exposición sur reciben menos radiación solar (sitios más frescos).";
  }

  return {
    estado,
    nota,
    media,
    p90: orden[Math.floor(0.9 * (orden.length - 1))],
    pct15: pct(15),
    pct30: pct(30),
    exposicion,
    notaExposicion,
    elevMin: Math.min(...e),
    elevMax: Math.max(...e),
    resolucionBaja: s < 90,
  };
}

// =====================================================================
//  2) RIEGO — FAO-56 con datos de ARClim (y CIREN donde existe)
// =====================================================================
// Kc de vid vinífera, FAO-56 (Allen et al., 1998), Tabla 12:
// 0,30 (inicial) · 0,70 (mediados) · 0,45 (final).
export const KC_VID = { 10: 0.3, 11: 0.43, 12: 0.57, 1: 0.7, 2: 0.7, 3: 0.58, 4: 0.45 };

// Usa ARClim (todo Chile). Si hay estudio agroclimático de CIREN, se
// entrega también como comparación (fuente oficial local).
export function calcularRiego(clima, agroclima) {
  const out = {};
  if (clima && clima.presente && clima.presente.etcTemp != null) {
    const p = clima.presente;
    out.arclim = { et0: p.et0Temp, etc: p.etcTemp, lluvia: p.lluviaTemp, deficit: Math.max(0, p.etcTemp - p.lluviaTemp) };
    const f = clima.f245;
    if (f && f.etcTemp != null) out.futuro = { etc: f.etcTemp, lluvia: f.lluviaTemp, deficit: Math.max(0, f.etcTemp - f.lluviaTemp) };
  }
  const m = agroclima?.disponible ? agroclima.actual?.mensual : null;
  if (m) {
    let et0 = 0;
    let etc = 0;
    let lluvia = 0;
    for (const [mes, v] of Object.entries(m)) {
      et0 += v.etp;
      etc += v.etp * KC_VID[mes];
      lluvia += v.ppa;
    }
    out.ciren = { et0, etc, lluvia, deficit: Math.max(0, etc - lluvia), estudio: agroclima.estudio };
  }
  if (!out.arclim && !out.ciren) return null;
  out.principal = out.arclim || out.ciren;
  return out;
}

// =====================================================================
//  3) SUELO — CIREN, capacidad de uso (clases I–VIII)
// =====================================================================
// Descripciones resumidas de la "Pauta para Estudio de Suelos" del SAG
// (versión modificada 2016). El semáforo de cada clase es criterio de
// WineCheck para viña, no una norma oficial.
export const CLASES_SUELO = {
  I: { estado: "apto", titulo: "Clase I", desc: "Arable, con pocas limitaciones. Suelos planos o casi planos, profundos, bien drenados, sin pedregosidad ni erosión; aptos para uso agrícola intensivo." },
  II: { estado: "apto", titulo: "Clase II", desc: "Arable, con ligeras limitaciones (por ejemplo, pendiente de hasta 5%, profundidad no menor a 70 cm o drenaje moderado); pueden requerir prácticas de conservación." },
  III: { estado: "apto", titulo: "Clase III", desc: "Arable, con limitaciones al laboreo (pendientes cercanas al 8% o hasta 15% de pedregosidad superficial); pueden limitar especies de raíces profundas y exigen prácticas de conservación." },
  IV: { estado: "riesgo", titulo: "Clase IV", desc: "Última clase arable: riesgo de erosión por pendiente (hasta 15%) o profundidad no mayor a 40 cm, pedregosidad o drenaje imperfecto; requiere prácticas de conservación." },
  V: { estado: "veto", titulo: "Clase V", desc: "No arable: suelos depresionales inundados, con drenaje muy pobre e inundación permanente y vegetación de suelos saturados." },
  VI: { estado: "riesgo", titulo: "Clase VI", desc: "No arable para laboreo (principalmente por pendiente, pedregosidad o erosión severa); su uso normal es ganadero y forestal." },
  VII: { estado: "veto", titulo: "Clase VII", desc: "No arable, con limitaciones muy severas que lo hacen inadecuado para cultivos (escarpado, muy delgado o muy pedregoso); uso de pastoreo y forestal." },
  VIII: { estado: "veto", titulo: "Clase VIII", desc: "Sin valor agrícola, ganadero ni forestal; uso limitado a vida silvestre, recreación o protección de cuencas." },
};
export const SUBCLASES = {
  e: "riesgo o efectos de erosión",
  w: "humedad (drenaje)",
  s: "limitaciones del suelo",
  c: "clima",
};
export const ORDEN_CLASES = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"];

// Verificado (oct 2026): el servicio de CIREN tiene UNA CAPA POR REGIÓN
// (0 = Atacama, 1 = Coquimbo, 2 = Valparaíso, 3 = Metropolitana, ...).
// La versión anterior consultaba solo la capa 0 (Atacama): por eso fuera
// de Atacama el suelo salía siempre "sin dato". Ahora se usa "identify"
// sobre todas las capas regionales. El campo de la clase es "textcaus"
// (en identify llega con su alias). "N.C." = no clasificado.
function leerCampoClase(attrs) {
  const claves = Object.keys(attrs || {});
  const k =
    claves.find((x) => x.toLowerCase() === "textcaus") ||
    claves.find((x) => /capacidad de uso/i.test(x));
  if (k && attrs[k] != null && String(attrs[k]).trim() !== "") return String(attrs[k]).trim();
  return null;
}
export function parseClase(raw) {
  if (!raw) return null;
  const t = String(raw).toUpperCase().replace(/^CLASE\s*/, "").trim();
  const m = t.match(/^(VIII|VII|VI|V|IV|III|II|I)(?![IVX])\s*([EWSC]*)/);
  if (!m) return null;
  return { clase: m[1], sub: m[2].toLowerCase().split("").filter((x) => SUBCLASES[x]) };
}

export function urlIdentifyPunto(base, [lat, lon], capas = "all", margen = 0.01) {
  return (
    `${base}/identify?geometry=${lon.toFixed(6)},${lat.toFixed(6)}&geometryType=esriGeometryPoint` +
    `&sr=4326&layers=${capas}&tolerance=0` +
    `&mapExtent=${(lon - margen).toFixed(5)},${(lat - margen).toFixed(5)},${(lon + margen).toFixed(5)},${(lat + margen).toFixed(5)}` +
    `&imageDisplay=400,400,96&returnGeometry=false&f=json`
  );
}

export async function pedirSuelo(lls) {
  const consulta = (ll) => fetchJSON(urlIdentifyPunto(URLS.cirenSuelos, ll), 12000);
  // Sonda: si CIREN no responde el primer punto, se avisa de inmediato
  // en vez de esperar el tiempo límite en cada uno de los puntos.
  let primero;
  try {
    primero = { ok: true, v: await consulta(lls[0]) };
  } catch (e) {
    throw new Error("el servidor de CIREN no respondió");
  }
  const resto = await enParalelo(lls.slice(1), CONCURRENCIA, consulta);
  const res = [primero, ...resto];
  const fallos = res.filter((r) => !r.ok).length;

  const conteo = {};
  const subclases = new Set();
  const estudios = new Set();
  let noClasif = 0;
  let sinCobertura = 0;
  for (const r of res) {
    if (!r.ok) continue;
    const f = r.v.results || [];
    if (!f.length) {
      sinCobertura++;
      continue;
    }
    if (f[0].layerName) estudios.add(f[0].layerName);
    const raw = leerCampoClase(f[0].attributes);
    const c = parseClase(raw);
    if (!c) {
      noClasif++;
      continue;
    }
    conteo[c.clase] = (conteo[c.clase] || 0) + 1;
    c.sub.forEach((s) => subclases.add(s));
  }
  const clasificados = Object.values(conteo).reduce((a, v) => a + v, 0);
  const conDato = clasificados + noClasif;
  if (!clasificados) {
    return {
      estado: "nd",
      clases: [],
      nota: noClasif
        ? "CIREN marca estos puntos como \"N.C.\" (no clasificados en el estudio agrológico)."
        : "El estudio agrológico de CIREN no cubre este lugar. CIREN no tiene estudio para las regiones de Arica y Parinacota, Tarapacá y Antofagasta, y dentro de cada región cubre principalmente las zonas agrícolas.",
      fallos,
      estudios: [...estudios],
    };
  }

  const clases = ORDEN_CLASES.filter((c) => conteo[c]).map((c) => ({
    clase: c,
    ...CLASES_SUELO[c],
    pct: (100 * conteo[c]) / conDato,
  }));
  const pctNC = (100 * noClasif) / conDato;
  const pctDe = (lista) => clases.filter((c) => lista.includes(c.clase)).reduce((a, c) => a + c.pct, 0);
  const pctVIIVIII = pctDe(["V", "VII", "VIII"]);
  const pctIVmas = pctDe(["IV", "V", "VI", "VII", "VIII"]);
  let estado = "apto";
  if (pctVIIVIII >= 50) estado = "veto";
  else if (pctIVmas >= 25 || pctVIIVIII >= 10) estado = "riesgo";

  return {
    estado,
    clases,
    pctNC,
    subclases: [...subclases].map((s) => ({ s, desc: SUBCLASES[s] })),
    pctVIIVIII,
    pctIVmas,
    muestras: conDato,
    fallos,
    sinCobertura,
    estudios: [...estudios],
  };
}

// =====================================================================
//  4) AGUA SUBTERRÁNEA — DGA, SHAC: abierto / restricción / prohibición
// =====================================================================
const RANGO_AGUA = { "zona de prohibicion": 3, "area de restriccion": 2, abierto: 1 };
const normal = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export async function pedirAgua(pts) {
  const j = await fetchJSON(urlQueryPoligono(URLS.dgaAgua, pts, "TIPO_LIMIT,SHAC,NOM_ACUIF"), 15000);
  const feats = (j.features || []).map((f) => f.attributes);
  if (!feats.length) {
    return {
      estado: "nd",
      zonas: [],
      nota: "El terreno no está dentro de ningún Sector Hidrogeológico de Aprovechamiento Común (SHAC) delimitado por la DGA: no hay información administrativa de agua subterránea para este lugar.",
    };
  }
  const vistos = new Set();
  const zonas = [];
  for (const a of feats) {
    const key = a.SHAC + "|" + a.TIPO_LIMIT;
    if (vistos.has(key)) continue;
    vistos.add(key);
    zonas.push({ tipo: a.TIPO_LIMIT, shac: a.SHAC, acuifero: a.NOM_ACUIF, rango: RANGO_AGUA[normal(a.TIPO_LIMIT)] || 0 });
  }
  zonas.sort((x, y) => y.rango - x.rango);
  const peor = zonas[0];
  let estado = "apto";
  let nota;
  if (peor.rango === 3) {
    estado = "riesgo";
    nota = "Zona de Prohibición: la DGA no otorga nuevos derechos de aprovechamiento de agua subterránea en este sector. Para regar se deben adquirir derechos existentes o usar agua superficial.";
  } else if (peor.rango === 2) {
    estado = "riesgo";
    nota = "Área de Restricción: la DGA solo puede otorgar derechos provisionales de agua subterránea, sujetos a la disponibilidad del acuífero.";
  } else if (peor.rango === 1) {
    nota = "Sector abierto: se pueden solicitar nuevos derechos de agua subterránea, sujeto a disponibilidad y a la tramitación ante la DGA.";
  } else {
    estado = "nd";
    nota = `Tipo de límite no reconocido: "${peor.tipo}".`;
  }
  return { estado, zonas, nota };
}

// =====================================================================
//  5) ESCASEZ HÍDRICA — DGA, decretos
//  Verificado: el campo VIGENTE de la capa no es confiable (hay
//  decretos marcados "SI" ya caducados). La vigencia se decide por
//  FECHA_CADUCIDAD > hoy. También se mide qué tan actualizada está la capa.
// =====================================================================
export async function pedirEscasez(pts) {
  const urlQ = urlQueryPoligono(
    URLS.dgaEscasez,
    pts,
    "NUM_DECRETO,ANO_DECRETO,FECHA_DECRETO,FECHA_CADUCIDAD,COMUNA,NOM_TERRITORIO"
  );
  const stats =
    `${URLS.dgaEscasez}/query?where=1%3D1&outStatistics=` +
    encodeURIComponent(JSON.stringify([{ statisticType: "max", onStatisticField: "FECHA_DECRETO", outStatisticFieldName: "ULTIMO" }])) +
    `&f=json`;
  const [j, s] = await Promise.all([fetchJSON(urlQ, 15000), fetchJSON(stats, 15000).catch(() => null)]);

  const ahora = Date.now();
  const ultimoCapa = s?.features?.[0] ? Object.values(s.features[0].attributes)[0] : null;
  const capaActualizada = ultimoCapa && ahora - ultimoCapa < 365 * 864e5;

  const vistos = new Set();
  const decretos = [];
  for (const f of j.features || []) {
    const a = f.attributes;
    const key = a.NUM_DECRETO + "-" + a.ANO_DECRETO;
    if (vistos.has(key)) continue;
    vistos.add(key);
    decretos.push({
      num: a.NUM_DECRETO,
      anio: a.ANO_DECRETO,
      desde: a.FECHA_DECRETO,
      hasta: a.FECHA_CADUCIDAD,
      lugar: a.COMUNA && a.COMUNA !== "No Aplica" ? a.COMUNA : a.NOM_TERRITORIO,
      vigente: a.FECHA_CADUCIDAD ? a.FECHA_CADUCIDAD > ahora : false,
    });
  }
  decretos.sort((x, y) => (y.desde || 0) - (x.desde || 0));
  const vigentes = decretos.filter((d) => d.vigente);
  const hace10 = new Date().getFullYear() - 10;
  const aniosRecientes = new Set(decretos.filter((d) => d.anio >= hace10).map((d) => d.anio));
  const recurrente = aniosRecientes.size >= 3;

  let estado;
  let nota;
  if (vigentes.length) {
    estado = "riesgo";
    nota = `Decreto de escasez hídrica vigente (${vigentes
      .map((d) => `N° ${d.num}/${d.anio}, hasta ${fecha(d.hasta)}`)
      .join("; ")}). Durante su vigencia la autoridad puede redistribuir y restringir extracciones.`;
  } else if (capaActualizada) {
    estado = "apto";
    nota = "Sin decretos de escasez hídrica vigentes según la DGA.";
  } else {
    estado = "nd";
    nota = `La capa de la DGA no registra decretos vigentes para este terreno, pero su decreto más reciente es del ${fecha(
      ultimoCapa
    )}: podría no incluir decretos posteriores. Verifica en el sitio de la DGA antes de concluir.`;
  }
  return { estado, nota, decretos, vigentes, recurrente, aniosRecientes: aniosRecientes.size, ultimoCapa, capaActualizada };
}

// =====================================================================
//  6) HUMEDALES — MMA, Inventario Nacional de Humedales
//  Campo de nombre verificado: NOM_HUMDET. ORDEN_1: 10 = artificial.
// =====================================================================
const ORDEN1 = { 10: "artificial", 20: "continental", 30: "marino o costero", 999: "sin clasificar" };

function aHumedal(a) {
  return {
    nombre: a.NOM_HUMDET && String(a.NOM_HUMDET).trim() ? String(a.NOM_HUMDET).trim() : "sin nombre",
    tipo: ORDEN1[a.ORDEN_1] || "sin clasificar",
    artificial: a.ORDEN_1 === 10,
  };
}

export async function pedirHumedales(pts, lls) {
  const j = await fetchJSON(urlQueryPoligono(URLS.mmaHumedales, pts, "NOM_HUMDET,ORDEN_1"), 15000);
  const feats = (j.features || []).map((f) => aHumedal(f.attributes));
  if (!feats.length) return { encontrados: [], porPunto: lls.map(() => []), fallosPunto: 0 };

  const res = await enParalelo(lls, CONCURRENCIA, (ll) => fetchJSON(urlQueryPunto(URLS.mmaHumedales, ll, "NOM_HUMDET,ORDEN_1"), 12000));
  const porPunto = res.map((r) => (r.ok ? (r.v.features || []).map((f) => aHumedal(f.attributes)) : null));
  const vistos = new Set();
  const encontrados = feats.filter((h) => {
    const k = h.nombre + "|" + h.tipo;
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
  return { encontrados, porPunto, fallosPunto: porPunto.filter((p) => p === null).length };
}

// =====================================================================
//  7) ÁREAS PROTEGIDAS — SMA, "Áreas de protección oficial"
//  Verificado: el servicio tiene una capa por categoría. Se consultan
//  todas con "identify" y se separan en veto / advertencia.
// =====================================================================
export const SMA_VETO = {
  1: "Santuario de la Naturaleza (CMN)",
  30: "Humedal urbano declarado (Ley 21.202)",
  31: "Área marina costera protegida",
  32: "Área marina protegida",
  34: "Monumento Natural",
  35: "Parque Nacional",
  36: "Parque marino",
  38: "Reserva marina",
  39: "Reserva Nacional",
  40: "Santuario de la Naturaleza",
  41: "Área del SNASPE",
  42: "Sitio RAMSAR",
};
export const SMA_ADVERTENCIA = {
  0: "Monumento histórico (CMN)",
  2: "Zona típica (CMN)",
  3: "Acuífero protegido (DGA)",
  33: "Bien Nacional Protegido",
  37: "Reserva Forestal",
  43: "Zona de conservación histórica (MINVU)",
  44: "Zona de Interés Turístico (SERNATUR)",
};
for (let id = 5; id <= 29; id++) SMA_ADVERTENCIA[id] = "Zona de protección en instrumento de planificación territorial";

const IDS_SMA = [...Object.keys(SMA_VETO), ...Object.keys(SMA_ADVERTENCIA)].map(Number);

// El "value" de identify es el campo de despliegue de cada capa, que a
// veces es una URL o la superficie (verificado). Se prefiere un campo
// de nombre real (NombreOrig, NOMBRE_TOT, Nombre, ...).
function nombreSMA(r) {
  const a = r.attributes || {};
  const util = (v) => v != null && String(v).trim() && !/^(null|<null>)$/i.test(String(v).trim());
  const k = Object.keys(a).find((x) => /^(nombreorig|nombre_tot|nombre|nom_|nom$)/i.test(x) && util(a[x]));
  if (k) return String(a[k]).trim();
  const v = r.value;
  if (util(v) && !/^https?:/i.test(v) && isNaN(Number(v))) return String(v).trim();
  return null;
}
function aProteccion(r) {
  const veto = SMA_VETO[r.layerId] != null;
  const categoria = SMA_VETO[r.layerId] || SMA_ADVERTENCIA[r.layerId] || r.layerName;
  const nombre = nombreSMA(r);
  return {
    capa: r.layerId,
    veto,
    categoria,
    nombre: nombre || r.layerName,
    etiqueta: nombre ? `${categoria}: ${nombre}` : categoria,
  };
}

function urlIdentify(geom, tipo, b, ids) {
  return (
    `${URLS.smaProteccion}/identify?geometry=${encodeURIComponent(geom)}&geometryType=${tipo}` +
    `&sr=4326&layers=all:${ids.join(",")}&tolerance=0` +
    `&mapExtent=${b.o},${b.s},${b.e},${b.n}&imageDisplay=800,800,96&returnGeometry=false&f=json`
  );
}

export async function pedirProtegidas(pts, lls) {
  const b = caja(pts, 0.001);
  const j = await fetchJSON(urlIdentify(geomPoligono(pts), "esriGeometryPolygon", b, IDS_SMA), 20000);
  const vistos = new Set();
  const encontradas = [];
  for (const r of j.results || []) {
    const p = aProteccion(r);
    if (vistos.has(p.etiqueta)) continue;
    vistos.add(p.etiqueta);
    encontradas.push(p);
  }
  if (!encontradas.length) return { encontradas: [], porPunto: lls.map(() => []), fallosPunto: 0 };

  const ids = [...new Set(encontradas.map((p) => p.capa))];
  const res = await enParalelo(lls, CONCURRENCIA, (ll) =>
    fetchJSON(urlIdentify(`${ll[1].toFixed(6)},${ll[0].toFixed(6)}`, "esriGeometryPoint", b, ids), 15000)
  );
  const porPunto = res.map((r) => (r.ok ? (r.v.results || []).map(aProteccion) : null));
  return { encontradas, porPunto, fallosPunto: porPunto.filter((p) => p === null).length };
}

// =====================================================================
//  9) BUSCADOR DE LUGARES — Nominatim (OpenStreetMap)
// =====================================================================
export async function buscarLugar(texto) {
  if (!texto || !texto.trim()) return null;
  const url = `${URLS.nominatim}?format=json&limit=1&countrycodes=cl&q=${encodeURIComponent(texto)}`;
  const j = await fetchJSON(url, 10000);
  if (Array.isArray(j) && j.length) {
    return { lat: parseFloat(j[0].lat), lon: parseFloat(j[0].lon), nombre: j[0].display_name };
  }
  return null;
}

export { fmt, fecha, normal };
