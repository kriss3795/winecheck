// =====================================================================
//  clima.js — clima del terreno desde ARClim (Ministerio del Medio Ambiente)
//
//  POR QUÉ ARClim Y NO ERA5 (verificado el 26-10-2026):
//  Se comparó el reanálisis ERA5/ERA5-Land con la estación DMC de
//  Pudahuel y con los estudios agroclimáticos de CIREN. En el valle
//  central ERA5 sobreestima la temperatura mínima de verano en ~4 °C
//  (enero: 16,1 °C en ERA5-Land contra 12,2 °C en la estación), lo que
//  inflaba la temperatura media de temporada en ~2 °C. ARClim, que está
//  referenciado a CR2MET (producto grillado basado en estaciones chilenas),
//  dio 12,5 °C, prácticamente igual a la estación.
//
//  Los datos se preprocesan con scripts/arclim.mjs (GitHub Actions) y se
//  publican en /clima/b{banda}.json: una celda de 0,05° (~5 km) con los
//  índices de presente (1980–2010) y futuro (2035–2065, SSP2-4.5 y SSP5-8.5).
// =====================================================================

import { fetchTimeout } from "./red.js";

const cacheBandas = new Map();

async function banda(b) {
  if (!cacheBandas.has(b)) {
    cacheBandas.set(
      b,
      fetchTimeout(`/clima/b${b}.json`, 15000).then((r) => {
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
    for (let di = -r; di <= r; di++) for (let dj = -r; dj <= r; dj++) if (Math.max(Math.abs(di), Math.abs(dj)) === r) orden.push([di, dj]);
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
    if (c) {
      const obj = (arr) => (arr ? Object.fromEntries(d.campos.map((k, n) => [k, arr[n]])) : null);
      return { elev: c.e, vecina: di !== 0 || dj !== 0, presente: obj(c.p), f245: obj(c.f245), f585: obj(c.f585) };
    }
  }
  return null;
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

export async function pedirClima(lat, lon) {
  const c = await celda(lat, lon);
  if (!c || !c.presente || c.presente.gst == null) throw new Error("ARClim no tiene datos para este punto");
  const p = c.presente;

  let estado = "apto";
  const notas = [];
  if (p.gst < 13) {
    estado = "veto";
    notas.push("Temperatura media de temporada bajo 13 °C: según Jones, en ese rango solo prosperan híbridos o cepas de maduración muy temprana.");
  } else if (p.gst > 24) {
    estado = "veto";
    notas.push("Temperatura media de temporada sobre 24 °C: sobre el límite que Jones indica incluso para uva de mesa y pasas.");
  } else if (p.gst > 21) {
    estado = "riesgo";
    notas.push("Temperatura media de temporada sobre 21 °C: Jones asocia este rango principalmente a vinos fortificados, uva de mesa y pasas.");
  } else {
    notas.push("Temperatura media de temporada dentro del rango que Jones asocia a vinos de calidad (13–21 °C).");
  }
  if (p.heladasPrimavera >= 1) {
    if (estado === "apto") estado = "riesgo";
    notas.push(`En promedio ${p.heladasPrimavera.toLocaleString("es-CL")} días con helada entre septiembre y noviembre (brotación y floración).`);
  }

  const cepas = CEPAS_JONES.map((x) => ({
    ...x,
    encaja:
      p.gst >= x.min && p.gst <= x.max
        ? "si"
        : p.gst >= x.min - MARGEN_CEPAS && p.gst <= x.max + MARGEN_CEPAS
        ? "limite"
        : "no",
  }));

  return {
    estado,
    notas,
    elevCelda: c.elev,
    vecina: c.vecina,
    presente: p,
    f245: c.f245,
    f585: c.f585,
    gst: p.gst,
    gdd: p.gdd,
    huglin: p.huglin,
    region: regionWinkler(p.gdd),
    gstClase: claseGST(p.gst),
    huglinClase: claseHuglin(p.huglin),
    nochesClase: p.tminMar != null ? claseNoches(p.tminMar) : null,
    cepas,
  };
}
