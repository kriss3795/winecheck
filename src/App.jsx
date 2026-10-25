// =====================================================================
//  WineCheck — App.jsx (interfaz)
//  Evalúa si un terreno en Chile es apto para plantar viñas.
//
//  PRINCIPIOS (acordados con Kriss):
//   - Solo datos reales de fuentes oficiales verificables. Si una fuente
//     falla, se muestra "Sin dato": nunca se asume que "no hay nada".
//   - Mar, ríos, lagos, embalses, humedales y áreas protegidas no se
//     plantan: se calcula qué % del terreno ocupan. Si es el 100%,
//     no se muestran clima/suelo/agua.
//   - El terreno se muestrea con una grilla de puntos interiores.
//   - Panel "Fuentes y cómo leerlas" siempre al final.
//   - Nunca pantalla blanca: cfg() seguro y fetch con AbortController.
//
//  La lógica de datos vive en src/lib/:
//   red.js (red y proxy) · geometria.js · capas.js (fuentes) · veredicto.js
// =====================================================================

import React, { useState, useMemo } from "react";
import { MapContainer, TileLayer, Polygon, CircleMarker, useMapEvents, useMap } from "react-leaflet";
import { areaM2, centroide, grillaInterna, seAutoIntersecta } from "./lib/geometria.js";
import {
  URLS,
  fmt,
  fecha,
  pedirElevaciones,
  calcularPendiente,
  pedirClima,
  pedirSuelo,
  pedirAgua,
  pedirEscasez,
  pedirHumedales,
  pedirProtegidas,
  pedirOSM,
  buscarLugar,
} from "./lib/capas.js";
import { calcularRestricciones, calcularVeredicto } from "./lib/veredicto.js";

// ---------------------------------------------------------------------
//  Semáforo — acceso siempre seguro
// ---------------------------------------------------------------------
const CFG = {
  apto: { color: "#2e7d32", texto: "Buena opción" },
  riesgo: { color: "#e6a100", texto: "Con manejo" },
  veto: { color: "#c62828", texto: "No recomendado" },
  nd: { color: "#6b7280", texto: "Sin dato" },
};
function cfg(estado) {
  return CFG[estado] || CFG.nd;
}

// ---------------------------------------------------------------------
//  Componentes de mapa
// ---------------------------------------------------------------------
function CapturaClics({ activo, onPunto }) {
  useMapEvents({
    click(e) {
      if (activo) onPunto([e.latlng.lat, e.latlng.lng]);
    },
  });
  return null;
}

function VolarA({ destino }) {
  const map = useMap();
  React.useEffect(() => {
    if (!destino || typeof destino.lat !== "number" || typeof destino.lon !== "number") return;
    try {
      map.setView([destino.lat, destino.lon], 14);
    } catch (e) {
      /* el mapa aún no está listo: no botar la app */
    }
  }, [destino, map]);
  return null;
}

function colorPunto(p) {
  if (p.excluido) return "#c62828";
  if (p.aviso) return "#e6a100";
  return "#2e7d32";
}

// =====================================================================
//  Componente principal
// =====================================================================
export default function App() {
  const [puntos, setPuntosRaw] = useState([]);
  const [capa, setCapa] = useState("satelite");
  const [busqueda, setBusqueda] = useState("");
  const [destino, setDestino] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [paso, setPaso] = useState("");
  const [error, setError] = useState(null);
  const [resultado, setResultado] = useState(null);

  // Si cambia el terreno, el resultado anterior deja de valer
  function setPuntos(fn) {
    setPuntosRaw(fn);
    setResultado(null);
  }

  const areaHa = useMemo(() => areaM2(puntos) / 10000, [puntos]);
  const cruzado = useMemo(() => seAutoIntersecta(puntos), [puntos]);

  async function onBuscar(e) {
    if (e) e.preventDefault();
    setError(null);
    try {
      const r = await buscarLugar(busqueda);
      if (r) setDestino(r);
      else setError("No se encontró el lugar. Prueba con otro nombre o comuna.");
    } catch (err) {
      setError("El buscador no respondió. Intenta de nuevo en unos segundos.");
    }
  }

  async function analizar() {
    if (puntos.length < 3) {
      setError("Marca al menos 3 puntos para formar el terreno.");
      return;
    }
    if (cruzado) {
      setError("El contorno se cruza a sí mismo. Reinicia y marca las esquinas en orden, siguiendo el borde del terreno.");
      return;
    }
    setError(null);
    setResultado(null);
    setCargando(true);

    const fuentes = {};
    const marca = (clave, promesa) =>
      promesa
        .then((v) => {
          fuentes[clave] = "ok";
          return v;
        })
        .catch((e) => {
          fuentes[clave] = "error";
          console.warn("[WineCheck]", clave, e);
          return null;
        });

    try {
      const poly = puntos.slice();
      const grid = grillaInterna(poly);
      const lls = grid.puntos.map((p) => p.ll);

      setPaso("Revisando agua, humedales y áreas protegidas…");
      const [elev, osm, sma, hum, agua, escasez] = await Promise.all([
        marca("elevacion", pedirElevaciones(lls)),
        marca("osm", pedirOSM(poly, lls)),
        marca("sma", pedirProtegidas(poly, lls)),
        marca("humedales", pedirHumedales(poly, lls)),
        marca("agua", pedirAgua(poly)),
        marca("escasez", pedirEscasez(poly)),
      ]);

      const R = calcularRestricciones(lls.length, { elev, osm, hum, sma });

      let clima = null;
      let suelo = null;
      let pendiente = null;
      if (R.libres.length) {
        setPaso("Calculando clima de 10 temporadas y suelo…");
        const c = centroide(R.libres.map((k) => lls[k]));
        [clima, suelo] = await Promise.all([
          marca("clima", pedirClima(c[0], c[1])),
          marca("suelo", pedirSuelo(R.libres.map((k) => lls[k]))),
        ]);
        pendiente = elev ? calcularPendiente(grid, elev, R.libres) : null;
      } else {
        fuentes.clima = fuentes.suelo = "no aplica";
      }

      setResultado({
        poly,
        grid,
        areaHa: areaM2(poly) / 10000,
        R,
        osm,
        clima,
        suelo,
        pendiente,
        agua,
        escasez,
        fuentes,
        consultado: new Date(),
      });
    } catch (e) {
      setError("No se pudo completar el análisis: " + (e?.message || e));
    } finally {
      setCargando(false);
      setPaso("");
    }
  }

  function deshacer() {
    setPuntos((prev) => prev.slice(0, -1));
  }
  function reiniciar() {
    setPuntos([]);
    setError(null);
  }

  const ver = useMemo(() => (resultado ? calcularVeredicto(resultado) : null), [resultado]);

  return (
    <div>
      <header className="cabecera">
        <img src="/logo.png" alt="WineCheck" />
        <div>
          <h1>WINE CHECK</h1>
          <p className="lema">¿Se puede plantar una viña aquí? Prefactibilidad con datos oficiales de Chile.</p>
        </div>
      </header>

      <div className="wrap">
        <form className="buscador" onSubmit={onBuscar}>
          <input
            type="text"
            placeholder="Buscar lugar o comuna (ej: Paine, Casablanca, Colchagua)"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
          <button type="submit">Buscar</button>
        </form>

        <div className="capas">
          {[
            ["calle", "Mapa"],
            ["satelite", "Satélite"],
            ["relieve", "Relieve"],
          ].map(([k, t]) => (
            <button key={k} className={capa === k ? "activo" : ""} onClick={() => setCapa(k)}>
              {t}
            </button>
          ))}
        </div>

        <div className="mapa">
          <MapContainer center={[-33.85, -70.75]} zoom={9} style={{ height: "100%", width: "100%" }}>
            {capa === "calle" && (
              <TileLayer key="calle" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap" />
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

            <CapturaClics activo={!cargando} onPunto={(p) => setPuntos((prev) => [...prev, p])} />
            <VolarA destino={destino} />

            {puntos.length >= 3 && (
              <Polygon positions={puntos} pathOptions={{ color: cruzado ? "#c62828" : "#7b1d2b", fillOpacity: 0.12 }} />
            )}
            {puntos.map((p, i) => (
              <CircleMarker
                key={"v" + i}
                center={p}
                radius={6}
                interactive={false}
                pathOptions={{ color: "#fff", weight: 2, fillColor: "#7b1d2b", fillOpacity: 1 }}
              />
            ))}
            {resultado &&
              resultado.grid.puntos.map((p, k) => (
                <CircleMarker
                  key={"g" + k}
                  center={p.ll}
                  radius={4}
                  interactive={false}
                  pathOptions={{ color: colorPunto(resultado.R.puntos[k]), weight: 1, fillOpacity: 0.9 }}
                />
              ))}
          </MapContainer>
        </div>

        {resultado && (
          <div className="leyenda">
            <span><i style={{ background: "#2e7d32" }} /> disponible</span>
            <span><i style={{ background: "#e6a100" }} /> con advertencia</span>
            <span><i style={{ background: "#c62828" }} /> restringido</span>
            <span className="tenue">({resultado.R.n} puntos de muestreo)</span>
          </div>
        )}

        <p className="ayuda">
          Toca el mapa para marcar las esquinas del terreno, en orden alrededor del borde (mínimo 3).
          {puntos.length > 0 && (
            <strong>
              {" "}
              {puntos.length} {puntos.length === 1 ? "punto" : "puntos"}
              {puntos.length >= 3 ? ` · ${fmt(areaHa, areaHa < 10 ? 2 : 1)} ha` : ""}
            </strong>
          )}
        </p>
        {cruzado && <div className="aviso">El contorno se cruza a sí mismo. Deshaz puntos o reinicia y márcalos en orden.</div>}

        <div className="acciones">
          <button className="btn-analizar" onClick={analizar} disabled={cargando || puntos.length < 3}>
            {cargando ? "Analizando…" : "Analizar terreno"}
          </button>
          <button className="btn-reiniciar" onClick={deshacer} disabled={cargando || !puntos.length}>
            Deshacer punto
          </button>
          <button className="btn-reiniciar" onClick={reiniciar} disabled={cargando || !puntos.length}>
            Reiniciar
          </button>
        </div>

        {error && <div className="error">{error}</div>}
        {cargando && <div className="cargando">{paso || "Consultando fuentes oficiales…"} Puede tardar hasta un minuto.</div>}

        {resultado && ver && (
          <>
            <div className={"veredicto " + ver.estado}>
              <h2>
                {ver.titulo}
                {ver.provisorio ? " (provisorio)" : ""}
              </h2>
              <ul className="resumen">
                {ver.frases.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </div>

            {ver.vetoTotal ? (
              <TarjetaTerritorio r={resultado} />
            ) : (
              <>
                <TarjetaTerritorio r={resultado} />
                <TarjetaClima clima={resultado.clima} />
                <TarjetaSuelo suelo={resultado.suelo} />
                <TarjetaRelieve p={resultado.pendiente} />
                <TarjetaAgua agua={resultado.agua} />
                <TarjetaEscasez e={resultado.escasez} />
              </>
            )}

            <div className="alcance">
              WineCheck es una herramienta de prefactibilidad. No reemplaza el estudio de suelo en terreno (calicatas),
              la verificación de derechos de agua del predio ni la revisión legal y ambiental del proyecto.
            </div>
          </>
        )}

        <PanelFuentes r={resultado} />
      </div>
    </div>
  );
}

// =====================================================================
//  Tarjetas
// =====================================================================
function Tarjeta({ titulo, estado, children }) {
  return (
    <div className="tarjeta">
      <h3>
        <span className={"punto " + (estado || "nd")} /> {titulo}
        {estado && <span className={"chip " + estado}>{cfg(estado).texto}</span>}
      </h3>
      {children}
    </div>
  );
}

function SinDato({ titulo, texto }) {
  return (
    <Tarjeta titulo={titulo} estado="nd">
      <p>{texto || "La fuente no respondió. No se muestra información para no inducir a error; reintenta en unos minutos."}</p>
    </Tarjeta>
  );
}

function Fila({ k, v, sub }) {
  return (
    <div className="fila">
      <div className="k">{k}</div>
      <div className="v">
        {v}
        {sub && <div className="sub">{sub}</div>}
      </div>
    </div>
  );
}

// ---- Superficie, restricciones y agua superficial
function TarjetaTerritorio({ r }) {
  const { R, fuentes, osm, areaHa } = r;
  const disponibles = 100 - R.pctExcluido;
  const estado = R.pctExcluido >= 100 ? "veto" : R.pctExcluido > 0 || R.pctAviso > 0 ? "riesgo" : fuentes.sma === "ok" && fuentes.humedales === "ok" ? "apto" : "nd";
  const cauces = osm ? osm.cauces : [];
  return (
    <Tarjeta titulo="Superficie y restricciones territoriales" estado={estado}>
      <div className="barra">
        <span style={{ width: disponibles + "%", background: "#2e7d32" }} />
        <span style={{ width: R.pctExcluido + "%", background: "#c62828" }} />
      </div>
      <Fila k="Superficie marcada" v={`${fmt(areaHa, areaHa < 10 ? 2 : 1)} ha`} />
      <Fila k="Disponible para plantar" v={`${fmt((areaHa * disponibles) / 100, areaHa < 10 ? 2 : 1)} ha (${fmt(disponibles)}%)`} />
      {R.pctMar > 0 && <Fila k="Mar" v={`${fmt(R.pctMar)}% del terreno`} sub="Elevación ≤ 0 m según el modelo Copernicus." />}
      {(R.pctAguaNatural > 0 || R.pctAguaArtificial > 0) && (
        <Fila
          k="Superficie de agua"
          v={`${fmt(R.pctAguaNatural + R.pctAguaArtificial)}% del terreno`}
          sub={`${R.nombresAgua.join(", ")}. No es plantable.${R.pctAguaArtificial > 0 ? " Los tranques y embalses artificiales no son áreas protegidas." : ""}`}
        />
      )}
      {R.protegidasVeto.length > 0 && (
        <Fila
          k="Áreas protegidas"
          v={R.pctProtegida > 0 ? `${fmt(R.pctProtegida)}% del terreno` : "toca el borde del terreno"}
          sub={R.protegidasVeto.map((p) => p.etiqueta).join("; ") + ". No admite plantación."}
        />
      )}
      {R.humedalesNat.length > 0 && (
        <Fila
          k="Humedales (inventario MMA)"
          v={R.pctHumedal > 0 ? `${fmt(R.pctHumedal)}% del terreno` : "toca el borde del terreno"}
          sub={
            R.humedalesNat.map((h) => `${h.nombre} (${h.tipo})`).join("; ") +
            ". Intervenir un humedal (drenar, rellenar, plantar) puede requerir evaluación ambiental; esa superficie se excluye."
          }
        />
      )}
      {(R.protegidasAviso.length > 0 || R.humedalesArt.length > 0) && (
        <Fila
          k="Advertencias"
          v={R.pctAviso > 0 ? `${fmt(R.pctAviso)}% del terreno` : "en el borde del terreno"}
          sub={[...R.protegidasAviso.map((p) => p.etiqueta), ...R.humedalesArt.map((h) => `Humedal artificial: ${h.nombre}`)].join("; ") +
            ". No impide plantar, pero conviene revisar sus normas."}
        />
      )}
      {cauces.filter((c) => c.natural && c.dentro).length > 0 && (
        <Fila
          k="Cauces naturales"
          v="cruzan el terreno"
          sub={cauces.filter((c) => c.natural && c.dentro).map((c) => (c.nombre ? `${c.tipo} ${c.nombre}` : c.tipo)).join(", ") +
            ". Considerar riesgo de crecidas y restricciones en la ribera."}
        />
      )}
      {cauces.filter((c) => !c.natural).length > 0 && (
        <Fila
          k="Canales y acequias"
          v={cauces.some((c) => !c.natural && c.dentro) ? "dentro o junto al terreno" : "cerca del terreno"}
          sub={cauces.filter((c) => !c.natural).map((c) => (c.nombre ? `${c.tipo} ${c.nombre}` : c.tipo)).join(", ") +
            " (OpenStreetMap). No restringen; pueden ser útiles para el riego si el predio tiene derechos."}
        />
      )}
      {fuentes.sma !== "ok" && <p className="falla">No se pudo consultar la SMA: no se puede descartar que haya áreas protegidas.</p>}
      {fuentes.humedales !== "ok" && <p className="falla">No se pudo consultar el inventario de humedales del MMA.</p>}
      {fuentes.osm !== "ok" && <p className="falla">No se pudo consultar OpenStreetMap (cuerpos de agua).</p>}
      {fuentes.elevacion !== "ok" && <p className="falla">No se pudo consultar la elevación (detección de mar y pendiente).</p>}
      {R.dudosos > 0 && <p className="falla">En {R.dudosos} puntos no se pudo confirmar la restricción.</p>}
    </Tarjeta>
  );
}

// ---- Clima
function TarjetaClima({ clima }) {
  if (!clima) return <SinDato titulo="Clima (ERA5-Land)" />;
  return (
    <Tarjeta titulo={`Clima — promedio ${clima.desde}–${clima.hasta}`} estado={clima.estado}>
      <Fila
        k="Grados-día (Winkler, base 10 °C, oct–abr)"
        v={`${fmt(clima.gdd)} °C·día — Región ${clima.region.n} (${clima.region.desc})`}
        sub={`Entre temporadas varió de ${fmt(clima.gddMin)} a ${fmt(clima.gddMax)}.`}
      />
      <Fila k="Temperatura media de temporada (oct–abr)" v={`${fmt(clima.gst, 1)} °C — categoría ${clima.gstClase} (Jones)`} />
      <Fila k="Índice heliotérmico de Huglin" v={`${fmt(clima.huglin)} — ${clima.huglinClase}`} />
      {clima.nochesClase && <Fila k="Índice de frío nocturno (mínima media de marzo)" v={`${fmt(clima.noches, 1)} °C — ${clima.nochesClase}`} />}
      <Fila
        k="Heladas primaverales (15 sep–30 nov)"
        v={`${fmt(clima.heladas, 1)} días por temporada en promedio`}
        sub={`Hubo heladas en ${clima.aniosConHelada} de ${clima.temporadas} temporadas.`}
      />
      <Fila
        k="Precipitación"
        v={
          clima.lluviaTemp == null
            ? "sin dato (la fuente no respondió)"
            : `${fmt(clima.lluviaTemp)} mm en temporada (oct–abr) · ${fmt(clima.lluviaVend)} mm en vendimia (mar–abr)`
        }
        sub={clima.lluviaAnual != null ? `Promedio anual (mayo–abril): ${fmt(clima.lluviaAnual)} mm. Fuente: ERA5 (~28 km).` : null}
      />
      <ul className="notas">
        {clima.notas.map((n, i) => (
          <li key={i}>{n}</li>
        ))}
      </ul>

      <h4>Cepas según su rango térmico publicado</h4>
      <table className="tabla">
        <thead>
          <tr>
            <th>Cepa</th>
            <th>Rango óptimo (temp. media de temporada)</th>
            <th>¿Calza?</th>
          </tr>
        </thead>
        <tbody>
          {clima.cepas.map((c) => (
            <tr key={c.cepa}>
              <td>{c.cepa}</td>
              <td>
                {fmt(c.min, 1)}–{fmt(c.max, 1)} °C
              </td>
              <td className={c.encaja}>{{ si: "Sí", limite: "En el límite", no: "No" }[c.encaja]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="tenue">
        Rangos publicados por G. V. Jones (ver Fuentes). Otras cepas (Carmenère, Syrah, Merlot, Sauvignon Blanc…) no se
        listan porque no encontramos sus rangos numéricos publicados en texto, y no se inventan cifras.
      </p>
      <p className="tenue">
        Temperaturas {clima.modelo} (Copernicus/ECMWF), resolución de ~{clima.modelo === "ERA5-Land" ? "9" : "28"} km:
        describen el clima de la zona, no el microclima de un cuartel. Los reanálisis pueden diferir en torno a ±1 °C de una
        estación local, por eso "en el límite" considera ±0,5 °C. Las heladas en fondos de valle pueden ser más frecuentes que
        lo indicado; conviene validar con una estación agrometeorológica cercana.
      </p>
    </Tarjeta>
  );
}

// ---- Suelo
function TarjetaSuelo({ suelo }) {
  if (!suelo) return <SinDato titulo="Suelo (CIREN — capacidad de uso)" texto="El servidor de CIREN no respondió. Sin este dato el veredicto es provisorio; reintenta más tarde." />;
  if (!suelo.clases.length) return <SinDato titulo="Suelo (CIREN — capacidad de uso)" texto={suelo.nota} />;
  return (
    <Tarjeta titulo="Suelo — capacidad de uso (CIREN)" estado={suelo.estado}>
      <div className="barra">
        {suelo.clases.map((c) => (
          <span key={c.clase} style={{ width: c.pct + "%", background: cfg(c.estado).color }} title={`Clase ${c.clase}`} />
        ))}
      </div>
      {suelo.clases.map((c) => (
        <div className="param" key={c.clase}>
          <span className={"punto " + c.estado} />
          <div>
            <strong>
              {c.titulo} — {fmt(c.pct)}% de la superficie disponible
            </strong>
            <div>{c.desc}</div>
          </div>
        </div>
      ))}
      {suelo.subclases.length > 0 && (
        <p>
          <strong>Limitaciones indicadas (subclases):</strong> {suelo.subclases.map((s) => `${s.s} = ${s.desc}`).join("; ")}.
        </p>
      )}
      <p className="tenue">
        La capacidad de uso (clases I a VIII) mide la aptitud del suelo para cultivos en general, no específicamente para
        vid: las clases I–IV son arables y las V–VIII no arables. Muchas viñas de ladera se establecen en clases IV a VI con
        manejo. Confirmar siempre con calicatas. Basado en {suelo.muestras} puntos
        {suelo.fallos ? ` (${suelo.fallos} sin respuesta de CIREN)` : ""}
        {suelo.sinCobertura ? `; ${suelo.sinCobertura} fuera de la cobertura del estudio` : ""}.
      </p>
    </Tarjeta>
  );
}

// ---- Relieve
function TarjetaRelieve({ p }) {
  if (!p) return <SinDato titulo="Pendiente y relieve" />;
  if (p.estado === "nd") return <SinDato titulo="Pendiente y relieve" texto={p.nota} />;
  return (
    <Tarjeta titulo="Pendiente y relieve" estado={p.estado}>
      <Fila k="Pendiente media" v={`${fmt(p.media)}%`} sub={p.nota} />
      <Fila k="Superficie con pendiente > 15% / > 30%" v={`${fmt(p.pct15)}% / ${fmt(p.pct30)}%`} />
      <Fila k="Altitud" v={`${fmt(p.elevMin)}–${fmt(p.elevMax)} m s.n.m.`} />
      <Fila k="Exposición general" v={p.exposicion || "terreno prácticamente plano"} sub={p.notaExposicion} />
      {p.resolucionBaja && (
        <p className="tenue">
          El modelo de elevación tiene ~90 m de resolución: en terrenos pequeños la pendiente es aproximada. Verificar con
          topografía.
        </p>
      )}
    </Tarjeta>
  );
}

// ---- Agua subterránea
function TarjetaAgua({ agua }) {
  if (!agua) return <SinDato titulo="Agua subterránea (DGA)" />;
  return (
    <Tarjeta titulo="Agua subterránea (DGA)" estado={agua.estado}>
      {agua.zonas.map((z, i) => (
        <Fila key={i} k={z.tipo} v={`SHAC ${z.shac}`} sub={z.acuifero ? `Acuífero ${z.acuifero}` : null} />
      ))}
      <p>{agua.nota}</p>
      <p className="tenue">
        Indica la situación administrativa del acuífero. No reemplaza revisar los derechos de agua (subterráneos o
        superficiales) que tenga el predio.
      </p>
    </Tarjeta>
  );
}

// ---- Escasez hídrica
function TarjetaEscasez({ e }) {
  if (!e) return <SinDato titulo="Escasez hídrica (DGA)" />;
  return (
    <Tarjeta titulo="Escasez hídrica (DGA)" estado={e.estado}>
      <p>{e.nota}</p>
      {e.decretos.length > 0 ? (
        <>
          <p>
            <strong>Historial:</strong> {e.decretos.length} decreto{e.decretos.length > 1 ? "s" : ""} de escasez han
            cubierto este terreno
            {e.recurrente ? `, en ${e.aniosRecientes} de los últimos 10 años (zona con escasez recurrente)` : ""}.
          </p>
          <table className="tabla">
            <thead>
              <tr>
                <th>Decreto</th>
                <th>Vigencia</th>
                <th>Territorio</th>
              </tr>
            </thead>
            <tbody>
              {e.decretos.slice(0, 8).map((d) => (
                <tr key={d.num + "-" + d.anio}>
                  <td>
                    N° {d.num}/{d.anio}
                  </td>
                  <td>
                    {fecha(d.desde)} – {fecha(d.hasta)}
                    {d.vigente ? " (vigente)" : ""}
                  </td>
                  <td>{d.lugar || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <p>No hay decretos de escasez registrados para este terreno en la capa de la DGA.</p>
      )}
      {e.ultimoCapa && <p className="tenue">Decreto más reciente cargado en la capa de la DGA: {fecha(e.ultimoCapa)}.</p>}
    </Tarjeta>
  );
}

// =====================================================================
//  Panel de fuentes — SIEMPRE al final
// =====================================================================
const FUENTES = [
  {
    clave: "clima",
    n: "Clima — ERA5-Land (Copernicus / ECMWF), vía Open-Meteo",
    por: "Reanálisis climático del Centro Europeo de Previsiones Meteorológicas a Plazo Medio (ECMWF) para el programa Copernicus de la Unión Europea; es la referencia científica estándar para series climáticas largas. Se usan temperaturas y lluvias diarias de las últimas 10 temporadas completas.",
    leer: "Grados-día de Winkler y temperatura media de temporada (oct–abr): más alto = más calor para madurar. Huglin pondera además las máximas. Las clases vienen de Amerine & Winkler (1944), Jones (2006) y Tonietto & Carbonneau (2004).",
    links: [
      ["API de datos históricos (Open-Meteo)", "https://open-meteo.com/en/docs/historical-weather-api"],
      ["Tonietto & Carbonneau (2004), Agricultural and Forest Meteorology", "https://doi.org/10.1016/j.agrformet.2003.06.001"],
    ],
  },
  {
    clave: "clima",
    n: "Cepas — rangos térmicos de G. V. Jones",
    por: "Gregory V. Jones es climatólogo especializado en viticultura; sus rangos de temperatura media de temporada por cepa son de uso internacional.",
    leer: "Una cepa \"calza\" si la temperatura media de temporada del terreno está dentro de su rango óptimo publicado.",
    links: [
      ["Jones, Climate, Grapes and Wine (VIII Congreso Internacional de Terroir)", "https://ives-openscience.eu/wp-content/uploads/2023/03/Climate_Grape_Wine_Jones.pdf"],
      ["Jones (2015), Climate, Grapes, and Wine — GuildSomm", "https://www.guildsomm.com/public_content/features/articles/b/gregory_jones/posts/climate-grapes-and-wine"],
    ],
  },
  {
    clave: "suelo",
    n: "Suelo — CIREN, Estudio Agrológico (capacidad de uso)",
    por: "El Centro de Información de Recursos Naturales (Ministerio de Agricultura) elabora la cartografía oficial de suelos de Chile y su clasificación por capacidad de uso (clases I a VIII).",
    leer: "Clases I–IV: arables, con limitaciones crecientes. V–VIII: no arables. Las letras (subclase) indican el tipo de limitación.",
    links: [["Capa oficial de CIREN (servicio de mapas)", URLS.ciren]],
  },
  {
    clave: "agua",
    n: "Agua subterránea — DGA (Ministerio de Obras Públicas)",
    por: "La Dirección General de Aguas administra los derechos de agua y declara la condición de cada Sector Hidrogeológico de Aprovechamiento Común (SHAC).",
    leer: "Abierto: se pueden pedir nuevos derechos. Área de Restricción: solo derechos provisionales. Zona de Prohibición: no se otorgan nuevos derechos.",
    links: [["Capa oficial de la DGA", URLS.dgaAgua]],
  },
  {
    clave: "escasez",
    n: "Escasez hídrica — DGA, decretos de escasez",
    por: "Los decretos de escasez los dicta el MOP a propuesta de la DGA y permiten redistribuir y restringir el uso del agua mientras están vigentes.",
    leer: "Se considera vigente un decreto cuya fecha de caducidad es posterior a hoy. El historial muestra si la zona sufre sequías recurrentes.",
    links: [["Capa oficial de la DGA", URLS.dgaEscasez]],
  },
  {
    clave: "humedales",
    n: "Humedales — MMA, Inventario Nacional de Humedales",
    por: "El Ministerio del Medio Ambiente mantiene el inventario oficial de humedales del país, clasificados en naturales (continentales, costeros) y artificiales.",
    leer: "La superficie de humedales naturales se excluye de lo plantable. Los artificiales (tranques, embalses) se muestran como advertencia.",
    links: [
      ["Capa oficial del MMA", URLS.mmaHumedales],
      ["Portal de humedales del MMA", "https://humedaleschile.mma.gob.cl/"],
    ],
  },
  {
    clave: "sma",
    n: "Áreas protegidas — SMA, Áreas de protección oficial",
    por: "La Superintendencia del Medio Ambiente reúne en un solo servicio las áreas protegidas oficiales: parques y reservas nacionales, monumentos naturales, santuarios, sitios RAMSAR, humedales urbanos y otras protecciones.",
    leer: "Parques, reservas nacionales, monumentos naturales, santuarios, sitios RAMSAR y humedales urbanos excluyen superficie. Reservas forestales, zonas típicas, monumentos históricos, ZOIT y zonas de planes reguladores se muestran como advertencia.",
    links: [["Servicio oficial de la SMA", URLS.smaProteccion]],
  },
  {
    clave: "elevacion",
    n: "Pendiente y elevación — Copernicus DEM GLO-90, vía Open-Meteo",
    por: "Modelo digital de elevación global del programa Copernicus (Agencia Espacial Europea), resolución de 90 m. Se usa para pendiente, exposición y detección de mar.",
    leer: "Las clases de pendiente siguen la guía de descripción de suelos de la FAO (2006).",
    links: [
      ["API de elevación (Open-Meteo)", "https://open-meteo.com/en/docs/elevation-api"],
      ["FAO (2006), Guidelines for Soil Description", "https://fao.org/4/a0541e/a0541e.pdf"],
    ],
  },
  {
    clave: "osm",
    n: "Cuerpos de agua y canales — OpenStreetMap (control cruzado)",
    por: "Cartografía colaborativa mundial; NO es una fuente oficial. Se usa solo como control cruzado para detectar lagos, ríos, embalses y canales.",
    leer: "La superficie de agua se excluye de lo plantable. Canales y acequias se informan, pero no restringen.",
    links: [["OpenStreetMap", "https://www.openstreetmap.org/"]],
  },
];

const ESTADO_FUENTE = { ok: "consultada", error: "no respondió", "no aplica": "no aplica" };

function PanelFuentes({ r }) {
  return (
    <div className="tarjeta fuentes">
      <h3>Fuentes y cómo leerlas</h3>
      <p>
        Los datos provienen de organismos oficiales chilenos y de referencias científicas internacionales; OpenStreetMap se
        usa solo como control cruzado. Cada fuente se puede verificar en su enlace.
        {r && ` Consulta realizada el ${r.consultado.toLocaleString("es-CL")}.`}
      </p>
      {FUENTES.map((f, i) => {
        const est = r ? r.fuentes[f.clave] : null;
        return (
          <details key={i}>
            <summary>
              {f.n}
              {est && <span className={"badge " + (est === "ok" ? "ok" : est === "error" ? "error" : "")}>{ESTADO_FUENTE[est] || est}</span>}
            </summary>
            <p><strong>Qué es y por qué es autoridad:</strong> {f.por}</p>
            <p><strong>Cómo leerlo:</strong> {f.leer}</p>
            <p>
              {f.links.map(([t, u], j) => (
                <React.Fragment key={j}>
                  <a href={u} target="_blank" rel="noreferrer">
                    {t} ↗
                  </a>
                  <br />
                </React.Fragment>
              ))}
            </p>
          </details>
        );
      })}
      <p>Búsqueda de lugares: Nominatim (OpenStreetMap). Mapas base: OpenStreetMap y Esri.</p>
    </div>
  );
}
