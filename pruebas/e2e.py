# Prueba de punta a punta: abre la app compilada, marca terrenos reales y
# guarda el texto completo del resultado y capturas (celular y PC).
# Se ejecuta en GitHub Actions (.github/workflows/e2e.yml).
import json, os, sys, time
from playwright.sync_api import sync_playwright

URL = os.environ.get("URL", "http://localhost:4173/")
OUT = "salida"
os.makedirs(OUT, exist_ok=True)

SITIOS = {
    "paine": (-33.82, -70.75),
    "pencahue": (-35.38, -71.83),
    "vicuna": (-30.03, -70.71),
    "casablanca": (-33.32, -71.41),
    "aculeo_orilla": (-33.836, -70.905),
    "la_campana": (-32.955, -71.09),
    "osorno": (-40.57, -73.13),
    "coyhaique": (-45.60, -72.10),
    "pichilemu_mar": (-34.39, -72.03),
    "pichilemu_costa": (-34.392, -72.012),
    "mendoza_argentina": (-32.89, -68.84),
}
LADO = 0.003  # ~300 m

TRAMPA = """
Object.defineProperty(window, 'L', {
  configurable: true,
  get() { return window.__L; },
  set(v) { window.__L = v; try { v.Map.addInitHook(function () { window.__mapa = this; }); } catch (e) {} },
});
"""

def correr(pg, nombre, lat, lon, ancho):
    pg.goto(URL)
    pg.wait_for_function("window.__mapa !== undefined", timeout=30000)
    pg.evaluate(f"window.__mapa.setView([{lat},{lon}], 15)")
    pg.wait_for_timeout(800)
    pts = [(lat + LADO, lon - LADO), (lat + LADO, lon + LADO), (lat - LADO, lon + LADO), (lat - LADO, lon - LADO)]
    for a, b in pts:
        pg.evaluate(f"window.__mapa.fire('click', {{latlng: window.__L.latLng({a},{b})}})")
        pg.wait_for_timeout(150)
    pg.click(".btn-analizar")
    t0 = time.time()
    # Espera a que termine: el botón vuelve a estar habilitado y aparece el veredicto
    pg.wait_for_timeout(3000)
    pg.wait_for_function("!document.querySelector('.btn-analizar') || !document.querySelector('.btn-analizar').disabled", timeout=240000)
    pg.wait_for_timeout(2000)
    texto = pg.evaluate("document.body.innerText")
    open(f"{OUT}/{nombre}_{ancho}.txt", "w").write(f"[{time.time()-t0:.0f} s]\n" + texto)
    pg.screenshot(path=f"{OUT}/{nombre}_{ancho}.png", full_page=True)

with sync_playwright() as p:
    b = p.chromium.launch()
    errores = []
    for ancho, alto in ((390, 844), (1366, 800)):
        ctx = b.new_context(viewport={"width": ancho, "height": alto}, device_scale_factor=1, has_touch=(ancho < 500), is_mobile=(ancho < 500), locale="es-CL")
        ctx.add_init_script(TRAMPA)
        pg = ctx.new_page()
        pg.on("console", lambda m: errores.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
        pg.on("pageerror", lambda e: errores.append(f"pageerror: {e}"))
        # Inicio, sin analizar
        pg.goto(URL); pg.wait_for_timeout(2500)
        pg.screenshot(path=f"{OUT}/inicio_{ancho}.png")
        print("ancho", ancho, "scrollWidth", pg.evaluate("document.documentElement.scrollWidth"), flush=True)
        sitios = SITIOS if ancho == 1366 else {"paine": SITIOS["paine"]}
        for n, (la, lo) in sitios.items():
            try:
                correr(pg, n, la, lo, ancho)
                print("ok", n, ancho, flush=True)
            except Exception as e:
                print("FALLA", n, ancho, e, flush=True)
                try: pg.screenshot(path=f"{OUT}/{n}_{ancho}_falla.png", full_page=True)
                except Exception: pass
        ctx.close()
    open(f"{OUT}/consola.txt", "w").write("\n".join(errores))
    b.close()
