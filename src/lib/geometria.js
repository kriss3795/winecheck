// =====================================================================
//  geometria.js — cálculos sobre el polígono del terreno
//  Coordenadas siempre como [lat, lon].
//  Para distancias y áreas se usa una proyección local plana
//  (equirectangular), precisa para predios de hasta decenas de km.
// =====================================================================

const M_POR_GRADO_LAT = 110540;
const M_POR_GRADO_LON = 111320;

export function centroide(pts) {
  const n = pts.length;
  return [pts.reduce((a, p) => a + p[0], 0) / n, pts.reduce((a, p) => a + p[1], 0) / n];
}

export function proyector(lat0, lon0) {
  const k = Math.cos((lat0 * Math.PI) / 180);
  return {
    aXY: ([lat, lon]) => [(lon - lon0) * M_POR_GRADO_LON * k, (lat - lat0) * M_POR_GRADO_LAT],
    aLL: ([x, y]) => [lat0 + y / M_POR_GRADO_LAT, lon0 + x / (M_POR_GRADO_LON * k)],
  };
}

function areaFirmadaXY(xy) {
  let s = 0;
  for (let i = 0; i < xy.length; i++) {
    const [x1, y1] = xy[i];
    const [x2, y2] = xy[(i + 1) % xy.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

export function areaM2(pts) {
  if (!pts || pts.length < 3) return 0;
  const c = centroide(pts);
  const pr = proyector(c[0], c[1]);
  return Math.abs(areaFirmadaXY(pts.map(pr.aXY)));
}

// Punto dentro de polígono (ray casting) en coordenadas planas [x,y]
function dentroXY([x, y], xy) {
  let dentro = false;
  for (let i = 0, j = xy.length - 1; i < xy.length; j = i++) {
    const [xi, yi] = xy[i];
    const [xj, yj] = xy[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

// Igual, pero en [lat, lon] (x = lon, y = lat)
export function dentro([lat, lon], poly) {
  return dentroXY(
    [lon, lat],
    poly.map((p) => [p[1], p[0]])
  );
}

function orientacion(a, b, c) {
  const v = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}
export function segmentosSeCruzan(p1, p2, p3, p4) {
  return (
    orientacion(p1, p2, p3) !== orientacion(p1, p2, p4) &&
    orientacion(p3, p4, p1) !== orientacion(p3, p4, p2)
  );
}

// ¿El polígono se cruza a sí mismo? (dibujo en "8")
export function seAutoIntersecta(pts) {
  const n = pts.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) continue;
      if (segmentosSeCruzan(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return true;
    }
  }
  return false;
}

// ¿Una línea (río, canal) pasa por dentro del polígono?
export function lineaTocaPoligono(linea, poly) {
  if (linea.some((p) => dentro(p, poly))) return true;
  for (let i = 0; i < linea.length - 1; i++) {
    for (let j = 0; j < poly.length; j++) {
      if (segmentosSeCruzan(linea[i], linea[i + 1], poly[j], poly[(j + 1) % poly.length])) return true;
    }
  }
  return false;
}

// Grilla regular de puntos DENTRO del terreno. Cada punto representa
// la misma superficie, así el % de puntos = % de superficie (aprox.).
export function grillaInterna(pts, objetivo = 40, maximo = 80) {
  const c = centroide(pts);
  const pr = proyector(c[0], c[1]);
  const xy = pts.map(pr.aXY);
  const xs = xy.map((p) => p[0]);
  const ys = xy.map((p) => p[1]);
  const [minx, maxx, miny, maxy] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const area = Math.abs(areaFirmadaXY(xy));
  let s = Math.max(Math.sqrt(area / objetivo), 5);
  let mejor = null;

  for (let intento = 0; intento < 8; intento++) {
    const out = [];
    let i = 0;
    for (let x = minx + s / 2; x < maxx; x += s, i++) {
      let j = 0;
      for (let y = miny + s / 2; y < maxy; y += s, j++) {
        if (dentroXY([x, y], xy)) out.push({ i, j, x, y });
      }
    }
    if (out.length) mejor = { s, out };
    if (out.length < 12) s /= 1.4;
    else if (out.length > maximo) s *= 1.2;
    else break;
  }

  if (!mejor) {
    // Polígono degenerado (muy delgado): usamos el centro
    return { espaciado: 0, puntos: [{ i: 0, j: 0, x: 0, y: 0, ll: c }] };
  }
  return {
    espaciado: mejor.s,
    puntos: mejor.out.map((p) => ({ ...p, ll: pr.aLL([p.x, p.y]) })),
  };
}

export function caja(pts, margenGrados = 0) {
  const lats = pts.map((p) => p[0]);
  const lons = pts.map((p) => p[1]);
  return {
    s: Math.min(...lats) - margenGrados,
    n: Math.max(...lats) + margenGrados,
    o: Math.min(...lons) - margenGrados,
    e: Math.max(...lons) + margenGrados,
  };
}

// Anillo en formato ArcGIS: [lon,lat], cerrado y en sentido horario
// (en ArcGIS un anillo antihorario se interpreta como "hoyo").
export function anilloArcGIS(pts) {
  const ring = pts.map(([lat, lon]) => [lon, lat]);
  if (areaFirmadaXY(ring) > 0) ring.reverse(); // >0 = antihorario
  ring.push(ring[0]);
  return ring;
}
