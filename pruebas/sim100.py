# =====================================================================
#  Simulación de 100 terrenos en todo Chile.
#  1) Elige 100 puntos al azar en tierra chilena (70 en la zona vitícola
#     -27° a -42°, 30 en el resto), verificados con la capa de comunas.
#  2) Analiza cada terreno (~36 ha) en la app compilada y guarda el
#     resultado completo (window.__wc) y el texto de la página.
#  3) CONTROL INDEPENDIENTE: consulta directamente las fuentes oficiales
#     en el centro del terreno (CIREN suelo, DPA comuna, SMA, elevación)
#     y lo compara con lo que mostró la app.
# =====================================================================
import json, os, random, time, urllib.request, urllib.parse, concurrent.futures as cf
from playwright.sync_api import sync_playwright

URL = os.environ.get("URL", "http://localhost:4173/")
OUT = "salida"
os.makedirs(OUT, exist_ok=True)
random.seed(20261028)
LADO = 0.003

def get(url, t=40):
    for i in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "WineCheck-pruebas/1.0"})
            with urllib.request.urlopen(req, timeout=t) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            err = e
            time.sleep(3)
    raise err

def q_punto(base, lat, lon, campos):
    p = {"geometry": f"{lon},{lat}", "geometryType": "esriGeometryPoint", "inSR": "4326",
         "spatialRel": "esriSpatialRelIntersects", "outFields": campos, "returnGeometry": "false", "f": "json"}
    return get(base + "/query?" + urllib.parse.urlencode(p))

def identify(base, lat, lon, capas="all"):
    p = {"geometry": f"{lon},{lat}", "geometryType": "esriGeometryPoint", "sr": "4326", "layers": capas, "tolerance": "0",
         "mapExtent": f"{lon-0.01},{lat-0.01},{lon+0.01},{lat+0.01}", "imageDisplay": "400,400,96", "returnGeometry": "false", "f": "json"}
    return get(base + "/identify?" + urllib.parse.urlencode(p))

MMA_COMUNAS = "https://arcgis.mma.gob.cl/server/rest/services/SIMBIO/SIMBIO_DIVISION_ADMINISTRATIVA/MapServer/2"
DPA = "https://rest-sit.mop.gob.cl/arcgis/rest/services/INTEROP/SERVICIO_DPA/MapServer/1"
CIREN = "https://esri.ciren.cl/server/rest/services/IDEMINAGRI/SUELOS_AGROLOGICOS/MapServer"
SMA = "https://ideserver.sma.gob.cl/arcgis/rest/services/IDE/Areas_proteccion_oficial2/MapServer"

# Ancho aproximado de Chile por latitud (de la costa a la cordillera)
BANDAS = [(-18.5, -25, -70.5, -68.6), (-25, -30, -71.4, -69.2), (-30, -35, -71.8, -70.2), (-35, -40, -73.3, -71.2),
          (-40, -44, -73.9, -71.8), (-44, -50, -74.5, -71.6), (-50, -53.8, -74.0, -69.0)]

def candidato(zona):
    while True:
        lat = random.uniform(-42, -27) if zona == "vit" else random.choice([random.uniform(-27, -18.5), random.uniform(-53.8, -42)])
        for a, b, lo1, lo2 in BANDAS:
            if b <= lat <= a:
                return round(lat, 4), round(random.uniform(lo1, lo2), 4)

def en_tierra(p):
    try:
        return len(q_punto(MMA_COMUNAS, p[0], p[1], "OBJECTID").get("features", [])) > 0
    except Exception:
        return False

puntos = []
for zona, n in (("vit", 70), ("otra", 30)):
    k = 0
    while k < n:
        lote = [candidato(zona) for _ in range(12)]
        with cf.ThreadPoolExecutor(6) as ex:
            ok = list(ex.map(en_tierra, lote))
        for p, o in zip(lote, ok):
            if o and k < n:
                puntos.append({"id": len(puntos) + 1, "zona": zona, "lat": p[0], "lon": p[1]})
                k += 1
print("puntos elegidos", len(puntos), flush=True)

# ---- Control independiente en el centro de cada terreno
def control(p):
    lat, lon = p["lat"], p["lon"]
    c = {}
    try:
        r = identify(CIREN, lat, lon).get("results", [])
        c["ciren"] = [list(x["attributes"].values())[3] if len(x["attributes"]) > 3 else None for x in r]
        c["ciren_raw"] = [x["attributes"] for x in r][:1]
    except Exception as e:
        c["ciren"] = "error " + str(e)[:80]
    try:
        f = q_punto(DPA, lat, lon, "COMUNA,REGION").get("features", [])
        c["comuna"] = f[0]["attributes"]["COMUNA"] if f else None
    except Exception as e:
        c["comuna"] = "error " + str(e)[:80]
    try:
        r = identify(SMA, lat, lon).get("results", [])
        c["sma"] = sorted({x["layerId"] for x in r})
    except Exception as e:
        c["sma"] = "error " + str(e)[:80]
    try:
        c["elev"] = get(f"https://api.open-meteo.com/v1/elevation?latitude={lat}&longitude={lon}")["elevation"][0]
    except Exception as e:
        c["elev"] = "error " + str(e)[:80]
    return c

with cf.ThreadPoolExecutor(4) as ex:
    controles = list(ex.map(control, puntos))
for p, c in zip(puntos, controles):
    p["control"] = c
print("controles listos", flush=True)

TRAMPA = """
Object.defineProperty(window, 'L', { configurable: true, get() { return window.__L; },
  set(v) { window.__L = v; try { v.Map.addInitHook(function () { window.__mapa = this; }); } catch (e) {} } });
"""

RESUMEN_JS = """() => { const r = window.__wc; if (!r) return null;
  const pick = (o, ks) => o ? Object.fromEntries(ks.filter(k => k in o).map(k => [k, o[k]])) : null;
  return {
    areaHa: r.areaHa, fuentes: r.fuentes,
    R: pick(r.R, ['n','pctRestringido','vetoTotal','dudosos']),
    ubic: r.ubic, clima: r.clima ? { estado: r.clima.estado, gst: r.clima.gst, gdd: r.clima.gdd, huglin: r.clima.huglin,
      region: r.clima.region, gstClase: r.clima.gstClase, actual: r.clima.actual, base: r.clima.base, f245: r.clima.f245,
      periodo: r.clima.periodo, elevCelda: r.clima.elevCelda, vecina: r.clima.vecina } : null,
    suelo: r.suelo ? { estado: r.suelo.estado, clases: (r.suelo.clases||[]).map(c => [c.clase, Math.round(c.pct)]), pctNC: r.suelo.pctNC, nota: r.suelo.nota, estudios: r.suelo.estudios, fallos: r.suelo.fallos } : null,
    soil: r.soil, erosion: r.erosion,
    agroclima: r.agroclima ? { disponible: r.agroclima.disponible, zona: r.agroclima.zona, actual: r.agroclima.actual && { ...r.agroclima.actual, mensual: undefined } } : null,
    pendiente: r.pendiente ? pick(r.pendiente, ['media','pct15','pct30','elevMin','elevMax','estado','exposicion']) : null,
    agua: r.agua, uso: r.uso ? pick(r.uso, ['clases','hayBosqueNativo','pctBosqueNativo','anio','fuente']) : null,
  }; }"""

def correr(pg, p):
    lat, lon = p["lat"], p["lon"]
    pg.goto(URL)
    pg.wait_for_function("window.__mapa !== undefined", timeout=30000)
    pg.evaluate(f"window.__wc = undefined; window.__mapa.setView([{lat},{lon}], 15)")
    pg.wait_for_timeout(500)
    for a, b in [(lat + LADO, lon - LADO), (lat + LADO, lon + LADO), (lat - LADO, lon + LADO), (lat - LADO, lon - LADO)]:
        pg.evaluate(f"window.__mapa.fire('click', {{latlng: window.__L.latLng({a},{b})}})")
        pg.wait_for_timeout(100)
    t0 = time.time()
    pg.click(".btn-analizar")
    pg.wait_for_timeout(2500)
    pg.wait_for_function("!document.querySelector('.btn-analizar') || !document.querySelector('.btn-analizar').disabled", timeout=240000)
    pg.wait_for_timeout(1500)
    p["segundos"] = round(time.time() - t0)
    p["app"] = pg.evaluate(RESUMEN_JS)
    texto = pg.evaluate("document.body.innerText")
    p["texto"] = texto
    i = texto.find("Reiniciar")
    p["veredicto"] = texto[i + 9: i + 2500] if i >= 0 else texto[:1500]

def trabajador(lista, nombre):
    errores = []
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        ctx = b.new_context(viewport={"width": 1366, "height": 800}, locale="es-CL")
        ctx.add_init_script(TRAMPA)
        pg = ctx.new_page()
        pg.on("console", lambda m: errores.append(f"{m.type}: {m.text}") if m.type in ("error",) else None)
        pg.on("pageerror", lambda e: errores.append(f"pageerror: {e}"))
        for p in lista:
            try:
                correr(pg, p)
                print("ok", p["id"], p["segundos"], "s", flush=True)
            except Exception as e:
                p["falla"] = str(e)[:300]
                print("FALLA", p["id"], e, flush=True)
        b.close()
    return errores

grupos = [puntos[i::3] for i in range(3)]
with cf.ThreadPoolExecutor(3) as ex:
    errs = list(ex.map(trabajador, grupos, ["a", "b", "c"]))
json.dump(puntos, open(f"{OUT}/sim100.json", "w"), ensure_ascii=False, indent=1, default=str)
open(f"{OUT}/consola.txt", "w").write("\n".join(sum(errs, [])))
print("listo", flush=True)
