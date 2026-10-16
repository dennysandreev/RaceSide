import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEPANG_BOUNDS, parseOsmXml } from './sepang-geometry.mjs';

const scripts=path.dirname(fileURLToPath(import.meta.url));
const BBOX=[101.727,2.744,101.750,2.769];
const REFERENCES=[
  ['openstreetmap-map.osm',`https://api.openstreetmap.org/api/0.6/map?bbox=${BBOX.join(',')}`,'ODbL 1.0','© OpenStreetMap contributors','current raceway, pit lanes, footprints, barriers and individually mapped trees','EPSG:4326','vector snapshot'],
  ['fia-2017-circuit-map.pdf','https://www.fia.com/sites/default/files/formula_one_malaysian_grand_prix_2017_document_-_doc_1.pdf','FIA document; reference only','FIA / Formula One','2017 control map; 2026 sporting positions remain unconfirmed','document reference','vector PDF, page 2'],
  ['official-architecture.html','https://www.sepangcircuit.com/architecture','official venue reference; not redistributed','PETRONAS Sepang International Circuit','dimensions of track, 33 garages and permanent paddock infrastructure','document reference','venue specification'],
  ['official-main-grandstand.html','https://www.sepangcircuit.com/main-grandstand','official venue reference; not redistributed','PETRONAS Sepang International Circuit','current double-frontage main stand and seating','document reference','venue reference'],
  ['main-grandstand-photo.jpg','https://www.sepangcircuit.com/media/mageplus/tickets/main-grandstand.jpg','official venue reference; not redistributed','PETRONAS Sepang International Circuit','canopy form, columns and seat colours; observational reference only','document reference','photograph'],
  ['main-grandstand-map.jpg','https://www.sepangcircuit.com/media/mageplus/tickets/SIC-Map_MGS.jpg','official venue reference; not redistributed','PETRONAS Sepang International Circuit','main stand footprint and circular umbrella roof','document reference','venue map'],
  ['official-event-guide.pdf','https://www.sepangcircuit.com/media/wysiwyg/pdf/MGP25_Spectator_Guide_v2.pdf','official venue reference; not redistributed','PETRONAS Sepang International Circuit','2025 venue spectator layout; not a 2026 F1 temporary-object source','document reference','PDF'],
];
const RASTERS=[
  ['sentinel-tci.tif','https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/47/N/RD/2026/8/S2C_47NRD_20260815_0_L2A/TCI.tif','Copernicus Sentinel Data Terms','Contains modified Copernicus Sentinel data 2026','real surface colours; acquisition 2026-08-15','EPSG:32647','10 m native TCI; clipped COG'],
  ['copernicus-dem.tif','https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N02_00_E101_00_DEM/Copernicus_DSM_COG_10_N02_00_E101_00_DEM.tif','Copernicus DEM GLO-30 public licence','© DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018 provided under COPERNICUS by the European Union and ESA; all rights reserved','terrain height proxy; DSM, not surveyed bare-earth DTM','EPSG:4326 + EGM2008','30 m native DSM; clipped COG'],
];
const hash=body=>createHash('sha256').update(body).digest('hex');
export async function loadSepangBuildingColours() {
  const body=await readFile(path.resolve(scripts,'../../docs/track-model-sepang-building-colours.json'));
  return {...JSON.parse(body),auditSha256:hash(body)};
}

async function downloadBuildingColourSources(sourceDirectory) {
  const audit=await loadSepangBuildingColours();
  const sources=[];
  for(const reference of audit.references) {
    const target=path.join(sourceDirectory,reference.file);
    let body;
    try{body=await readFile(target);}catch(e){if(e.code!=='ENOENT')throw e;}
    if(!body) {
      const response=await fetch(reference.url,{signal:AbortSignal.timeout(45000)});
      if(!response.ok)throw Error(`Sepang colour reference ${response.status}: ${reference.url}`);
      body=Buffer.from(await response.arrayBuffer());
    }
    if(body.length!==reference.bytes||hash(body)!==reference.sha256)throw Error(`Sepang colour reference changed: ${reference.file}; review the photograph and its audit before updating`);
    await writeFile(target,body);
    sources.push({...reference,crs:'document reference',resolution:'official photograph; observed material colours, not measured reflectance',bbox:BBOX,bboxCrs:'EPSG:4326',verticalDatum:null});
  }
  return sources;
}
export async function verifySepangSources(sourceDirectory,manifest) {
  for(const source of manifest.sources) {
    const body=await readFile(path.join(sourceDirectory,source.file));
    if(body.length!==source.bytes||hash(body)!==source.sha256)throw Error(`Sepang source cache changed: ${source.file}; use --force-sources only for an intentional refresh`);
  }
}
export async function downloadSepangData({force=false,sourceDirectory}) {
  await mkdir(sourceDirectory,{recursive:true});
  const manifestPath=path.join(sourceDirectory,'source-manifest.json');
  let cached;
  try{cached=JSON.parse(await readFile(manifestPath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  if(cached&&!force){
    await verifySepangSources(sourceDirectory,cached);
    const colours=await downloadBuildingColourSources(sourceDirectory);
    const files=new Set(cached.sources.map(source=>source.file));
    const manifest={...cached,sources:[...cached.sources,...colours.filter(source=>!files.has(source.file))]};
    await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');
    return manifest;
  }
  let publishedManifest;
  if(!force) {
    try{publishedManifest=JSON.parse(await readFile(path.resolve(scripts,'../../public/f1/tracks/3d/sepang-metadata.json'),'utf8')).sourceManifest;}
    catch(e){if(e.code!=='ENOENT')throw e;}
  }
  for(const [file,url] of REFERENCES) {
    const target=path.join(sourceDirectory,file);
    try{if(!force&&(await readFile(target)).length>1000)continue;}catch(e){if(e.code!=='ENOENT')throw e;}
    const response=await fetch(url,{signal:AbortSignal.timeout(60000)});
    if(!response.ok)throw Error(`Sepang source ${response.status}: ${url}`);
    const body=Buffer.from(await response.arrayBuffer());
    if(file.endsWith('.pdf')&&body.subarray(0,5).toString()!=='%PDF-')throw Error(`Not a PDF: ${url}`);
    await writeFile(target,body);
  }
  const osm=parseOsmXml(await readFile(path.join(sourceDirectory,'openstreetmap-map.osm'),'utf8'));
  await writeFile(path.join(sourceDirectory,'openstreetmap.json'),JSON.stringify(osm)+'\n');
  // Raster sources are fixed, dated URLs. Download only absent crops.
  const result=spawnSync(process.env.PYTHON_BIN??'python3',[path.join(scripts,'prepare-sepang-rasters.py'),'--source',sourceDirectory,'--download'],{stdio:'inherit'});
  if(result.error)throw result.error;
  if(result.status!==0)throw Error('Sepang Copernicus crop download failed');
  // A fresh checkout must not silently replace the checked-in source snapshot
  // with today's mutable OSM/venue content. An intentional refresh is explicit.
  if(publishedManifest) {
    const colours=await downloadBuildingColourSources(sourceDirectory);
    await verifySepangSources(sourceDirectory,publishedManifest);
    const files=new Set(publishedManifest.sources.map(source=>source.file));
    const manifest={...publishedManifest,sources:[...publishedManifest.sources,...colours.filter(source=>!files.has(source.file))]};
    await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');
    return manifest;
  }
  const sources=[];
  for(const [file,url,license,attribution,role,crs,resolution] of [...REFERENCES,...RASTERS]) {
    const body=await readFile(path.join(sourceDirectory,file));
    sources.push({file,url,license,attribution,role,crs,resolution,bytes:body.length,sha256:hash(body),bbox:file.endsWith('.tif')?SEPANG_BOUNDS:BBOX,bboxCrs:file.endsWith('.tif')?'EPSG:32647':'EPSG:4326',verticalDatum:file==='copernicus-dem.tif'?'EGM2008 orthometric metres':null,retrievedAt:new Date().toISOString()});
  }
  const derived=await readFile(path.join(sourceDirectory,'openstreetmap.json'));
  sources.push({file:'openstreetmap.json',url:REFERENCES[0][1],license:'ODbL 1.0',attribution:'© OpenStreetMap contributors',role:'lossless parsed vector snapshot with original IDs',crs:'EPSG:4326',resolution:'vector',bytes:derived.length,sha256:hash(derived),bbox:BBOX,verticalDatum:null,retrievedAt:new Date().toISOString()});
  const colourSources=await downloadBuildingColourSources(sourceDirectory);
  sources.push(...colourSources.filter(source=>!sources.some(existing=>existing.file===source.file)));
  const manifest={schemaVersion:1,generatedAt:new Date().toISOString(),bounds:SEPANG_BOUNDS,coordinateReferenceSystem:'EPSG:32647',verticalDatum:'EGM2008 orthometric metres',sources};
  await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');
  return manifest;
}
