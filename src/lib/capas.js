// =====================================================================
//  capas.js — consultas a cada fuente oficial
//
//  Regla de oro: si una fuente FALLA, la función LANZA un error.
//  Nunca se interpreta un fallo como "no hay nada aquí".
//  Los nombres de campos fueron verificados contra cada servicio
//  (octubre 2026).
// =====================================================================

import { fetchJSON, fetchTimeout, viaProxy, enParalelo } from "./red.js";
import { anilloArcGIS, caja, dentro, lineaTocaPoligono } from "./geometria.js";

export const URLS = {
  clima: "https://archive-api.open-meteo.com/v1/archive",
  elevacion: "https://api.open-meteo.com/v1/elevation",
  cirenSuelos: "https://esri.ciren.cl/server/rest/services/IDEMINAGRI/SUELOS_AGROLOGICOS/MapServer",
  cirenErosion: "https://esri.ciren.cl/server/rest/services/IDEMINAGRI/EROSION/MapServer",
  cirenAgroclima: "https://esri.ciren.cl/server/rest/services/IDEMINAGRI/AGROCLIMA_IDEMINAGRI/MapServer",
  dgaAgotamiento: "https://rest-sit.mop.gob.cl/arcgis/rest/services/DGA/Declaracion_de_Agotamiento/MapServer/0",
  dpaComunas: "https://rest-sit.mop.gob.cl/arcgis/rest/services/INTEROP/SERVICIO_DPA/MapServer/1",
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
  overpass: "https://overpass-api.de/api/interpreter",
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
  if (!s || indices.length < 3) return { estado: "nd", nota: "Terreno demasiado pequeño para estimar pendiente." };
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
//  2) CLIMA — ERA5-Land (Copernicus/ECMWF) vía Open-Meteo, 10 temporadas
// =====================================================================
// Última temporada completa (oct–abr). ERA5 se publica con ~5 días de
// retraso, así que una temporada se considera cerrada desde el 10 de mayo.
function temporadaFinal(hoy = new Date()) {
  const y = hoy.getFullYear();
  return hoy >= new Date(y, 4, 10) ? y : y - 1;
}

// Coeficiente de largo del día del índice de Huglin (Tonietto & Carbonneau, 2004)
function coefHuglin(lat) {
  const a = Math.abs(lat);
  if (a <= 40) return 1.0;
  if (a <= 42) return 1.02;
  if (a <= 44) return 1.03;
  if (a <= 46) return 1.04;
  if (a <= 48) return 1.05;
  return 1.06;
}

// Clases de Winkler en °C-día (Amerine & Winkler 1944; tabla de Jones et al.)
export function regionWinkler(gdd) {
  if (gdd < 1111) return { n: "<I", desc: "más fría que la Región I" };
  if (gdd < 1389) return { n: "I", desc: "fría" };
  if (gdd < 1667) return { n: "II", desc: "templada-fría" };
  if (gdd < 1944) return { n: "III", desc: "templada" };
  if (gdd < 2222) return { n: "IV", desc: "templada-cálida" };
  if (gdd < 2500) return { n: "V", desc: "cálida" };
  if (gdd <= 2778) return { n: "VI", desc: "muy cálida" };
  return { n: ">VI", desc: "más cálida que la Región VI" };
}
// Temperatura media de temporada (GST), clases de Jones (2006)
export function claseGST(t) {
  if (t < 13) return "demasiado fría";
  if (t < 15) return "fría";
  if (t < 17) return "intermedia";
  if (t < 19) return "cálida";
  if (t < 21) return "calurosa";
  if (t <= 24) return "muy calurosa";
  return "demasiado calurosa";
}
// Índice de Huglin, clases de Tonietto & Carbonneau (2004)
export function claseHuglin(h) {
  if (h <= 1500) return "muy fresco";
  if (h <= 1800) return "fresco";
  if (h <= 2100) return "templado";
  if (h <= 2400) return "templado cálido";
  if (h <= 3000) return "cálido";
  return "muy cálido";
}
// Índice de frío nocturno (mínima media de marzo), Tonietto & Carbonneau (2004)
export function claseNoches(t) {
  if (t <= 12) return "noches muy frías";
  if (t <= 14) return "noches frías";
  if (t <= 18) return "noches templadas";
  return "noches cálidas";
}

// Cepas con rango térmico publicado en texto por G. V. Jones.
// Solo se incluyen cepas cuyo rango numérico está escrito en la fuente;
// el resto del gráfico de Jones no se transcribe para no inventar cifras.
// Coeficiente de cultivo de vid vinífera, FAO-56 (Allen et al., 1998),
// Tabla 12: Kc ini 0,30 · Kc med 0,70 · Kc fin 0,45. Se reparte por mes
// para el hemisferio sur: brotación (oct), desarrollo (nov–dic, lineal),
// mediados de temporada (ene–feb) y final (mar–abr).
export const KC_VID = { 10: 0.3, 11: 0.43, 12: 0.57, 1: 0.7, 2: 0.7, 3: 0.58, 4: 0.45 };

export const CEPAS_JONES = [
  { cepa: "Pinot Noir", min: 14.0, max: 16.0, ref: "jones2006" },
  { cepa: "Chardonnay", min: 14.0, max: 18.0, ref: "jones2015" },
  { cepa: "Cabernet Franc", min: 15.4, max: 19.8, ref: "jones2006" },
  { cepa: "Cabernet Sauvignon", min: 16.8, max: 20.2, ref: "jones2006" },
];

export async function pedirClima(lat, lon) {
  const fin = temporadaFinal();
  const ini = fin - 10;
  const comun =
    `${URLS.clima}?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&start_date=${ini}-05-01&end_date=${fin}-04-30&timezone=America%2FSantiago`;
  const urlT = comun + "&daily=temperature_2m_max,temperature_2m_min";
  // Verificado: ERA5-Land vía Open-Meteo no entrega precipitación diaria,
  // así que la lluvia se toma de ERA5 (misma fuente Copernicus, ~28 km).
  // También de ERA5: evapotranspiración de referencia FAO-56 (ET0) y
  // radiación solar (verificado: ERA5-Land no las entrega vía Open-Meteo).
  const urlP = comun + "&daily=precipitation_sum,et0_fao_evapotranspiration,shortwave_radiation_sum&models=era5";

  const nulos = (j) => {
    const t = j?.daily?.temperature_2m_max || [];
    return t.length ? t.filter((v) => v == null).length / t.length : 1;
  };
  const pedirTemperaturas = async () => {
    try {
      const j = await fetchJSON(urlT + "&models=era5_land", 25000);
      if (nulos(j) > 0.2) throw new Error("ERA5-Land sin datos en este punto");
      return { j, modelo: "ERA5-Land" };
    } catch (e) {
      // En la costa ERA5-Land puede no tener dato: se usa ERA5 (más gruesa)
      const j = await fetchJSON(urlT + "&models=era5", 25000);
      if (nulos(j) > 0.2) throw new Error("sin datos climáticos para este punto");
      return { j, modelo: "ERA5" };
    }
  };
  const [{ j, modelo }, jp] = await Promise.all([pedirTemperaturas(), fetchJSON(urlP, 25000).catch(() => null)]);
  const lluviaPorDia = new Map();
  const et0PorDia = new Map();
  const radPorDia = new Map();
  if (jp?.daily?.time)
    jp.daily.time.forEach((t, i) => {
      lluviaPorDia.set(t, jp.daily.precipitation_sum[i]);
      et0PorDia.set(t, jp.daily.et0_fao_evapotranspiration?.[i]);
      radPorDia.set(t, jp.daily.shortwave_radiation_sum?.[i]);
    });

  const d = j.daily;
  const T = {}; // acumuladores por temporada (año de inicio, octubre)
  const get = (y) =>
    (T[y] = T[y] || { gdd: 0, sumMed: 0, nMed: 0, hug: 0, nMin3: 0, sMin3: 0, heladas: 0, lluviaTemp: 0, nLluTemp: 0, lluviaVend: 0, lluviaAnual: 0, nAnual: 0, et0: 0, etc: 0, nEt: 0, rad: 0, nRad: 0, dias35: 0, heladasInv: 0 });

  for (let i = 0; i < d.time.length; i++) {
    const [yy, mm, dd] = d.time[i].split("-").map(Number);
    const tx = d.temperature_2m_max[i];
    const tn = d.temperature_2m_min[i];
    const pp = lluviaPorDia.has(d.time[i]) ? lluviaPorDia.get(d.time[i]) : null;
    const anioAgri = mm >= 5 ? yy : yy - 1; // año agrícola mayo–abril
    if (pp != null) {
      get(anioAgri).lluviaAnual += pp;
      get(anioAgri).nAnual++;
    }
    if (tx == null || tn == null) continue;
    const tm = (tx + tn) / 2;

    if (mm >= 10 || mm <= 4) {
      const t = get(mm >= 10 ? yy : yy - 1);
      t.gdd += Math.max(0, tm - 10);
      t.sumMed += tm;
      t.nMed++;
      if (pp != null) {
        t.lluviaTemp += pp;
        t.nLluTemp++;
      }
      if (mm >= 3 && mm <= 4 && pp != null) t.lluviaVend += pp;
      const e0 = et0PorDia.get(d.time[i]);
      if (e0 != null) {
        t.et0 += e0;
        t.etc += e0 * KC_VID[mm];
        t.nEt++;
      }
      const rd = radPorDia.get(d.time[i]);
      if (rd != null) {
        t.rad += rd;
        t.nRad++;
      }
      if (tx >= 35) t.dias35++;
      if (mm !== 4) t.hug += Math.max(0, (tm - 10 + (tx - 10)) / 2);
      if (mm === 3) {
        t.sMin3 += tn;
        t.nMin3++;
      }
    }
    // Heladas primaverales: 15 sep – 30 nov (brotación y floración)
    if ((mm === 9 && dd >= 15) || mm === 10 || mm === 11) {
      if (tn <= 0) get(yy).heladas++;
    }
  }

  const k = coefHuglin(lat);
  const validas = [];
  for (let y = ini; y < fin; y++) {
    const t = T[y];
    if (t && t.nMed >= 0.95 * 212) validas.push({ anio: y, ...t });
  }
  if (!validas.length) throw new Error("datos climáticos incompletos");

  const prom = (f) => validas.reduce((a, t) => a + f(t), 0) / validas.length;
  const gddLista = validas.map((t) => t.gdd);
  const gdd = prom((t) => t.gdd);
  const gst = prom((t) => t.sumMed / t.nMed);
  const huglin = prom((t) => t.hug) * k;
  const noches = prom((t) => (t.nMin3 ? t.sMin3 / t.nMin3 : NaN));
  const heladas = prom((t) => t.heladas);
  const aniosConHelada = validas.filter((t) => t.heladas > 0).length;
  const anuales = validas.filter((t) => t.nAnual >= 360);
  const lluviaAnual = anuales.length ? anuales.reduce((a, t) => a + t.lluviaAnual, 0) / anuales.length : null;
  const conLluvia = validas.filter((t) => t.nLluTemp >= 0.95 * 212);
  const promLluvia = (f) => (conLluvia.length ? conLluvia.reduce((a, t) => a + f(t), 0) / conLluvia.length : null);
  const conEt = validas.filter((t) => t.nEt >= 0.95 * 212 && t.nLluTemp >= 0.95 * 212);
  const promEt = (f) => (conEt.length ? conEt.reduce((a, t) => a + f(t), 0) / conEt.length : null);
  const et0Temp = promEt((t) => t.et0);
  const etcTemp = promEt((t) => t.etc);
  const lluviaParaRiego = promEt((t) => t.lluviaTemp);
  const deficit = etcTemp != null ? Math.max(0, etcTemp - lluviaParaRiego) : null;
  const conRad = validas.filter((t) => t.nRad >= 0.95 * 212);
  const radMedia = conRad.length ? conRad.reduce((a, t) => a + t.rad / t.nRad, 0) / conRad.length : null;

  // Estado (criterios con fuente)
  let estado = "apto";
  const notas = [];
  if (gst < 13) {
    estado = "veto";
    notas.push("Temperatura media de temporada bajo 13 °C: según Jones (2006), en ese rango solo prosperan híbridos o cepas de maduración muy temprana.");
  } else if (gst > 24) {
    estado = "veto";
    notas.push("Temperatura media de temporada sobre 24 °C: fuera del rango de producción de uva para vino (Jones, 2006).");
  } else if (gst > 21) {
    estado = "riesgo";
    notas.push("Temperatura media de temporada sobre 21 °C: Jones (2006) asocia este rango a vinos fortificados, uva de mesa y pasas.");
  } else {
    notas.push(`Temperatura media de temporada dentro del rango de vinos de calidad (13–21 °C, Jones 2006).`);
  }
  if (estado === "apto" && (gdd < 1111 || gdd > 2778)) {
    estado = "riesgo";
    notas.push("Grados-día fuera de las regiones de Winkler I a VI.");
  }
  if (heladas >= 1) {
    if (estado === "apto") estado = "riesgo";
    notas.push(
      `Riesgo de heladas primaverales: en promedio ${fmt(heladas, 1)} días con mínima ≤ 0 °C entre el 15 de septiembre y el 30 de noviembre (brotación-floración), con heladas en ${aniosConHelada} de ${validas.length} temporadas.`
    );
  }

  return {
    estado,
    notas,
    modelo,
    temporadas: validas.length,
    desde: validas[0].anio,
    hasta: validas[validas.length - 1].anio + 1,
    gdd,
    gddMin: Math.min(...gddLista),
    gddMax: Math.max(...gddLista),
    region: regionWinkler(gdd),
    gst,
    gstClase: claseGST(gst),
    huglin,
    huglinClase: claseHuglin(huglin),
    noches,
    nochesClase: isFinite(noches) ? claseNoches(noches) : null,
    heladas,
    aniosConHelada,
    lluviaTemp: promLluvia((t) => t.lluviaTemp),
    lluviaVend: promLluvia((t) => t.lluviaVend),
    lluviaAnual,
    et0Temp,
    etcTemp,
    deficit,
    radMedia,
    dias35: prom((t) => t.dias35),
    // "límite": a menos de 0,5 °C del rango (incertidumbre típica del reanálisis)
    cepas: CEPAS_JONES.map((c) => ({
      ...c,
      encaja: gst >= c.min && gst <= c.max ? "si" : gst >= c.min - 0.5 && gst <= c.max + 0.5 ? "limite" : "no",
    })),
  };
}

// =====================================================================
//  3) SUELO — CIREN, capacidad de uso (clases I–VIII)
// =====================================================================
export const CLASES_SUELO = {
  I: { estado: "apto", titulo: "Clase I", desc: "Suelo arable prácticamente sin limitaciones de uso." },
  II: { estado: "apto", titulo: "Clase II", desc: "Suelo arable con limitaciones ligeras; requiere prácticas de manejo sencillas." },
  III: { estado: "apto", titulo: "Clase III", desc: "Suelo arable con limitaciones moderadas que restringen la elección de cultivos o exigen prácticas de conservación." },
  IV: { estado: "riesgo", titulo: "Clase IV", desc: "Suelo arable con limitaciones severas; uso ocasional o muy restringido de cultivos y manejo cuidadoso." },
  V: { estado: "riesgo", titulo: "Clase V", desc: "Suelo no arable, generalmente plano, con limitaciones difíciles de corregir (drenaje, inundación, pedregosidad); apto para praderas." },
  VI: { estado: "riesgo", titulo: "Clase VI", desc: "Suelo no arable con limitaciones severas; apto para pastoreo o uso forestal." },
  VII: { estado: "veto", titulo: "Clase VII", desc: "Suelo no arable con limitaciones muy severas; uso forestal o de protección." },
  VIII: { estado: "veto", titulo: "Clase VIII", desc: "Sin valor agrícola, ganadero ni forestal; destinado a vida silvestre, recreación o protección." },
};
export const SUBCLASES = {
  e: "erosión o riesgo de erosión",
  w: "exceso de humedad o drenaje deficiente",
  s: "limitaciones del suelo en la zona de raíces (profundidad, pedregosidad, salinidad u otras)",
  c: "limitaciones de clima",
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
  const pctVIIVIII = pctDe(["VII", "VIII"]);
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
//  8) CUERPOS DE AGUA Y CAUCES — OpenStreetMap (control cruzado)
//  - Lagos, ríos (como superficie), embalses y tranques: se marca qué
//    puntos del terreno caen SOBRE el agua (superficie no plantable).
//  - Ríos y esteros como línea: advertencia si cruzan el terreno.
//  - Canales y acequias: NO restringen; se informan (útiles para riego).
// =====================================================================
const igual = (a, b) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;

function unirAnillos(segmentos) {
  const pend = segmentos.filter((s) => s.length >= 2).map((s) => s.slice());
  const anillos = [];
  while (pend.length) {
    let a = pend.shift();
    let cambio = true;
    while (!igual(a[0], a[a.length - 1]) && cambio) {
      cambio = false;
      for (let i = 0; i < pend.length; i++) {
        const s = pend[i];
        const fin = a[a.length - 1];
        if (igual(fin, s[0])) a = a.concat(s.slice(1));
        else if (igual(fin, s[s.length - 1])) a = a.concat(s.slice(0, -1).reverse());
        else if (igual(a[0], s[s.length - 1])) a = s.slice(0, -1).concat(a);
        else if (igual(a[0], s[0])) a = s.slice(1).reverse().concat(a);
        else continue;
        pend.splice(i, 1);
        cambio = true;
        break;
      }
    }
    if (a.length >= 4 && igual(a[0], a[a.length - 1])) anillos.push(a);
  }
  return anillos;
}

function tipoAgua(tags) {
  const w = tags.water;
  if (tags.landuse === "reservoir" || ["reservoir", "pond", "basin", "wastewater", "reflecting_pool"].includes(w))
    return { tipo: "embalse o tranque", artificial: true };
  if (w === "river" || w === "stream" || w === "canal") return { tipo: "cauce de río", artificial: w === "canal" };
  if (w === "lagoon") return { tipo: "laguna", artificial: false };
  return { tipo: "lago o laguna", artificial: false };
}

// Overpass es un servicio comunitario que a veces se satura: se prueban
// varios servidores públicos y, al final, el principal vía nuestro proxy.
const SERVIDORES_OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
async function consultarOverpass(q) {
  // Se consultan todos a la vez y se usa la primera respuesta válida,
  // con un máximo de 15 s, para que OSM nunca frene el análisis.
  const data = "?data=" + encodeURIComponent(q);
  const urls = [...SERVIDORES_OVERPASS.map((u) => u + data), viaProxy(URLS.overpass + data)];
  return new Promise((resolve, reject) => {
    let pendientes = urls.length;
    let listo = false;
    const fallo = () => {
      pendientes--;
      if (!pendientes && !listo) {
        listo = true;
        reject(new Error("ningún servidor de OpenStreetMap respondió"));
      }
    };
    urls.forEach((u) =>
      fetchTimeout(u, 15000)
        .then(async (r) => {
          if (!r.ok) throw new Error("Overpass HTTP " + r.status);
          const j = await r.json();
          if (!Array.isArray(j.elements)) throw new Error("respuesta inválida");
          if (j.remark && /error|timed out/i.test(j.remark)) throw new Error(j.remark);
          if (!listo) {
            listo = true;
            resolve(j);
          }
        })
        .catch(fallo)
    );
  });
}

export async function pedirOSM(pts, lls) {
  const b = caja(pts, 0.0015);
  const bb = `${b.s},${b.o},${b.n},${b.e}`;
  const q =
    `[out:json][timeout:25];(` +
    `way["natural"="water"](${bb});relation["natural"="water"](${bb});` +
    `way["landuse"="reservoir"](${bb});` +
    `way["waterway"~"^(river|stream|canal|ditch|drain)$"](${bb});` +
    `);out geom;`;
  const j = await consultarOverpass(q);

  const superficies = [];
  const cauces = [];
  for (const el of j.elements || []) {
    const tags = el.tags || {};
    if (el.type === "way" && tags.waterway) {
      const linea = (el.geometry || []).map((g) => [g.lat, g.lon]);
      if (linea.length < 2) continue;
      const natural = tags.waterway === "river" || tags.waterway === "stream";
      cauces.push({
        nombre: tags.name || null,
        tipo: { river: "río", stream: "estero o arroyo", canal: "canal", ditch: "acequia", drain: "dren" }[tags.waterway],
        natural,
        dentro: lineaTocaPoligono(linea, pts),
      });
    } else if (el.type === "way" && el.geometry) {
      const ring = el.geometry.map((g) => [g.lat, g.lon]);
      if (ring.length >= 4 && igual(ring[0], ring[ring.length - 1])) superficies.push({ anillos: [ring], tags });
    } else if (el.type === "relation") {
      const segs = (el.members || [])
        .filter((m) => m.type === "way" && m.role !== "inner" && m.geometry)
        .map((m) => m.geometry.map((g) => [g.lat, g.lon]));
      const anillos = unirAnillos(segs);
      if (anillos.length) superficies.push({ anillos, tags });
    }
  }

  const aguaPorPunto = lls.map((ll) => {
    for (const s of superficies) {
      if (s.anillos.some((r) => dentro(ll, r))) {
        return { ...tipoAgua(s.tags), nombre: s.tags.name || null };
      }
    }
    return null;
  });

  // Resumen de cauces (sin duplicar tramos del mismo nombre/tipo)
  const resumen = new Map();
  for (const c of cauces) {
    const k = (c.nombre || "") + "|" + c.tipo;
    const prev = resumen.get(k);
    if (!prev) resumen.set(k, { ...c });
    else prev.dentro = prev.dentro || c.dentro;
  }
  return { aguaPorPunto, cauces: [...resumen.values()] };
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
