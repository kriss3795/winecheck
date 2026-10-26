// =====================================================================
//  suelo.js — erosión (CIREN) y propiedades del suelo (ISRIC SoilGrids)
// =====================================================================
import { fetchJSON } from "./red.js";
import { URLS, urlIdentifyPunto } from "./capas.js";

// ---------------------------------------------------------------------
//  1) EROSIÓN — CIREN (erosión actual, riesgo actual y riesgo potencial)
//  Verificado: capas 1–16 = erosión actual por región, 18–33 = riesgo
//  de erosión actual, 35 en adelante = riesgo de erosión potencial.
//  En "identify" los campos llegan con su alias ("Descripción clase…").
// ---------------------------------------------------------------------
function descClase(attrs) {
  const k = Object.keys(attrs || {}).find((x) => /^Descripci[oó]n clase/i.test(x));
  const v = k ? String(attrs[k] || "").trim() : "";
  return v && !/^null$/i.test(v) ? v.toLowerCase() : null;
}

export async function pedirErosion(centro) {
  const j = await fetchJSON(urlIdentifyPunto(URLS.cirenErosion, centro), 15000);
  const out = { actual: null, riesgoActual: null, riesgoPotencial: null };
  for (const r of j.results || []) {
    const d = descClase(r.attributes);
    if (!d) continue;
    if (r.layerId >= 1 && r.layerId <= 16 && !out.actual) out.actual = d;
    else if (r.layerId >= 18 && r.layerId <= 33 && !out.riesgoActual) out.riesgoActual = d;
    else if (r.layerId >= 35 && !out.riesgoPotencial) out.riesgoPotencial = d;
  }
  const severa = /sever|muy sever|grave/i;
  const moderada = /moderad/i;
  let estado = "apto";
  if (severa.test(out.actual || "") || severa.test(out.riesgoActual || "")) estado = "riesgo";
  else if (moderada.test(out.actual || "")) estado = "riesgo";
  out.estado = out.actual || out.riesgoActual ? estado : "nd";
  return out;
}

// ---------------------------------------------------------------------
//  2) PROPIEDADES DEL SUELO — ISRIC SoilGrids 2.0 (mapa global, 250 m)
//  Poggio et al. (2021), SOIL 7: 217–240. Es una ESTIMACIÓN MODELADA:
//  sirve para orientar, no reemplaza el análisis de laboratorio.
//  Límite de uso del servicio: 5 consultas por minuto (se hace 1 por análisis).
// ---------------------------------------------------------------------
const PROFUNDIDADES = ["0-5cm", "5-15cm", "15-30cm", "30-60cm", "60-100cm"];
const ESPESOR = { "0-5cm": 5, "5-15cm": 10, "15-30cm": 15, "30-60cm": 30, "60-100cm": 40 };

// Clase textural USDA a partir de % arena, limo y arcilla
export function texturaUSDA(arena, limo, arcilla) {
  if (limo + 1.5 * arcilla < 15) return "arenosa";
  if (limo + 1.5 * arcilla >= 15 && limo + 2 * arcilla < 30) return "arenosa franca";
  if ((arcilla >= 7 && arcilla < 20 && arena > 52 && limo + 2 * arcilla >= 30) || (arcilla < 7 && limo < 50 && limo + 2 * arcilla >= 30))
    return "franco arenosa";
  if (arcilla >= 7 && arcilla < 27 && limo >= 28 && limo < 50 && arena <= 52) return "franca";
  if ((limo >= 50 && arcilla >= 12 && arcilla < 27) || (limo >= 50 && limo < 80 && arcilla < 12)) return "franco limosa";
  if (limo >= 80 && arcilla < 12) return "limosa";
  if (arcilla >= 20 && arcilla < 35 && limo < 28 && arena > 45) return "franco arcillo arenosa";
  if (arcilla >= 27 && arcilla < 40 && arena > 20 && arena <= 45) return "franco arcillosa";
  if (arcilla >= 27 && arcilla < 40 && arena <= 20) return "franco arcillo limosa";
  if (arcilla >= 35 && arena > 45) return "arcillo arenosa";
  if (arcilla >= 40 && limo >= 40) return "arcillo limosa";
  if (arcilla >= 40 && arena <= 45 && limo < 40) return "arcillosa";
  return "sin clasificar";
}

export function clasePH(ph) {
  // Rangos de reacción del suelo (USDA, Soil Survey Manual)
  if (ph < 4.5) return "extremadamente ácido";
  if (ph < 5.1) return "muy fuertemente ácido";
  if (ph < 5.6) return "fuertemente ácido";
  if (ph < 6.1) return "moderadamente ácido";
  if (ph < 6.6) return "ligeramente ácido";
  if (ph < 7.4) return "neutro";
  if (ph < 7.9) return "ligeramente alcalino";
  if (ph < 8.5) return "moderadamente alcalino";
  if (ph < 9.1) return "fuertemente alcalino";
  return "muy fuertemente alcalino";
}

export async function pedirSoilGrids([lat, lon]) {
  const props = ["phh2o", "clay", "sand", "silt", "cfvo"];
  const url =
    `${URLS.soilgrids}?lon=${lon.toFixed(5)}&lat=${lat.toFixed(5)}` +
    props.map((p) => `&property=${p}`).join("") +
    PROFUNDIDADES.map((d) => `&depth=${d}`).join("") +
    `&value=mean`;
  let j;
  try {
    j = await fetchJSON(url, 25000);
  } catch (e) {
    // El servicio limita a 5 consultas por minuto: se reintenta una vez
    // (solo ante errores de red o del servicio, no por falta de datos)
    await new Promise((r) => setTimeout(r, 12000));
    j = await fetchJSON(url, 25000);
  }
  const capas = j?.properties?.layers || [];
  if (!capas.length) throw new Error("SoilGrids sin datos");

  // Promedio ponderado por espesor para 0–30 cm y 30–100 cm
  const valor = (nombre, rango) => {
    const l = capas.find((x) => x.name === nombre);
    if (!l) return null;
    const f = l.unit_measure?.d_factor || 1;
    let s = 0;
    let w = 0;
    for (const d of l.depths || []) {
      if (!rango.includes(d.label)) continue;
      const v = d.values?.mean;
      if (v == null) continue;
      s += (v / f) * ESPESOR[d.label];
      w += ESPESOR[d.label];
    }
    return w ? s / w : null;
  };
  const sup = ["0-5cm", "5-15cm", "15-30cm"];
  const sub = ["30-60cm", "60-100cm"];
  const hacer = (rango) => {
    const arcilla = valor("clay", rango);
    const arena = valor("sand", rango);
    const limo = valor("silt", rango);
    const ph = valor("phh2o", rango);
    if (arcilla == null || arena == null || limo == null) return null;
    // Normaliza a 100% (los mapas se predicen por separado)
    const t = arcilla + arena + limo;
    const [ar, li, ac] = [(100 * arena) / t, (100 * limo) / t, (100 * arcilla) / t];
    return {
      arena: ar,
      limo: li,
      arcilla: ac,
      textura: texturaUSDA(ar, li, ac),
      ph: ph != null ? Math.round(ph * 10) / 10 : null,
      phClase: ph != null ? clasePH(Math.round(ph * 10) / 10) : null,
      // Unidades tras aplicar d_factor (verificado): cfvo en cm³/100 cm³ (= % de volumen).
      pedregosidad: valor("cfvo", rango),
    };
  };
  const superficial = hacer(sup);
  // Sin estimación (zona urbana, roca o agua): no es una falla del servicio
  if (!superficial) return { sinDatos: true, superficial: null, subsuelo: null };
  return { superficial, subsuelo: hacer(sub) };
}
