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
//   red.js · geometria.js · capas.js · territorio.js · suelo.js ·
//   tiempo.js · denominaciones.js · veredicto.js
// =====================================================================

import React, { useState, useMemo } from "react";
import { MapContainer, TileLayer, Polygon, CircleMarker, useMapEvents, useMap } from "react-leaflet";
import { areaM2, centroide, grillaInterna, seAutoIntersecta } from "./lib/geometria.js";
import {
  URLS,
  fmt,
  calcularRiego,
  fecha,
  pedirElevaciones,
  calcularPendiente,
  pedirSuelo,
  pedirAgua,
  pedirEscasez,
  pedirHumedales,
  pedirProtegidas,
  buscarLugar,
} from "./lib/capas.js";
import {
  pedirUbicacion,
  pedirUsoSuelo,
  pedirHidrografia,
  pedirLimiteUrbano,
  pedirRiesgoIPT,
  pedirAgotamiento,
  puntosEnTierra,
} from "./lib/territorio.js";
import { pedirErosion, pedirSoilGrids } from "./lib/suelo.js";
import { pedirClima, MARGEN_CEPAS } from "./lib/clima.js";
import { pedirAgroclimaCIREN, pedirPronostico, urlWindy, urlWindyCompleto } from "./lib/tiempo.js";
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

const dec = (n) => (n < 10 ? 2 : 1);

// ---------------------------------------------------------------------
//  Componentes de mapa
// ---------------------------------------------------------------------
function CapturaClics({ activo, onPunto, onMover }) {
  const map = useMapEvents({
    click(e) {
      if (activo) onPunto([e.latlng.lat, e.latlng.lng]);
    },
    moveend() {
      const c = map.getCenter();
      onMover([c.lat, c.lng]);
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
  const [centroMapa, setCentroMapa] = useState([-33.85, -70.75]);
  const [verWindy, setVerWindy] = useState(false);
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
      const c0 = centroide(poly);

      setPaso("Revisando ubicación, restricciones territoriales y agua…");
      const [elev, sma, hum, agua, escasez, uso, hidro, limUrb, riesgoIPT, agot] = await Promise.all([
        marca("elevacion", pedirElevaciones(lls)),
        marca("sma", pedirProtegidas(poly, lls)),
        marca("humedales", pedirHumedales(poly, lls)),
        marca("agua", pedirAgua(poly)),
        marca("escasez", pedirEscasez(poly)),
        marca("uso", pedirUsoSuelo(poly, lls)),
        marca("hidro", pedirHidrografia(poly)),
        marca("limUrb", pedirLimiteUrbano(poly, lls)),
        marca("riesgo", pedirRiesgoIPT(poly)),
        marca("agotamiento", pedirAgotamiento(poly)),
      ]);

      // Un punto con elevación ≤ 0 m se considera mar solo si además está
      // fuera de toda comuna (evita marcar como mar humedales costeros a nivel del mar).
      let elevMar = elev;
      if (elev) {
        const bajos = elev.map((e, k) => (e != null && e <= 0 ? k : -1)).filter((k) => k >= 0);
        if (bajos.length) {
          const tierra = await puntosEnTierra(bajos.map((k) => lls[k])).catch(() => null);
          elevMar = elev.slice();
          bajos.forEach((k, n) => {
            if (!tierra || tierra[n] !== false) elevMar[k] = 1;
          });
        }
      }
      const R = calcularRestricciones(lls.length, { elev: elevMar, osm: null, hum, sma });

      let clima = null;
      let suelo = null;
      let pendiente = null;
      let soil = null;
      let erosion = null;
      let agroclima = null;
      let pronostico = null;
      // La ubicación se consulta en el centro de la superficie disponible
      // (si el centro del polígono cae en el mar, no habría comuna).
      const cUbic = R.libres.length ? centroide(R.libres.map((k) => lls[k])) : c0;
      const ubic = await marca("ubicacion", pedirUbicacion(cUbic));
      const fueraDeChile = ubic && ubic.enChile === false;
      if (R.libres.length && !fueraDeChile) {
        setPaso("Calculando clima, suelo, riego y pronóstico…");
        const libres = R.libres.map((k) => lls[k]);
        const c = centroide(libres);
        [clima, suelo, soil, erosion, agroclima, pronostico] = await Promise.all([
          marca("clima", pedirClima(c[0], c[1])),
          marca("suelo", pedirSuelo(libres)),
          marca("soilgrids", pedirSoilGrids(c)),
          marca("erosion", pedirErosion(c)),
          marca("agroclima", pedirAgroclimaCIREN(c)),
          marca("pronostico", pedirPronostico(c)),
        ]);
        pendiente = elev ? calcularPendiente(grid, elev, R.libres) : null;
      } else {
        ["clima", "suelo", "soilgrids", "erosion", "agroclima", "pronostico"].forEach((k) => (fuentes[k] = "no aplica"));
      }

      setResultado({
        poly,
        grid,
        centro: c0,
        areaHa: areaM2(poly) / 10000,
        R,
        clima,
        suelo,
        soil,
        erosion,
        agroclima,
        pronostico,
        pendiente,
        agua,
        escasez,
        ubic,
        uso,
        hidro,
        limUrb,
        riesgoIPT,
        agot,
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

  // Al terminar el análisis, llevar la vista al veredicto (útil en celular)
  const refVeredicto = React.useRef(null);
  React.useEffect(() => {
    if (resultado && refVeredicto.current) {
      try {
        refVeredicto.current.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch (e) {
        /* navegadores antiguos */
      }
    }
  }, [resultado]);

  return (
    <div>
      <header className="cabecera">
        <div className="cabecera-in">
          <img src="/logo.png" alt="WineCheck" className="logo" width="111" height="72" />
          <div>
            <h1 className="sr-only">WineCheck</h1>
            <p className="lema">
              <strong>¿Se puede plantar una viña aquí?</strong>
              Prefactibilidad con datos oficiales de Chile.
            </p>
          </div>
        </div>
      </header>

      <div className="wrap">
        <form className="buscador" onSubmit={onBuscar}>
          <input
            type="search"
            enterKeyHint="search"
            aria-label="Buscar lugar o comuna"
            placeholder="Buscar lugar o comuna"
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
          <button className={"btn-windy " + (verWindy ? "activo" : "")} onClick={() => setVerWindy((v) => !v)}>
            {verWindy ? "Ocultar tiempo" : "Tiempo en vivo (Windy)"}
          </button>
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

            <CapturaClics activo={!cargando} onPunto={(p) => setPuntos((prev) => [...prev, p])} onMover={setCentroMapa} />
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

        {verWindy && <PanelWindy centro={puntos.length >= 3 ? centroide(puntos) : centroMapa} />}

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
              {puntos.length >= 3 ? ` · ${fmt(areaHa, dec(areaHa))} ha` : ""}
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
        {cargando && (
          <div className="cargando" role="status">
            {paso || "Consultando fuentes oficiales…"} Puede tardar hasta un minuto.
          </div>
        )}

        {resultado && ver && (
          <>
            <div className={"veredicto " + ver.estado} ref={refVeredicto} style={{ scrollMarginTop: 12 }}>
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

            {!ver.vetoTotal && (
              <nav className="indice">
                {[
                  ["s-ubicacion", "Ubicación"],
                  ["s-territorio", "Restricciones"],
                  ["s-clima", "Clima"],
                  ["s-riego", "Riego"],
                  ["s-suelo", "Suelo"],
                  ["s-relieve", "Relieve"],
                  ["s-agua", "Agua"],
                  ["s-tiempo", "Pronóstico"],
                  ["s-fuentes", "Fuentes"],
                ].map(([id, t]) => (
                  <a key={id} href={"#" + id}>
                    {t}
                  </a>
                ))}
              </nav>
            )}

            <TarjetaUbicacion u={resultado.ubic} />
            <TarjetaTerritorio r={resultado} />

            {!ver.vetoTotal && (
              <>
                <TarjetaUso uso={resultado.uso} />
                <TarjetaClima clima={resultado.clima} />
                <TarjetaAgroclima a={resultado.agroclima} />
                <TarjetaRiego clima={resultado.clima} agroclima={resultado.agroclima} pron={resultado.pronostico} />
                <TarjetaSuelo suelo={resultado.suelo} />
                <TarjetaPropSuelo soil={resultado.soil} erosion={resultado.erosion} />
                <TarjetaRelieve p={resultado.pendiente} />
                <TarjetaAgua agua={resultado.agua} agot={resultado.agot} />
                <TarjetaEscasez e={resultado.escasez} />
                <TarjetaPronostico p={resultado.pronostico} centro={resultado.centro} />
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
function Tarjeta({ id, titulo, estado, children }) {
  return (
    <div className="tarjeta" id={id}>
      <h3>
        <span className={"punto " + (estado || "nd")} /> {titulo}
        {estado && <span className={"chip " + estado}>{cfg(estado).texto}</span>}
      </h3>
      {children}
    </div>
  );
}

function SinDato({ id, titulo, texto }) {
  return (
    <Tarjeta id={id} titulo={titulo} estado="nd">
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

// ---- Ubicación y denominación de origen
function TarjetaUbicacion({ u }) {
  if (!u) return <SinDato id="s-ubicacion" titulo="Ubicación" />;
  if (!u.enChile)
    return <SinDato id="s-ubicacion" titulo="Ubicación" texto="El terreno no está dentro de Chile según la División Político-Administrativa oficial." />;
  return (
    <Tarjeta id="s-ubicacion" titulo="Ubicación y denominación de origen">
      <Fila k="Comuna" v={u.comuna} sub={`Provincia de ${u.provincia} · Región ${u.region}`} />
      {u.cuenca && <Fila k="Cuenca hidrográfica" v={u.cuenca} sub={u.subcuenca ? `Subcuenca: ${u.subcuenca}` : null} />}
      <Fila
        k="Denominación de origen (vinos)"
        v={u.do ? u.do.valle + (u.do.zona ? ` — ${u.do.zona}` : "") : "Fuera de la zonificación vitícola"}
        sub={
          u.do
            ? `${u.do.region}. Según la zonificación vitícola del Decreto 464 (Ministerio de Agricultura).`
            : "La comuna no figura en el Decreto 464. Se puede plantar, pero el vino no podría rotularse con una DO de valle."
        }
      />
    </Tarjeta>
  );
}

// ---- Superficie, restricciones y agua superficial
function TarjetaTerritorio({ r }) {
  const { R, fuentes, areaHa, limUrb, riesgoIPT, hidro } = r;
  const disponibles = 100 - R.pctExcluido;
  const hayAvisos = R.pctAviso > 0 || (limUrb && limUrb.pct > 0) || (riesgoIPT && riesgoIPT.zonas.length);
  const estado =
    R.pctExcluido >= 100
      ? "veto"
      : R.pctExcluido > 0 || hayAvisos
      ? "riesgo"
      : fuentes.sma === "ok" && fuentes.humedales === "ok"
      ? "apto"
      : "nd";
  const caucesMMA = hidro ? hidro.cauces : [];
  return (
    <Tarjeta id="s-territorio" titulo="Superficie y restricciones territoriales" estado={estado}>
      <div className="barra">
        <span style={{ width: disponibles + "%", background: "#2e7d32" }} />
        <span style={{ width: R.pctExcluido + "%", background: "#c62828" }} />
      </div>
      <Fila k="Superficie marcada" v={`${fmt(areaHa, dec(areaHa))} ha`} />
      <Fila k="Disponible para plantar" v={`${fmt((areaHa * disponibles) / 100, dec(areaHa))} ha (${fmt(disponibles)}%)`} />
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
          sub={
            [...R.protegidasAviso.map((p) => p.etiqueta), ...R.humedalesArt.map((h) => `Humedal artificial: ${h.nombre}`)].join("; ") +
            ". No impide plantar, pero conviene revisar sus normas."
          }
        />
      )}
      {limUrb && limUrb.pct > 0 && (
        <Fila
          k="Límite urbano (MINVU)"
          v={`${fmt(limUrb.pct)}% del terreno`}
          sub={`${limUrb.encontrados.join("; ")}. Dentro del límite urbano el uso del suelo lo define el plan regulador; la plantación agrícola puede no estar permitida.`}
        />
      )}
      {riesgoIPT && riesgoIPT.zonas.length > 0 && (
        <Fila
          k="Áreas de riesgo (plan regulador)"
          v={`${riesgoIPT.zonas.length} zona${riesgoIPT.zonas.length > 1 ? "s" : ""}`}
          sub={riesgoIPT.zonas.map((z) => z.nombre + (z.cat ? ` (${z.cat})` : "")).join("; ") + "."}
        />
      )}
      {caucesMMA.length > 0 && (
        <Fila
          k="Cauces que cruzan el terreno"
          v={`${caucesMMA.length} curso${caucesMMA.length > 1 ? "s" : ""} de agua`}
          sub={
            caucesMMA.map((c) => c.etiqueta).join(", ") +
            " (red hidrográfica oficial, MMA). Los cauces naturales implican riesgo de crecidas y una faja de ribera que no conviene plantar; los canales pueden servir para el riego si el predio tiene derechos."
          }
        />
      )}
      {fuentes.sma !== "ok" && <p className="falla">No se pudo consultar la SMA: no se puede descartar que haya áreas protegidas.</p>}
      {fuentes.humedales !== "ok" && <p className="falla">No se pudo consultar el inventario de humedales del MMA.</p>}
      {fuentes.hidro !== "ok" && <p className="falla">No se pudo consultar la red hidrográfica del MMA.</p>}
      {fuentes.limUrb !== "ok" && <p className="falla">No se pudo consultar los límites urbanos del MINVU.</p>}
      {fuentes.elevacion !== "ok" && <p className="falla">No se pudo consultar la elevación (detección de mar y pendiente).</p>}
      {R.dudosos > 0 && <p className="falla">En {R.dudosos} puntos no se pudo confirmar la restricción.</p>}
    </Tarjeta>
  );
}

// ---- Uso actual del suelo
function TarjetaUso({ uso }) {
  if (!uso) return <SinDato titulo="Uso actual del suelo (CONAF)" />;
  if (!uso.clases.length) return <SinDato titulo="Uso actual del suelo (CONAF)" texto="El catastro no tiene información para este terreno." />;
  return (
    <Tarjeta titulo="Uso actual del suelo (catastro CONAF)" estado={uso.hayBosqueNativo ? "riesgo" : undefined}>
      {uso.clases.map((c) => (
        <Fila key={c.nombre} k={c.nombre} v={`${fmt(c.pct)}% del terreno`} />
      ))}
      {uso.hayBosqueNativo && (
        <p>
          <strong>Hay bosque nativo en el terreno según el catastro.</strong> Toda corta de bosque nativo requiere
          un plan de manejo aprobado por CONAF (Ley 20.283, art. 5), y la corta sin plan se multa.
        </p>
      )}
      <p className="tenue">
        Catastro de Uso de Suelo y Vegetación de CONAF, síntesis nacional del MMA. Fecha de la fuente según región:{" "}
        {uso.anios.join(", ") || "—"}; el uso real puede haber cambiado desde entonces (revisar con la imagen satelital).
      </p>
    </Tarjeta>
  );
}

// ---- Clima (ARClim)
function TarjetaClima({ clima }) {
  if (!clima) return <SinDato id="s-clima" titulo="Clima (ARClim)" />;
  const p = clima.presente;
  const f2 = clima.f245;
  const f5 = clima.f585;
  const filas = [
    ["Grados-día de Winkler (base 10 °C, oct–abr)", "gdd", " °C·día", 0],
    ["Temperatura media de temporada (oct–abr)", "gst", " °C", 1],
    ["Índice heliotérmico de Huglin", "huglin", "", 0],
    ["Mínima media de marzo (frío nocturno)", "tminMar", " °C", 1],
    ["Máxima media de enero", "tmaxEnero", " °C", 1],
    ["Días con helada en primavera (sep–nov)", "heladasPrimavera", " días", 1],
    ["Días con helada al año", "heladasAnio", " días", 1],
    ["Días sobre 30 °C al año", "diasCalurosos", " días", 0],
    ["Lluvia anual", "lluviaAnual", " mm", 0],
    ["Lluvia de temporada (oct–abr)", "lluviaTemp", " mm", 0],
  ];
  const val = (o, k, u, d) => (o && o[k] != null ? fmt(o[k], d) + u : "—");
  return (
    <Tarjeta id="s-clima" titulo="Clima del terreno (ARClim)" estado={clima.estado}>
      <Fila k="Región de Winkler" v={`Región ${clima.region.n} (${clima.region.desc})`} />
      <Fila k="Categoría según temperatura de temporada (Jones)" v={clima.gstClase} />
      <Fila k="Índice de Huglin (Tonietto & Carbonneau)" v={clima.huglinClase} />
      {clima.nochesClase && <Fila k="Índice de frío nocturno (Tonietto & Carbonneau)" v={clima.nochesClase} />}
      <ul className="notas">
        {clima.notas.map((n, i) => (
          <li key={i}>{n}</li>
        ))}
      </ul>
      <div className="tabla-scroll">
        <table className="tabla">
          <thead>
            <tr>
              <th>Variable</th>
              <th>1980–2010</th>
              {f2 && <th>2035–2065 (SSP2-4.5)</th>}
              {f5 && <th>2035–2065 (SSP5-8.5)</th>}
            </tr>
          </thead>
          <tbody>
            {filas.map(([t, k, u, d]) => (
              <tr key={k}>
                <td>{t}</td>
                <td>{val(p, k, u, d)}</td>
                {f2 && <td>{val(f2, k, u, d)}</td>}
                {f5 && <td>{val(f5, k, u, d)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h4>Cepas según su rango térmico publicado</h4>
      <div className="tabla-scroll">
        <table className="tabla">
          <thead>
            <tr>
              <th>Cepa</th>
              <th>Rango óptimo (temp. media de temporada)</th>
              <th>¿Calza hoy?</th>
              {f2 && <th>¿Calza 2035–2065?</th>}
            </tr>
          </thead>
          <tbody>
            {clima.cepas.map((c) => {
              const fut = f2 ? (f2.gst >= c.min && f2.gst <= c.max ? "si" : f2.gst >= c.min - MARGEN_CEPAS && f2.gst <= c.max + MARGEN_CEPAS ? "limite" : "no") : null;
              const tx = { si: "Sí", limite: "En el límite", no: "No" };
              return (
                <tr key={c.cepa}>
                  <td>{c.cepa}</td>
                  <td>
                    {fmt(c.min, 1)}–{fmt(c.max, 1)} °C
                  </td>
                  <td className={c.encaja}>{tx[c.encaja]}</td>
                  {f2 && <td className={fut}>{tx[fut]}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="tenue">
        Rangos publicados en texto por G. V. Jones (ver Fuentes). "En el límite" = a menos de 1 °C del rango, por la
        incertidumbre de los datos. Otras cepas (Carmenère, Syrah, Merlot, Sauvignon Blanc…) no se listan porque no
        encontramos sus rangos numéricos publicados en texto, y no se inventan cifras.
      </p>
      <p className="tenue">
        Fuente: ARClim, Atlas de Riesgos Climáticos del Ministerio del Medio Ambiente: grilla de ~5 km referenciada a CR2MET
        (producto basado en estaciones chilenas); futuro según el promedio de modelos climáticos CMIP6 corregidos. Índices
        calculados con promedios mensuales. Elevación media de la celda: {fmt(clima.elevCelda)} m
        {clima.vecina ? " (se usó la celda vecina más cercana)" : ""}. Una celda de 5 km no capta el microclima de un cuartel:
        en fondos de valle las heladas pueden ser más frecuentes y en laderas o quebradas la temperatura puede diferir.
      </p>
    </Tarjeta>
  );
}

// ---- Agroclima oficial de CIREN (donde existe)
function TarjetaAgroclima({ a }) {
  if (!a || !a.disponible) return null;
  const filas = [
    ["Suma térmica anual", "sumaTermica", " °C·día", 0],
    ["Período libre de heladas", "libreHeladas", " días", 0],
    ["Heladas al año", "nHeladas", "", 0],
    ["Temperatura máxima media de enero", "tmaxEnero", " °C", 1],
    ["Temperatura mínima media de julio", "tminJulio", " °C", 1],
    ["Precipitación anual", "precip", " mm", 0],
    ["Evapotranspiración de referencia anual", "etp", " mm", 0],
    ["Déficit hídrico anual", "deficit", " mm", 0],
  ];
  const val = (o, k, u, d) => (o && o[k] != null ? fmt(o[k], d) + u : "—");
  return (
    <Tarjeta titulo={`Agroclima oficial (CIREN) — zona ${a.zona || ""}`}>
      <table className="tabla">
        <thead>
          <tr>
            <th>Variable</th>
            <th>Clima actual</th>
            {a.cercano && <th>Futuro cercano</th>}
            {a.medio && <th>Futuro medio</th>}
          </tr>
        </thead>
        <tbody>
          {filas.map(([t, k, u, d]) => (
            <tr key={k}>
              <td>{t}</td>
              <td>{val(a.actual, k, u, d)}</td>
              {a.cercano && <td>{val(a.cercano, k, u, d)}</td>}
              {a.medio && <td>{val(a.medio, k, u, d)}</td>}
            </tr>
          ))}
          {a.actual.primeraHelada && (
            <tr>
              <td>Primera / última helada</td>
              <td>
                {String(a.actual.primeraHelada).toLowerCase()} / {String(a.actual.ultimaHelada || "—").toLowerCase()}
              </td>
              {a.cercano && <td>{String(a.cercano.primeraHelada || "—").toLowerCase()} / {String(a.cercano.ultimaHelada || "—").toLowerCase()}</td>}
              {a.medio && <td>{String(a.medio.primeraHelada || "—").toLowerCase()} / {String(a.medio.ultimaHelada || "—").toLowerCase()}</td>}
            </tr>
          )}
        </tbody>
      </table>
      <p className="tenue">
        Fuente: {a.estudio}. Es el estudio oficial de CIREN para la zona y sirve para contrastar los datos de ARClim. Los horizontes
        "futuro cercano" y "futuro medio" son los del estudio de CIREN (el servicio de mapas no indica sus años exactos).
        CIREN tiene esta zonificación solo para algunas regiones.
      </p>
    </Tarjeta>
  );
}

// ---- Riego (FAO-56)
function TarjetaRiego({ clima, agroclima, pron }) {
  const riego = calcularRiego(clima, agroclima);
  if (!riego) return <SinDato id="s-riego" titulo="Necesidad de riego (FAO-56)" />;
  const proxEt0 = pron ? pron.dias.slice(0, 7).reduce((a, d) => a + (d.et0 || 0), 0) : null;
  const proxLluvia = pron ? pron.dias.slice(0, 7).reduce((a, d) => a + (d.lluvia || 0), 0) : null;
  const col = [
    riego.arclim && ["ARClim 1980–2010", riego.arclim],
    riego.futuro && ["ARClim 2035–2065 (SSP2-4.5)", riego.futuro],
    riego.ciren && ["Estudio CIREN", riego.ciren],
  ].filter(Boolean);
  return (
    <Tarjeta id="s-riego" titulo="Necesidad de riego estimada (FAO-56)">
      <div className="tabla-scroll">
        <table className="tabla">
          <thead>
            <tr>
              <th>Temporada oct–abr</th>
              {col.map(([t]) => (
                <th key={t}>{t}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Evapotranspiración de referencia (ET0)</td>
              {col.map(([t, v]) => (
                <td key={t}>{v.et0 != null ? `${fmt(v.et0)} mm` : "—"}</td>
              ))}
            </tr>
            <tr>
              <td>Consumo de la viña (ETc = Kc × ET0)</td>
              {col.map(([t, v]) => (
                <td key={t}>{fmt(v.etc)} mm</td>
              ))}
            </tr>
            <tr>
              <td>Lluvia</td>
              {col.map(([t, v]) => (
                <td key={t}>{fmt(v.lluvia)} mm</td>
              ))}
            </tr>
            <tr>
              <td>
                <strong>Riego necesario (aprox.)</strong>
              </td>
              {col.map(([t, v]) => (
                <td key={t}>
                  <strong>
                    {fmt(v.deficit)} mm ≈ {fmt(v.deficit * 10)} m³/ha
                  </strong>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="tenue">
        Kc de vid vinífera FAO-56: 0,30 (brotación) → 0,70 (enero–febrero) → 0,45 (cosecha). Estimación de referencia para
        una viña adulta sin estrés hídrico: no descuenta la lluvia que no aprovecha el cultivo ni la eficiencia del sistema
        de riego. Método: FAO, Estudio Riego y Drenaje N° 56 (Allen et al., 1998).
        {riego.ciren && " Las dos fuentes oficiales difieren porque usan datos y métodos distintos; tómalas como un rango."}
      </p>
      {proxEt0 != null && (
        <Fila
          k="Próximos 7 días (pronóstico)"
          v={`ET0 ${fmt(proxEt0)} mm · lluvia ${fmt(proxLluvia)} mm`}
          sub={`Consumo esperado de una viña en plena temporada (Kc 0,70): ${fmt(proxEt0 * 0.7)} mm ≈ ${fmt(proxEt0 * 7)} m³/ha.`}
        />
      )}
    </Tarjeta>
  );
}

// ---- Suelo: capacidad de uso (CIREN)
function TarjetaSuelo({ suelo }) {
  if (!suelo)
    return (
      <SinDato
        id="s-suelo"
        titulo="Suelo — capacidad de uso (CIREN)"
        texto="El servidor de CIREN no respondió. Sin este dato el veredicto es provisorio; reintenta más tarde."
      />
    );
  if (!suelo.clases.length) return <SinDato id="s-suelo" titulo="Suelo — capacidad de uso (CIREN)" texto={suelo.nota} />;
  return (
    <Tarjeta id="s-suelo" titulo="Suelo — capacidad de uso (CIREN)" estado={suelo.estado}>
      <div className="barra">
        {suelo.clases.map((c) => (
          <span key={c.clase} style={{ width: c.pct + "%", background: cfg(c.estado).color }} title={`Clase ${c.clase}`} />
        ))}
        {suelo.pctNC > 0 && <span style={{ width: suelo.pctNC + "%", background: "#bbb" }} title="No clasificado" />}
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
      {suelo.pctNC > 0 && (
        <div className="param">
          <span className="punto nd" />
          <div>
            <strong>No clasificado (N.C.) — {fmt(suelo.pctNC)}%</strong>
            <div>Sectores que el estudio de CIREN no clasificó (por ejemplo, zonas urbanas, cauces o caminos).</div>
          </div>
        </div>
      )}
      <p className="tenue">
        La capacidad de uso (clases I a VIII, Pauta del SAG) mide la aptitud del suelo para cultivos en general, no
        específicamente para vid: las clases I–IV son arables y las V–VIII no arables. El color de cada clase es criterio de
        WineCheck. Confirmar siempre con calicatas. Estudio: {suelo.estudios.join(", ") || "CIREN"}. Basado en {suelo.muestras}{" "}
        {suelo.muestras === 1 ? "punto" : "puntos"}{suelo.fallos ? ` (${suelo.fallos} sin respuesta de CIREN)` : ""}
        {suelo.sinCobertura ? `; ${suelo.sinCobertura} fuera de la cobertura del estudio` : ""}.
      </p>
    </Tarjeta>
  );
}

// ---- Propiedades del suelo (SoilGrids) y erosión (CIREN)
function TarjetaPropSuelo({ soil, erosion }) {
  if (!soil && !erosion) return <SinDato titulo="Propiedades del suelo y erosión" />;
  const s = soil?.superficial;
  const b = soil?.subsuelo;
  return (
    <Tarjeta titulo="Propiedades del suelo y erosión" estado={erosion?.estado === "riesgo" ? "riesgo" : undefined}>
      {s && (
        <table className="tabla">
          <thead>
            <tr>
              <th>Propiedad (estimada)</th>
              <th>0–30 cm</th>
              <th>30–100 cm</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Textura (USDA)</td>
              <td>{s.textura}</td>
              <td>{b?.textura || "—"}</td>
            </tr>
            <tr>
              <td>Arena / limo / arcilla</td>
              <td>
                {fmt(s.arena)} / {fmt(s.limo)} / {fmt(s.arcilla)} %
              </td>
              <td>{b ? `${fmt(b.arena)} / ${fmt(b.limo)} / ${fmt(b.arcilla)} %` : "—"}</td>
            </tr>
            <tr>
              <td>pH en agua</td>
              <td>
                {fmt(s.ph, 1)} ({s.phClase})
              </td>
              <td>{b?.ph != null ? `${fmt(b.ph, 1)} (${b.phClase})` : "—"}</td>
            </tr>
            <tr>
              <td>Fragmentos gruesos (piedras)</td>
              <td>{fmt(s.pedregosidad)} % del volumen</td>
              <td>{b?.pedregosidad != null ? `${fmt(b.pedregosidad)} %` : "—"}</td>
            </tr>
          </tbody>
        </table>
      )}
      {soil && (
        <p className="tenue">
          Estimaciones del mapa mundial de suelos ISRIC SoilGrids 2.0 (resolución 250 m, Poggio et al., 2021) en el centro
          del terreno. Orientan sobre textura, pH y piedras, pero tienen error: no reemplazan un análisis de suelo de
          laboratorio. No se muestran materia orgánica ni capacidad de intercambio catiónico: en las pruebas dieron valores
          atípicamente altos para suelos agrícolas y no pudimos validarlos.
        </p>
      )}
      {!soil && <p className="falla">No se pudo consultar SoilGrids (el servicio permite pocas consultas por minuto).</p>}
      {erosion && (erosion.actual || erosion.riesgoActual) && (
        <>
          <h4>Erosión (CIREN)</h4>
          {erosion.actual && <Fila k="Erosión actual" v={erosion.actual} />}
          {erosion.riesgoActual && <Fila k="Riesgo de erosión actual" v={erosion.riesgoActual} />}
          {erosion.riesgoPotencial && <Fila k="Riesgo de erosión potencial" v={erosion.riesgoPotencial} />}
        </>
      )}
    </Tarjeta>
  );
}

// ---- Relieve
function TarjetaRelieve({ p }) {
  if (!p) return <SinDato id="s-relieve" titulo="Pendiente y relieve" />;
  if (p.estado === "nd") return <SinDato id="s-relieve" titulo="Pendiente y relieve" texto={p.nota} />;
  return (
    <Tarjeta id="s-relieve" titulo="Pendiente y relieve" estado={p.estado}>
      <Fila k="Pendiente media" v={`${fmt(p.media)}%`} sub={p.nota} />
      <Fila k="Superficie con pendiente > 15% / > 30%" v={`${fmt(p.pct15)}% / ${fmt(p.pct30)}%`} />
      <Fila k="Altitud" v={`${fmt(p.elevMin)}–${fmt(p.elevMax)} m s.n.m.`} />
      <Fila
        k="Exposición general"
        v={p.exposicion || (p.media >= 5 ? "sin una orientación dominante" : "terreno prácticamente plano")}
        sub={p.exposicion ? p.notaExposicion : p.media >= 5 ? "El terreno tiene laderas con distintas orientaciones (por ejemplo, ambos lados de una quebrada)." : null}
      />
      {p.resolucionBaja && (
        <p className="tenue">
          El modelo de elevación tiene ~90 m de resolución: en terrenos pequeños la pendiente es aproximada. Verificar con
          topografía.
        </p>
      )}
    </Tarjeta>
  );
}

// ---- Agua: subterránea (SHAC) y superficial (agotamiento)
function TarjetaAgua({ agua, agot }) {
  if (!agua && !agot) return <SinDato id="s-agua" titulo="Agua para riego (DGA)" />;
  const estado = [agua?.estado, agot?.estado].includes("riesgo") ? "riesgo" : agua?.estado === "apto" ? "apto" : "nd";
  return (
    <Tarjeta id="s-agua" titulo="Agua para riego (DGA)" estado={estado}>
      <h4>Agua subterránea</h4>
      {agua ? (
        <>
          {agua.zonas.map((z, i) => (
            <Fila key={i} k={z.tipo} v={`SHAC ${z.shac}`} sub={z.acuifero ? `Acuífero ${z.acuifero}` : null} />
          ))}
          <p>{agua.nota}</p>
        </>
      ) : (
        <p className="falla">No se pudo consultar la DGA.</p>
      )}
      <h4>Agua superficial</h4>
      {agot ? (
        <>
          {agot.fuentes.map((x, i) => (
            <Fila
              key={i}
              k="Declaración de agotamiento"
              v={x.nombre}
              sub={x.resolucion ? `Resolución DGA N° ${x.resolucion}${x.fecha ? ` del ${x.fecha}` : ""}` : null}
            />
          ))}
          <p>{agot.nota}</p>
        </>
      ) : (
        <p className="falla">No se pudo consultar la DGA (agotamiento).</p>
      )}
      <p className="tenue">
        Indica la situación administrativa de las fuentes de agua. No reemplaza revisar los derechos de agua que tenga el
        predio (Catastro Público de Aguas de la DGA).
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
      {e.ultimoCapa && !e.capaActualizada && (
        <p className="tenue">
          La capa de mapas de la DGA llega solo hasta el {fecha(e.ultimoCapa)}, pero el MOP ha seguido dictando decretos (por
          ejemplo, el Decreto MOP N° 185 de 2026, que prorroga la escasez en la provincia de Choapa). Para saber si hoy hay
          un decreto vigente en la comuna, revisa el Diario Oficial o la DGA.
        </p>
      )}
    </Tarjeta>
  );
}

// ---- Pronóstico y Windy
function TarjetaPronostico({ p, centro }) {
  return (
    <div className="tarjeta" id="s-tiempo">
      <h3>Tiempo actual y pronóstico</h3>
      {p ? (
        <>
          {p.actual && (
            <p>
              <strong>Ahora:</strong> {fmt(p.actual.temp, 1)} °C · humedad {fmt(p.actual.humedad)}% · viento{" "}
              {fmt(p.actual.viento)} km/h
            </p>
          )}
          <p className="tenue">
            Ojo: los modelos de pronóstico tienden a subestimar el frío de la madrugada en los valles; una mínima pronosticada
            de 2–3 °C puede ser helada en el predio.
          </p>
          {(p.heladas > 0 || p.riesgoHeladas > 0) && (
            <div className="aviso">
              Alerta: el pronóstico muestra {p.heladas > 0 ? `${p.heladas} día(s) con helada (mínima ≤ 0 °C)` : ""}
              {p.heladas > 0 && p.riesgoHeladas > 0 ? " y " : ""}
              {p.riesgoHeladas > 0 ? `${p.riesgoHeladas} día(s) con mínima entre 0 y 3 °C` : ""} en los próximos 16 días.
            </div>
          )}
          <div className="tabla-scroll">
            <table className="tabla pron">
              <thead>
                <tr>
                  <th>Día</th>
                  <th>Mín / máx</th>
                  <th>Lluvia</th>
                  <th>Ráfagas</th>
                  <th>ET0</th>
                </tr>
              </thead>
              <tbody>
                {p.dias.map((d) => (
                  <tr key={d.fecha} className={d.helada ? "helada" : d.riesgoHelada ? "casi-helada" : ""}>
                    <td>
                      {new Date(d.fecha + "T12:00:00").toLocaleDateString("es-CL", { weekday: "short", day: "numeric", month: "short" })}
                    </td>
                    <td>
                      {fmt(d.tmin)}° / {fmt(d.tmax)}°
                    </td>
                    <td>
                      {fmt(d.lluvia, 1)} mm{d.prob != null ? ` (${fmt(d.prob)}%)` : ""}
                    </td>
                    <td>{fmt(d.rafaga)} km/h</td>
                    <td>{fmt(d.et0, 1)} mm</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="tenue">Pronóstico Open-Meteo (combina modelos de servicios meteorológicos nacionales, ECMWF, GFS y otros).</p>
        </>
      ) : (
        <p className="falla">No se pudo obtener el pronóstico.</p>
      )}
      <PanelWindy centro={centro} embebido />
    </div>
  );
}

const CAPAS_WINDY = [
  ["temp", "Temperatura"],
  ["rain", "Lluvia"],
  ["wind", "Viento"],
  ["gust", "Ráfagas"],
  ["clouds", "Nubes"],
  ["rh", "Humedad"],
];

function PanelWindy({ centro, embebido }) {
  const [capa, setCapa] = useState("temp");
  if (!centro) return null;
  return (
    <div className={embebido ? "windy" : "tarjeta windy"}>
      {!embebido && <h3>Tiempo en vivo y pronóstico (Windy)</h3>}
      <div className="capas">
        {CAPAS_WINDY.map(([k, t]) => (
          <button key={k} className={capa === k ? "activo" : ""} onClick={() => setCapa(k)}>
            {t}
          </button>
        ))}
        <a className="abrir" href={urlWindyCompleto(centro, capa)} target="_blank" rel="noreferrer">
          Abrir en Windy ↗
        </a>
      </div>
      <iframe
        key={capa + centro.join(",")}
        title="Mapa del tiempo Windy"
        src={urlWindy(centro, capa)}
        loading="lazy"
        allowFullScreen
      />
      <p className="tenue">
        Mapa interactivo de Windy.com (modelo ECMWF). Usa la línea de tiempo inferior para ver el pronóstico de los próximos
        días hora a hora.
      </p>
    </div>
  );
}

// =====================================================================
//  Panel de fuentes — SIEMPRE al final
// =====================================================================
const FUENTES = [
  {
    clave: "ubicacion",
    n: "Ubicación — División Político-Administrativa (MOP) y cuencas (MMA)",
    por: "Capas oficiales de comunas, provincias y regiones publicadas por la IDE del Ministerio de Obras Públicas, y cuencas y subcuencas del Ministerio del Medio Ambiente (según la DGA).",
    leer: "Indican en qué comuna y en qué cuenca hidrográfica está el terreno.",
    links: [
      ["Capa de comunas (MOP)", URLS.dpaComunas],
      ["Cuencas (MMA)", URLS.mmaCuencas],
    ],
  },
  {
    clave: "ubicacion",
    n: "Denominaciones de origen — Decreto N° 464 de 1994 (Ministerio de Agricultura)",
    por: "Decreto que establece la zonificación vitícola de Chile (regiones, valles, zonas y áreas) para rotular vinos con denominación de origen; lo fiscaliza el SAG.",
    leer: "Se asigna según la comuna. Incluye Chiloé y el Área Rapa Nui (Decreto N° 27 de 2024). No muestra áreas menores dentro de una comuna (Apalta, Los Lingues, Lo Abarca) ni las menciones Costa, Entre Cordilleras y Andes.",
    links: [
      ["Texto del Decreto 464 (SAG)", "https://sag.cl/sites/default/files/decreto_ndeg_464.pdf"],
      ["Decreto N° 27 de 2024 (Diario Oficial)", "https://www.diariooficial.interior.gob.cl/publicaciones/2025/05/14/44148/01/2643653.pdf"],
    ],
  },
  {
    clave: "clima",
    n: "Clima — ARClim, Atlas de Riesgos Climáticos (Ministerio del Medio Ambiente)",
    por: "Plataforma oficial del MMA. Su clima histórico (1980–2010) está referenciado a CR2MET, la grilla de temperatura y lluvia de ~5 km del Centro de Ciencia del Clima y la Resiliencia (CR)2 construida con estaciones chilenas; el futuro (2035–2065) es el promedio de modelos CMIP6 corregidos, en escenarios SSP2-4.5 y SSP5-8.5.",
    leer: "Grados-día de Winkler y temperatura media de temporada (oct–abr): más alto = más calor para madurar. Clases: Jones et al. (2010) y Jones (2006); Huglin y frío nocturno: Tonietto & Carbonneau (2004). Se eligió ARClim porque, comparado con la estación de Pudahuel, el reanálisis global ERA5 sobreestimaba las mínimas de verano en ~4 °C y ARClim no.",
    links: [
      ["ARClim (MMA)", "https://arclim.mma.gob.cl/"],
      ["Metodología ARClim", "https://arclim.mma.gob.cl/media/learning/Metodologia_ARCLIM.pdf"],
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
    clave: "agroclima",
    n: "Agroclima — CIREN, zonificación agroclimática regional",
    por: "Estudios oficiales de CIREN (Ministerio de Agricultura) con variables agroclimáticas por zona: suma térmica, horas frío, heladas, evapotranspiración y déficit hídrico, en clima actual y futuro. Disponibles para Atacama, Valparaíso, Metropolitana, O'Higgins y Magallanes.",
    leer: "Sirve para contrastar ARClim con el estudio local oficial. No se muestran las horas frío: los dos estudios oficiales de CIREN (1988 y 2024) dan valores muy distintos para el mismo lugar.",
    links: [["Servicio de CIREN", URLS.cirenAgroclima]],
  },
  {
    clave: "clima",
    n: "Riego — FAO, Estudio Riego y Drenaje N° 56",
    por: "Método internacional de la FAO (Allen et al., 1998) para calcular la evapotranspiración y el consumo de agua de los cultivos. Kc de vid vinífera: 0,30 / 0,70 / 0,45. La evapotranspiración y la lluvia vienen de ARClim y, donde existe, del estudio agroclimático de CIREN.",
    leer: "Consumo de la viña = Kc × ET0. Riego necesario ≈ consumo − lluvia de la temporada.",
    links: [["Coeficientes de cultivo FAO-56 (resumen UC Davis)", "https://wineserver.ucdavis.edu/sites/g/files/dgvnsk2676/files/inline-files/1%20LEW%20Irrigation%20Shortcourse%20Napa%202019.pdf"]],
  },
  {
    clave: "suelo",
    n: "Suelo — CIREN, Estudios Agrológicos (capacidad de uso)",
    por: "El Centro de Información de Recursos Naturales (Ministerio de Agricultura) elabora la cartografía oficial de suelos de Chile y su clasificación por capacidad de uso (clases I a VIII), con un estudio por región.",
    leer: "Clases I–IV: arables, con limitaciones crecientes. V–VIII: no arables. Definiciones según la Pauta para Estudio de Suelos del SAG.",
    links: [
      ["Capa oficial de CIREN (servicio de mapas)", URLS.cirenSuelos],
      ["Pauta para Estudio de Suelos (SAG, 2016)", "https://www.sag.gob.cl/sites/default/files/pauta-para-estudio-de-suelos--mod-2016.pdf"],
    ],
  },
  {
    clave: "soilgrids",
    n: "Propiedades del suelo — ISRIC SoilGrids 2.0",
    por: "Mapa mundial de propiedades del suelo del ISRIC (World Soil Information, centro de datos de suelos del Consejo Internacional de la Ciencia), publicado por Poggio et al. (2021) en la revista SOIL.",
    leer: "Estimación modelada de textura, pH y piedras a 250 m. Orienta; no reemplaza el análisis de laboratorio. Las clases de pH siguen el Soil Survey Manual del USDA.",
    links: [
      ["SoilGrids (ISRIC)", "https://www.isric.org/explore/soilgrids"],
      ["Poggio et al. (2021), SOIL", "https://doi.org/10.5194/soil-7-217-2021"],
    ],
  },
  {
    clave: "erosion",
    n: "Erosión — CIREN, Determinación de la Erosión Actual y Potencial",
    por: "Estudio nacional de CIREN sobre erosión actual y riesgo de erosión de los suelos de Chile.",
    leer: "La erosión actual y el riesgo de erosión indican si el suelo requiere prácticas de conservación (cubiertas, curvas de nivel).",
    links: [["Servicio de CIREN", URLS.cirenErosion]],
  },
  {
    clave: "uso",
    n: "Uso actual del suelo — Catastro de CONAF (síntesis MMA)",
    por: "Catastro de Uso de Suelo y Vegetación de CONAF, publicado por el Ministerio del Medio Ambiente en SIMBIO.",
    leer: "Muestra si el terreno es agrícola, pradera, matorral, bosque, urbano, etc. Si hay bosque nativo, aplica la Ley 20.283.",
    links: [
      ["Capa del MMA", URLS.mmaUsoSuelo],
      ["Ley 20.283 (texto, MMA)", "https://mma.gob.cl/transparencia/mma/doc/LEY20283.pdf"],
    ],
  },
  {
    clave: "agua",
    n: "Agua subterránea — DGA (Ministerio de Obras Públicas)",
    por: "La Dirección General de Aguas administra los derechos de agua y declara la condición de cada Sector Hidrogeológico de Aprovechamiento Común (SHAC).",
    leer: "Abierto: se pueden pedir nuevos derechos. Área de Restricción: solo derechos provisionales. Zona de Prohibición: no se otorgan nuevos derechos.",
    links: [["Capa oficial de la DGA", URLS.dgaAgua]],
  },
  {
    clave: "agotamiento",
    n: "Agua superficial — DGA, declaraciones de agotamiento",
    por: "Fuentes superficiales declaradas agotadas por la DGA según el artículo 282 del Código de Aguas.",
    leer: "Si la fuente está agotada, no se conceden nuevos derechos consuntivos permanentes de agua superficial.",
    links: [
      ["Capa oficial de la DGA", URLS.dgaAgotamiento],
      ["Artículo 282 del Código de Aguas", "https://iura.cl/ca/282"],
    ],
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
    clave: "hidro",
    n: "Ríos, esteros y canales — MMA, red hidrográfica",
    por: "Red hidrográfica nacional publicada por el Ministerio del Medio Ambiente en SIMBIO.",
    leer: "Muestra los cursos de agua que cruzan el terreno.",
    links: [["Capa oficial del MMA", URLS.mmaHidrografia]],
  },
  {
    clave: "sma",
    n: "Áreas protegidas — SMA, Áreas de protección oficial",
    por: "La Superintendencia del Medio Ambiente reúne en un solo servicio las áreas protegidas oficiales: parques y reservas nacionales, monumentos naturales, santuarios, sitios RAMSAR, humedales urbanos y otras protecciones.",
    leer: "Parques, reservas nacionales, monumentos naturales, santuarios, sitios RAMSAR y humedales urbanos excluyen superficie. Reservas forestales, zonas típicas, monumentos históricos, ZOIT y zonas de planes reguladores se muestran como advertencia.",
    links: [["Servicio oficial de la SMA", URLS.smaProteccion]],
  },
  {
    clave: "limUrb",
    n: "Límites urbanos y áreas de riesgo — MINVU (planes reguladores)",
    por: "Límites urbanos y zonas de riesgo de los Instrumentos de Planificación Territorial (planes reguladores comunales, intercomunales y metropolitanos), publicados por el Ministerio de Vivienda y Urbanismo.",
    leer: "Dentro del límite urbano el uso del suelo lo define el plan regulador. Las áreas de riesgo (inundación, remoción en masa) solo existen en las comunas con planes digitalizados.",
    links: [
      ["Límites urbanos (MINVU)", URLS.minvuLimUrbano],
      ["Áreas de riesgo (MINVU)", URLS.minvuRiesgo],
    ],
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
    clave: "pronostico",
    n: "Pronóstico y tiempo en vivo — Open-Meteo y Windy",
    por: "Open-Meteo combina los modelos de servicios meteorológicos nacionales (ECMWF, NOAA GFS, entre otros). Windy.com muestra los mismos modelos en un mapa interactivo.",
    leer: "Útil para planificar labores y anticipar heladas; el pronóstico pierde precisión después de 5 a 7 días.",
    links: [
      ["API de pronóstico (Open-Meteo)", "https://open-meteo.com/en/docs"],
      ["Windy.com", "https://www.windy.com/"],
    ],
  },
];

const ESTADO_FUENTE = { ok: "consultada", error: "no respondió", "no aplica": "no aplica" };

function PanelFuentes({ r }) {
  return (
    <div className="tarjeta fuentes" id="s-fuentes">
      <h3>Fuentes y cómo leerlas</h3>
      <p>
        Los datos provienen de organismos oficiales chilenos y de referencias científicas internacionales. Cada fuente se
        puede verificar en su enlace.
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
            <p>
              <strong>Qué es y por qué es autoridad:</strong> {f.por}
            </p>
            <p>
              <strong>Cómo leerlo:</strong> {f.leer}
            </p>
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
