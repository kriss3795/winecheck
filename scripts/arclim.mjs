// =====================================================================
//  scripts/arclim.mjs — construye public/clima/*.json desde ARClim (MMA)
//  Fuente: Atlas de Riesgos Climáticos (ARClim), Ministerio del Medio
//  Ambiente. Grilla de 0,05° (~5 km) referenciada a CR2MET.
//  Histórico 1980–2010; futuro 2035–2065 (CMIP6, SSP2-4.5 y SSP5-8.5).
//  Se ejecuta en GitHub Actions (node scripts/arclim.mjs).
// =====================================================================
import fs from "node:fs";

const API = "https://arclim.mma.gob.cl/api/datos/arclim_raster_5km";
const MESES = ["oct", "nov", "dec", "jan", "feb", "mar", "apr"];
const DIAS = { oct: 31, nov: 30, dec: 31, jan: 31, feb: 28.25, mar: 31, apr: 30 };
const KC = { oct: 0.3, nov: 0.43, dec: 0.57, jan: 0.7, feb: 0.7, mar: 0.58, apr: 0.45 };

async function get(url, intentos = 4) {
  for (let i = 0; i < intentos; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(240000) });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } catch (e) {
      console.log("reintento", i + 1, e.message);
      await new Promise((s) => setTimeout(s, 5000));
    }
  }
  throw new Error("falló " + url);
}

function atributos(per) {
  const a = [];
  for (const m of MESES) a.push(`$CLIMA$mean_temperature$${m}$${per}`, `$CLIMA$eto_mean$${m}$${per}`, `$CLIMA$pr_sum$${m}$${per}`);
  for (const m of MESES.slice(0, 6)) a.push(`$CLIMA$tasmax_mean$${m}$${per}`);
  a.push(`$CLIMA$tasmin_mean$mar$${per}`, `$CLIMA$frost_days$son$${per}`, `$CLIMA$frost_days$annual$${per}`, `$CLIMA$hot_days$annual$${per}`, `$CLIMA$pr_sum$annual$${per}`);
  return a;
}

async function tabla(attrs) {
  const out = new Map();
  for (let i = 0; i < attrs.length; i += 12) {
    const grupo = attrs.slice(i, i + 12);
    const j = await get(`${API}/json/?attributes=id,${encodeURIComponent(grupo.join(","))}`);
    const cols = j.data.columns;
    for (const fila of j.data.values) {
      const id = fila[0];
      if (!out.has(id)) out.set(id, {});
      const o = out.get(id);
      cols.forEach((c, k) => {
        if (k > 0) o[c] = fila[k];
      });
    }
    console.log("ok", grupo.length, "atributos");
  }
  return out;
}

function coefHuglin(lat) {
  const a = Math.abs(lat);
  if (a <= 40) return 1.0;
  if (a <= 42) return 1.02;
  if (a <= 44) return 1.03;
  if (a <= 46) return 1.04;
  if (a <= 48) return 1.05;
  return 1.06;
}

function indices(o, per, lat) {
  const v = (n, m) => o[`$CLIMA$${n}$${m}$${per}`];
  const tm = MESES.map((m) => v("mean_temperature", m));
  if (tm.some((x) => x == null || isNaN(x))) return null;
  let gst = 0, gdd = 0, hi = 0, et0 = 0, etc = 0, pr = 0, dias = 0;
  MESES.forEach((m, k) => {
    gst += tm[k] * DIAS[m];
    dias += DIAS[m];
    gdd += Math.max(0, tm[k] - 10) * DIAS[m];
    if (m !== "apr") hi += Math.max(0, (tm[k] - 10 + (v("tasmax_mean", m) - 10)) / 2) * DIAS[m];
    et0 += (v("eto_mean", m) || 0) * DIAS[m];
    etc += (v("eto_mean", m) || 0) * DIAS[m] * KC[m];
    pr += v("pr_sum", m) || 0;
  });
  const r1 = (x) => (x == null || isNaN(x) ? null : Math.round(x * 10) / 10);
  const r0 = (x) => (x == null || isNaN(x) ? null : Math.round(x));
  return [
    r1(gst / dias), r0(gdd), r0(hi * coefHuglin(lat)), r1(v("tasmin_mean", "mar")),
    r1(v("frost_days", "son")), r1(v("frost_days", "annual")), r1(v("hot_days", "annual")),
    r0(et0), r0(etc), r0(pr), r0(v("pr_sum", "annual")),
    r1(v("tasmax_mean", "jan")), r1(v("mean_temperature", "jan")),
  ];
}

const geo = await get(`${API}/geojson/?attributes=id,elev`);
const celdas = geo.data.features.map((f) => {
  const c = f.geometry.coordinates[0];
  const lo = Math.min(...c.map((p) => p[0]));
  const la = Math.min(...c.map((p) => p[1]));
  return { id: f.properties.id, i: Math.round(lo / 0.05), j: Math.round(la / 0.05), lat: la + 0.025, elev: f.properties.elev };
});
console.log("celdas", celdas.length);

const per = { p: "present", f245: "future$ssp245", f585: "future$ssp585" };
const datos = {};
for (const [k, p] of Object.entries(per)) datos[k] = await tabla(atributos(p));

const bandas = {};
for (const c of celdas) {
  const fila = { e: Math.round(c.elev) };
  for (const k of Object.keys(per)) {
    const o = datos[k].get(c.id);
    fila[k] = o ? indices(o, per[k], c.lat) : null;
  }
  if (!fila.p) continue;
  const b = Math.floor(c.lat);
  (bandas[b] = bandas[b] || {})[`${c.i},${c.j}`] = fila;
}
fs.mkdirSync("public/clima", { recursive: true });
const campos = ["gst", "gdd", "huglin", "tminMar", "heladasPrimavera", "heladasAnio", "diasCalurosos", "et0Temp", "etcTemp", "lluviaTemp", "lluviaAnual", "tmaxEnero", "tmedEnero"];
for (const [b, cel] of Object.entries(bandas)) {
  fs.writeFileSync(`public/clima/b${b}.json`, JSON.stringify({ campos, celdas: cel }));
}
fs.writeFileSync(
  "public/clima/meta.json",
  JSON.stringify({
    fuente: "ARClim — Atlas de Riesgos Climáticos, Ministerio del Medio Ambiente (arclim.mma.gob.cl)",
    grilla: "0,05° (~5 km), referenciada a CR2MET",
    presente: "1980–2010",
    futuro: "2035–2065 (CMIP6, SSP2-4.5 y SSP5-8.5)",
    generado: new Date().toISOString(),
    campos,
  })
);
console.log("bandas", Object.keys(bandas).length);
