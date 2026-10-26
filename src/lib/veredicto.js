// =====================================================================
//  veredicto.js — combina todas las capas en restricciones por punto,
//  un veredicto (semáforo) y un resumen explicado de TODOS los parámetros.
// =====================================================================
import { fmt, calcularRiego } from "./capas.js";

export const ORDEN = { veto: 3, riesgo: 2, apto: 1, nd: 0 };
export function peorEstado(lista) {
  let peor = "nd";
  for (const e of lista) if (e && ORDEN[e] > ORDEN[peor]) peor = e;
  return peor;
}

const unicos = (arr) => [...new Set(arr.filter(Boolean))];

// ---------------------------------------------------------------------
//  Restricciones por punto de la grilla
// ---------------------------------------------------------------------
export function calcularRestricciones(n, { elev, osm, hum, sma }) {
  const puntos = [];
  for (let k = 0; k < n; k++) {
    const f = { mar: false, agua: null, humedal: [], humedalArt: [], protegida: [], advertencia: [], dudoso: false };
    if (elev && elev[k] != null && elev[k] <= 0) f.mar = true;
    if (osm) f.agua = osm.aguaPorPunto[k];
    if (hum) {
      const h = hum.porPunto[k];
      if (h === null) f.dudoso = true;
      else {
        f.humedal = h.filter((x) => !x.artificial);
        f.humedalArt = h.filter((x) => x.artificial);
      }
    }
    if (sma) {
      const s = sma.porPunto[k];
      if (s === null) f.dudoso = true;
      else {
        f.protegida = s.filter((x) => x.veto);
        f.advertencia = s.filter((x) => !x.veto);
      }
    }
    f.excluido = f.mar || !!f.agua || f.humedal.length > 0 || f.protegida.length > 0;
    f.aviso = !f.excluido && (f.humedalArt.length > 0 || f.advertencia.length > 0);
    puntos.push(f);
  }
  const pct = (fn) => (n ? (100 * puntos.filter(fn).length) / n : 0);
  const libres = puntos.map((p, k) => (p.excluido ? -1 : k)).filter((k) => k >= 0);

  // Nombres de lo encontrado (aunque no caiga sobre ningún punto)
  const protegidasVeto = sma ? sma.encontradas.filter((p) => p.veto) : [];
  const protegidasAviso = sma ? sma.encontradas.filter((p) => !p.veto) : [];
  const humedalesNat = hum ? hum.encontrados.filter((h) => !h.artificial) : [];
  const humedalesArt = hum ? hum.encontrados.filter((h) => h.artificial) : [];

  return {
    n,
    puntos,
    libres,
    pctExcluido: pct((p) => p.excluido),
    pctMar: pct((p) => p.mar),
    pctAguaNatural: pct((p) => p.agua && !p.agua.artificial),
    pctAguaArtificial: pct((p) => p.agua && p.agua.artificial),
    pctHumedal: pct((p) => p.humedal.length > 0),
    pctHumedalArt: pct((p) => p.humedalArt.length > 0),
    pctProtegida: pct((p) => p.protegida.length > 0),
    pctAviso: pct((p) => p.humedalArt.length > 0 || p.advertencia.length > 0),
    dudosos: puntos.filter((p) => p.dudoso).length,
    nombresAgua: unicos(puntos.map((p) => p.agua && (p.agua.nombre ? `${p.agua.tipo} ${p.agua.nombre}` : p.agua.tipo))),
    protegidasVeto,
    protegidasAviso,
    humedalesNat,
    humedalesArt,
  };
}

// ---------------------------------------------------------------------
//  Veredicto global
// ---------------------------------------------------------------------
export const TITULOS = {
  apto: "Buena opción",
  riesgo: "Con manejo",
  veto: "No recomendado",
  nd: "Veredicto incompleto",
};

export function calcularVeredicto(r) {
  const { R, clima, suelo, pendiente, agua, escasez, fuentes, areaHa, ubic, uso, hidro, limUrb, riesgoIPT, agot, erosion } = r;
  const haLibres = (areaHa * (100 - R.pctExcluido)) / 100;

  // 0) Fuera de Chile: las fuentes oficiales no aplican
  if (ubic && ubic.enChile === false) {
    return {
      estado: "nd",
      titulo: "Fuera de Chile",
      vetoTotal: true,
      frases: ["El terreno marcado no está dentro de Chile según la División Político-Administrativa oficial. WineCheck solo evalúa terrenos en Chile."],
    };
  }

  // 1) Todo el terreno restringido: veto absoluto
  if (R.n && R.pctExcluido >= 100) {
    const motivos = motivosRestriccion(R);
    return {
      estado: "veto",
      titulo: TITULOS.veto,
      vetoTotal: true,
      frases: [
        `No se puede plantar en este terreno: ${motivos.join("; ")}.`,
        "Por eso no se muestran clima, suelo ni agua: no aplican en este lugar.",
      ],
    };
  }

  // 2) ¿Se pudieron verificar las restricciones?
  const sinVerificar = [];
  if (fuentes.sma !== "ok") sinVerificar.push("áreas protegidas (SMA)");
  if (fuentes.humedales !== "ok") sinVerificar.push("humedales (MMA)");

  const parametros = [clima, suelo, pendiente, agua, escasez, agot];
  let estado = peorEstado(parametros.map((p) => p && p.estado));
  if (R.pctExcluido >= 50 && ORDEN[estado] < ORDEN.riesgo) estado = "riesgo";

  let incompleto = false;
  if (!clima) incompleto = true;
  if (sinVerificar.length) incompleto = true;
  if (incompleto) estado = "nd";
  const provisorio = !incompleto && (!suelo || suelo.estado === "nd");

  // 3) Resumen explicado, parámetro por parámetro
  const f = [];
  if (ubic && ubic.comuna) {
    f.push(
      `Ubicación: comuna de ${ubic.comuna} (${ubic.region})${ubic.cuenca ? `, cuenca del ${ubic.cuenca}` : ""}. ${
        ubic.do
          ? `Pertenece a la denominación de origen ${ubic.do.valle}${ubic.do.zona ? ` (${ubic.do.zona})` : ""}, ${ubic.do.region}.`
          : "La comuna no figura en la zonificación vitícola del Decreto 464 (no tiene denominación de origen de vinos)."
      }`
    );
  }
  f.push(
    R.pctExcluido > 0
      ? `Superficie marcada: ${fmt(areaHa, 1)} ha. Quedan disponibles para plantar unas ${fmt(haLibres, 1)} ha (${fmt(
          100 - R.pctExcluido
        )}%); el resto está restringido: ${motivosRestriccion(R).join("; ")}.`
      : `Superficie marcada: ${fmt(areaHa, 1)} ha, sin superficie restringida por agua, humedales ni áreas protegidas.`
  );

  const borde = [
    ...(R.pctProtegida === 0 ? R.protegidasVeto.map((p) => p.etiqueta) : []),
    ...(R.pctHumedal === 0 ? R.humedalesNat.map((h) => `humedal ${h.nombre}`) : []),
  ];
  if (borde.length) {
    f.push(`Ojo: el terreno toca el borde de ${unicos(borde).join("; ")}. Verifica el límite exacto en terreno antes de plantar en ese sector.`);
    if (!incompleto && ORDEN[estado] < ORDEN.riesgo) estado = "riesgo";
  }
  // Otras restricciones territoriales (advertencias)
  if (limUrb && limUrb.pct > 0) {
    f.push(
      `Límite urbano: el ${fmt(limUrb.pct)}% del terreno está dentro de un límite urbano (${limUrb.encontrados.join("; ")}); ahí el uso del suelo lo define el plan regulador y la plantación agrícola puede no estar permitida.`
    );
    if (!incompleto && limUrb.pct >= 50 && ORDEN[estado] < ORDEN.riesgo) estado = "riesgo";
  }
  if (uso && uso.hayBosqueNativo) {
    f.push(
      `Uso actual: hay ${uso.tiposBosque.join(" y ").toLowerCase()} según el catastro de CONAF. Cortar bosque nativo exige un plan de manejo aprobado por CONAF (Ley 20.283, art. 5).`
    );
    if (!incompleto && ORDEN[estado] < ORDEN.riesgo) estado = "riesgo";
  }
  if (riesgoIPT && riesgoIPT.zonas.length) {
    f.push(`Áreas de riesgo del plan regulador: ${riesgoIPT.zonas.map((z) => z.nombre + (z.cat ? ` (${z.cat})` : "")).join("; ")}.`);
    if (!incompleto && ORDEN[estado] < ORDEN.riesgo) estado = "riesgo";
  }
  const caucesNat = hidro ? hidro.cauces.filter((c) => !c.artificial) : [];
  if (caucesNat.length) {
    f.push(
      `Cauces que cruzan el terreno (red hidrográfica oficial): ${caucesNat
        .map((c) => (c.nombre ? `${c.tipo} ${c.nombre}` : c.tipo).toLowerCase())
        .join(", ")}. Considerar riesgo de crecidas y la faja de protección de la ribera.`
    );
  }
  if (R.dudosos > 0) f.push(`En ${R.dudosos} de ${R.n} puntos no se pudo confirmar si hay restricción (la fuente no respondió).`);

  if (clima) {
    f.push(
      `Clima (promedio de ${clima.temporadas} temporadas): ${fmt(clima.gdd)} grados-día, Región ${clima.region.n} de Winkler (${clima.region.desc}); temperatura media de temporada ${fmt(
        clima.gst,
        1
      )} °C (categoría ${clima.gstClase} según Jones).${clima.heladas >= 1 ? " Hay riesgo de heladas primaverales." : ""}`
    );
  } else f.push("Clima: no se pudo obtener; sin clima no es posible un veredicto.");

  if (suelo && suelo.clases && suelo.clases.length) {
    f.push(
      `Suelo (CIREN): ${suelo.clases.map((c) => `clase ${c.clase} en ${fmt(c.pct)}%`).join(", ")} de la superficie disponible.`
    );
  } else f.push("Suelo: sin clase de capacidad de uso de CIREN en este lugar; el veredicto es provisorio hasta tener un estudio de suelo.");
  if (r.soil && r.soil.superficial) {
    const s0 = r.soil.superficial;
    f.push(
      `Propiedades estimadas del suelo (SoilGrids, 0–30 cm): textura ${s0.textura}, pH ${fmt(s0.ph, 1)} (${s0.phClase}), ${fmt(
        s0.pedregosidad
      )}% de fragmentos gruesos.`
    );
  }
  if (erosion && erosion.actual) f.push(`Erosión actual (CIREN): ${erosion.actual}${erosion.riesgoPotencial ? `; riesgo potencial ${erosion.riesgoPotencial}` : ""}.`);

  if (pendiente && pendiente.estado !== "nd") {
    f.push(
      `Relieve: pendiente media ${fmt(pendiente.media)}% (${pendiente.media <= 15 ? "manejable" : "exige manejo"})${
        pendiente.exposicion ? `, exposición ${pendiente.exposicion}` : ""
      }.`
    );
  }
  const riego = calcularRiego(clima, r.agroclima);
  if (riego) {
    f.push(
      `Riego: la viña consumiría unos ${fmt(riego.etc)} mm por temporada (método FAO-56) y llueven ${fmt(
        riego.lluvia
      )} mm entre octubre y abril, así que habría que aportar del orden de ${fmt(riego.deficit)} mm (≈ ${fmt(
        riego.deficit * 10
      )} m³/ha) con riego${riego.fuente === "ciren" ? " (según el estudio agroclimático de CIREN)" : " (según el reanálisis ERA5, que tiende a sobreestimar)"}.`
    );
  }
  if (agot && agot.fuentes.length) f.push(`Agua superficial: ${agot.fuentes.map((x) => x.nombre).join("; ")} tiene declaración de agotamiento de la DGA (no se otorgan nuevos derechos permanentes).`);
  if (agua) f.push(`Agua subterránea (DGA): ${agua.zonas.length ? agua.zonas.map((z) => `${z.tipo} (SHAC ${z.shac})`).join(", ") : "sin delimitación"}.`);
  else f.push("Agua subterránea: no se pudo consultar la DGA.");

  if (escasez) {
    if (escasez.vigentes.length) f.push("Escasez hídrica: hay decreto vigente.");
    else if (escasez.recurrente)
      f.push(`Escasez hídrica: sin decreto vigente registrado, pero hubo decretos en ${escasez.aniosRecientes} de los últimos 10 años (zona con escasez recurrente).`);
    else if (escasez.estado === "nd") f.push("Escasez hídrica: la capa de la DGA no está actualizada; verificar decretos recientes.");
  }

  const avisos = [...R.protegidasAviso.map((p) => p.etiqueta), ...R.humedalesArt.map((h) => `humedal artificial ${h.nombre}`)];
  if (avisos.length) f.push(`Advertencias (no impiden plantar, pero hay que revisarlas): ${unicos(avisos).join("; ")}.`);

  if (clima) {
    const encajan = clima.cepas.filter((c) => c.encaja === "si").map((c) => c.cepa);
    const limite = clima.cepas.filter((c) => c.encaja === "limite").map((c) => c.cepa);
    let txt = encajan.length
      ? `Cepas cuyo rango térmico publicado incluye esta zona: ${encajan.join(", ")}.`
      : "Ninguna de las cepas con rango térmico publicado por Jones calza dentro de su rango.";
    if (limite.length) txt += ` En el límite de su rango (±0,5 °C): ${limite.join(", ")}.`;
    f.push(txt);
  }

  if (incompleto) {
    f.push(
      `No se pudo completar la verificación${sinVerificar.length ? ` de ${sinVerificar.join(" y ")}` : ""}${
        !clima ? (sinVerificar.length ? " ni del clima" : " del clima") : ""
      }. Reintenta en unos minutos antes de sacar conclusiones.`
    );
  } else if (estado === "apto") f.push("Conclusión: los parámetros evaluados están en rangos adecuados para establecer una viña.");
  else if (estado === "riesgo") f.push(`Conclusión: es plantable, con manejo técnico en: ${problemas(r).join(", ") || "los puntos señalados"}.`);
  else if (estado === "veto") f.push(`Conclusión: no recomendable por ${problemas(r, true).join(", ")}.`);

  return { estado, titulo: TITULOS[estado], provisorio, incompleto, frases: f, haLibres };
}

function problemas(r, soloVeto) {
  const out = [];
  const add = (p, nombre) => {
    if (!p) return;
    if (p.estado === "veto" || (!soloVeto && p.estado === "riesgo")) out.push(nombre);
  };
  add(r.clima, "clima");
  add(r.suelo, "suelo");
  add(r.pendiente, "pendiente");
  add(r.agua, "agua subterránea");
  add(r.escasez, "escasez hídrica");
  add(r.agot, "agua superficial (agotamiento)");
  if (!soloVeto && r.limUrb && r.limUrb.pct >= 50) out.push("límite urbano");
  if (!soloVeto && r.uso && r.uso.hayBosqueNativo) out.push("bosque nativo");
  if (!soloVeto && r.riesgoIPT && r.riesgoIPT.zonas.length) out.push("áreas de riesgo");
  if (!soloVeto && r.R.pctExcluido >= 50) out.push("superficie restringida");
  return out;
}

export function motivosRestriccion(R) {
  const m = [];
  if (R.pctMar > 0) m.push(`mar (${fmt(R.pctMar)}%)`);
  if (R.pctAguaNatural > 0) m.push(`cuerpo de agua (${fmt(R.pctAguaNatural)}%)`);
  if (R.pctAguaArtificial > 0) m.push(`embalse o tranque (${fmt(R.pctAguaArtificial)}%)`);
  if (R.pctHumedal > 0) m.push(`humedal ${unicos(R.humedalesNat.map((h) => h.nombre)).join(", ")} (${fmt(R.pctHumedal)}%)`);
  if (R.pctProtegida > 0) m.push(`${unicos(R.protegidasVeto.map((p) => p.etiqueta)).join(", ")} (${fmt(R.pctProtegida)}%)`);
  return m.length ? m : ["restricción territorial"];
}
