#!/usr/bin/env python3
# =====================================================================
#  cr2met.py — CLIMA ACTUAL OBSERVADO (últimas 10 temporadas completas)
#
#  Fuente: CR2MET v2.5_best, Centro de Ciencia del Clima y la Resiliencia
#  (CR)2 — https://ftp.cr2.cl/browse/cr2met/  (licencia CC BY 4.0).
#  Grilla diaria de 0,05° para Chile continental construida con
#  estaciones chilenas (DMC, DGA). Es la MISMA base a la que está
#  referenciado ARClim, así que ambas columnas son comparables.
#
#  Por cada celda de ARClim (public/clima/b*.json) se guarda en
#  public/clima/a{banda}.json:
#    tm[7]   temperatura media mensual oct..abr (°C)
#    tx[7]   máxima media mensual oct..abr (°C)
#    tn[7]   mínima media mensual oct..abr (°C)
#    pr[7]   lluvia media mensual oct..abr (mm/mes)
#    et[7]   ET0 media diaria oct..abr (mm/día; CR2MET, Hargreaves-Samani modificada)
#    hp      días con mínima < 0 °C entre sep y nov (promedio por temporada)
#  y en la cabecera el período usado.
# =====================================================================
import json, os, glob, subprocess, sys, datetime, math
import numpy as np
import netCDF4

BASE = "https://ftp.cr2.cl/download/cr2met/v2.5_best"
CARPETA = {"txn": "txn", "tmean": "tmean", "pr": "pr", "et0": "et0"}
PREFIJO = {"txn": "CR2MET_tmin_tmax", "tmean": "CR2MET_tmean", "pr": "CR2MET_pr", "et0": "CR2MET_et0hsm"}
MESES = [10, 11, 12, 1, 2, 3, 4]
TMP = "/tmp/cr2"
os.makedirs(TMP, exist_ok=True)


def url(var, y, m):
    return f"{BASE}/{CARPETA[var]}/v2.5_best_day/{PREFIJO[var]}_v2.5_best_day_{y}_{m:02d}_005deg.nc"


def bajar(var, y, m):
    dest = f"{TMP}/{var}_{y}_{m:02d}.nc"
    if os.path.exists(dest):
        return dest
    for intento in range(4):
        r = subprocess.run(["curl", "-sSfL", "--retry", "3", "-m", "900", "-o", dest, url(var, y, m)])
        if r.returncode == 0 and os.path.getsize(dest) > 100000:
            return dest
    raise RuntimeError(f"no se pudo bajar {url(var, y, m)}")


def variables(ds):
    return [k for k, v in ds.variables.items() if len(v.dimensions) == 3]


# Temporada final: la última con abril completo publicado (v2.5_best tiene ~9 días de retraso)
hoy = datetime.date.today()
fin = hoy.year if hoy >= datetime.date(hoy.year, 5, 15) else hoy.year - 1
ini = fin - 10  # 10 temporadas: oct(ini) … abr(fin)
temporadas = list(range(ini, fin))  # año de octubre de cada temporada
print("temporadas", temporadas[0], "-", temporadas[-1] + 1, flush=True)

lat = lon = None
acum = {}  # (campo, k) -> suma
cuenta = {}
helada = None
n_helada = 0


def sumar(campo, k, arr):
    arr = np.ma.filled(arr.astype("f8"), np.nan)
    if (campo, k) not in acum:
        acum[(campo, k)] = np.zeros(arr.shape[1:], "f8")
        cuenta[(campo, k)] = np.zeros(arr.shape[1:], "i4")
    ok = ~np.isnan(arr)
    acum[(campo, k)] += np.where(ok, arr, 0).sum(axis=0)
    cuenta[(campo, k)] += ok.sum(axis=0)


for t in temporadas:
    # Heladas sep–nov (con la mínima diaria)
    hs = None
    for m in (9, 10, 11):
        f = bajar("txn", t, m)
        with netCDF4.Dataset(f) as ds:
            if lat is None:
                lat = ds["lat"][:].astype("f8")
                lon = ds["lon"][:].astype("f8")
                print("variables txn:", variables(ds), "forma", ds[variables(ds)[0]].shape, flush=True)
                print("lat", lat[0], lat[-1], "lon", lon[0], lon[-1], flush=True)
            vn = [v for v in variables(ds) if "min" in v.lower()][0]
            tn = np.ma.filled(ds[vn][:].astype("f8"), np.nan)
            c = (tn < 0).sum(axis=0).astype("f8")
            c[np.all(np.isnan(tn), axis=0)] = np.nan
            hs = c if hs is None else hs + c
        if m == 9:
            os.remove(f)
    helada = hs if helada is None else helada + hs
    n_helada += 1

    for k, m in enumerate(MESES):
        y = t if m >= 10 else t + 1
        f = bajar("txn", y, m)
        with netCDF4.Dataset(f) as ds:
            vs = variables(ds)
            vmax = [v for v in vs if "max" in v.lower()][0]
            vmin = [v for v in vs if "min" in v.lower()][0]
            sumar("tx", k, ds[vmax][:])
            sumar("tn", k, ds[vmin][:])
        os.remove(f)
        for var, campo in (("tmean", "tm"), ("pr", "pr"), ("et0", "et")):
            f = bajar(var, y, m)
            with netCDF4.Dataset(f) as ds:
                vs = variables(ds)
                if t == temporadas[0] and k == 0:
                    v = ds[vs[0]]
                    print(var, vs, {a: v.getncattr(a) for a in v.ncattrs()}, flush=True)
                sumar(campo, k, ds[vs[0]][:])
            os.remove(f)
        print("ok", y, m, flush=True)

DIAS = [31, 30, 31, 31, 28.25, 31, 30]
media = {}
for (campo, k), s in acum.items():
    with np.errstate(invalid="ignore", divide="ignore"):
        media[(campo, k)] = s / cuenta[(campo, k)]
helada = helada / n_helada

# Índices de la grilla CR2MET más cercanos a cada centro de celda ARClim
lat_asc = lat[0] < lat[-1]
lon_asc = lon[0] < lon[-1]
dlat = abs(lat[1] - lat[0])
dlon = abs(lon[1] - lon[0])


def idx(arr, asc, d, v):
    i = int(round((v - arr[0]) / d)) if asc else int(round((arr[0] - v) / d))
    return i if 0 <= i < len(arr) else None


def r1(x):
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else round(float(x), 1)


total = 0
for fb in sorted(glob.glob("public/clima/b*.json")):
    b = json.load(open(fb))
    out = {}
    for key in b["celdas"]:
        i, j = map(int, key.split(","))
        clon = (i + 0.5) * 0.05
        clat = (j + 0.5) * 0.05
        yi = idx(lat, lat_asc, dlat, clat)
        xi = idx(lon, lon_asc, dlon, clon)
        if yi is None or xi is None:
            continue
        reg = {}
        valido = True
        for campo in ("tm", "tx", "tn", "pr", "et"):
            vals = []
            for k in range(7):
                v = media[(campo, k)][yi, xi]
                if math.isnan(v):
                    valido = False
                    break
                if campo == "pr":
                    v = v * DIAS[k]
                vals.append(round(float(v), 2 if campo == "et" else 1))
            if not valido:
                break
            reg[campo] = vals
        if not valido:
            continue
        reg["hp"] = r1(helada[yi, xi])
        out[key] = reg
    total += len(out)
    nombre = os.path.basename(fb).replace("b", "a", 1)
    json.dump(
        {
            "fuente": "CR2MET v2.5_best (CR2), datos diarios observados",
            "desde": ini,
            "hasta": fin,
            "temporadas": f"oct {ini} – abr {fin}",
            "generado": hoy.isoformat(),
            "meses": ["oct", "nov", "dec", "jan", "feb", "mar", "apr"],
            "celdas": out,
        },
        open(f"public/clima/{nombre}", "w"),
        separators=(",", ":"),
    )
print("celdas con clima actual:", total, flush=True)
