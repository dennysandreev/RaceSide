import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadSepangData, loadSepangBuildingColours } from './download-sepang-data.mjs';
import { SEPANG_BOUNDS,MAIN_WAYS,PIT_WAYS,assembleWays,utm47nFromWgs84,cumulativeDistances,nearestDistance,rotateClosedLine,distance } from './sepang-geometry.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
// OSM apex vertices checked against FIA Document 1 (2017), page 2. Distances
// are measured after the actual mapped control line, never screen positions.
const TURN_VERTICES=[[1561055755,7],[1561055755,23],[1561055769,11],[1561055757,4],[144359489,9],[144359489,23],[1561055760,3],[1561055760,7],[1561055762,4],[1561055763,5],[1561055764,3],[1561055771,3],[1561055765,7],[1561055766,3],[1561055768,5]];
export async function exportSepangTrackData({forceSources=false,outputPath,sourceDirectory=path.join(root,'.track-model-build/sepang-source')}) {
  const manifest=await downloadSepangData({force:forceSources,sourceDirectory});
  const buildingAppearance=await loadSepangBuildingColours();
  const osm=JSON.parse(await readFile(path.join(sourceDirectory,'openstreetmap.json'),'utf8'));
  const source=assembleWays(osm,MAIN_WAYS,{closed:true});
  const finish=osm.elements.find(f=>f.tags.raceway==='start-finish');
  if(!finish)throw Error('Sepang start/finish source is missing');
  const offset=nearestDistance(source,utm47nFromWgs84(finish.lat,finish.lon));
  if(offset.separation>2)throw Error('Sepang control line is not on the raceway');
  const centerline=rotateClosedLine(source,offset.distance), total=cumulativeDistances(centerline).at(-1);
  if(Math.abs(total-5543)/5543>.005)throw Error(`Sepang length ${total} fails FIA tolerance`);
  const turns=TURN_VERTICES.map(([id,index],i)=>{
    const p=osm.elements.find(f=>f.id===id&&f.type==='way').geometry[index];
    return {number:i+1,name:`Turn ${i+1}`,distanceMeters:nearestDistance(centerline,utm47nFromWgs84(p.lat,p.lon)).distance,sourceWayId:id,sourceVertex:index,anchorSide:[-1,1,-1,-1,1,-1,-1,-1,1,-1,-1,1,-1,-1,1][i],anchorOffsetMeters:24};
  });
  const bounds=SEPANG_BOUNDS;
  const vectors=osm.elements.map(f=>({...f,world:f.type==='node'?utm47nFromWgs84(f.lat,f.lon):f.geometry.map(p=>utm47nFromWgs84(p.lat,p.lon))}));
  const pitCenterline=assembleWays(osm,PIT_WAYS);
  const footprint=vectors.find(f=>f.id===144362327).world;
  const edges=footprint.slice(1).map((b,i)=>[footprint[i],b]).filter(([a,b])=>distance(a,b)>150);
  edges.sort((a,b)=>a.reduce((sum,p)=>sum+nearestDistance(centerline,p).separation,0)-b.reduce((sum,p)=>sum+nearestDistance(centerline,p).separation,0));
  const [a,b]=edges[0],frontageLength=distance(a,b);
  const pitGarageMarkDistancesMeters=Array.from({length:34},(_,i)=>{
    const t=.5+(i-16.5)*8/frontageLength;
    return nearestDistance(pitCenterline,a.map((v,axis)=>v+(b[axis]-v)*t)).distance;
  }).sort((a,b)=>a-b);
  const payload={vectors,schemaVersion:4,generatorVersion:'1.0.0',sourceDirectory,sourceManifest:manifest,buildingAppearance,
    model:{id:'sepang',bounds,center:{x:(bounds.minX+bounds.maxX)/2,y:(bounds.minY+bounds.maxY)/2},lapLengthMeters:5543,mainCircuitWayIds:MAIN_WAYS,pitLaneWayIds:PIT_WAYS,centerline,pitCenterline,pitGarageMarkDistancesMeters,sourceStartFinishOffsetMeters:offset.distance,startFinishDistanceMeters:0,trackWidthMeters:16,pitLaneWidthMeters:8,pitBoxes:33,turns},
    officialControlPoints:{referenceYear:2017,currentEventVerified:false,sectorBoundaries:[{sector:2,absoluteDistanceMeters:turns[3].distanceMeters-151},{sector:3,absoluteDistanceMeters:turns[8].distanceMeters+80}],speedTrap:{turn:15,beforeTurnMeters:207},drs:[]},
    officialSources:manifest.sources.filter(s=>s.file==='fia-2017-circuit-map.pdf'||s.file.startsWith('official-')).map(({url,role})=>({url,role})),
    limitations:['Control markers use FIA 2017 Document 1; a 2026 operational map has not been verified. No 2017 DRS zones are asserted for 2026.','Ground is a 30 m Copernicus surface DEM, not surveyed bare-earth terrain; banking cannot be reconstructed from it.','Ground materials use mapped OSM boundaries, subdued Sentinel-2 colour at 10 m and decorative grain; the 4K texture is not surveyed high-resolution imagery. Parking materials without surface tags are estimated. Building roof shapes and heights without OSM measurements are explicitly estimated.','No unverified 2026 temporary grandstands or motorhomes are invented. Permanent paddock buildings use current mapped footprints.'],
  };
  await mkdir(path.dirname(outputPath),{recursive:true});await writeFile(outputPath,JSON.stringify(payload,null,2)+'\n');return payload;
}
