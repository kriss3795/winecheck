// =====================================================================
//  tiempo.js — agroclima oficial de CIREN y pronóstico del tiempo
// =====================================================================
import { fetchJSON } from "./red.js";
import { URLS, urlIdentifyPunto, urlQueryPunto } from "./capas.js";

// ---------------------------------------------------------------------
//  1) ZONIFICACIÓN AGROCLIMÁTICA — CIREN (estudios regionales)
//  Verificado (oct 2026): existe para Atacama (2023), Valparaíso (2021),
//  Metropolitana (2024), O'Higgins (2023) y Magallanes (2023), con clima
//  "actual", "futuro cercano" y "futuro medio".
//  Capas: actual 16,21,43,36,26 · cercano 17,22,44,37,27 · medio 18,23,45,38,28
// ---------------------------------------------------------------------
const CAPAS = {
  ac: [16, 21, 43, 36, 26],
  fc: [17, 22, 44, 37, 27],
  fm: [18, 23, 45, 38, 28],
};
const ESTUDIOS = [
  "Zonificación agroclimática Región de Atacama (CIREN, 2023)",
  "Zonificación agroclimática Región de Valparaíso (CIREN, 2021)",
  "Zonificación agroclimática Región Metropolitana (CIREN, 2024)",
  "Zonificación agroclimática Región de O'Higgins (CIREN, 2023)",
  "Zonificación agroclimática Región de Magallanes (CIREN, 2023)",
];

function leer(attrs, suf) {
  // identify entrega alias; query entrega nombres. Se aceptan ambos.
  const a = attrs || {};
  const k = (nombre, aliasRe) => {
    if (a[nombre + "_" + suf] != null) return a[nombre + "_" + suf];
    const kk = Object.keys(a).find((x) => aliasRe.test(x));
    return kk != null ? a[kk] : null;
  };
  const num = (v) => {
    const n = Number(String(v ?? "").replace(",", "."));
    return v == null || v === "" || isNaN(n) ? null : n;
  };
  return {
    sumaTermica: num(k("sut", /^Suma térmica anual/i)),
    horasFrio: num(k("hfri", /^Horas frío anual/i)),
    libreHeladas: num(k("plh", /^Período libre de heladas/i)),
    primeraHelada: k("ph", /^Primera helada/i),
    ultimaHelada: k("uh", /^Última helada/i),
    nHeladas: num(k("nh", /^Número de heladas al año/i)),
    precip: num(k("ppa", /^Precipitación total anual/i)),
    etp: num(k("etp", /^Evapotranspiración potencial.*total anual/i)),
    deficit: num(k("defh", /^Déficit hídrico anual/i)),
    tmaxEnero: num(k("txe", /^Temperatura máxima media del mes más cálido/i)),
    tminJulio: num(k("tnj", /^Temperatura mínima del mes más frío/i)),
  };
}

// Valores mensuales de ETP y precipitación (sufijos verificados en el
// servicio: en, fe, mz, ab, my, jn, jl, ag, se, oc, no, di).
const MESES = { 10: "oc", 11: "no", 12: "di", 1: "en", 2: "fe", 3: "mz", 4: "ab" };
function mensual(attrs, suf) {
  if (!attrs) return null;
  const out = {};
  for (const [m, c] of Object.entries(MESES)) {
    const etp = Number(attrs[`etp_${suf}_${c}`]);
    const ppa = Number(attrs[`ppa_${suf}_${c}`]);
    if (!isFinite(etp) || attrs[`etp_${suf}_${c}`] == null) return null;
    out[m] = { etp, ppa: isFinite(ppa) ? ppa : 0 };
  }
  return out;
}

export async function pedirAgroclimaCIREN(centro) {
  // "identify" solo devuelve la capa del clima actual (verificado), así
  // que las capas futuras se consultan con "query" en la misma región.
  const j = await fetchJSON(urlIdentifyPunto(URLS.cirenAgroclima, centro, "all:" + CAPAS.ac.join(",")), 15000);
  const ac = (j.results || []).find((r) => CAPAS.ac.includes(r.layerId));
  if (!ac) return { disponible: false };
  const i = CAPAS.ac.indexOf(ac.layerId);
  const [acq, fc, fm] = await Promise.all(
    [CAPAS.ac[i], CAPAS.fc[i], CAPAS.fm[i]].map((id) =>
      fetchJSON(urlQueryPunto(`${URLS.cirenAgroclima}/${id}`, centro, "*"), 15000)
        .then((q) => q.features?.[0]?.attributes || null)
        .catch(() => null)
    )
  );
  const a = ac.attributes || {};
  const kz = Object.keys(a).find((x) => /^nombrezona$|^Nombre de la zona/i.test(x));
  return {
    disponible: true,
    zona: kz ? a[kz] : null,
    estudio: ESTUDIOS[i],
    actual: { ...leer(a, "ac"), mensual: mensual(acq, "ac") },
    cercano: fc ? leer(fc, "fc") : null,
    medio: fm ? leer(fm, "fm") : null,
  };
}

// ---------------------------------------------------------------------
//  2) PRONÓSTICO 16 DÍAS — Open-Meteo (modelos de servicios
//     meteorológicos nacionales, combinados automáticamente)
// ---------------------------------------------------------------------
export async function pedirPronostico([lat, lon]) {
  const url =
    `${URLS.pronostico}?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_gusts_10m_max,et0_fao_evapotranspiration` +
    `&current=temperature_2m,relative_humidity_2m,wind_speed_10m,precipitation` +
    `&forecast_days=16&timezone=America%2FSantiago`;
  const j = await fetchJSON(url, 15000);
  const d = j.daily;
  if (!d?.time?.length) throw new Error("sin pronóstico");
  const dias = d.time.map((t, i) => ({
    fecha: t,
    tmax: d.temperature_2m_max[i],
    tmin: d.temperature_2m_min[i],
    lluvia: d.precipitation_sum[i],
    prob: d.precipitation_probability_max?.[i],
    rafaga: d.wind_gusts_10m_max?.[i],
    et0: d.et0_fao_evapotranspiration?.[i],
    helada: d.temperature_2m_min[i] != null && d.temperature_2m_min[i] <= 0,
    riesgoHelada: d.temperature_2m_min[i] != null && d.temperature_2m_min[i] > 0 && d.temperature_2m_min[i] <= 2,
  }));
  return {
    actual: j.current
      ? {
          temp: j.current.temperature_2m,
          humedad: j.current.relative_humidity_2m,
          viento: j.current.wind_speed_10m,
          lluvia: j.current.precipitation,
          hora: j.current.time,
        }
      : null,
    dias,
    heladas: dias.filter((x) => x.helada).length,
    riesgoHeladas: dias.filter((x) => x.riesgoHelada).length,
  };
}

// ---------------------------------------------------------------------
//  3) WINDY — mapa del tiempo embebido (pronóstico interactivo)
// ---------------------------------------------------------------------
export function urlWindy([lat, lon], capa = "temp", zoom = 9) {
  const p = new URLSearchParams({
    type: "map",
    location: "coordinates",
    metricRain: "mm",
    metricTemp: "°C",
    metricWind: "km/h",
    zoom: String(zoom),
    overlay: capa,
    product: "ecmwf",
    level: "surface",
    lat: lat.toFixed(4),
    lon: lon.toFixed(4),
    detailLat: lat.toFixed(4),
    detailLon: lon.toFixed(4),
    detail: "true",
    marker: "true",
    message: "true",
  });
  return "https://embed.windy.com/embed.html?" + p.toString();
}
export function urlWindyCompleto([lat, lon], capa = "temp") {
  return `https://www.windy.com/${lat.toFixed(3)}/${lon.toFixed(3)}?${capa},${lat.toFixed(3)},${lon.toFixed(3)},9`;
}
