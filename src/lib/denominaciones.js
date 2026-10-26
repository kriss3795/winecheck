// =====================================================================
//  denominaciones.js — Zonificación vitícola de Chile (Denominaciones de
//  Origen), según el Decreto N° 464 de 1994 del Ministerio de Agricultura
//  (texto publicado por el SAG: sag.cl/sites/default/files/decreto_ndeg_464.pdf).
//
//  Se asigna por comuna y provincia (obtenidas de la capa oficial de
//  División Político-Administrativa). Si una comuna no aparece en el
//  decreto, se informa que no pertenece a una DO de vinos.
//  Ojo: el decreto tiene modificaciones posteriores (por ejemplo, las
//  menciones "Costa", "Entre Cordilleras" y "Andes", agregadas en 2011),
//  que aquí no se aplican: la app muestra región, valle y zona.
// =====================================================================

const norm = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// [región vitícola, valle (subregión), provincias completas, comunas sueltas, zonas]
// zonas: { "Nombre zona": [comunas] }  (provincias completas => por provincia)
const DO = [
  ["Región Vitícola de Atacama", "Valle de Copiapó", ["Copiapó"], [], null],
  ["Región Vitícola de Atacama", "Valle del Huasco", ["Huasco"], [], null],
  ["Región Vitícola de Coquimbo", "Valle del Elqui", ["Elqui"], [], null],
  ["Región Vitícola de Coquimbo", "Valle del Limarí", ["Limarí"], [], null],
  ["Región Vitícola de Coquimbo", "Valle del Choapa", ["Choapa"], [], null],
  ["Región Vitícola de Aconcagua", "Valle del Aconcagua", ["San Felipe de Aconcagua", "Los Andes", "Quillota"], [], null],
  ["Región Vitícola de Aconcagua", "Valle de Casablanca", [], ["Casablanca"], null],
  ["Región Vitícola de Aconcagua", "Valle de San Antonio", ["San Antonio"], [], { "Zona Valle de Leyda": ["San Antonio", "Santo Domingo"] }],
  ["Región Vitícola de Aconcagua", "Área del Valle del Marga-Marga", [], ["Quilpué"], null],
  ["Región Vitícola de Aconcagua", "Área de Zapallar", [], ["Zapallar"], null],
  ["Región Vitícola del Valle Central", "Valle del Maipo", ["*RM"], [], null],
  ["Región Vitícola del Valle Central", "Valle del Rapel", ["Cachapoal", "Colchagua", "Cardenal Caro"], [], { "Zona Valle del Cachapoal": ["prov:Cachapoal"], "Zona Valle de Colchagua": ["prov:Colchagua", "prov:Cardenal Caro"] }],
  ["Región Vitícola del Valle Central", "Valle de Curicó", ["Curicó"], ["Río Claro"], { "Zona Valle del Teno": ["Teno", "Romeral", "Rauco", "Hualañé", "Vichuquén"], "Zona Valle del Lontué": ["Curicó", "Molina", "Sagrada Familia", "Río Claro"] }],
  ["Región Vitícola del Valle Central", "Valle del Maule", ["Talca", "Linares"], ["Cauquenes"], { "Zona Valle del Claro": ["Talca", "San Clemente", "Pencahue", "Maule", "Pelarco", "San Rafael", "Empedrado", "Curepto"], "Zona Valle del Loncomilla": ["San Javier", "Villa Alegre", "Retiro", "Parral", "Linares", "Yerbas Buenas", "Colbún", "Longaví"], "Zona Valle del Tutuvén": ["Cauquenes"] }],
  ["Región Vitícola del Sur", "Valle del Itata", [], ["Chillán", "Coelemu", "Ránquil", "Quillón", "Portezuelo", "Ninhue", "Trehuaco", "Treguaco", "Quirihue", "San Nicolás", "Bulnes", "San Carlos", "Florida"], null],
  ["Región Vitícola del Sur", "Valle del Bío-Bío", [], ["Yumbel", "Nacimiento", "Mulchén", "Negrete", "Laja"], null],
  ["Región Vitícola del Sur", "Valle del Malleco", [], ["Angol", "Collipulli", "Ercilla", "Los Sauces", "Lumaco", "Purén", "Renaico", "Traiguén", "Victoria"], null],
  ["Región Vitícola Austral", "Valle del Cautín", [], ["Perquenco", "Galvarino"], null],
  ["Región Vitícola Austral", "Valle de Osorno", [], ["Osorno", "San Pablo", "Purranque", "La Unión", "Futrono"], null],
];

export function denominacionDeOrigen({ comuna, provincia, cutReg }) {
  const c = norm(comuna);
  const p = norm(provincia);
  for (const [region, valle, provs, comunas, zonas] of DO) {
    // Valle del Maule excluye Río Claro (va a Curicó)
    if (valle === "Valle del Maule" && c === "rio claro") continue;
    const porProv = provs.some((x) => (x === "*RM" ? cutReg === "13" : norm(x) === p));
    const porCom = comunas.some((x) => norm(x) === c);
    if (!porProv && !porCom) continue;
    let zona = null;
    if (zonas) {
      for (const [z, lista] of Object.entries(zonas)) {
        if (lista.some((x) => (x.startsWith("prov:") ? norm(x.slice(5)) === p : norm(x) === c))) {
          zona = z;
          break;
        }
      }
    }
    return { region, valle, zona };
  }
  return null;
}
