// Actualiza public/escasez.json con los decretos de escasez VIGENTES
// publicados por la DGA (se ejecuta en GitHub Actions, semanalmente).
// Si el formato de la página cambia y no se puede leer, NO se modifica
// el archivo (mejor un dato con fecha de revisión antigua que uno falso).
import fs from "node:fs";
const URL = "https://dga.mop.gob.cl/derechos-de-agua/proteccion-de-las-fuentes/decretos-de-escasez-2/";
const MESES = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
const html = await (await fetch(URL, { headers: { "User-Agent": "WineCheck/2.0" } })).text();
const texto = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
const ini = texto.search(/Decretos declaraci[oó]n zona de escasez vigentes/i);
const fin = texto.search(/Descargar todos los archivos/i);
if (ini < 0 || fin < ini) throw new Error("no se encontró la sección de decretos vigentes");
const sec = texto.slice(ini, fin);
const re = /Decreto MOP N°\s*(\d+) de (\d{1,2}) de (\w+) de (\d{4}),?\s*(?:prorroga decreto MOP N°\s*(\d+) de \d{1,2} de \w+ de (\d{4}),?\s*)?que declara zona de escasez h[ií]drica (?:a la |al )?(provincia de|Sector Hidrogeol[oó]gico de Aprovechamiento Com[uú]n|comuna de|comunas de)\s*(.+?),? en la regi[oó]n de (.+?)\. caducidad (\d{2})-(\d{2})-(\d{4})/gi;
const decretos = [];
let m;
while ((m = re.exec(sec))) {
  const tipo = /provincia/i.test(m[7]) ? "provincia" : /sector/i.test(m[7]) ? "shac" : "comuna";
  decretos.push({
    num: +m[1], anio: +m[4],
    fecha: `${m[4]}-${String(MESES[m[3].toLowerCase()]).padStart(2, "0")}-${m[2].padStart(2, "0")}`,
    prorroga: m[5] ? `N° ${m[5]} de ${m[6]}` : null,
    tipo, territorio: m[8].trim(), region: m[9].trim(),
    caducidad: `${m[12]}-${m[11]}-${m[10]}`,
  });
}
const n = (sec.match(/Decreto MOP N°/g) || []).length;
if (decretos.length !== n) throw new Error(`se leyeron ${decretos.length} de ${n} decretos: revisar formato`);
fs.writeFileSync("public/escasez.json", JSON.stringify({
  fuente: "Dirección General de Aguas — Decretos declaración zona de escasez vigentes", url: URL,
  revisado: new Date().toISOString().slice(0, 10), decretos }, null, 2) + "\n");
console.log("decretos vigentes:", decretos.length);
