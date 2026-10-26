// =====================================================================
//  clima.js — clima del terreno
//
//  1) BASE CONFIABLE: ARClim (Ministerio del Medio Ambiente), grilla de
//     0,05° (~5 km) referenciada a CR2MET, período 1980–2010.
//     Verificado el 26-10-2026: frente a la estación DMC de Pudahuel,
//     ARClim acierta en la mínima de enero (12,5 vs 12,2 °C), mientras
//     el reanálisis ERA5 la sobreestima en ~4 °C.
//
//  2) CLIMA ACTUAL (últimas 10 temporadas completas): CR2MET v2.5_best,
//     del Centro de Ciencia del Clima y la Resiliencia (CR)2. Es la grilla
//     OBSERVADA (estaciones DMC/DGA) en que se basa ARClim, actualizada
//     hasta el mes pasado. Se preprocesa con scripts/cr2met.py.
//
//  3) FUTURO: ARClim 2035–2065, escenarios SSP2-4.5 y SSP5-8.5.
//
//  ARClim se preprocesa con scripts/arclim.mjs → /clima/b{banda}.json;
//  CR2MET con scripts/cr2met.py → /clima/a{banda}.json (GitHub Actions).
// =====================================================================

import { fetchTimeout } from "./red.js";

const MESES = ["oct", "nov", "dec", "jan", "feb", "mar", "apr"];
const NUM_MES = [10, 11, 12, 1, 2, 3, 4];
const DIAS = [31, 30, 31, 31, 28.25, 31, 30];
// Kc de vid vinífera FAO-56 (Allen et al., 1998): 0,30 · 0,70 · 0,45, repartido por mes
const KC = [0.3, 0.43, 0.57, 0.7, 0.7, 0.58, 0.45];

const cacheBandas = new Map();
async function banda(b) {
  if (!cacheBandas.has(b)) {
    cacheBandas.set(
      b,
      fetchTimeout(`/clima/b${b}.json`, 20000).then((r) => {
        if (!r.ok) throw new Error("sin datos climáticos para esta latitud");
        return r.json();
      })
    );
  }
  try {
    return await cacheBandas.get(b);
  } catch (e) {
    cacheBandas.delete(b);
    throw e;
  }
}

async function celda(lat, lon) {
  const i0 = Math.floor(lon / 0.05 + 1e-9);
  const j0 = Math.floor(lat / 0.05 + 1e-9);
  // Celda propia y, si no existe (borde costero), la vecina más cercana
  const orden = [[0, 0]];
  for (let r = 1; r <= 2; r++)
    for (let di = -r; di <= r; di++)
      for (let dj = -r; dj <= r; dj++) if (Math.max(Math.abs(di), Math.abs(dj)) === r) orden.push([di, dj]);
  for (const [di, dj] of orden) {
    const i = i0 + di;
    const j = j0 + dj;
    const b = Math.floor(j * 0.05 + 0.025);
    let d;
    try {
      d = await banda(b);
    } catch (e) {
      continue;
    }
    const c = d.celdas[`${i},${j}`];
    if (c && c.m) {
      const obj = (arr) => (arr ? Object.fromEntries(d.campos.map((k, n) => [k, arr[n]])) : null);
      const [tm, tx, tnMar, et0, pr, heladasPrimavera, heladasAnio, diasCalurosos, lluviaAnual] = c.m;
      return {
        elev: c.e,
        vecina: di !== 0 || dj !== 0,
        clave: `${i},${j}`,
        base: { tm, tx, tnMar, et0, pr, heladasPrimavera, heladasAnio, diasCalurosos, lluviaAnual },
        f245: obj(c.f245),
        f585: obj(c.f585),
      };
    }
  }
  return null;
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

// Índices a partir de valores mensuales oct–abr (mismo cálculo que el script)
export function indicesMensuales(m, lat) {
  let gst = 0, dias = 0, gdd = 0, hi = 0, et0 = 0, etc = 0, pr = 0;
  for (let k = 0; k < 7; k++) {
    gst += m.tm[k] * DIAS[k];
    dias += DIAS[k];
    gdd += Math.max(0, m.tm[k] - 10) * DIAS[k];
    if (k < 6) hi += Math.max(0, (m.tm[k] - 10 + (m.tx[k] - 10)) / 2) * DIAS[k];
    if (m.et0) {
      et0 += m.et0[k] * DIAS[k];
      etc += m.et0[k] * DIAS[k] * KC[k];
    }
    pr += m.pr[k];
  }
  return {
    gst: gst / dias,
    gdd,
    huglin: hi * coefHuglin(lat),
    tminMar: m.tnMar,
    tmaxEnero: m.tx[3],
    tmedEnero: m.tm[3],
    et0Temp: m.et0 ? et0 : null,
    etcTemp: m.et0 ? etc : null,
    lluviaTemp: pr,
  };
}

// ---- Clima actual observado: CR2MET (últimas 10 temporadas) ---------
// Archivo /clima/a{banda}.json generado por scripts/cr2met.py con los
// datos diarios de CR2MET v2.5_best, la misma grilla en que se basa ARClim.
const cacheActual = new Map();
async function bandaActual(b) {
  if (!cacheActual.has(b)) {
    cacheActual.set(
      b,
      fetchTimeout(`/clima/a${b}.json`, 20000).then((r) => {
        if (!r.ok) throw new Error("sin clima actual");
        return r.json();
      })
    );
  }
  try {
    return await cacheActual.get(b);
  } catch (e) {
    cacheActual.delete(b);
    throw e;
  }
}

async function climaActual(clave) {
  const [, j] = clave.split(",").map(Number);
  const d = await bandaActual(Math.floor(j * 0.05 + 0.025));
  const c = d.celdas[clave];
  if (!c) return null;
  return {
    desde: d.desde,
    hasta: d.hasta,
    m: { tm: c.tm, tx: c.tx, tnMar: c.tn[5], et0: null, pr: c.pr },
    extra: { heladasPrimavera: c.hp, heladasAnio: c.ha, dias30: c.d30, dias35: c.d35, lluviaAnual: c.pa },
  };
}

// Proyección: clima actual observado + CAMBIO que proyecta ARClim entre
// 1980–2010 y 2035–2065 (método delta). Se usa el cambio y no el valor
// absoluto de ARClim porque su "presente" es el promedio de 20–30 modelos
// corregidos, que en algunas celdas difiere en más de 1 °C de lo observado.
function proyectar(mAct, base, fut, lat) {
  if (!fut) return null;
  const dT = fut.gst - base.gst;
  const dTx = fut.tmaxEnero != null && base.tmaxEnero != null ? fut.tmaxEnero - base.tmaxEnero : dT;
  const dTn = fut.tminMar != null && base.tminMar != null ? fut.tminMar - base.tminMar : dT;
  const fLluvia = base.lluviaTemp > 0 ? Math.min(3, Math.max(0, fut.lluviaTemp / base.lluviaTemp)) : 1;
  const fAnual = base.lluviaAnual > 0 ? Math.min(3, Math.max(0, fut.lluviaAnual / base.lluviaAnual)) : 1;
  const m = {
    tm: mAct.tm.map((v) => v + dT),
    tx: mAct.tx.map((v) => v + dTx),
    tnMar: mAct.tnMar + dTn,
    et0: null,
    pr: mAct.pr.map((v) => v * fLluvia),
  };
  return { r: redondear(indicesMensuales(m, lat)), fAnual };
}

// ---- Clasificaciones con fuente -------------------------------------
// Winkler en °C·día (base 10 °C, oct–abr), límites de Jones et al. (2010)
export function regionWinkler(gdd) {
  if (gdd < 1111) return { n: "<I", desc: "más fría que la Región I" };
  if (gdd < 1389) return { n: "I", desc: "la más fresca" };
  if (gdd < 1667) return { n: "II", desc: "fresca-templada" };
  if (gdd < 1944) return { n: "III", desc: "templada" };
  if (gdd < 2222) return { n: "IV", desc: "templada-cálida" };
  if (gdd < 2500) return { n: "V", desc: "cálida" };
  if (gdd <= 2778) return { n: "VI", desc: "muy cálida" };
  return { n: ">VI", desc: "más cálida que la Región VI" };
}
// Temperatura media de temporada (GST), Jones (2006)
export function claseGST(t) {
  if (t < 13) return "demasiado fría";
  if (t < 15) return "fría";
  if (t < 17) return "intermedia";
  if (t < 19) return "cálida";
  if (t < 21) return "calurosa";
  if (t <= 24) return "muy calurosa";
  return "demasiado calurosa";
}
// Índice de Huglin, Tonietto & Carbonneau (2004)
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

// Cepas con rango térmico (temperatura media de temporada) publicado EN TEXTO
// por G. V. Jones. Pinot Noir, Cabernet Franc y Cabernet Sauvignon: Jones,
// "Climate, Grapes and Wine" (VIII Congreso Int. de Terroir). Chardonnay:
// Jones (2015), GuildSomm ("~14–16 °C" en clima fresco y "~16–18 °C" en cálido).
export const CEPAS_JONES = [
  { cepa: "Pinot Noir", min: 14.0, max: 16.0 },
  { cepa: "Chardonnay", min: 14.0, max: 18.0 },
  { cepa: "Cabernet Franc", min: 15.4, max: 19.8 },
  { cepa: "Cabernet Sauvignon", min: 16.8, max: 20.2 },
];
// Margen de incertidumbre: frente a la estación de Pudahuel, ARClim
// difirió en torno a 1 °C en las máximas de enero.
export const MARGEN_CEPAS = 1.0;
export function calzaCepa(gst, c) {
  if (gst == null) return null;
  if (gst >= c.min && gst <= c.max) return "si";
  if (gst >= c.min - MARGEN_CEPAS && gst <= c.max + MARGEN_CEPAS) return "limite";
  return "no";
}

const r1 = (x) => Math.round(x * 10) / 10;
function redondear(o) {
  return {
    gst: r1(o.gst),
    gdd: Math.round(o.gdd),
    huglin: Math.round(o.huglin),
    tminMar: o.tminMar != null ? r1(o.tminMar) : null,
    tmaxEnero: o.tmaxEnero != null ? r1(o.tmaxEnero) : null,
    tmedEnero: o.tmedEnero != null ? r1(o.tmedEnero) : null,
    et0Temp: o.et0Temp != null ? Math.round(o.et0Temp) : null,
    etcTemp: o.etcTemp != null ? Math.round(o.etcTemp) : null,
    lluviaTemp: Math.round(o.lluviaTemp),
  };
}

export async function pedirClima(lat, lon) {
  const c = await celda(lat, lon);
  if (!c) throw new Error("ARClim no tiene datos para este punto");
  const b = c.base;
  const base = {
    ...redondear(indicesMensuales(b, lat)),
    heladasPrimavera: b.heladasPrimavera,
    heladasAnio: b.heladasAnio,
    diasCalurosos: b.diasCalurosos,
    lluviaAnual: b.lluviaAnual,
  };

  // Clima actual observado (CR2MET). Si no está disponible, se usa 1980–2010.
  let actual = null;
  let periodo = null;
  let f245 = c.f245;
  let f585 = c.f585;
  try {
    const a = await climaActual(c.clave);
    if (a) {
      actual = { ...redondear(indicesMensuales(a.m, lat)), ...a.extra };
      periodo = { desde: a.desde, hasta: a.hasta };
      const p245 = proyectar(a.m, base, c.f245, lat);
      const p585 = proyectar(a.m, base, c.f585, lat);
      const anual = (p) => (actual.lluviaAnual != null ? Math.round(actual.lluviaAnual * p.fAnual) : null);
      if (p245) f245 = { ...p245.r, lluviaAnual: anual(p245) };
      if (p585) f585 = { ...p585.r, lluviaAnual: anual(p585) };
    }
  } catch (e) {
    console.warn("[WineCheck] clima actual", e);
  }
  const ref = actual || base;

  let estado = "apto";
  const notas = [];
  if (ref.gst < 13) {
    estado = "veto";
    notas.push("Temperatura media de temporada bajo 13 °C: según Jones, en ese rango solo prosperan híbridos o cepas de maduración muy temprana.");
  } else if (ref.gst > 24) {
    estado = "veto";
    notas.push("Temperatura media de temporada sobre 24 °C: sobre el límite que Jones indica incluso para uva de mesa y pasas.");
  } else if (ref.gst > 21) {
    estado = "riesgo";
    notas.push("Temperatura media de temporada sobre 21 °C: Jones asocia este rango principalmente a vinos fortificados, uva de mesa y pasas.");
  } else {
    notas.push("Temperatura media de temporada dentro del rango que Jones asocia a vinos de calidad (13–21 °C).");
  }
  const hel = actual ? actual.heladasPrimavera : b.heladasPrimavera;
  if (actual && actual.dias35 != null && actual.dias35 >= 1) {
    notas.push(
      `En promedio ${actual.dias35.toLocaleString("es-CL")} días al año superan los 35 °C (dato informativo: temperaturas así reducen la fotosíntesis de la vid y pueden afectar la maduración; su efecto depende del manejo y la cepa).`
    );
  }
  if (hel != null && hel >= 1) {
    if (estado === "apto") estado = "riesgo";
    notas.push(
      actual
        ? `En ${periodo.desde}–${periodo.hasta} hubo en promedio ${hel.toLocaleString("es-CL")} días por año con mínima de 0 °C o menos entre septiembre y noviembre (brotación y floración).`
        : `En 1980–2010 hubo en promedio ${hel.toLocaleString("es-CL")} días con helada entre septiembre y noviembre (brotación y floración).`
    );
  }

  return {
    estado,
    notas,
    elevCelda: c.elev,
    vecina: c.vecina,
    base,
    actual,
    periodo,
    f245,
    f585,
    arclim: { base, f245: c.f245, f585: c.f585 },
    ref,
    gst: ref.gst,
    gdd: ref.gdd,
    huglin: ref.huglin,
    region: regionWinkler(ref.gdd),
    gstClase: claseGST(ref.gst),
    huglinClase: claseHuglin(ref.huglin),
    nochesClase: ref.tminMar != null ? claseNoches(ref.tminMar) : null,
    cepas: CEPAS_JONES.map((x) => ({ ...x, encaja: calzaCepa(ref.gst, x) })),
  };
}
