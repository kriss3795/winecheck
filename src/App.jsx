import React, { useState, useEffect } from "react";
import { MapContainer, TileLayer, Polygon, CircleMarker, useMapEvents, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";

const P = {
  vid:"#2F4A32", agua:"#2C6E8F", fondo:"#F7F6F2", panel:"#FFFFFF",
  tinta:"#1C231D", apto:"#3B8C4E", riesgo:"#D99A1C", veto:"#C43C2E",
  linea:"#DAD6CC", suave:"#6B6459", nd:"#9A9488",
};
const CFG = {
  apto:{color:P.apto,label:"Buena opción",icono:"●"},
  riesgo:{color:P.riesgo,label:"Con manejo",icono:"▲"},
  veto:{color:P.veto,label:"No recomendado",icono:"■"},
  nd:{color:P.nd,label:"Sin dato",icono:"○"},
  info:{color:P.agua,label:"Informativo",icono:"•"},
};

function useEsMovil(){
  const [m,setM]=useState(typeof window!=="undefined"?window.innerWidth<820:false);
  useEffect(()=>{const f=()=>setM(window.innerWidth<820);window.addEventListener("resize",f);return()=>window.removeEventListener("resize",f);},[]);
  return m;
}

function regionWinkler(gda){
  if(gda<1389)return{region:"Región I",desc:"clima frío"};
  if(gda<1667)return{region:"Región II",desc:"templado-frío"};
  if(gda<1944)return{region:"Región III",desc:"templado"};
  if(gda<2222)return{region:"Región IV",desc:"cálido"};
  return{region:"Región V",desc:"muy cálido"};
}

// Distancia aproximada del punto a la costa del Pacifico (km), usando la longitud.
// Chile central: la costa esta cerca de lon -71.6; a mas al este (mas negativo hacia
// -70), mas continental/cordillerano. Es una aproximacion, honesta y util.
function distanciaCostaKm(lat,lon){
  // Longitud de costa aprox por tramo de latitud (interpolacion simple).
  const costa = lat>-33 ? -71.5 : lat>-35 ? -71.7 : -72.9; // Valpo/RM, OHiggins/Maule, Itata/costa sur
  const km = (lon - costa) * 92; // ~92 km por grado de lon en esta latitud (cos(34°)*111)
  return Math.max(0, Math.round(km));
}

// Cepas afines segun clima (calor) Y posicion este-oeste (influencia marina vs andina).
// Basado en: costas/frio -> blancas y tintas frescas; interior calido -> tintas de cuerpo.
function cepasRecomendadas(gda, amplitud, distCostaKm){
  const frio = gda<1389, templadoFrio = gda>=1389&&gda<1667, calido = gda>=1944;
  const costero = distCostaKm!=null && distCostaKm<40;
  const cordillerano = distCostaKm!=null && distCostaKm>90;
  if(costero || frio){
    return {perfil:"Clima fresco / influencia marina", cepas:"Sauvignon Blanc, Chardonnay, Pinot Noir"+(templadoFrio?", Syrah de clima frío":"")};
  }
  if(calido && cordillerano){
    return {perfil:"Interior cálido / influencia andina", cepas:"Cabernet Sauvignon, Syrah, Carménère"};
  }
  if(calido){
    return {perfil:"Cálido", cepas:"Cabernet Sauvignon, Carménère, Syrah"};
  }
  // templado intermedio
  return {perfil:"Templado", cepas:"Cabernet Sauvignon, Merlot, Carménère, Chardonnay"};
}

function analizarClima(fechas,tmax,tmin,precip,radiacion,et0,viento){
  const pt={};
  for(let i=0;i<fechas.length;i++){
    const d=new Date(fechas[i]);const mes=d.getMonth();const anio=d.getFullYear();
    if(!(mes>=9||mes<=3))continue;
    const temp=mes>=9?anio:anio-1;
    if(!pt[temp])pt[temp]={gdd:0,helada:false,ampl:[],calor:0,lluviaCosecha:0,rad:0,radN:0,et0:0,lluviaTotal:0,vientoMax:0};
    const s=pt[temp];const mx=tmax[i],mn=tmin[i];if(mx==null||mn==null)continue;
    const media=(mx+mn)/2;if(media>10)s.gdd+=(media-10);
    if((mes===9||mes===10)&&mn<=0)s.helada=true;
    if(mes===1||mes===2)s.ampl.push(mx-mn);
    if(mx>=34)s.calor+=1;
    if(mes===2||mes===3)s.lluviaCosecha+=(precip[i]||0);
    if(radiacion&&radiacion[i]!=null){s.rad+=radiacion[i];s.radN++;}
    if(et0&&et0[i]!=null)s.et0+=et0[i];
    s.lluviaTotal+=(precip[i]||0);
    if(viento&&viento[i]!=null&&viento[i]>s.vientoMax)s.vientoMax=viento[i];
  }
  const t=Object.values(pt);const n=t.length||1;
  const gda=Math.round(t.reduce((a,s)=>a+s.gdd,0)/n);
  const heladaTardia=t.filter(s=>s.helada).length;
  const amplAll=t.flatMap(s=>s.ampl);
  const amplitud=amplAll.length?+(amplAll.reduce((a,b)=>a+b,0)/amplAll.length).toFixed(1):null;
  const calor=Math.round(t.reduce((a,s)=>a+s.calor,0)/n);
  const lluviaCosecha=Math.round(t.reduce((a,s)=>a+s.lluviaCosecha,0)/n);
  // Radiacion solar: promedio diario de la temporada (MJ/m2/dia)
  const radDias=t.reduce((a,s)=>a+s.radN,0);
  const radiacionProm=radDias>0?+(t.reduce((a,s)=>a+s.rad,0)/radDias).toFixed(1):null;
  // Balance hidrico anual: lluvia - evapotranspiracion (deficit = necesidad de riego)
  const lluviaAnual=Math.round(t.reduce((a,s)=>a+s.lluviaTotal,0)/n);
  const et0Anual=Math.round(t.reduce((a,s)=>a+s.et0,0)/n);
  const balanceHidrico=lluviaAnual-et0Anual; // negativo = deficit
  // Viento maximo tipico
  const vientoMax=+(t.reduce((a,s)=>a+s.vientoMax,0)/n).toFixed(0);
  const problemas=[];let estado="apto";const fH=heladaTardia/n;
  if(fH>0.4){estado="veto";problemas.push("Helada tras la brotación en "+heladaTardia+" de "+n+" años: pérdida de cosecha muy probable.");}
  else if(fH>0.2){estado="riesgo";problemas.push("Helada tras la brotación frecuente ("+heladaTardia+"/"+n+"): exige control antihelada o buen drenaje de aire.");}
  if(gda<850){estado="veto";problemas.push("Calor insuficiente incluso para cepas de clima frío ("+gda+" GDA).");}
  if(lluviaCosecha>80){if(estado!=="veto")estado="riesgo";problemas.push("Lluvia de cosecha alta ("+lluviaCosecha+" mm): riesgo de botritis.");}
  else if(lluviaCosecha>45&&estado==="apto"){estado="riesgo";problemas.push("Lluvia de cosecha moderada ("+lluviaCosecha+" mm): vigilar botritis.");}
  if(calor>35){if(estado!=="veto")estado="riesgo";problemas.push("Muchos días sobre 34 °C ("+calor+"/año): estrés de maduración.");}
  const botritis=lluviaCosecha>60?"alto":lluviaCosecha>30?"medio":"bajo";
  return{estado,gda,heladaTardia,temporadas:n,amplitud,calor,lluviaCosecha,botritis,problemas,radiacionProm,lluviaAnual,et0Anual,balanceHidrico,vientoMax};
}

async function pedirClima(lat,lon){
  const anioActual=new Date().getFullYear();
  const finAnio=anioActual-1;
  const startFull=(finAnio-24)+"-01-01";
  const startShort=(finAnio-9)+"-01-01";
  const end=finAnio+"-12-31";
  const base=(daily,start)=>"https://archive-api.open-meteo.com/v1/archive?latitude="+lat.toFixed(4)+"&longitude="+lon.toFixed(4)+"&start_date="+start+"&end_date="+end+"&timezone=auto&daily="+daily;
  const completo="temperature_2m_max,temperature_2m_min,precipitation_sum,shortwave_radiation_sum,et0_fao_evapotranspiration,wind_speed_10m_max";
  const basico="temperature_2m_max,temperature_2m_min,precipitation_sum";

  let ultimoError="";
  async function intentar(url){
    try{
      // Vía proxy: usa la IP del servidor de Netlify, evita el límite por IP del usuario.
      const j=await fetchGeo(url,20000);
      if(!j){ ultimoError="sin respuesta"; return null; }
      if(j.error){ ultimoError=(j.reason||"error API"); return null; }
      if(!j.daily){ ultimoError="respuesta sin datos diarios"; return null; }
      return j;
    }catch(e){ ultimoError=(e&&e.message)||"error de red"; return null; }
  }

  const intentos=[base(completo,startFull),base(basico,startFull),base(completo,startShort),base(basico,startShort)];
  let j=null;
  for(let k=0;k<intentos.length&&!j;k++){
    j=await intentar(intentos[k]);
    if(!j&&k<intentos.length-1) await new Promise(res=>setTimeout(res,1000));
  }
  if(!j){ await new Promise(res=>setTimeout(res,2000)); j=await intentar(base(basico,startShort)); }
  if(!j) throw new Error(ultimoError||"Open-Meteo no respondió");

  const d=j.daily;
  const res=analizarClima(d.time,d.temperature_2m_max,d.temperature_2m_min,d.precipitation_sum,d.shortwave_radiation_sum,d.et0_fao_evapotranspiration,d.wind_speed_10m_max);
  res._url=base(basico,startFull); // guardar para diagnóstico
  return res;
}// fetchGeo: intenta la petición directa (si el servidor permite CORS) y, si el
// navegador la bloquea, reintenta a través del proxy de Netlify (/api/geo).
// Así funciona con CIREN y DGA tanto si permiten CORS como si no.
async function fetchGeo(url, timeoutMs){
  const t = timeoutMs || 9000;
  // Helper: parsea SOLO si es JSON de verdad (evita tragarse el index.html del proxy caido)
  const leerJSON = async (resp) => {
    const ct = resp.headers.get("content-type") || "";
    const txt = await resp.text();
    // Si viene HTML (proxy inactivo devuelve la SPA), NO es dato valido.
    if (ct.indexOf("html") !== -1 || txt.trim().startsWith("<")) throw new Error("respuesta-no-json");
    try { return JSON.parse(txt); } catch(e){ throw new Error("json-invalido"); }
  };
  // 1) Intento directo (si el servidor permite CORS)
  try{
    const r = await fetch(url, { signal: AbortSignal.timeout(t) });
    if(!r.ok) throw 0;
    return await leerJSON(r);
  }catch(e){ /* sigue al proxy */ }
  // 2) Reintento vía proxy Netlify. Si el proxy no existe, leerJSON lanzara y no
  //    devolvemos datos falsos.
  const prox = "/api/geo?url=" + encodeURIComponent(url);
  const r2 = await fetch(prox, { signal: AbortSignal.timeout(t + 4000) });
  if(!r2.ok) throw new Error("proxy-"+r2.status);
  return await leerJSON(r2);
}

// Agua REAL: ArcGIS del MOP/DGA. ¿el punto cae en restriccion/prohibicion?
async function pedirAgua(lat,lon){
  const base="https://rest-sit.mop.gob.cl/arcgis/rest/services/DGA/Areas_de_Restriccion_y_Zonas_de_Prohibicion/MapServer/0/query";
  try{
    const params=new URLSearchParams({
      where:"1=1",
      geometry:lon.toFixed(6)+","+lat.toFixed(6),
      geometryType:"esriGeometryPoint",inSR:"4326",
      spatialRel:"esriSpatialRelIntersects",outFields:"*",returnGeometry:"false",f:"json"});
    const j=await fetchGeo(base+"?"+params.toString(),9000);
    if(j.error)throw 0;
    const hay=j.features&&j.features.length>0&&j.features.length<=3;
    if(hay){
      const a=j.features[0].attributes||{};
      const tipo=(a.TIPO_LIMIT||a.tipo_limit||"").toString();
      const shac=(a.SHAC||a.shac||"").toString().trim();
      const acuif=(a.NOM_ACUIF||a.nom_acuif||"").toString().trim();
      const region=(a.REGION||a.region||"").toString().trim();
      const res=(a.RES_DGA||a.res_dga||"").toString().trim();
      const fecha=(()=>{const f=a.F_RES_DGA||a.f_res_dga;if(!f)return"";try{return new Date(f).getFullYear();}catch(e){return"";}})();
      const esProhib=/prohib/i.test(tipo);
      const esRestric=/restric/i.test(tipo);
      const esAbierto=/abierto/i.test(tipo);
      const nombre=shac||acuif||"acuífero";
      if(esAbierto){
        return{estado:"apto",conectado:true,
          titular:"Acuífero ABIERTO: "+nombre,
          detalle:"Sin restricción ni prohibición vigente. No garantiza disponibilidad real de derechos; verificar en el visor DGA.",
          extra:(acuif&&acuif!==shac)?("Acuífero: "+acuif):null};
      }
      let suf="";
      if(res){ suf=" (Res. DGA "+res+(fecha?"/"+fecha:"")+")"; }
      const extraAcuif = (acuif&&acuif!==shac) ? ("Acuífero: "+acuif) : null;
      if(esProhib){
        return{estado:"riesgo",conectado:true,nivel:"prohibicion",
          titular:"ZONA DE PROHIBICIÓN: "+nombre,
          detalle:"No se constituyen NUEVOS derechos permanentes. La viña es viable solo comprando/transfiriendo derechos existentes en el mismo acuífero. Verificar oferta y precio."+suf,
          extra:extraAcuif};
      }
      if(esRestric){
        return{estado:"riesgo",conectado:true,nivel:"restriccion",
          titular:"ÁREA DE RESTRICCIÓN: "+nombre,
          detalle:"La DGA solo otorga derechos PROVISIONALES. También se pueden comprar derechos existentes. Disponibilidad limitada."+suf,
          extra:extraAcuif};
      }
      // tipo desconocido pero hay poligono
      return{estado:"riesgo",conectado:true,
        titular:"Limitación vigente: "+nombre,
        detalle:tipo||"El punto cae en un acuífero con limitación administrativa. Verificar en el visor DGA.",
        extra:extraAcuif};
    }
    // sin poligono = fuera de SHAC declarado
    return{estado:"apto",conectado:true,
      titular:"Sin restricción de agua en el punto",
      detalle:"El punto no cae en un acuífero declarado en restricción o prohibición por la DGA. Igual conviene verificar disponibilidad real de derechos.",
      extra:null};
  }catch(e){return{estado:"nd",conectado:false};}
}

// HUMEDAL: detecta si el punto cae en un humedal (inventario o urbano declarado).
// Un humedal es VETO: no se planta (protegido por Ley 21.202, suelo anegado).
async function pedirHumedal(lat,lon){
  const capas=[
    {url:"https://arcgis.mma.gob.cl/server/rest/services/SIMBIO/SIMBIO_HUMEDALES/MapServer/1",tipo:"urbano"},
    {url:"https://arcgis.mma.gob.cl/server/rest/services/SIMBIO/SIMBIO_HUMEDALES/MapServer/0",tipo:"inventario"},
  ];
  for(const c of capas){
    try{
      const params=new URLSearchParams({
        where:"1=1",geometry:lon.toFixed(6)+","+lat.toFixed(6),
        geometryType:"esriGeometryPoint",inSR:"4326",
        spatialRel:"esriSpatialRelIntersects",outFields:"*",returnGeometry:"false",f:"json"});
      const j=await fetchGeo(c.url+"/query?"+params.toString(),9000);
      if(j.error||!j.features||!j.features.length)continue;
      const a=j.features[0].attributes||{};
      const nombre=(a.NOMBRE||a.NOM_HUMDET||a.NOM_HUMEDA||a.NOM_HUMEDAL||"humedal").toString().trim();
      const comuna=(a.COMUNA||"").toString().trim();
      const declarado=a.ES_DECLARADO===1||/declarad/i.test(JSON.stringify(a));
      if(c.tipo==="urbano"){
        return{esHumedal:true,tipo:"Humedal urbano"+(declarado?" declarado":""),nombre,comuna,
          detalle:"Protegido por la Ley 21.202. NO se puede plantar ni construir: es área de protección de valor natural y suelo anegado."};
      }
      return{esHumedal:true,tipo:"Humedal (Inventario Nacional MMA)",nombre,comuna,
        detalle:"El punto está en un humedal del inventario nacional. Suelo anegado y ecosistema protegido: no apto para viña."};
    }catch(e){continue;}
  }
  return{esHumedal:false};
}

// Suelo REAL de Chile// Suelo REAL de Chile: estudios agrologicos CIREN. Cubre TODO Chile (Atacama-Aysen)
// descubriendo dinamicamente las capas del servicio, sin IDs codificados a mano.
const CIREN_SERVICIOS = [
  "https://esri.ciren.cl/server/rest/services/IDEMINAGRI/SUELOS_AGROLOGICOS/MapServer",
  "https://esri.ciren.cl/server/rest/services/ESTUDIO_AGROLOGICO_SUELOS/MapServer",
];

async function listarCapas(servicio){
  try{
    const j=await fetchGeo(servicio+"?f=json",8000);
    if(!j.layers)return [];
    return j.layers.map(l=>l.id);
  }catch(e){return [];}
}

async function consultarCapa(servicio,capa,lat,lon){
  const base=servicio+"/"+capa+"/query";
  // where=1=1 explicito + geometria de punto. spatialRel Intersects filtra al
  // poligono que CONTIENE el punto. Pedimos count primero para validar 1 match.
  const params=new URLSearchParams({
    where:"1=1",
    geometry:JSON.stringify({x:lon,y:lat,spatialReference:{wkid:4326}}),
    geometryType:"esriGeometryPoint",
    inSR:"4326",
    spatialRel:"esriSpatialRelIntersects",
    outFields:"*",
    returnGeometry:"false",
    f:"json",
  });
  const j=await fetchGeo(base+"?"+params.toString(),8000);
  if(j.error)throw 0;
  if(!j.features||j.features.length===0)throw 0; // sin dato en este punto (correcto)
  // GUARDA CONTRA BUG: si devuelve MUCHOS features, la consulta no filtro por punto
  // (devolvio toda la capa). Ese dato NO es fiable para el punto -> lo rechazamos.
  if(j.features.length>3)throw 0;
  return j.features[0].attributes||{};
}

function explicaCapacidad(num){
  const M={
    I:"Clase I — suelo sin limitaciones, apto para cualquier cultivo. Excelente para vid.",
    II:"Clase II — limitaciones leves. Muy apto para vid.",
    III:"Clase III — limitaciones moderadas (drenaje, pendiente o profundidad). Apto para vid con manejo.",
    IV:"Clase IV — limitaciones severas; cultivo restringido. La vid es de los pocos cultivos viables aquí.",
    V:"Clase V — no arable por pedregosidad o anegamiento, pero sin erosión. Uso preferente praderas/forestal.",
    VI:"Clase VI — solo praderas o forestal; laderas o secano. Vid solo en microsectores favorables.",
    VII:"Clase VII — severas limitaciones, uso forestal. No recomendable para vid.",
    VIII:"Clase VIII — sin aptitud productiva (roca, alta montaña). No plantable.",
  };
  return M[num]||null;
}

function interpretarSuelo(a, nombreCapa){
  const buscar=(re)=>{const k=Object.keys(a).find(k=>re.test(k)&&a[k]!=null&&String(a[k]).trim()!=="");return k?a[k]:null;};
  // CIREN usa codigos abreviados: textcaus/txtcaus=capacidad de uso, simbvari/simbolo=serie,
  // caus/cus=clase capacidad, drenaje, textura, etc. Buscamos por codigo Y por alias legible.
  const serie=buscar(/simbvari|simbolo|serie|nom_ser|nombre_su|variacion/i);
  const capacidad=buscar(/textcaus|txtcaus|txtcus|caus|^cus$|cap.*uso|capuso|clase.*cap|c_uso/i);
  const drenaje=buscar(/drenaj|txtdren|dren/i);
  const textura=buscar(/textur|txttext|text_sup/i);
  const aptFrutal=buscar(/apt.*frut|frutal|txtfrut/i);
  const aptAgricola=buscar(/apt.*agric|agricol|txtagri/i);
  const riego=buscar(/txtrieg|riego|categ.*rieg|caprie/i);
  const erosion=buscar(/erosi|txteros/i);
  const prof=buscar(/profund|txtprof|prof/i);
  const topografia=buscar(/topograf|pendient|txttopo|txtpend/i);
  const ph=buscar(/^ph$|ph_|txtph/i);

  // VALIDACION ESTRICTA: si no hay NINGUN campo agronomico util, no es un dato fiable.
  const utiles=[serie,capacidad,drenaje,textura,aptFrutal,aptAgricola].filter(v=>v!=null);
  if(utiles.length===0) return null;

  let estado="apto";const notas=[];
  const capStr=(capacidad!=null?String(capacidad):"");
  const num=(capStr.match(/(VIII|VII|VI|IV|III|II|I|V)/)||[])[0];
  const mapaRomano={I:1,II:2,III:3,IV:4,V:5,VI:6,VII:7,VIII:8};
  const cn=mapaRomano[num];
  if(cn){
    if(cn<=3)estado="apto";
    else if(cn===4){estado="apto";notas.push("capacidad de uso IV: cultivable con limitaciones; la vid es viable con manejo");}
    else if(cn<=6){estado="riesgo";notas.push("capacidad de uso "+num+": limitaciones serias (secano/laderas); solo microsectores favorables");}
    else{estado="veto";notas.push("capacidad de uso "+num+": suelo NO arable (forestal/sin aptitud). No apto para viña");}
  }
  if(drenaje&&/(pobre|imperfect|mal)/i.test(String(drenaje))){if(estado==="apto")estado="riesgo";notas.push("drenaje "+String(drenaje).toLowerCase()+": la vid no tolera encharcamiento");}
  const explica=num?explicaCapacidad(num):null;
  const juicio=explica||(notas.length?notas.join("; ")+".":"Dato de capacidad de uso disponible.");
  return{estado,conectado:true,fuente:"CIREN",region:nombreCapa,serie,capacidad:capStr||null,drenaje,textura,aptFrutal,aptAgricola,riego,erosion,prof,topografia,ph,juicio,explica};
}

// Descubre capas con su NOMBRE (para verificar que corresponde a la region del punto).
async function listarCapasConNombre(servicio){
  try{
    const j=await fetchGeo(servicio+"?f=json",8000);
    if(!j.layers)return [];
    return j.layers.map(l=>({id:l.id,nombre:l.name||("capa "+l.id)}));
  }catch(e){return [];}
}

async function consultarCapaDist(servicio,capa,lat,lon,dist){
  const base=servicio+"/"+capa+"/query";
  const params=new URLSearchParams({
    where:"1=1",
    geometry:JSON.stringify({x:lon,y:lat,spatialReference:{wkid:4326}}),
    geometryType:"esriGeometryPoint",inSR:"4326",
    spatialRel:"esriSpatialRelIntersects",outFields:"*",returnGeometry:"false",f:"json",
  });
  if(dist&&dist>0){ params.set("distance",String(dist)); params.set("units","esriSRUnit_Meter"); }
  const j=await fetchGeo(base+"?"+params.toString(),8000);
  if(j.error||!j.features||!j.features.length)throw 0;
  // Con distancia puede devolver varios; tomamos el primero pero avisamos que es aproximado.
  return j.features[0].attributes||{};
}

// Ordena las capas para consultar primero la region probable segun latitud.
// Rangos aprox de latitud por region (para priorizar, no para excluir).
function prioridadRegion(nombre, lat){
  const R=[
    [/atacama/i,-29,-25],[/coquimbo/i,-32.3,-29],[/valpara/i,-33.3,-32],
    [/metropolit/i,-34.3,-32.9],[/higgins/i,-35,-33.8],[/maule/i,-36.4,-34.7],
    [/uble|ñuble/i,-37.3,-36],[/b[ií]o/i,-38.5,-36.8],[/araucan/i,-39.6,-37.5],
    [/r[ií]os/i,-40.5,-39.2],[/lagos/i,-44,-40],[/ays[eé]n/i,-49,-43.5],
    [/magallan/i,-56,-48.5],[/pascua/i,-27.2,-27.0],
  ];
  for(const [re,a,b] of R){ if(re.test(nombre)) return (lat<=b&&lat>=a)?0:1; }
  return 2;
}

async function pedirSuelo(lat,lon){
  // FASE 1: punto EXACTO en cada servicio (dato 100% del lugar).
  for(const servicio of CIREN_SERVICIOS){
    let capas=await listarCapasConNombre(servicio);
    if(!capas.length)continue;
    capas=capas.slice().sort((a,b)=>prioridadRegion(a.nombre,lat)-prioridadRegion(b.nombre,lat));
    const intentos=await Promise.allSettled(capas.map(async c=>{
      const attr=await consultarCapa(servicio,c.id,lat,lon);
      return {attr,nombre:c.nombre};
    }));
    for(const it of intentos){
      if(it.status==="fulfilled"&&it.value.attr){
        const r=interpretarSuelo(it.value.attr,it.value.nombre);
        if(r){r.aprox=null;return r;}
      }
    }
  }
  // FASE 2: BUSCAR COMO LOCO. Radios crecientes hasta 5 km. El suelo cercano es
  // orientativo (no exactamente el del punto), y lo marcamos como tal.
  const radios=[300,1000,3000,5000];
  for(const servicio of CIREN_SERVICIOS){
    const capas=await listarCapasConNombre(servicio);
    if(!capas.length)continue;
    for(const dist of radios){
      const intentos=await Promise.allSettled(capas.map(async c=>{
        const attr=await consultarCapaDist(servicio,c.id,lat,lon,dist);
        return {attr,nombre:c.nombre};
      }));
      for(const it of intentos){
        if(it.status==="fulfilled"&&it.value.attr){
          const r=interpretarSuelo(it.value.attr,it.value.nombre);
          if(r){r.aprox=dist;return r;} // marca distancia de aproximacion
        }
      }
    }
  }
  return{estado:"nd",conectado:false};
}

// Explicaciones de cada fuente (que es, como leerla) — no solo un link a numeros.
const EXPLICA = {
  clima:{titulo:"Open-Meteo (clima ERA5)",que:"Reanálisis climático: combina estaciones, satélite y modelo para dar la temperatura y lluvia diaria de cualquier punto desde 1940. El enlace abre los datos diarios crudos (JSON) de tu punto; WineCheck ya los procesó en los indicadores de arriba.",u:(lat,lon)=>{const f=new Date().getFullYear()-1;return "https://open-meteo.com/en/docs/historical-weather-api#latitude="+lat.toFixed(4)+"&longitude="+lon.toFixed(4);}},
  winkler:{titulo:"Índice de Winkler (referencia agronómica)",que:"El método clásico que clasifica un clima vitícola en cinco regiones según los grados-día acumulados, y qué cepas maduran bien en cada una. El enlace explica el método.",u:()=>"https://es.wikipedia.org/wiki/%C3%8Dndice_Winkler"},
  agua:{titulo:"DGA — Áreas de restricción y prohibición",que:"La Dirección General de Aguas declara acuíferos 'en restricción' (solo derechos provisionales) o 'en prohibición' (sin nuevos derechos). El enlace abre el listado oficial con las resoluciones vigentes.",u:()=>"https://dga.mop.gob.cl/derechos-de-agua/proteccion-de-las-fuentes/areas-de-restriccion/"},
  suelo:{titulo:"CIREN — Estudio agrológico de suelos",que:"El estudio oficial de suelos de Chile (escala 1:20.000). Define la serie de suelo, su capacidad de uso (I a VIII), drenaje, textura y aptitud frutal. Es el dato que usan los agrónomos. El enlace abre el visor de suelos de CIREN.",u:()=>"https://www.ciren.cl/productos/suelos-agrologicos/"},
};

function MiniSemaforo({estado}){
  const c=CFG[estado]||CFG.nd;
  return(<span style={{display:"inline-flex",alignItems:"center",gap:6,fontSize:12,fontWeight:600,color:c.color}}>
    <span style={{fontSize:10}}>{c.icono}</span>{c.label}</span>);
}
function Dato({valor,unidad,etiqueta}){
  return(<div style={{marginBottom:14}}>
    <div style={{display:"flex",alignItems:"baseline",gap:4}}>
      <span style={{fontSize:22,fontWeight:700,color:P.tinta,fontVariantNumeric:"tabular-nums"}}>{valor}</span>
      {unidad&&<span style={{fontSize:13,color:P.suave}}>{unidad}</span>}</div>
    <div style={{fontSize:12.5,color:P.suave,lineHeight:1.35}}>{etiqueta}</div></div>);
}
function Fila({etiqueta,valor}){
  if(valor==null||valor==="")return null;
  return(<div style={{fontSize:13,lineHeight:1.5}}><strong>{etiqueta}:</strong> {String(valor)}</div>);
}
function Tarjeta({titulo,estado,destacada,nota,children}){
  return(<div style={{border:destacada?"2px solid "+P.agua:"1px solid "+P.linea,
    borderLeft:"4px solid "+(CFG[estado]||CFG.nd).color,borderRadius:10,padding:"14px 16px",background:P.panel,marginBottom:12}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
      <h3 style={{margin:0,fontSize:14,fontWeight:700,color:destacada?P.agua:P.vid}}>{titulo}</h3>
      <MiniSemaforo estado={estado}/></div>
    {nota&&<div style={{fontSize:10.5,color:"#B08900",background:"#FBF3DC",borderRadius:5,padding:"3px 7px",display:"inline-block",marginBottom:10}}>{nota}</div>}
    {children}</div>);
}
function VolarA({destino}){
  const map=useMap();
  React.useEffect(()=>{ if(destino) map.flyTo([destino.lat,destino.lon],14,{duration:1.2}); },[destino,map]);
  return null;
}
function ClicHandler({onClic,activo}){
  useMapEvents({click(e){if(activo)onClic([e.latlng.lat,e.latlng.lng]);}});
  return null;
}

function veredictoGlobal(clima,agua,suelo,humedal,protegida,pendiente,extras,cuerpoAgua){
  if((cuerpoAgua&&cuerpoAgua.enAgua)||(pendiente&&pendiente.ok&&pendiente.enAgua))return "veto";
  if(humedal&&humedal.esHumedal)return "veto";
  if(protegida&&protegida.protegida)return "veto";
  if(extras&&extras.activas&&Object.keys(extras.activas).length>0)return "veto";
  if(pendiente&&pendiente.ok&&pendiente.estado==="veto")return "veto";
  const orden={veto:3,riesgo:2,apto:1,nd:0};
  const estados=[clima&&clima.estado, agua&&agua.conectado&&agua.estado, suelo&&suelo.conectado&&suelo.estado];
  if(pendiente&&pendiente.ok)estados.push(pendiente.estado);
  const validos=estados.filter(Boolean);
  if(!validos.length)return "nd";
  let peor="apto";for(const e of validos){if(orden[e]>orden[peor])peor=e;}return peor;
}
function fraseGlobal(g,clima,agua,w,rec,humedal,protegida,pendiente,extras,cuerpoAgua){
  // VETOS ABSOLUTOS (no plantable físicamente/legalmente)
  if(cuerpoAgua&&cuerpoAgua.enAgua)return "No plantable: el punto está en "+cuerpoAgua.tipo.toLowerCase()+(cuerpoAgua.nombre?" ("+cuerpoAgua.nombre+")":"")+". Es un cuerpo de agua.";
  if(pendiente&&pendiente.ok&&pendiente.enAgua)return "No plantable: el punto está sobre el mar u océano (sin superficie de tierra).";
  if(extras&&extras.activas&&Object.keys(extras.activas).length>0){const k=Object.keys(extras.activas)[0];const e=extras.activas[k];return "No plantable: el punto está en "+e.tipo.toLowerCase()+(e.nombre?" ("+e.nombre+")":"")+". "+e.detalle;}
  if(humedal&&humedal.esHumedal)return "No plantable: el punto está en un "+humedal.tipo.toLowerCase()+(humedal.nombre?" ("+humedal.nombre+")":"")+". Es área protegida y suelo anegado.";
  if(protegida&&protegida.protegida)return "No plantable: el punto está dentro de un área protegida"+(protegida.nombre?" ("+protegida.nombre+")":"")+". Prohibido por ley plantar o construir.";
  // Recolectar TODOS los problemas de las capas evaluables, coherente con el color.
  const probs=[];
  if(pendiente&&pendiente.ok&&pendiente.estado==="veto")probs.push("pendiente extrema (~"+pendiente.pendiente+"%): inviable mecanizar");
  else if(pendiente&&pendiente.ok&&pendiente.estado==="riesgo")probs.push("pendiente pronunciada (~"+pendiente.pendiente+"%)");
  if(clima&&clima.estado==="veto"&&clima.problemas&&clima.problemas[0])probs.push(clima.problemas[0]);
  else if(clima&&clima.estado==="riesgo"&&clima.problemas&&clima.problemas[0])probs.push(clima.problemas[0]);
  if(agua&&agua.conectado&&agua.estado==="veto")probs.push("agua: acuífero en prohibición");
  else if(agua&&agua.conectado&&agua.estado==="riesgo")probs.push("agua: restricción de derechos");
  if(suelo&&suelo.conectado&&suelo.estado==="veto")probs.push("suelo clase "+suelo.capacidad+": no arable");
  else if(suelo&&suelo.conectado&&suelo.estado==="riesgo")probs.push("suelo clase "+suelo.capacidad+": con limitaciones");

  if(g==="veto")return "No recomendado. Factores que lo impiden: "+(probs.join("; ")||"limitación severa")+".";
  if(g==="riesgo")return "Plantable con manejo. Atender: "+(probs.join("; ")||"factores en ámbar")+". Cepas afines al clima "+w.region+": "+rec.cepas+".";
  return "Buena opción. Clima "+w.region+" ("+rec.perfil+"), sin factores limitantes en agua, suelo ni relieve. Cepas afines: "+rec.cepas+".";
}

async function pedirCuerpoAgua(lat,lon){
  // Lagos/ríos/embalses vía Overpass (el mar se detecta por elevación en pedirPendiente).
  try{
    const q="[out:json][timeout:10];(way(around:120,"+lat+","+lon+")[natural=water];way(around:120,"+lat+","+lon+")[waterway~\"river|canal|stream\"];relation(around:120,"+lat+","+lon+")[natural=water];);out tags 1;";
    const url="https://overpass-api.de/api/interpreter?data="+encodeURIComponent(q);
    const j=await fetchGeo(url,10000);
    if(j&&j.elements&&j.elements.length>0){
      const t=j.elements[0].tags||{};
      let tipo="Cuerpo de agua";
      if(t.water==="lake"||/lag/i.test(t.name||""))tipo="Lago";
      else if(t.waterway)tipo="Río / cauce";
      else if(t.water==="reservoir"||/embalse/i.test(t.name||""))tipo="Embalse";
      return{enAgua:true,tipo,nombre:(t.name||"").trim()};
    }
    return{enAgua:false};
  }catch(e){return{enAgua:false,error:true};}
}

// filtrado por región del punto. API pública CKAN (JSON), licencia CC-BY.
// Convierte WineCheck de herramienta agronómica a herramienta de inversión.
async function pedirEscasez(lat,lon){
  try{
    const base="https://rest-sit.mop.gob.cl/arcgis/rest/services/DGA/Decretos_Escasez_Hidrica/MapServer/0/query";
    const params=new URLSearchParams({
      where:"1=1",geometry:lon.toFixed(6)+","+lat.toFixed(6),
      geometryType:"esriGeometryPoint",inSR:"4326",
      spatialRel:"esriSpatialRelIntersects",outFields:"*",returnGeometry:"false",f:"json"});
    const j=await fetchGeo(base+"?"+params.toString(),9000);
    if(j.error||!j.features||!j.features.length||j.features.length>5)return {escasez:false};
    const a=j.features[0].attributes||{};
    const decreto=Object.values(a).find(v=>typeof v==="string"&&/decreto|escasez|n°|res/i.test(v))||"";
    return {escasez:true,detalle:String(decreto).trim()};
  }catch(e){return {escasez:false};}
}

async function puntoEnCapa(urlLayer, lat, lon, campoNombre){
  try{
    const params=new URLSearchParams({
      where:"1=1",geometry:lon.toFixed(6)+","+lat.toFixed(6),
      geometryType:"esriGeometryPoint",inSR:"4326",
      spatialRel:"esriSpatialRelIntersects",outFields:"*",returnGeometry:"false",f:"json"});
    const j=await fetchGeo(urlLayer+"/query?"+params.toString(),8000);
    if(j.error||!j.features||!j.features.length)return {hay:false};
    const a=j.features[0].attributes||{};
    let nombre="";
    if(campoNombre){for(const c of campoNombre){if(a[c]){nombre=String(a[c]).trim();break;}}}
    return {hay:true,nombre};
  }catch(e){return {hay:false,error:true};}
}

// Capas de restricción adicionales. Cada una se AUTO-VERIFICA: si el servicio
// no responde o no existe, se reporta como "no-verificada" y NO afecta el veredicto
// (integridad: nunca vetamos por una fuente que no pudimos confirmar).
const CAPAS_EXTRA=[];

async function pedirRestriccionesExtra(lat,lon){
  const activas={}; const estado={};
  for(const c of CAPAS_EXTRA){
    const r=await puntoEnCapa(c.url,lat,lon,c.campos);
    if(r.error){ estado[c.clave]="no-verificada"; }
    else if(r.hay){ activas[c.clave]={tipo:c.tipo,nombre:r.nombre,detalle:c.detalle,porque:c.porque}; estado[c.clave]="activa"; }
    else { estado[c.clave]="libre"; }
  }
  return {activas, estado};
}

// ÁREA PROTEGIDA:// ÁREA PROTEGIDA: parque nacional, reserva, santuario, monumento, RAMSAR, etc.
// Servicio oficial SMA (Areas_proteccion_oficial2). VETO: no se planta.
async function pedirAreaProtegida(lat,lon){
  const base="https://ideserver.sma.gob.cl/arcgis/rest/services/IDE/Areas_proteccion_oficial2/MapServer";
  // Consultamos las capas mas relevantes (parques, reservas, monumentos, santuarios).
  // Usamos identify sobre todas las capas visibles de una vez.
  try{
    const params=new URLSearchParams({
      geometry:JSON.stringify({x:lon,y:lat,spatialReference:{wkid:4326}}),
      geometryType:"esriGeometryPoint",sr:"4326",
      tolerance:"2",mapExtent:(lon-0.01)+","+(lat-0.01)+","+(lon+0.01)+","+(lat+0.01),
      imageDisplay:"400,400,96",layers:"all",returnGeometry:"false",f:"json"});
    const j=await fetchGeo(base+"/identify?"+params.toString(),9000);
    if(j&&j.results&&j.results.length>0){
      const r=j.results[0];
      const nombre=r.value||(r.attributes&&(r.attributes.NOMBRE||r.attributes.Nombre))||"";
      const capa=r.layerName||"Área protegida";
      return{protegida:true,tipo:capa,nombre:(typeof nombre==="string"?nombre:"").trim()};
    }
    return{protegida:false};
  }catch(e){return{protegida:false,error:true};}
}

// PENDIENTE / CERRO: usa Open-Meteo Elevation (Copernicus DEM). Consulta la altura
// en varios puntos del terreno; si el desnivel es alto para la distancia, es ladera
// empinada. Pendiente >45% suele ser inviable para viña mecanizada.
async function pedirPendiente(puntos, centro){
  try{
    const todos=[centro,...puntos];
    const lats=todos.map(p=>p[0]).join(",");
    const lons=todos.map(p=>p[1]).join(",");
    const url="https://api.open-meteo.com/v1/elevation?latitude="+lats+"&longitude="+lons;
    const j=await fetchGeo(url,9000);
    if(!j||!j.elevation||!j.elevation.length)return{ok:false};
    const elevs=j.elevation;
    const emin=Math.min(...elevs), emax=Math.max(...elevs);
    const desnivel=emax-emin;
    // distancia maxima aprox entre puntos (grados -> metros)
    let distMax=0;
    for(let i=0;i<todos.length;i++)for(let k=i+1;k<todos.length;k++){
      const dy=(todos[i][0]-todos[k][0])*111000;
      const dx=(todos[i][1]-todos[k][1])*92000;
      const d=Math.sqrt(dx*dx+dy*dy);
      if(d>distMax)distMax=d;
    }
    const pendientePct = distMax>0 ? Math.round((desnivel/distMax)*100) : 0;
    let estado="apto";
    if(pendientePct>45){estado="veto";}
    else if(pendientePct>25){estado="riesgo";}
    // Detección de agua/mar: elevación <= 0 (bajo el nivel del mar) = cuerpo de agua.
    const enAgua = emax<=0;
    return{ok:true,elevMin:Math.round(emin),elevMax:Math.round(emax),desnivel:Math.round(desnivel),pendiente:pendientePct,estado,enAgua};
  }catch(e){return{ok:false};}
}

// Consulta el suelo en varios puntos del poligono (las 4 esquinas + centro) para
// capturar la VARIABILIDAD del terreno: un predio grande puede tener varias clases.
// Version ligera: solo la region correcta por latitud, 1 servicio, sin radios.
// Para el muestreo multiple (5 puntos) esto evita cientos de requests.
async function pedirSueloLigero(lat,lon,capasCache){
  const servicio=CIREN_SERVICIOS[0];
  const capas=capasCache||await listarCapasConNombre(servicio);
  if(!capas.length)return {estado:"nd",conectado:false,_capas:capas};
  // priorizar la region por latitud y consultar solo las 2 primeras candidatas
  const ordenadas=capas.slice().sort((a,b)=>prioridadRegion(a.nombre,lat)-prioridadRegion(b.nombre,lat)).slice(0,2);
  for(const c of ordenadas){
    try{
      const attr=await consultarCapa(servicio,c.id,lat,lon);
      const r=interpretarSuelo(attr,c.nombre);
      if(r){r._capas=capas;return r;}
    }catch(e){}
  }
  return {estado:"nd",conectado:false,_capas:capas};
}

async function pedirSuelosMultiples(puntos, centro){
  const sitios=[...puntos, centro]; // 4 esquinas + centroide
  // Primera consulta (centro) tambien descubre las capas y las reusa (cache) -> rapido.
  const primero=await pedirSueloLigero(centro[0],centro[1]);
  const capasCache=primero._capas;
  const restantes=await Promise.allSettled(puntos.map(p=>pedirSueloLigero(p[0],p[1],capasCache)));
  const todos=[primero,...restantes.filter(r=>r.status==="fulfilled").map(r=>r.value)];
  const encontrados=todos.filter(s=>s&&s.conectado);
  if(!encontrados.length){
    // ninguno con dato en el poligono: intentar UNA busqueda amplia en el centro (fase 2)
    const amplio=await pedirSuelo(centro[0],centro[1]);
    return {lista: amplio.conectado?[amplio]:[], principal:amplio};
  }
  // Agrupar por clase de capacidad de uso unica
  const porClase={};
  for(const s of encontrados){
    const clave=s.capacidad||"s/i";
    if(!porClase[clave]) porClase[clave]=s;
  }
  const lista=Object.values(porClase);
  // El "principal" (para el veredicto) = el PEOR suelo encontrado (mas conservador)
  const orden={veto:3,riesgo:2,apto:1,nd:0};
  let principal=lista[0];
  for(const s of lista){ if(orden[s.estado]>orden[principal.estado]) principal=s; }
  return {lista, principal};
}

export default function App(){
  const esMovil=useEsMovil();
  const [puntos,setPuntos]=useState([]);
  const [fase,setFase]=useState("mapa");
  const [modo,setModo]=useState("diseno");
  const [bib,setBib]=useState(false);
  const [clima,setClima]=useState(null);
  const [agua,setAgua]=useState(null);
  const [suelo,setSuelo]=useState(null);
  const [suelosMulti,setSuelosMulti]=useState([]);
  const [humedal,setHumedal]=useState(null);
  const [protegida,setProtegida]=useState(null);
  const [pendiente,setPendiente]=useState(null);
  const [extras,setExtras]=useState({activas:{},estado:{}});
  const [cuerpoAgua,setCuerpoAgua]=useState(null);
    const [escasez,setEscasez]=useState(null);
  const [aguaVar,setAguaVar]=useState([]);
  const [capaBase,setCapaBase]=useState("calle"); // calle | satelite | topo
  const [busqueda,setBusqueda]=useState("");
  const [destinoBusqueda,setDestinoBusqueda]=useState(null);
  const [buscando,setBuscando]=useState(false);
  const [centro,setCentro]=useState(null);
  const [error,setError]=useState(null);

  async function buscarLugar(){
    if(!busqueda.trim())return;
    setBuscando(true);
    try{
      const url="https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=cl&q="+encodeURIComponent(busqueda);
      const r=await fetch(url,{headers:{"Accept":"application/json"},signal:AbortSignal.timeout(9000)});
      const j=await r.json();
      if(j&&j.length>0){ setDestinoBusqueda({lat:parseFloat(j[0].lat),lon:parseFloat(j[0].lon)}); }
      else { alert("No se encontró el lugar. Prueba con otro nombre (comuna, localidad)."); }
    }catch(e){ alert("No se pudo buscar ahora. Intenta de nuevo."); }
    setBuscando(false);
  }
  function agregarPunto(ll){if(fase==="mapa")setPuntos(prev=>[...prev,ll]);}
// Muestrea una función de capa en varios puntos y agrupa resultados distintos.
// clave: función que extrae un identificador para deduplicar (ej. tipo, estado).
async function muestrearCapa(fn, sitios, clave){
  const R=await Promise.allSettled(sitios.map(p=>fn(p[0],p[1])));
  const oks=R.filter(r=>r.status==="fulfilled"&&r.value).map(r=>r.value);
  const vistos={}; const distintos=[];
  for(const v of oks){ const k=clave(v); if(k!=null&&!vistos[k]){vistos[k]=1;distintos.push(v);} }
  return distintos;
}

  async function evaluar(){
    const la=puntos.reduce((s,p)=>s+p[0],0)/puntos.length;
    const lo=puntos.reduce((s,p)=>s+p[1],0)/puntos.length;
    setCentro([la,lo]);setFase("cargando");setError(null);
    const val=(r,def)=>r.status==="fulfilled"?r.value:def;
    // Limitar muestreo a máx 5 sitios (esquinas + centro) para no saturar las APIs.
    const sitios=[...puntos.slice(0,4),[la,lo]];
    // CLIMA PRIMERO Y SOLO: es la capa base; la pedimos aislada para que no compita
    // con las demás peticiones y no falle por saturación.
    let c=null, errClima="";
    try{ c=await pedirClima(la,lo); }catch(e){ c=null; errClima=(e&&e.message)||"desconocido"; }
    if(!c){ setError("No se pudo obtener el clima. Detalle técnico: "+errClima+" · Coordenadas consultadas: "+la.toFixed(4)+", "+lo.toFixed(4)); setFase("resultado"); return; }
    try{
      const R=await Promise.allSettled([
        muestrearCapa(pedirCuerpoAgua,sitios,v=>v&&v.enAgua?(v.tipo+(v.nombre||"")):"no"),      // 0 agua-cuerpo (VETO, primero)
        muestrearCapa(pedirAgua,sitios,v=>v&&v.conectado?(v.titular||v.estado):null),          // 1 agua DGA
        pedirSuelosMultiples(puntos,[la,lo]),                       // 2 suelo
        muestrearCapa(pedirHumedal,sitios,v=>v&&v.esHumedal?(v.nombre||v.tipo):"no"),           // 3 humedal
        muestrearCapa(pedirAreaProtegida,sitios,v=>v&&v.protegida?(v.nombre||v.tipo):"no"),     // 4 area
        pedirPendiente(puntos,[la,lo]),                             // 5 pendiente
        pedirRestriccionesExtra(la,lo)                             // 6 extra
      ]);
      const aguaCuerpoList=val(R[0],[]);
      const aguaList=val(R[1],[]);
      const suMulti=val(R[2],{lista:[],principal:{estado:"nd",conectado:false}});
      const humList=val(R[3],[]);
      const protList=val(R[4],[]);
      const pend=val(R[5],{ok:false});
      const ext=val(R[6],{activas:{},estado:{}});

      // Consolidar: para agua/humedal/area/cuerpo, elegir el MÁS restrictivo como principal
      const ordEst={veto:3,riesgo:2,apto:1,nd:0};
      const peorPorEstado=(lista,def)=>{ if(!lista.length)return def; let p=lista[0]; for(const x of lista){if((ordEst[x.estado]||0)>(ordEst[p.estado]||0))p=x;} return p; };
      // agua: el peor estado de todos los sitios
      const aConect=aguaList.filter(x=>x.conectado);
      const a=aConect.length?peorPorEstado(aConect,{estado:"nd",conectado:false}):(aguaList[0]||{estado:"nd",conectado:false});
      // humedal / area / cuerpo: hay veto si CUALQUIER sitio cae dentro
      const hum=humList.find(x=>x.esHumedal)||{esHumedal:false};
      const prot=protList.find(x=>x.protegida)||{protegida:false};
      const cAgua=aguaCuerpoList.find(x=>x.enAgua)||{enAgua:false};

      setClima(c);setAgua(a);setSuelo(suMulti.principal);setSuelosMulti(suMulti.lista);
      setHumedal(hum);setProtegida(prot);setPendiente(pend);setExtras(ext||{activas:{},estado:{}});
      setCuerpoAgua(cAgua);
      // Guardar las listas variables para mostrarlas
      setAguaVar(aConect.length>1?aConect:[]);
      pedirEscasez(la,lo).then(es=>setEscasez(es)).catch(()=>{});
      setFase("resultado");
    }catch(e){setError(e.message||"error");setFase("resultado");}
  }
  function reiniciar(){setPuntos([]);setFase("mapa");setClima(null);setAgua(null);setSuelo(null);setSuelosMulti([]);setHumedal(null);setProtegida(null);setPendiente(null);setExtras({activas:{},estado:{}});setCuerpoAgua(null);setEscasez(null);setAguaVar([]);setCentro(null);setError(null);setBib(false);}

  const w=clima?regionWinkler(clima.gda):null;
  const distCosta=centro?distanciaCostaKm(centro[0],centro[1]):null;
  const rec=clima?cepasRecomendadas(clima.gda,clima.amplitud,distCosta):null;
  const veredicto=clima?veredictoGlobal(clima,agua,suelo,humedal,protegida,pendiente,extras,cuerpoAgua):"nd";
  // Veto absoluto = el sitio es físicamente/legalmente no plantable (agua, humedal,
  // área protegida). En ese caso NO tiene sentido mostrar precios de uva, suelo, etc.
  const enMar=(cuerpoAgua&&cuerpoAgua.enAgua)||(pendiente&&pendiente.ok&&pendiente.enAgua);
  const vetoAbsoluto=enMar||(humedal&&humedal.esHumedal)||(protegida&&protegida.protegida)||(extras&&extras.activas&&Object.keys(extras.activas).length>0);
  const color=fase==="resultado"&&clima?CFG[veredicto].color:P.vid;

  const Panel=()=>(
    <div style={{padding:esMovil?"10px 16px 32px":18}}>
      <div style={{display:"flex",gap:4,background:"#EDEAE1",borderRadius:8,padding:3,marginBottom:16}}>
        {[["diseno","Diseño · 25 años"],["escapada","Escapada · clima"]].map(([k,t])=>(
          <button key={k} onClick={()=>setModo(k)} style={{flex:1,border:"none",borderRadius:6,padding:"9px 6px",
            fontSize:12.5,fontWeight:600,cursor:"pointer",background:modo===k?P.panel:"transparent",
            color:modo===k?P.vid:P.suave,boxShadow:modo===k?"0 1px 3px rgba(0,0,0,.12)":"none"}}>{t}</button>
        ))}
      </div>

      {modo==="diseno"?(
        <>
          <div style={{marginBottom:12}}>
            <h2 style={{margin:"0 0 4px",fontSize:18,color:P.vid}}>Terreno evaluado</h2>
            {centro&&(
              <div style={{fontSize:12,color:P.suave,lineHeight:1.5}}>
                Centro del terreno: <strong>{centro[0].toFixed(4)}, {centro[1].toFixed(4)}</strong> · {puntos.length} puntos marcados
                {" · "}<a href={"https://www.google.com/maps/@"+centro[0]+","+centro[1]+",15z"} target="_blank" rel="noreferrer" style={{color:P.agua}}>ver en Google Maps ↗</a>
              </div>
            )}
          </div>

          {error&&<div style={{background:"#F7E4E1",color:P.veto,borderRadius:10,padding:14,marginBottom:14,fontSize:13,lineHeight:1.5}}>
            <strong>No se pudo calcular el clima.</strong><br/>{error}<br/><span style={{fontSize:11.5}}>Vuelve a intentar; si persiste, revisa tu conexión a internet.</span></div>}

          {clima&&(<>
            <div style={{background:color,color:"#fff",borderRadius:12,padding:"18px 20px",marginBottom:14}}>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                <span style={{fontSize:22}}>{CFG[veredicto].icono}</span>
                <span style={{fontSize:22,fontWeight:800}}>{CFG[veredicto].label}</span></div>
              <p style={{margin:0,fontSize:14,lineHeight:1.45,opacity:0.96}}>{fraseGlobal(veredicto,clima,agua,w,rec,humedal,protegida,pendiente,extras,cuerpoAgua)}</p>
            </div>

            {pendiente&&pendiente.ok&&pendiente.enAgua&&!(cuerpoAgua&&cuerpoAgua.enAgua)&&(
              <div style={{background:"#F7E4E1",border:"2px solid "+P.veto,borderRadius:10,padding:"12px 14px",marginBottom:14}}>
                <div style={{fontSize:14,fontWeight:800,color:P.veto,marginBottom:4}}>🚫 Mar / océano</div>
                <div style={{fontSize:12.5,color:P.suave,lineHeight:1.45}}>El punto marcado está sobre el mar (sin superficie terrestre). No es un terreno plantable.</div>
                <div style={{fontSize:11,color:"#A39C8E",marginTop:6}}>Fuente: Copernicus DEM (elevación bajo el nivel del mar)</div>
              </div>
            )}
            {cuerpoAgua&&cuerpoAgua.enAgua&&(
              <div style={{background:"#F7E4E1",border:"2px solid "+P.veto,borderRadius:10,padding:"12px 14px",marginBottom:14}}>
                <div style={{fontSize:14,fontWeight:800,color:P.veto,marginBottom:4}}>🚫 {cuerpoAgua.tipo}</div>
                {cuerpoAgua.nombre&&<div style={{fontSize:13,color:P.tinta,marginBottom:4}}>{cuerpoAgua.nombre}</div>}
                <div style={{fontSize:12.5,color:P.suave,lineHeight:1.45}}>El punto marcado está sobre un cuerpo de agua. No es terreno plantable.</div>
                <div style={{fontSize:11,color:"#A39C8E",marginTop:6}}>Fuente: OpenStreetMap (base cartográfica colaborativa mundial)</div>
              </div>
            )}

            {humedal&&humedal.esHumedal&&(
              <div style={{background:"#F7E4E1",border:"2px solid "+P.veto,borderRadius:10,padding:"12px 14px",marginBottom:14}}>
                <div style={{fontSize:14,fontWeight:800,color:P.veto,marginBottom:4}}>🚫 {humedal.tipo}</div>
                {humedal.nombre&&<div style={{fontSize:13,color:P.tinta,marginBottom:4}}>{humedal.nombre}{humedal.comuna?" — "+humedal.comuna:""}</div>}
                <div style={{fontSize:12.5,color:P.suave,lineHeight:1.45}}>{humedal.detalle}</div>
                <div style={{fontSize:11,color:"#A39C8E",marginTop:6}}>Fuente: Ministerio del Medio Ambiente (MMA)</div>
              </div>
            )}

            {protegida&&protegida.protegida&&(
              <div style={{background:"#F7E4E1",border:"2px solid "+P.veto,borderRadius:10,padding:"12px 14px",marginBottom:14}}>
                <div style={{fontSize:14,fontWeight:800,color:P.veto,marginBottom:4}}>🚫 Área protegida</div>
                <div style={{fontSize:13,color:P.tinta,marginBottom:4}}>{protegida.tipo}{protegida.nombre?" — "+protegida.nombre:""}</div>
                <div style={{fontSize:12.5,color:P.suave,lineHeight:1.45}}>El punto está dentro de un área bajo protección oficial (SNASPE, santuario, monumento, sitio RAMSAR u otra). Está prohibido plantar o construir.</div>
                <div style={{fontSize:11,color:"#A39C8E",marginTop:6}}>Fuente: Superintendencia del Medio Ambiente (SMA)</div>
              </div>
            )}

            {pendiente&&pendiente.ok&&pendiente.estado!=="apto"&&(
              <div style={{background:pendiente.estado==="veto"?"#F7E4E1":"#FBF3DC",border:"2px solid "+(pendiente.estado==="veto"?P.veto:P.riesgo),borderRadius:10,padding:"12px 14px",marginBottom:14}}>
                <div style={{fontSize:14,fontWeight:800,color:pendiente.estado==="veto"?P.veto:P.riesgo,marginBottom:4}}>{pendiente.estado==="veto"?"🚫 Pendiente extrema":"⚠ Pendiente pronunciada"}</div>
                <div style={{fontSize:13,color:P.tinta,lineHeight:1.45}}>Pendiente estimada ~{pendiente.pendiente}% (desnivel {pendiente.desnivel} m; altura {pendiente.elevMin}–{pendiente.elevMax} msnm).{pendiente.estado==="veto"?" Terreno de cerro: inviable para viña mecanizada.":" Requiere terrazas o manejo especial; mayor costo y erosión."}</div>
                <div style={{fontSize:11,color:"#A39C8E",marginTop:6}}>Fuente: Open-Meteo Elevation (Copernicus DEM 90 m)</div>
              </div>
            )}

            {extras&&extras.activas&&Object.keys(extras.activas).length>0&&Object.entries(extras.activas).map(([k,e])=>(
              <div key={k} style={{background:"#F7E4E1",border:"2px solid "+P.veto,borderRadius:10,padding:"12px 14px",marginBottom:14}}>
                <div style={{fontSize:14,fontWeight:800,color:P.veto,marginBottom:4}}>🚫 {e.tipo}</div>
                {e.nombre&&<div style={{fontSize:13,color:P.tinta,marginBottom:4}}>{e.nombre}</div>}
                <div style={{fontSize:12.5,color:P.suave,lineHeight:1.45}}>{e.detalle}</div>
              </div>
            ))}

            {!vetoAbsoluto&&(
            <div style={{background:"#EAF1F4",border:"1px solid "+P.agua,borderRadius:10,padding:"10px 14px",marginBottom:14,fontSize:12.5,color:P.vid}}>
              <strong>Qué plantar aquí:</strong> {rec.cepas}.<br/><span style={{color:P.suave}}>{rec.perfil} · {w.region} · {distCosta!=null?(distCosta<0?"cordillera":distCosta+" km de la costa"):""}</span>
            </div>
            )}

            {!vetoAbsoluto&&(<>
            <Tarjeta titulo="Clima · 25 temporadas" estado={clima.estado}>
              <div style={{background:"#F0EEE6",borderRadius:6,padding:"8px 10px",marginBottom:12,fontSize:12.5,color:P.vid,fontWeight:600}}>
                Winkler {w.region} — clima {w.desc}</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                <Dato valor={clima.gda} etiqueta="grados-día (suma de calor de la temporada, base 10 °C) · promedio real" />
                <Dato valor={clima.heladaTardia} unidad={"/ "+clima.temporadas} etiqueta="años con helada tras la brotación" />
                <Dato valor={clima.amplitud??"—"} unidad="°C" etiqueta="amplitud térmica día/noche (feb–mar)" />
                <Dato valor={clima.calor} unidad="días" etiqueta="días/año sobre 34 °C" />
                {clima.radiacionProm!=null&&<Dato valor={clima.radiacionProm} unidad="MJ/m²" etiqueta="radiación solar diaria (fotosíntesis, azúcar)" />}
                {clima.vientoMax!=null&&<Dato valor={clima.vientoMax} unidad="km/h" etiqueta="viento máximo típico" />}</div>
              <Dato valor={clima.lluviaCosecha} unidad="mm" etiqueta={"lluvia feb–abr — riesgo de botritis "+clima.botritis} />
              <div style={{fontSize:11,color:"#A39C8E",marginTop:2}}>Fuente: Open-Meteo ERA5 (reanálisis, celda ~9 km). Representa el clima de la zona; un microclima de ladera puede variar.</div>
              {clima.problemas.length>0&&<div style={{fontSize:12.5,color:P.suave,lineHeight:1.4,marginTop:4}}>⚠ {clima.problemas.join(" ")}</div>}
            </Tarjeta>

            <Tarjeta titulo="Agua · restricción DGA" estado={agua?agua.estado:"nd"} destacada
              nota={agua&&!agua.conectado?"Sin dato verificable de la DGA para este punto — revisa el listado oficial abajo":null}>
              {agua&&agua.conectado?(
                <div style={{fontSize:13,lineHeight:1.55}}>
                  <div style={{fontWeight:600,marginBottom:4,color:CFG[agua.estado].color}}>{agua.titular}</div>
                  <div style={{color:P.suave}}>{agua.detalle}</div>
                  {agua.extra&&<div style={{color:P.suave,marginTop:4}}>{agua.extra}</div>}
                  {aguaVar&&aguaVar.length>1&&(
                    <div style={{background:"#EAF1F4",border:"1px solid "+P.agua,borderRadius:6,padding:"7px 9px",marginTop:8}}>
                      <div style={{fontSize:11.5,fontWeight:700,color:P.agua,marginBottom:3}}>⚠ El terreno cruza {aguaVar.length} situaciones de agua distintas:</div>
                      {aguaVar.map((x,i)=>(<div key={i} style={{fontSize:11.5,color:P.tinta}}>• <strong style={{color:CFG[x.estado].color}}>{x.titular}</strong></div>))}
                      <div style={{fontSize:10.5,color:P.suave,marginTop:2}}>Se usa la más restrictiva para el veredicto.</div>
                    </div>
                  )}
                  <div style={{fontSize:11,color:"#A39C8E",marginTop:8}}>Fuente: DGA / MOP (consulta por coordenada exacta), actualización diaria. Verifica en el <a href="https://dga.mop.gob.cl/derechos-de-agua/proteccion-de-las-fuentes/areas-de-restriccion/" target="_blank" rel="noreferrer" style={{color:P.agua}}>listado oficial ↗</a></div>
                  {escasez&&escasez.escasez&&(
                    <div style={{marginTop:10,paddingTop:10,borderTop:"1px dashed "+P.linea,fontSize:12.5,color:P.riesgo,fontWeight:600}}>
                      ⚠ Zona bajo Decreto de Escasez Hídrica vigente (DGA).{escasez.detalle?" "+escasez.detalle:""}
                      <div style={{fontSize:11,color:P.suave,fontWeight:400,marginTop:2}}>Indica déficit hídrico declarado por autoridad; afecta disponibilidad de agua para riego.</div>
                    </div>
                  )}
                </div>
              ):(
                <div style={{fontSize:13,color:P.suave,lineHeight:1.5}}>
                  Revisa si el punto tiene restricción en el <a href="https://dga.mop.gob.cl/derechos-de-agua/proteccion-de-las-fuentes/areas-de-restriccion/" target="_blank" rel="noreferrer" style={{color:P.agua}}>listado oficial DGA ↗</a>.
                </div>
              )}
            </Tarjeta>

            {clima&&clima.balanceHidrico!=null&&(
              <Tarjeta titulo="Balance hídrico · necesidad de riego" estado={clima.balanceHidrico<-800?"riesgo":"apto"}>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                  <Dato valor={clima.lluviaAnual} unidad="mm" etiqueta="lluvia anual" />
                  <Dato valor={clima.et0Anual} unidad="mm" etiqueta="evapotranspiración anual (demanda)" />
                </div>
                <div style={{fontSize:13,color:P.tinta,lineHeight:1.5}}>
                  <strong>Déficit hídrico:</strong> {clima.balanceHidrico<0?Math.abs(clima.balanceHidrico):0} mm/año.
                  {clima.balanceHidrico<0?" La viña necesitará riego para cubrir esa diferencia entre lo que llueve y lo que la planta evapora.":" El agua de lluvia cubre la demanda; riego mínimo."}
                </div>
                <div style={{fontSize:11,color:"#A39C8E",marginTop:6}}>Fuente: Open-Meteo — evapotranspiración FAO-56 Penman-Monteith (estándar mundial de riego). Cálculo sobre 25 años.</div>
              </Tarjeta>
            )}

            <Tarjeta titulo="Suelo · estudio agrológico CIREN" estado={suelo?suelo.estado:"nd"}
              nota={suelo&&!suelo.conectado?"El servidor de CIREN no respondió o no cubre el punto (suele bloquear apps externas) — usa el visor oficial abajo":null}>
              {suelo&&suelo.conectado?(
                <>
                  {suelo.region&&!suelo.aprox&&<div style={{fontSize:11,color:P.apto,background:"#E4F1E7",borderRadius:5,padding:"3px 7px",display:"inline-block",marginBottom:8}}>✓ dato exacto del punto · {suelo.region}</div>}
                  {suelo.region&&suelo.aprox&&<div style={{fontSize:11,color:"#B08900",background:"#FBF3DC",borderRadius:5,padding:"3px 7px",display:"inline-block",marginBottom:8}}>≈ suelo más cercano (~{suelo.aprox<1000?suelo.aprox+" m":(suelo.aprox/1000)+" km"}) · {suelo.region} — el punto exacto no tiene estudio; referencial</div>}
                  {suelo.capacidad&&(
                    <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:10}}>
                      <div style={{fontSize:26,fontWeight:800,color:CFG[suelo.estado].color,lineHeight:1,minWidth:70,textAlign:"center",border:"2px solid "+CFG[suelo.estado].color,borderRadius:8,padding:"8px 4px"}}>{suelo.capacidad}<div style={{fontSize:9,fontWeight:600,color:P.suave}}>de VIII</div></div>
                      <div style={{fontSize:12.5,color:P.tinta,lineHeight:1.4}}>
                        <strong>Clase de suelo {suelo.capacidad}</strong> (en la escala oficial de I a VIII, donde I es el mejor suelo agrícola y VIII el peor).
                        <div style={{fontWeight:700,color:CFG[suelo.estado].color,marginTop:2}}>{suelo.estado==="apto"?"→ Apto para viña":suelo.estado==="riesgo"?"→ Plantable con manejo":"→ No apto"}</div>
                      </div>
                    </div>
                  )}
                  {suelo.explica&&<div style={{fontSize:13,color:P.tinta,lineHeight:1.45,background:"#F0EEE6",borderRadius:6,padding:"8px 10px",marginBottom:8}}>{suelo.explica}</div>}
                  <details style={{marginBottom:8}}>
                    <summary style={{fontSize:11.5,color:P.agua,cursor:"pointer"}}>¿Qué significan las clases I a VIII?</summary>
                    <div style={{fontSize:11.5,color:P.suave,lineHeight:1.5,marginTop:6}}>
                      <div><strong>I–II:</strong> suelos sin o con leves limitaciones. Óptimos.</div>
                      <div><strong>III–IV:</strong> cultivables con limitaciones moderadas a severas. La vid es viable.</div>
                      <div><strong>V–VI:</strong> no arables (pedregosidad, laderas); praderas o forestal. Vid solo en microsectores.</div>
                      <div><strong>VII–VIII:</strong> sin aptitud agrícola (forestal, roca, alta montaña). No plantable.</div>
                      <div style={{marginTop:4,fontStyle:"italic"}}>Es la clasificación oficial de capacidad de uso del suelo (USDA, usada por CIREN en Chile).</div>
                    </div>
                  </details>
                  {suelosMulti.length>1&&(
                    <div style={{background:"#EAF1F4",border:"1px solid "+P.agua,borderRadius:8,padding:"9px 11px",marginBottom:8}}>
                      <div style={{fontSize:12,fontWeight:700,color:P.agua,marginBottom:5}}>⚠ El terreno tiene {suelosMulti.length} tipos de suelo distintos:</div>
                      {suelosMulti.map((s,i)=>(
                        <div key={i} style={{fontSize:12.5,color:P.tinta,lineHeight:1.4,marginBottom:3}}>
                          <strong style={{color:CFG[s.estado].color}}>Clase {s.capacidad||"s/i"}</strong> — {CFG[s.estado].label}
                        </div>
                      ))}
                      <div style={{fontSize:11,color:P.suave,marginTop:4}}>El veredicto usa la clase más limitante (criterio conservador).</div>
                    </div>
                  )}
                  <Fila etiqueta="Serie de suelo" valor={suelo.serie} />
                  <Fila etiqueta="Textura superficial" valor={suelo.textura} />
                  <Fila etiqueta="Drenaje" valor={suelo.drenaje} />
                  <Fila etiqueta="Aptitud frutal" valor={suelo.aptFrutal} />
                  <Fila etiqueta="Aptitud agrícola" valor={suelo.aptAgricola} />
                  <Fila etiqueta="Categoría de riego" valor={suelo.riego} />
                  <Fila etiqueta="Profundidad" valor={suelo.prof} />
                  <div style={{fontSize:11.5,color:P.suave,lineHeight:1.4,marginTop:8,fontStyle:"italic"}}>La capacidad de uso resume la aptitud del suelo. Para pH, textura y fertilidad exactos se requiere una calicata con análisis de laboratorio (ningún dato satelital lo reemplaza con fiabilidad).</div>
                  <div style={{fontSize:11,color:"#A39C8E",marginTop:6}}>Fuente: CIREN, estudio agrológico (escala 1:20.000). Verifica en el <a href="https://www.ciren.cl/productos/suelos-agrologicos/" target="_blank" rel="noreferrer" style={{color:P.agua}}>visor oficial ↗</a></div>
                </>
              ):(
                <div style={{fontSize:13,color:P.suave,lineHeight:1.5}}>
                  Sin dato agrológico verificable para este punto exacto. Los estudios CIREN cubren de la costa a la precordillera (no todo el territorio); en cerros, cordillera o zonas sin estudio no hay dato. Revisa el <a href="https://www.ciren.cl/productos/suelos-agrologicos/" target="_blank" rel="noreferrer" style={{color:P.agua}}>visor oficial CIREN ↗</a>.
                </div>
              )}
            </Tarjeta>

            <button onClick={()=>setBib(!bib)} style={{width:"100%",textAlign:"left",background:"#EAF1F4",
              border:"1px solid "+P.agua,borderRadius:10,padding:"12px 14px",marginBottom:8,marginTop:2,cursor:"pointer"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{fontSize:13,fontWeight:700,color:P.agua}}>Fuentes y cómo leerlas</span>
                <span style={{color:P.agua}}>{bib?"▲":"▼"}</span></div>
            </button>
            {bib&&centro&&(
              <div style={{background:P.panel,border:"1px solid "+P.linea,borderRadius:10,padding:"12px 14px",marginBottom:14}}>
                {Object.entries(EXPLICA).map(([k,f],i)=>(
                  <div key={k} style={{padding:"8px 0",borderBottom:i<3?"1px solid "+P.linea:"none"}}>
                    <a href={f.u(centro[0],centro[1])} target="_blank" rel="noreferrer" style={{fontSize:13,fontWeight:700,color:P.agua,textDecoration:"none"}}>{f.titulo} ↗</a>
                    <div style={{fontSize:12,color:P.suave,lineHeight:1.45,marginTop:3}}>{f.que}</div>
                  </div>
                ))}
              </div>
            )}

            {pendiente&&pendiente.ok&&(
              <Tarjeta titulo="Relieve y pendiente" estado={pendiente.estado}>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                  <Dato valor={pendiente.pendiente} unidad="%" etiqueta="pendiente estimada del terreno" />
                  <Dato valor={pendiente.desnivel} unidad="m" etiqueta="desnivel entre puntos" />
                </div>
                <div style={{fontSize:13,color:P.tinta,marginBottom:4}}>Altitud: {pendiente.elevMin}–{pendiente.elevMax} msnm</div>
                <div style={{fontSize:12.5,color:P.suave,lineHeight:1.4}}>{pendiente.estado==="apto"?"Terreno apto para mecanización.":pendiente.estado==="riesgo"?"Pendiente que requiere terrazas o manejo especial (mayor costo, erosión).":"Pendiente extrema: inviable para viña mecanizada."}</div>
                <div style={{fontSize:11,color:"#A39C8E",marginTop:6}}>Fuente: Copernicus DEM (Agencia Espacial Europea) vía Open-Meteo</div>
              </Tarjeta>
            )}

            
            </>)}

            {vetoAbsoluto&&(
              <div style={{background:"#F0EEE6",borderRadius:8,padding:"12px 14px",fontSize:12.5,color:P.suave,lineHeight:1.5,marginBottom:12}}>
                Este punto <strong>no es plantable</strong> (ver motivo arriba), por lo que no se muestran clima ni suelo: no aplican a un sitio donde no se puede establecer un viñedo.
              </div>
            )}

            <div style={{background:CFG[veredicto].color,borderRadius:8,padding:"12px 14px",fontSize:12.5,color:"#fff",lineHeight:1.5,marginBottom:10}}>
              <div style={{fontWeight:800,fontSize:14,marginBottom:6}}>Resumen del veredicto: {CFG[veredicto].label}</div>
              {(()=>{
                const partes=[];
                if(clima){const wk=regionWinkler(clima.gda);partes.push("Clima "+wk.region+" ("+clima.gda+" grados-día"+(clima.heladaTardia>0?", helada en "+clima.heladaTardia+"/"+clima.temporadas+" años":"")+")");}
                if(agua&&agua.conectado)partes.push("agua: "+(agua.estado==="apto"?"sin restricción":agua.estado==="riesgo"?"con restricción/prohibición (comprar derechos)":"limitada"));
                if(suelo&&suelo.conectado&&suelo.capacidad)partes.push("suelo clase "+suelo.capacidad+" ("+(suelo.estado==="apto"?"apto":suelo.estado==="riesgo"?"con manejo":"no apto")+")");
                if(pendiente&&pendiente.ok&&!pendiente.enAgua)partes.push("pendiente "+pendiente.pendiente+"%");
                let cierre="";
                if(veredicto==="apto")cierre=" Todos los factores evaluados son favorables para viña.";
                else if(veredicto==="riesgo")cierre=" Plantable, pero atiende los factores en ámbar antes de invertir.";
                else cierre=" Uno o más factores hacen el sitio no apto (ver detalle arriba).";
                return <span>Este sitio combina: {partes.join(" · ")}.{cierre}</span>;
              })()}
            </div>
            <div style={{background:"#F0EEE6",borderRadius:8,padding:"10px 12px",fontSize:11,color:P.suave,lineHeight:1.5}}>
              El veredicto toma el factor más restrictivo de todos. Un clima frío no es defecto (define la cepa). Cuerpos de agua, humedales, áreas protegidas y pendientes extremas hacen el sitio no plantable. Nada reemplaza una calicata antes de plantar.
            </div>

            <details style={{marginTop:12,background:P.panel,border:"1px solid "+P.linea,borderRadius:8,padding:"10px 12px"}}>
              <summary style={{fontSize:12.5,fontWeight:700,color:P.vid,cursor:"pointer"}}>Fuentes de datos: cuáles son, de dónde y por qué son autoridad</summary>
              <div style={{fontSize:11.5,color:P.suave,lineHeight:1.5,marginTop:10}}>
                <div style={{marginBottom:10}}>
                  <div style={{fontWeight:700,color:P.tinta}}>Clima (25 años) — Open-Meteo / ERA5</div>
                  <div>ERA5 es el reanálisis climático del <strong>ECMWF</strong> (Centro Europeo de Predicción Meteorológica), el estándar científico mundial para clima histórico. Open-Meteo lo entrega por API abierta.</div>
                  <a href="https://open-meteo.com/en/docs/historical-weather-api" target="_blank" rel="noreferrer" style={{color:P.agua}}>open-meteo.com/en/docs/historical-weather-api ↗</a>
                </div>
                <div style={{marginBottom:10}}>
                  <div style={{fontWeight:700,color:P.tinta}}>Agua — Dirección General de Aguas (DGA), MOP</div>
                  <div>Organismo del Estado de Chile <strong>legalmente encargado</strong> de administrar el agua y declarar áreas de restricción y zonas de prohibición de acuíferos (Código de Aguas). Es la autoridad oficial en la materia.</div>
                  <a href="https://dga.mop.gob.cl/derechos-de-agua/proteccion-de-las-fuentes/areas-de-restriccion/" target="_blank" rel="noreferrer" style={{color:P.agua}}>dga.mop.gob.cl — Áreas de restricción ↗</a>
                </div>
                <div style={{marginBottom:10}}>
                  <div style={{fontWeight:700,color:P.tinta}}>Suelo — CIREN, Estudios Agrológicos</div>
                  <div><strong>Centro de Información de Recursos Naturales</strong>, entidad técnica del Ministerio de Agricultura. Su cartografía de suelos (escala 1:20.000) es la referencia agronómica oficial en Chile.</div>
                  <a href="https://www.ciren.cl/productos/suelos-agrologicos/" target="_blank" rel="noreferrer" style={{color:P.agua}}>ciren.cl — Suelos agrológicos ↗</a>
                </div>
                <div style={{marginBottom:10}}>
                  <div style={{fontWeight:700,color:P.tinta}}>Relieve/pendiente — Copernicus DEM</div>
                  <div>Modelo de elevación de la <strong>Agencia Espacial Europea</strong> (programa Copernicus), 90 m. Consultado vía Open-Meteo Elevation.</div>
                  <a href="https://open-meteo.com/en/docs/elevation-api" target="_blank" rel="noreferrer" style={{color:P.agua}}>open-meteo.com — Elevation API ↗</a>
                </div>
                <div style={{marginBottom:10}}>
                  <div style={{fontWeight:700,color:P.tinta}}>Humedales — Ministerio del Medio Ambiente (MMA)</div>
                  <div>Inventario Nacional de Humedales y Humedales Urbanos Declarados (Ley 21.202). El MMA es la autoridad ambiental del Estado.</div>
                  <a href="https://humedales.mma.gob.cl/" target="_blank" rel="noreferrer" style={{color:P.agua}}>humedales.mma.gob.cl ↗</a>
                </div>
                <div style={{marginBottom:10}}>
                  <div style={{fontWeight:700,color:P.tinta}}>Áreas protegidas — Superintendencia del Medio Ambiente (SMA)</div>
                  <div>Registro oficial de áreas bajo protección (SNASPE, santuarios, sitios RAMSAR, etc.), fiscalizadas por la SMA.</div>
                  <a href="https://snifa.sma.gob.cl/" target="_blank" rel="noreferrer" style={{color:P.agua}}>sma.gob.cl ↗</a>
                </div>
                <div style={{marginBottom:10}}>
                  <div style={{fontWeight:700,color:P.tinta}}>Cuerpos de agua — OpenStreetMap</div>
                  <div>Base cartográfica colaborativa mundial, la más completa y actualizada para mar, lagos y ríos. Usada por gobiernos y empresas.</div>
                  <a href="https://www.openstreetmap.org/" target="_blank" rel="noreferrer" style={{color:P.agua}}>openstreetmap.org ↗</a>
                </div>
                
                <p style={{margin:"10px 0 0",fontStyle:"italic",fontSize:11}}>Todas son fuentes oficiales del Estado de Chile o estándares científicos internacionales, accesibles públicamente. Cada capa solo influye en el veredicto cuando su servicio confirma el dato en el punto; si un servicio no responde, no se inventa nada.</p>
              </div>
            </details>
          </>)}
        </>
      ):(
        <div>
          <h2 style={{margin:"0 0 4px",fontSize:18,color:P.vid}}>Escapada</h2>
          <p style={{fontSize:13,color:P.suave,marginTop:0}}>Mapa de viento y clima en vivo del sector (Windy).</p>
          {centro?(
            <iframe title="Windy" style={{width:"100%",height:esMovil?260:340,border:0,borderRadius:10}}
              src={"https://embed.windy.com/embed2.html?lat="+centro[0].toFixed(3)+"&lon="+centro[1].toFixed(3)+"&zoom=9&level=surface&overlay=wind&menu=&type=map&location=coordinates&metricWind=default&metricTemp=default&radarRange=-1"} />
          ):<div style={{fontSize:13,color:P.suave}}>Analiza un sitio primero para centrar Windy.</div>}
          <div style={{fontSize:11,color:"#A39C8E",marginTop:8}}>Fuente: Windy.com</div>
        </div>
      )}
    </div>
  );

  return(
    <div style={{fontFamily:"'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      background:P.fondo,height:"100vh",color:P.tinta,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <header style={{background:"#FFFFFF",color:P.tinta,padding:"10px 18px",display:"flex",
        justifyContent:"space-between",alignItems:"center",zIndex:1200,flexShrink:0,borderBottom:"1px solid "+P.linea}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <img src="/logo.png" alt="WineCheck" style={{height:64,width:"auto"}} />
          <div style={{fontSize:11,color:P.suave,borderLeft:"1px solid "+P.linea,paddingLeft:10}}>Aptitud vitícola<br/>por sector · Chile</div>
        </div>
        {fase==="resultado"&&<button onClick={reiniciar} style={{background:P.vid,color:"#F2EFE6",
          border:"none",borderRadius:6,padding:"7px 14px",fontSize:13,cursor:"pointer"}}>Nuevo sitio</button>}
      </header>

      <div style={{display:"flex",flex:1,minHeight:0,flexDirection:esMovil?"column":"row"}}>
        <div style={{position:"relative",flexShrink:0,
          flex:esMovil?(fase==="resultado"?"0 0 42vh":"0 0 62vh"):"1 1 auto",minHeight:esMovil?260:"auto"}}>
          <MapContainer center={[-34.5,-71.2]} zoom={7} zoomControl={!esMovil} style={{height:"100%",width:"100%"}}>
            {capaBase==="calle"&&<TileLayer key="calle" attribution='&copy; OpenStreetMap' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />}
            {capaBase==="satelite"&&<TileLayer key="satelite" attribution='&copy; Esri' url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" />}
            {capaBase==="topo"&&<TileLayer key="topo" attribution='&copy; Esri' url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}" />}
            <ClicHandler onClic={agregarPunto} activo={fase==="mapa"} />
            <VolarA destino={destinoBusqueda} />
            {puntos.length>=2&&<Polygon positions={puntos} pathOptions={{color:color,fillColor:color,fillOpacity:0.3,weight:2}} />}
            {puntos.map((p,i)=>(<CircleMarker key={i} center={p} radius={6} pathOptions={{color:"#fff",weight:2,fillColor:P.vid,fillOpacity:1}} />))}
          </MapContainer>

          {/* BUSCADOR tipo Google Maps */}
          <div style={{position:"absolute",top:10,left:0,right:0,zIndex:1000,display:"flex",justifyContent:"center",pointerEvents:"none"}}>
            <div style={{display:"flex",gap:0,pointerEvents:"auto",width:esMovil?"90%":360,boxShadow:"0 2px 8px rgba(0,0,0,.25)",borderRadius:8,overflow:"hidden"}}>
              <input value={busqueda} onChange={e=>setBusqueda(e.target.value)}
                onKeyDown={e=>{if(e.key==="Enter")buscarLugar();}}
                placeholder="Buscar lugar, comuna, dirección…"
                style={{flex:1,border:"none",padding:"10px 12px",fontSize:13,outline:"none"}} />
              <button onClick={buscarLugar} style={{background:P.vid,color:"#fff",border:"none",padding:"0 16px",fontSize:14,cursor:"pointer"}}>{buscando?"…":"🔍"}</button>
            </div>
          </div>

          {/* Selector de capa: calle / satélite / curvas de nivel */}
          <div style={{position:"absolute",top:esMovil?58:"auto",bottom:esMovil?"auto":24,right:12,zIndex:1000,display:"flex",flexDirection:esMovil?"row":"column",gap:4,background:"rgba(255,255,255,.95)",borderRadius:8,padding:4,boxShadow:"0 2px 8px rgba(0,0,0,.2)"}}>
            {[["calle","Calle"],["satelite","Satélite"],["topo","Relieve"]].map(([k,t])=>(
              <button key={k} onClick={()=>setCapaBase(k)} style={{border:"none",borderRadius:5,padding:"6px 10px",fontSize:11.5,fontWeight:capaBase===k?700:500,cursor:"pointer",background:capaBase===k?P.vid:"transparent",color:capaBase===k?"#fff":P.tinta}}>{t}</button>
            ))}
          </div>

          {fase==="mapa"&&(
            <div style={{position:"absolute",left:0,right:0,bottom:0,zIndex:1000,
              background:"linear-gradient(to top, rgba(28,35,29,.94), rgba(28,35,29,0))",
              padding:"30px 16px 14px",display:"flex",flexDirection:"column",alignItems:"center",gap:10}}>
              <div style={{color:"#fff",fontSize:13.5,fontWeight:600,textAlign:"center",textShadow:"0 1px 3px rgba(0,0,0,.6)"}}>
                {puntos.length===0?"Toca en el mapa para marcar las esquinas de tu terreno"
                  :puntos.length<3?"Marca al menos 3 puntos ("+puntos.length+")":"Terreno listo ("+puntos.length+" puntos) — puedes agregar más o analizar"}
              </div>
              <div style={{display:"flex",gap:10}}>
                {puntos.length>0&&(<button onClick={()=>setPuntos([])} style={{background:"rgba(255,255,255,.95)",color:P.tinta,
                  border:"none",borderRadius:8,padding:"12px 20px",fontSize:14,fontWeight:700,cursor:"pointer"}}>Borrar</button>)}
                {puntos.length>=3&&(<button onClick={evaluar} style={{background:P.apto,color:"#fff",border:"none",borderRadius:8,
                  padding:"12px 28px",fontSize:15,fontWeight:800,cursor:"pointer",boxShadow:"0 3px 12px rgba(0,0,0,.4)"}}>Analizar sitio</button>)}
              </div>
            </div>
          )}

          {fase==="cargando"&&(
            <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",
              background:"rgba(28,35,29,.6)",color:"#fff",flexDirection:"column",gap:8,textAlign:"center",padding:20,zIndex:1100}}>
              <div style={{fontSize:15,fontWeight:600}}>Analizando clima, agua y suelo del punto…</div>
              <div style={{fontSize:12,opacity:0.85}}>Open-Meteo · DGA · CIREN (suelo puede tardar unos segundos)</div>
            </div>
          )}
        </div>

        {fase==="resultado"&&(
          esMovil?(
            <div style={{flex:1,minHeight:0,background:P.fondo,borderTop:"3px solid "+color,overflowY:"auto",
              borderRadius:"16px 16px 0 0",marginTop:-14,position:"relative",zIndex:500}}>
              <div style={{width:40,height:4,background:P.linea,borderRadius:2,margin:"8px auto 0"}} />
              <Panel/>
            </div>
          ):(
            <aside style={{flex:"0 0 440px",background:P.fondo,borderLeft:"1px solid "+P.linea,overflowY:"auto"}}>
              <Panel/>
            </aside>
          )
        )}
      </div>
    </div>
  );
}
