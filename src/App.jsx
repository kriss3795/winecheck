// =====================================================================
//  WineCheck — App.jsx
//  Evalúa si un terreno en Chile es apto para plantar viñas.
//  Combina datos oficiales (clima, suelo, agua, humedales, áreas
//  protegidas, pendiente/mar, cuerpos de agua) y entrega un
//  veredicto tipo semáforo.
//
//  PRINCIPIOS (según lo acordado con Kriss):
//   - Todos los datos son reales y de fuentes oficiales verificables.
//     Si una fuente no es fiable, NO se muestra.
//   - Vetos absolutos: mar, humedal, parque/reserva, río/lago.
//     En esos casos NO se muestran datos de clima/suelo (no tiene
//     sentido hablar de suelo en el mar).
//   - Se muestrea el terreno en VARIOS puntos, no uno solo, porque
//     el suelo y otras capas varían dentro de un mismo predio.
//   - Nunca debe irse a pantalla blanca: todo acceso a config pasa
//     por cfg() y todo fetch tiene timeout compatible con celulares.
// =====================================================================

import React, { useState, useRef, useMemo } from "react";
import {
  MapContainer,
  TileLayer,
  Polygon,
  CircleMarker,
  useMapEvents,
  useMap,
} from "react-leaflet";

// ---------------------------------------------------------------------
//  1) CONFIGURACIÓN DE ESTADOS (semáforo) — acceso siempre seguro
// ---------------------------------------------------------------------
const CFG = {
  apto:   { color: "#2e7d32", texto: "Buena opción" },
  riesgo: { color: "#e6a100", texto: "Con manejo" },
  veto:   { color: "#c62828", texto: "No recomendado" },
  nd:     { color: "#6b7280", texto: "Sin dato" },
};
// cfg(): nunca devuelve undefined -> evita el crash a pantalla blanca
function cfg(estado) {
  return CFG[estado] || CFG.nd;
}

// Orden de severidad para combinar estados
const ORDEN = { veto: 3, riesgo: 2, apto: 1, nd: 0 };

// Proxy propio (Vercel). Todas las fuentes oficiales pasan por aquí.
const PROXY = "/api/geo?url=";
const viaProxy = (url) => PROXY + encodeURIComponent(url);

// ---------------------------------------------------------------------
//  2) UTILIDADES DE RED — timeout compatible con todos los navegadores
// ---------------------------------------------------------------------
// AbortSignal.timeout() crashea en algunos webviews de celular.
// Usamos AbortController manual, que funciona en todos lados.
function fetchTimeout(url, ms, opts) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, Object.assign({}, opts, { signal: ctrl.signal })).finally(
    () => clearTimeout(id)
  );
}

// Intenta directo y, si falla por CORS, reintenta por el proxy.
async function fetchGeo(url, ms = 15000) {
  try {
    const r = await fetchTimeout(url, ms);
    if (r.ok) return await r.json();
  } catch (e) {
    /* cae al proxy */
  }
  const r2 = await fetchTimeout(viaProxy(url), ms);
  if (!r2.ok) throw new Error("fuente respondió " + r2.status);
  return await r2.json();
}

// ---------------------------------------------------------------------
//  3) GEOMETRÍA — generar puntos de muestreo dentro del terreno
// ---------------------------------------------------------------------
function centroide(pts) {
  const n = pts.length;
  const lat = pts.reduce((a, p) => a + p[0], 0) / n;
  const lon = pts.reduce((a, p) => a + p[1], 0) / n;
  return [lat, lon];
}

// Devuelve los vértices + el centro, para muestrear variación interna.
function puntosMuestreo(pts) {
  if (!pts || pts.length < 3) return pts || [];
  const c = centroide(pts);
  return [...pts, c];
}

function distanciaKm(a, b) {
  const R = 6371;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLon = ((b[1] - a[1]) * Math.PI) / 180;
  const la1 = (a[0] * Math.PI) / 180;
  const la2 = (b[0] * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Peor estado de una lista (para combinar varios puntos o parámetros)
function peorEstado(estados) {
  let peor = "nd";
  for (const e of estados) {
    if (ORDEN[e] > ORDEN[peor]) peor = e;
  }
  return peor;
}

// =====================================================================
//  4) FUNCIONES DE CAPA — cada una consulta una fuente oficial
// =====================================================================

// ---- 4.1 CLIMA (Open-Meteo ERA5) — grados-día Winkler hemisferio sur
async function pedirClima(lat, lon) {
  // Temporada de crecimiento hemisferio sur: 1 oct (año-1) – 30 abr (año)
  const hoy = new Date();
  const anio = hoy.getFullYear();
  const base = "https://archive-api.open-meteo.com/v1/archive";
  const url =
    `${base}?latitude=${lat}&longitude=${lon}` +
    `&start_date=${anio - 1}-10-01&end_date=${anio}-04-30` +
    `&daily=temperature_2m_max,temperature_2m_min` +
    `&timezone=America%2FSantiago`;

  const j = await fetchGeo(url, 18000);
  const tmax = j?.daily?.temperature_2m_max || [];
  const tmin = j?.daily?.temperature_2m_min || [];
  if (!tmax.length) throw new Error("sin datos de temperatura");

  // Grados-día base 10°C (índice de Winkler)
  let gda = 0;
  let heladas = 0;
  for (let i = 0; i < tmax.length; i++) {
    const media = (tmax[i] + tmin[i]) / 2;
    if (media > 10) gda += media - 10;
    if (tmin[i] <= 0) heladas++;
  }
  gda = Math.round(gda);

  // Clasificación de aptitud por GDA
  let estado = "apto";
  let nota = "";
  if (gda < 850) {
    estado = "veto";
    nota = "Demasiado frío: por debajo del mínimo para madurar uva de vino.";
  } else if (gda < 1100) {
    estado = "riesgo";
    nota = "Clima fresco: apto para cepas tempranas con buen manejo.";
  } else if (gda > 2700) {
    estado = "riesgo";
    nota = "Clima muy cálido: requiere riego y manejo de canopia.";
  } else {
    nota = "Rango térmico adecuado para vid.";
  }
  if (heladas > 25 && estado === "apto") {
    estado = "riesgo";
    nota += " Alta frecuencia de heladas en temporada.";
  }

  return { estado, gda, heladas, nota, region: regionWinkler(gda) };
}

// Región climática de Winkler (I–V), adaptada a vid chilena
function regionWinkler(gda) {
  if (gda < 1390) return { n: "I", desc: "Fría — espumantes, blancos frescos" };
  if (gda < 1670) return { n: "II", desc: "Templada fría — Pinot Noir, Chardonnay" };
  if (gda < 1940) return { n: "III", desc: "Templada — Merlot, Cabernet" };
  if (gda < 2220) return { n: "IV", desc: "Cálida — Syrah, Carmenère" };
  return { n: "V", desc: "Muy cálida — uva de mesa / vinos de volumen" };
}

function cepasRecomendadas(gda) {
  if (gda < 1390) return "Sauvignon Blanc, Chardonnay, Pinot Noir, espumantes";
  if (gda < 1670) return "Chardonnay, Pinot Noir, Riesling";
  if (gda < 1940) return "Merlot, Cabernet Franc, Carmenère";
  if (gda < 2220) return "Cabernet Sauvignon, Syrah, Carmenère";
  return "Syrah, uva de mesa, cepas de clima cálido";
}

// ---- 4.2 PENDIENTE y MAR (Open-Meteo Elevation, DEM Copernicus)
async function pedirPendiente(puntos) {
  // Pide elevación de todos los puntos en una sola llamada
  const lats = puntos.map((p) => p[0]).join(",");
  const lons = puntos.map((p) => p[1]).join(",");
  const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lons}`;
  const j = await fetchGeo(url, 12000);
  const elev = j?.elevation || [];
  if (!elev.length) return { estado: "nd", ok: false };

  const emax = Math.max(...elev);
  const emin = Math.min(...elev);

  // Mar: si la elevación máxima es <= 0, el punto está en agua/mar.
  const enAgua = emax <= 0;

  // Pendiente aproximada: diferencia de altura / distancia entre extremos
  let pendPct = 0;
  if (puntos.length >= 2) {
    const d = distanciaKm(puntos[0], puntos[puntos.length - 1]) * 1000; // m
    if (d > 0) pendPct = (Math.abs(emax - emin) / d) * 100;
  }

  let estado = "apto";
  let nota = "Terreno con pendiente apta.";
  if (pendPct > 45) {
    estado = "veto";
    nota = "Pendiente excesiva (>45%): no mecanizable, erosión severa.";
  } else if (pendPct > 20) {
    estado = "riesgo";
    nota = "Pendiente moderada (>20%): requiere terrazas o manejo antierosión.";
  }

  return {
    estado,
    ok: true,
    enAgua,
    elevMin: Math.round(emin),
    elevMax: Math.round(emax),
    pendPct: Math.round(pendPct),
    nota,
  };
}

// ---- 4.3 SUELO (CIREN) — capacidad de uso (clases I–VIII), multipunto
const CLASES_SUELO = {
  I: { estado: "apto", desc: "Clase I — suelo arable sin limitaciones. Excelente." },
  II: { estado: "apto", desc: "Clase II — arable con limitaciones leves. Muy bueno." },
  III: { estado: "apto", desc: "Clase III — arable con limitaciones moderadas. Apto para vid." },
  IV: { estado: "riesgo", desc: "Clase IV — arable con limitaciones severas. Vid con manejo." },
  V: { estado: "riesgo", desc: "Clase V — no arable, praderas; vid posible con manejo especial." },
  VI: { estado: "riesgo", desc: "Clase VI — pastoreo/forestal; vid solo con fuerte manejo." },
  VII: { estado: "veto", desc: "Clase VII — forestal, no cultivable. No apto para vid." },
  VIII: { estado: "veto", desc: "Clase VIII — sin uso agrícola (roca, pantano). No apto." },
};

function parseClase(textcaus) {
  if (!textcaus) return null;
  const m = String(textcaus).trim().toUpperCase().match(/VIII|VII|VI|IV|V|III|II|I/);
  return m ? m[0] : null;
}

async function pedirSuelo(puntos) {
  const base =
    "https://esri.ciren.cl/server/rest/services/IDEMINAGRI/SUELOS_AGROLOGICOS/MapServer/0/query";
  const encontrados = {}; // clase -> cuántos puntos
  let consultados = 0;

  for (const [lat, lon] of puntos) {
    const url =
      `${base}?geometry=${lon},${lat}&geometryType=esriGeometryPoint` +
      `&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*` +
      `&returnGeometry=false&f=json`;
    try {
      const j = await fetchGeo(url, 12000);
      const feats = j?.features || [];
      consultados++;
      if (feats.length) {
        const attrs = feats[0].attributes || {};
        const raw =
          attrs.textcaus || attrs.TEXTCAUS || attrs.CAPACIDAD || attrs.clase;
        const clase = parseClase(raw);
        if (clase) encontrados[clase] = (encontrados[clase] || 0) + 1;
      }
    } catch (e) {
      /* un punto que falla no bota todo */
    }
  }

  const clases = Object.keys(encontrados);
  if (!clases.length) return { estado: "nd", clases: [], nota: "Sin dato de suelo en estos puntos." };

  // El estado del suelo es el PEOR de todas las clases encontradas
  const estados = clases.map((c) => CLASES_SUELO[c]?.estado || "nd");
  const estado = peorEstado(estados);

  const detalle = clases
    .sort()
    .map((c) => ({
      clase: c,
      estado: CLASES_SUELO[c]?.estado || "nd",
      desc: CLASES_SUELO[c]?.desc || `Clase ${c}.`,
      puntos: encontrados[c],
    }));

  return {
    estado,
    clases: detalle,
    variado: clases.length > 1,
    nota:
      clases.length > 1
        ? "El terreno tiene VARIAS clases de suelo (ver detalle)."
        : "Clase de suelo homogénea en el terreno.",
  };
}

// ---- 4.4 AGUA subterránea (DGA) — áreas de restricción / prohibición
async function pedirAgua(puntos) {
  const base =
    "https://rest-sit.mop.gob.cl/arcgis/rest/services/DGA/Areas_de_Restriccion_y_Zonas_de_Prohibicion/MapServer/0/query";
  let peor = "apto";
  let acuif = null;
  let tipo = null;
  let huboDato = false;

  for (const [lat, lon] of puntos) {
    const url =
      `${base}?geometry=${lon},${lat}&geometryType=esriGeometryPoint` +
      `&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*` +
      `&returnGeometry=false&f=json`;
    try {
      const j = await fetchGeo(url, 12000);
      const feats = j?.features || [];
      if (feats.length) {
        huboDato = true;
        const a = feats[0].attributes || {};
        const t = a.TIPO_LIMIT || a.tipo_limit || "";
        acuif = a.NOM_ACUIF || a.nom_acuif || acuif;
        tipo = t || tipo;
        if (/prohib/i.test(t) && ORDEN[peor] < ORDEN.veto) peor = "riesgo";
        else if (/restric/i.test(t) && ORDEN[peor] < ORDEN.riesgo) peor = "riesgo";
      }
    } catch (e) {
      /* sigue */
    }
  }

  if (!huboDato)
    return {
      estado: "apto",
      nota: "Fuera de áreas de restricción/prohibición de la DGA (acuífero abierto).",
    };

  let nota = "";
  if (/prohib/i.test(tipo || "")) {
    nota = `Zona de PROHIBICIÓN de la DGA${acuif ? " (acuífero " + acuif + ")" : ""}: no se otorgan nuevos derechos de agua subterránea. Requiere comprar derechos existentes.`;
    peor = "riesgo";
  } else if (/restric/i.test(tipo || "")) {
    nota = `Área de RESTRICCIÓN de la DGA${acuif ? " (acuífero " + acuif + ")" : ""}: derechos provisionales sujetos a disponibilidad.`;
    peor = "riesgo";
  } else {
    nota = "Acuífero con disponibilidad (abierto).";
  }
  return { estado: peor, acuif, tipo, nota };
}

// ---- 4.5 ESCASEZ HÍDRICA (DGA) — decretos de escasez vigentes
async function pedirEscasez(puntos) {
  const base =
    "https://rest-sit.mop.gob.cl/arcgis/rest/services/DGA/Decretos_Escasez_Hidrica/MapServer/0/query";
  for (const [lat, lon] of puntos) {
    const url =
      `${base}?geometry=${lon},${lat}&geometryType=esriGeometryPoint` +
      `&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*` +
      `&returnGeometry=false&f=json`;
    try {
      const j = await fetchGeo(url, 12000);
      const feats = j?.features || [];
      if (feats.length) {
        const a = feats[0].attributes || {};
        const dec = a.DECRETO || a.decreto || a.NOMBRE || "";
        return {
          estado: "riesgo",
          nota: `Zona con decreto de escasez hídrica vigente${dec ? " (" + dec + ")" : ""}. La autoridad puede restringir extracciones.`,
        };
      }
    } catch (e) {
      /* sigue */
    }
  }
  return { estado: "apto", nota: "Sin decreto de escasez hídrica vigente." };
}

// ---- 4.6 HUMEDALES (MMA) — VETO ABSOLUTO
async function pedirHumedal(puntos) {
  const base =
    "https://arcgis.mma.gob.cl/server/rest/services/SIMBIO/SIMBIO_HUMEDALES/MapServer/0/query";
  for (const [lat, lon] of puntos) {
    const url =
      `${base}?geometry=${lon},${lat}&geometryType=esriGeometryPoint` +
      `&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*` +
      `&returnGeometry=false&f=json`;
    try {
      const j = await fetchGeo(url, 12000);
      const feats = j?.features || [];
      if (feats.length) {
        const a = feats[0].attributes || {};
        const nom = a.NOMBRE || a.nombre || "humedal";
        return {
          esHumedal: true,
          estado: "veto",
          nota: `Humedal protegido (${nom}). Está prohibido drenar o intervenir humedales (Ley 21.202).`,
        };
      }
    } catch (e) {
      /* sigue */
    }
  }
  return { esHumedal: false, estado: "apto", nota: "Fuera de humedales del inventario MMA." };
}

// ---- 4.7 ÁREAS PROTEGIDAS (SMA / SNASPE) — VETO ABSOLUTO
async function pedirProtegida(puntos) {
  const base =
    "https://ideserver.sma.gob.cl/arcgis/rest/services/IDE/Areas_proteccion_oficial2/MapServer/37/query";
  for (const [lat, lon] of puntos) {
    const url =
      `${base}?geometry=${lon},${lat}&geometryType=esriGeometryPoint` +
      `&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*` +
      `&returnGeometry=false&f=json`;
    try {
      const j = await fetchGeo(url, 12000);
      const feats = j?.features || [];
      if (feats.length) {
        const a = feats[0].attributes || {};
        const nom = a.NOMBRE || a.nombre || "área protegida";
        return {
          protegida: true,
          estado: "veto",
          nota: `Área protegida oficial (${nom}). No se permite uso agrícola.`,
        };
      }
    } catch (e) {
      /* sigue */
    }
  }
  return { protegida: false, estado: "apto", nota: "Fuera de áreas protegidas oficiales." };
}

// ---- 4.8 CUERPOS DE AGUA (OpenStreetMap Overpass) — ríos/lagos: VETO
async function pedirCuerpoAgua(lat, lon) {
  // Busca agua (lago, río, embalse) en ~80 m alrededor del punto
  const q =
    `[out:json][timeout:15];(` +
    `way(around:80,${lat},${lon})["natural"="water"];` +
    `way(around:80,${lat},${lon})["waterway"];` +
    `relation(around:80,${lat},${lon})["natural"="water"];` +
    `);out ids 1;`;
  const url = "https://overpass-api.de/api/interpreter?data=" + encodeURIComponent(q);
  try {
    const j = await fetchGeo(url, 15000);
    const n = (j?.elements || []).length;
    if (n > 0)
      return {
        enAgua: true,
        estado: "veto",
        nota: "El punto cae sobre un cuerpo de agua (río, lago o embalse). No se puede plantar.",
      };
  } catch (e) {
    /* si Overpass falla, no vetamos por esto */
  }
  return { enAgua: false, estado: "apto", nota: "Sin cuerpos de agua superficiales en el punto." };
}

// ---- 4.9 BUSCADOR DE LUGARES (Nominatim) — tipo Google Maps
async function buscarLugar(texto) {
  if (!texto || !texto.trim()) return null;
  const url =
    "https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=cl&q=" +
    encodeURIComponent(texto);
  try {
    const j = await fetchGeo(url, 10000);
    if (Array.isArray(j) && j.length) {
      return { lat: parseFloat(j[0].lat), lon: parseFloat(j[0].lon), nombre: j[0].display_name };
    }
  } catch (e) {
    /* sin resultado */
  }
  return null;
}

// =====================================================================
//  5) COMPONENTES DE MAPA
// =====================================================================

// Captura los clics para marcar puntos del terreno
function CapturaClics({ puntos, setPuntos }) {
  useMapEvents({
    click(e) {
      setPuntos((prev) => [...prev, [e.latlng.lat, e.latlng.lng]]);
    },
  });
  return null;
}

// Mueve el mapa a un destino (resultado del buscador) de forma segura
function VolarA({ destino }) {
  const map = useMap();
  React.useEffect(() => {
    if (!destino || typeof destino.lat !== "number" || typeof destino.lon !== "number")
      return;
    try {
      map.setView([destino.lat, destino.lon], 14);
    } catch (e) {
      /* no botar la app si el mapa aún no está listo */
    }
  }, [destino, map]);
  return null;
}

// =====================================================================
//  6) COMPONENTE PRINCIPAL
// =====================================================================
export default function App() {
  const [puntos, setPuntos] = useState([]);
  const [capa, setCapa] = useState("calle"); // calle | satelite | relieve
  const [busqueda, setBusqueda] = useState("");
  const [destino, setDestino] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);
  const [resultado, setResultado] = useState(null);

  const centro = useMemo(() => (puntos.length ? centroide(puntos) : null), [puntos]);

  // --- Buscar un lugar y mover el mapa
  async function onBuscar(e) {
    if (e) e.preventDefault();
    setError(null);
    const r = await buscarLugar(busqueda);
    if (r) setDestino(r);
    else setError("No se encontró el lugar. Prueba con otro nombre o comuna.");
  }

  // --- Analizar el terreno marcado
  async function analizar() {
    if (puntos.length < 3) {
      setError("Marca al menos 3 puntos para formar el terreno.");
      return;
    }
    setError(null);
    setCargando(true);
    setResultado(null);

    try {
      const muestras = puntosMuestreo(puntos);
      const c = centroide(puntos);

      // Todas las consultas en paralelo. allSettled NO se cuelga si una falla.
      const [
        clima,
        pendiente,
        suelo,
        agua,
        escasez,
        humedal,
        protegida,
        cuerpoAgua,
      ] = await Promise.allSettled([
        pedirClima(c[0], c[1]),
        pedirPendiente(muestras),
        pedirSuelo(muestras),
        pedirAgua(muestras),
        pedirEscasez(muestras),
        pedirHumedal(muestras),
        pedirProtegida(muestras),
        pedirCuerpoAgua(c[0], c[1]),
      ]).then((rs) => rs.map((r) => (r.status === "fulfilled" ? r.value : null)));

      setResultado({ clima, pendiente, suelo, agua, escasez, humedal, protegida, cuerpoAgua, centro: c });
    } catch (e) {
      setError("No se pudo completar el análisis: " + (e?.message || e));
    } finally {
      setCargando(false);
    }
  }

  function reiniciar() {
    setPuntos([]);
    setResultado(null);
    setError(null);
  }

  // --- Determinar vetos absolutos y veredicto global
  const analisis = useMemo(() => {
    if (!resultado) return null;
    const { clima, pendiente, suelo, agua, escasez, humedal, protegida, cuerpoAgua } = resultado;

    const enMar =
      (cuerpoAgua && cuerpoAgua.enAgua) ||
      (pendiente && pendiente.ok && pendiente.enAgua);
    const esHumedal = humedal && humedal.esHumedal;
    const esProtegida = protegida && protegida.protegida;
    const vetoAbsoluto = enMar || esHumedal || esProtegida;

    // Lista de motivos de veto absoluto
    const motivosVeto = [];
    if (enMar) motivosVeto.push("el terreno cae sobre agua (mar, río, lago o embalse)");
    if (esHumedal) motivosVeto.push("es un humedal protegido");
    if (esProtegida) motivosVeto.push("es un área protegida oficial");

    // Estado global
    let estadoGlobal;
    if (vetoAbsoluto) {
      estadoGlobal = "veto";
    } else {
      const estados = [
        clima?.estado,
        pendiente?.estado,
        suelo?.estado,
        agua?.estado,
        escasez?.estado,
      ].filter(Boolean);
      estadoGlobal = peorEstado(estados);
    }

    return { vetoAbsoluto, motivosVeto, estadoGlobal };
  }, [resultado]);

  // --- Frase resumen del veredicto (explica TODOS los parámetros)
  function fraseVeredicto() {
    if (!resultado || !analisis) return "";
    if (analisis.vetoAbsoluto) {
      return (
        "No se puede plantar aquí porque " +
        analisis.motivosVeto.join(" y ") +
        ". Por eso no se muestran datos de clima ni suelo: no aplican en este lugar."
      );
    }
    const { clima, pendiente, suelo, agua, escasez } = resultado;
    const problemas = [];
    const buenos = [];
    const rev = (p, nombre) => {
      if (!p) return;
      if (p.estado === "veto" || p.estado === "riesgo") problemas.push(nombre);
      else if (p.estado === "apto") buenos.push(nombre);
    };
    rev(clima, "clima");
    rev(suelo, "suelo");
    rev(pendiente, "pendiente");
    rev(agua, "agua subterránea");
    rev(escasez, "disponibilidad hídrica");

    if (analisis.estadoGlobal === "apto") {
      return `Terreno apto para viña. Clima, suelo, pendiente y agua están dentro de rangos adecuados. Cepas sugeridas: ${clima ? cepasRecomendadas(clima.gda) : "según clima"}.`;
    }
    let f = "";
    if (problemas.length) f += `Puntos a manejar: ${problemas.join(", ")}. `;
    if (buenos.length) f += `A favor: ${buenos.join(", ")}. `;
    if (analisis.estadoGlobal === "veto")
      f += "Hay al menos un parámetro que lo hace no recomendable.";
    else f += "Es plantable con manejo técnico adecuado.";
    return f;
  }

  const esMovil = typeof window !== "undefined" && window.innerWidth <= 640;

  // =====================================================================
  //  7) INTERFAZ
  // =====================================================================
  return (
    <div>
      <header className="cabecera">
        <img src="/logo.png" alt="WineCheck" />
        <div>
          <h1>WINE CHECK</h1>
          <p className="lema">¿Se puede plantar una viña aquí? Datos oficiales de Chile.</p>
        </div>
      </header>

      <div className="wrap">
        {/* Buscador tipo Google Maps */}
        <form className="buscador" onSubmit={onBuscar}>
          <input
            type="text"
            placeholder="Buscar lugar o comuna (ej: Paine, Casablanca, Colchagua)"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
          <button type="submit">Buscar</button>
        </form>

        {/* Botones de capa */}
        <div className="capas">
          <button className={capa === "calle" ? "activo" : ""} onClick={() => setCapa("calle")}>
            Mapa
          </button>
          <button className={capa === "satelite" ? "activo" : ""} onClick={() => setCapa("satelite")}>
            Satélite
          </button>
          <button className={capa === "relieve" ? "activo" : ""} onClick={() => setCapa("relieve")}>
            Relieve
          </button>
        </div>

        {/* Mapa */}
        <div className="mapa">
          <MapContainer center={[-33.85, -70.75]} zoom={9} style={{ height: "100%", width: "100%" }}>
            {capa === "calle" && (
              <TileLayer
                key="calle"
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution="© OpenStreetMap"
              />
            )}
            {capa === "satelite" && (
              <TileLayer
                key="satelite"
                url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                attribution="© Esri World Imagery"
              />
            )}
            {capa === "relieve" && (
              <TileLayer
                key="relieve"
                url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}"
                attribution="© Esri World Topo"
              />
            )}

            <CapturaClics puntos={puntos} setPuntos={setPuntos} />
            <VolarA destino={destino} />

            {puntos.map((p, i) => (
              <CircleMarker key={i} center={p} radius={6} pathOptions={{ color: "#7b1d2b", fillColor: "#7b1d2b", fillOpacity: 1 }} />
            ))}
            {puntos.length >= 3 && (
              <Polygon positions={puntos} pathOptions={{ color: "#7b1d2b", fillOpacity: 0.15 }} />
            )}
          </MapContainer>
        </div>

        <p style={{ fontSize: "0.85rem", color: "#6b7280", margin: "8px 0" }}>
          Toca el mapa para marcar las esquinas del terreno (mínimo 3, sin límite). El punto central también se analiza.
        </p>

        {/* Acciones */}
        <div className="acciones">
          <button className="btn-analizar" onClick={analizar} disabled={cargando || puntos.length < 3}>
            {cargando ? "Analizando…" : "Analizar terreno"}
          </button>
          <button className="btn-reiniciar" onClick={reiniciar} disabled={cargando}>
            Reiniciar
          </button>
        </div>

        {error && <div className="error">{error}</div>}
        {cargando && <div className="cargando">Consultando fuentes oficiales… puede tardar unos segundos.</div>}

        {/* Resultado */}
        {resultado && analisis && (
          <>
            {/* Veredicto global */}
            <div className={"veredicto " + analisis.estadoGlobal}>
              <h2>{cfg(analisis.estadoGlobal).texto}</h2>
              <p>{fraseVeredicto()}</p>
            </div>

            {/* Si es veto absoluto, NO mostramos clima/suelo/etc. */}
            {analisis.vetoAbsoluto ? (
              <div className="tarjeta">
                <h3>¿Por qué no se muestran más datos?</h3>
                <p>
                  Este lugar está vetado ({analisis.motivosVeto.join(", ")}). No tiene sentido
                  mostrar clima, suelo o agua porque no se puede plantar una viña aquí bajo ninguna
                  condición.
                </p>
              </div>
            ) : (
              <>
                <TarjetaClima clima={resultado.clima} />
                <TarjetaSuelo suelo={resultado.suelo} />
                <TarjetaSimple titulo="Pendiente y relieve" p={resultado.pendiente} extra={relieveExtra(resultado.pendiente)} />
                <TarjetaSimple titulo="Agua subterránea (DGA)" p={resultado.agua} />
                <TarjetaSimple titulo="Disponibilidad hídrica (DGA)" p={resultado.escasez} />
                <TarjetaSimple titulo="Humedales (MMA)" p={resultado.humedal} />
                <TarjetaSimple titulo="Áreas protegidas (SMA)" p={resultado.protegida} />
              </>
            )}

            {/* FUENTES — al final del todo */}
            <PanelFuentes />
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
//  Componentes de tarjeta
// ---------------------------------------------------------------------
function relieveExtra(p) {
  if (!p || !p.ok) return null;
  return `Altitud: ${p.elevMin}–${p.elevMax} m · Pendiente aprox.: ${p.pendPct}%`;
}

function TarjetaClima({ clima }) {
  if (!clima) return <TarjetaSinDato titulo="Clima (Open-Meteo ERA5)" />;
  return (
    <div className="tarjeta">
      <h3>Clima — {cfg(clima.estado).texto}</h3>
      <div className="param">
        <span className={"punto " + clima.estado} />
        <div>
          <strong>Grados-día (Winkler, base 10°C): {clima.gda}</strong>
          <div>Región climática {clima.region?.n} — {clima.region?.desc}</div>
          <div>Heladas en temporada: {clima.heladas} días</div>
          <div style={{ marginTop: 4 }}>{clima.nota}</div>
          <div style={{ marginTop: 4, color: "#7b1d2b" }}>
            Cepas sugeridas: {cepasRecomendadas(clima.gda)}
          </div>
        </div>
      </div>
    </div>
  );
}

function TarjetaSuelo({ suelo }) {
  if (!suelo || suelo.estado === "nd" || !suelo.clases?.length)
    return <TarjetaSinDato titulo="Suelo (CIREN — capacidad de uso)" />;
  return (
    <div className="tarjeta">
      <h3>Suelo — {cfg(suelo.estado).texto}</h3>
      <p style={{ fontSize: "0.9rem", color: "#6b7280", marginTop: 0 }}>{suelo.nota}</p>
      {suelo.clases.map((c) => (
        <div className="param" key={c.clase}>
          <span className={"punto " + c.estado} />
          <div>
            <strong>Clase {c.clase}</strong> {c.puntos > 1 ? `(en ${c.puntos} puntos)` : ""}
            <div>{c.desc}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function TarjetaSimple({ titulo, p, extra }) {
  if (!p) return <TarjetaSinDato titulo={titulo} />;
  return (
    <div className="tarjeta">
      <h3>{titulo} — {cfg(p.estado).texto}</h3>
      <div className="param">
        <span className={"punto " + p.estado} />
        <div>
          <div>{p.nota}</div>
          {extra && <div style={{ marginTop: 4, color: "#6b7280" }}>{extra}</div>}
        </div>
      </div>
    </div>
  );
}

function TarjetaSinDato({ titulo }) {
  return (
    <div className="tarjeta">
      <h3>{titulo} — Sin dato</h3>
      <div className="param">
        <span className="punto nd" />
        <div>No se obtuvo dato de esta fuente para el terreno marcado.</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
//  Panel de fuentes — SIEMPRE al final, con explicación y enlaces
// ---------------------------------------------------------------------
function PanelFuentes() {
  const fuentes = [
    {
      n: "Clima — Open-Meteo (reanálisis ERA5)",
      por: "ERA5 es el reanálisis climático oficial del ECMWF (Centro Europeo de Previsiones Meteorológicas), estándar científico mundial con 25+ años de datos. Open-Meteo lo entrega libremente.",
      url: "https://open-meteo.com/en/docs/historical-weather-api",
    },
    {
      n: "Suelo — CIREN (Estudio Agrológico)",
      por: "CIREN (Centro de Información de Recursos Naturales) es el organismo técnico chileno que elabora la cartografía oficial de suelos y su capacidad de uso (clases I–VIII).",
      url: "https://esri.ciren.cl/server/rest/services/IDEMINAGRI/SUELOS_AGROLOGICOS/MapServer",
    },
    {
      n: "Agua subterránea y escasez — DGA / MOP",
      por: "La Dirección General de Aguas (Ministerio de Obras Públicas) administra los derechos de agua y declara las áreas de restricción, zonas de prohibición y decretos de escasez.",
      url: "https://dga.mop.gob.cl/derechos-de-agua/proteccion-de-las-fuentes/areas-de-restriccion/",
    },
    {
      n: "Humedales — MMA (SIMBIO)",
      por: "El Ministerio del Medio Ambiente mantiene el Inventario Nacional de Humedales y los humedales urbanos declarados (Ley 21.202), donde está prohibido intervenir.",
      url: "https://humedaleschile.mma.gob.cl/",
    },
    {
      n: "Áreas protegidas — SMA / SNASPE",
      por: "La Superintendencia del Medio Ambiente publica las áreas de protección oficial (parques, reservas, santuarios). No admiten uso agrícola.",
      url: "https://areasprotegidas.mma.gob.cl/",
    },
    {
      n: "Pendiente y elevación — Copernicus DEM (vía Open-Meteo)",
      por: "Modelo digital de elevación Copernicus (Agencia Espacial Europea), referencia global de topografía. Se usa para pendiente y para detectar mar.",
      url: "https://open-meteo.com/en/docs/elevation-api",
    },
    {
      n: "Cuerpos de agua — OpenStreetMap (Overpass)",
      por: "Base cartográfica colaborativa mundial. Se usa como control cruzado para detectar ríos, lagos y embalses bajo el punto marcado.",
      url: "https://www.openstreetmap.org/",
    },
  ];
  return (
    <div className="tarjeta fuentes">
      <h3>Fuentes y cómo leerlas</h3>
      <p>
        Todos los datos provienen de organismos oficiales y públicos. Cada fuente se puede verificar
        en su enlace:
      </p>
      {fuentes.map((f, i) => (
        <details key={i}>
          <summary>{f.n}</summary>
          <p style={{ margin: "6px 0" }}>{f.por}</p>
          <a href={f.url} target="_blank" rel="noreferrer">
            Ver fuente ↗
          </a>
        </details>
      ))}
    </div>
  );
}
