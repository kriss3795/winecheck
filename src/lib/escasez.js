// =====================================================================
//  escasez.js — decretos de escasez hídrica VIGENTES
//  Fuente: listado oficial de la DGA ("Decretos declaración zona de
//  escasez vigentes"), copiado a /escasez.json por scripts/escasez.mjs
//  (GitHub Actions, semanal). La capa de mapas de la DGA solo llega a
//  2023, así que se usa para el HISTORIAL y este listado para HOY.
// =====================================================================
import { fetchTimeout } from "./red.js";

const norm = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

export async function pedirEscasezVigente() {
  const r = await fetchTimeout("/escasez.json", 15000);
  if (!r.ok) throw new Error("sin listado de decretos vigentes");
  return r.json();
}

// Días desde la última revisión del listado de la DGA
export function diasDesdeRevision(lista) {
  return lista?.revisado ? Math.floor((Date.now() - new Date(lista.revisado + "T12:00:00").getTime()) / 864e5) : null;
}

// Cruza el listado con la provincia/comuna del terreno y sus SHAC (DGA)
export function cruzarEscasez(lista, ubic, agua) {
  if (!lista || !ubic || !ubic.enChile) return null;
  const hoy = Date.now();
  const shacs = (agua?.zonas || []).map((z) => norm(z.shac));
  const vigentes = [];
  for (const d of lista.decretos || []) {
    if (new Date(d.caducidad + "T23:59:59").getTime() < hoy) continue;
    const t = norm(d.territorio);
    let calza = false;
    if (d.tipo === "provincia") calza = norm(ubic.provincia) === t;
    else if (d.tipo === "comuna") calza = t.split(/,| y /).map((x) => x.trim()).includes(norm(ubic.comuna));
    else if (d.tipo === "shac") calza = shacs.some((s) => s === t || s.includes(t));
    if (calza) vigentes.push(d);
  }
  return { vigentes, revisado: lista.revisado, dias: diasDesdeRevision(lista), url: lista.url, total: (lista.decretos || []).length };
}
