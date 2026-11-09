import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { auditCorridorObjects, auditMonzaSurfaces, clipToRoad, readMonzaMeshes } from "./audit-monza-surfaces.mjs";
import { utm32nFromWgs84 } from "./export-monza-track-data.mjs";
import { surfaceIndex } from "./audit-madring-surfaces.mjs";
import { monzaFollowCameraPosition, sampleMonzaPose } from "../../src/features/anatomy/monza-lesson-track.ts";
import { MONZA_REPLAY_PATH } from "../../src/data/monza-model.ts";

const asset = new URL("../../public/f1/tracks/3d/monza.glb", import.meta.url);

test("the delivered oval edges stay smooth at four-metre intervals", async () => {
  const meshes=await readMonzaMeshes(await readFile(asset));
  const triangles=meshes.get("Monza_Historic_Banked_Oval_Mesh");
  const vertices=new Map(),edges=new Map();
  const key=p=>p.map(v=>v.toFixed(3)).join(',');
  for(const t of triangles) for(let i=0;i<3;i++) {
    const a=key(t[i]),b=key(t[(i+1)%3]);vertices.set(a,t[i]);vertices.set(b,t[(i+1)%3]);
    const id=[a,b].sort().join('|'); const old=edges.get(id);
    edges.set(id,{a,b,count:(old?.count??0)+1});
  }
  const neighbours=new Map();
  for(const {a,b,count} of edges.values()) if(count===1) {
    for(const [p,q] of [[a,b],[b,a]]) neighbours.set(p,[...(neighbours.get(p)??[]),q]);
  }
  let checked=0,worst=0;
  for(const [id,adjacent] of neighbours) {
    if(adjacent.length!==2)continue;
    const a=vertices.get(adjacent[0]),b=vertices.get(id),c=vertices.get(adjacent[1]);
    const length=(p,q)=>Math.hypot(p[0]-q[0],p[2]-q[2]);
    // Cross-section edges and clipped end caps are not longitudinal edges.
    if([length(a,b),length(b,c)].some(d=>d<3.6||d>4.4))continue;
    const deviation=Math.abs((c[0]-a[0])*(a[2]-b[2])-(a[0]-b[0])*(c[2]-a[2]))/length(a,c);
    worst=Math.max(worst,deviation);checked++;
  }
  assert.ok(checked>800,`Only ${checked} longitudinal edge vertices`);
  assert.ok(worst<.10,`An oval edge jumps ${worst.toFixed(3)} m sideways between 4 m sections`);
});

test("the southern bank follows the archived section and meets the ground at its toe", async () => {
  const meshes = await readMonzaMeshes(await readFile(asset));
  const oval = surfaceIndex(meshes.get("Monza_Historic_Banked_Oval_Mesh"));
  const ground = surfaceIndex(meshes.get("PCN_Monza_DTM_Terrain_RealScale_Mesh"));
  // Fixed survey-plane section away from bridges. Heights below come from
  // the archived 1954 drawing, not from the generated model's metadata.
  const toe = [-32.5477142, 759.4026489];
  const outward = [7.7509784 / 12, 9.1608887 / 12];
  const at = distance => oval(toe[0] + outward[0] * distance, toe[1] + outward[1] * distance);
  const apron = at(-4.5);
  assert.notEqual(apron, null);
  for (const [distance, rise] of [[.1,.012], [1.75,.21], [3.70,.77], [5.95,1.81], [8.65,3.51], [11.9,6.12]]) {
    const height = at(distance);
    assert.notEqual(height, null, `Missing banking at ${distance} m`);
    assert.ok(Math.abs(height - apron - rise) < .035,
      `At ${distance} m: rise ${height - apron}, expected ${rise}`);
  }
  const terrain = ground(...toe);
  assert.notEqual(terrain, null);
  assert.ok(apron >= terrain && apron - terrain < .8, `Bank toe floats ${apron - terrain} m above ground`);
});

test("pit entry and exit paint never crosses the main road edge paint", async () => {
  const meshes=await readMonzaMeshes(await readFile(asset));
  const pit=meshes.get("Monza_Pit_Fast_Lane_And_10_Working_Boxes_Mesh");
  const gp=meshes.get("Track_Edge_Lines_Mesh");
  const bounds=t=>[Math.min(...t.map(p=>p[0])),Math.min(...t.map(p=>p[2])),Math.max(...t.map(p=>p[0])),Math.max(...t.map(p=>p[2]))];
  const edges=gp.map(t=>({t,b:bounds(t)}));
  for(const triangle of pit) {
    const b=bounds(triangle);
    for(const edge of edges) {
      if(b[0]>edge.b[2]||b[2]<edge.b[0]||b[1]>edge.b[3]||b[3]<edge.b[1])continue;
      const polygon=clipToRoad(triangle,edge.t);
      const area=Math.abs(polygon.reduce((sum,p,i)=>{const q=polygon[(i+1)%polygon.length];return sum+p[0]*q[2]-q[0]*p[2];},0))/2;
      assert.ok(area<.0005,`Crossing white lines cover ${area} square metres`);
    }
  }
});

test("the approach beside Alta Velocita stands is flat, with no raised ribs", async () => {
  const meshes=await readMonzaMeshes(await readFile(asset));
  const oval=surfaceIndex(meshes.get("Monza_Historic_Banked_Oval_Mesh"));
  const supports=surfaceIndex(meshes.get("Monza_Historic_Banked_Oval_Structure_Mesh"));
  const [east,north]=utm32nFromWgs84(45.622535,9.28186);
  const x=east-522415,z=5051590-north;
  const heights=[-3,0,3].map(offset=>oval(x+offset,z));
  assert.ok(heights.every(h=>h!==null),JSON.stringify(heights));
  assert.ok(Math.max(...heights)-Math.min(...heights)<.15,JSON.stringify(heights));
  assert.equal(supports(x,z),null);
});

test("banking ribs stay below the curved shell across its full width", async () => {
  const meshes=await readMonzaMeshes(await readFile(asset));
  const oval=surfaceIndex(meshes.get("Monza_Historic_Banked_Oval_Mesh"));
  const triangles=meshes.get("Monza_Historic_Banked_Oval_Structure_Mesh");
  let checked=0;
  for(const triangle of triangles) {
    const p=triangle[0].map((_,axis)=>triangle.reduce((sum,v)=>sum+v[axis],0)/3);
    const floor=oval(p[0],p[2]);
    if(floor===null)continue;
    // Exclude crest rails by requiring a half-metre disk inside the shell.
    if([[.6,0],[-.6,0],[0,.6],[0,-.6]].some(([dx,dz])=>oval(p[0]+dx,p[2]+dz)===null))continue;
    assert.ok(p[1]<floor-.12,`Support emerges through banking at ${p}`);
    checked++;
  }
  assert.ok(checked>2000);
});

test("banked concrete has embedded colour and normal textures", async () => {
  const glb=await readFile(asset);
  const gltf=JSON.parse(glb.subarray(20,20+glb.readUInt32LE(12)).toString('utf8'));
  const material=gltf.materials.find(m=>m.name==='Monza_Weathered_Banking_Concrete');
  assert.ok(material?.pbrMetallicRoughness?.baseColorTexture);
  assert.ok(material?.normalTexture);
  const mesh=gltf.meshes.find(m=>m.name==='Monza_Historic_Banked_Oval_Mesh');
  assert.ok(mesh.primitives.every(p=>p.attributes.TEXCOORD_0!==undefined));
  const portals=gltf.meshes.find(m=>m.name==='Monza_Historic_Banked_Oval_Portals_Mesh');
  assert.ok(portals?.primitives.every(p=>p.attributes.TEXCOORD_0!==undefined
    && gltf.materials[p.material]?.pbrMetallicRoughness?.baseColorTexture));
});

test("the chase camera passes below the bridge shell and its girders", async () => {
  const meshes=await readMonzaMeshes(await readFile(asset));
  const road=surfaceIndex(meshes.get("FIA_Monza_Centreline_12m_Mesh"));
  const oval=surfaceIndex(meshes.get("Monza_Historic_Banked_Oval_Mesh"));
  let checked=0;
  for(let i=0;i<=2000;i++) {
    const pose=sampleMonzaPose(.60+i/2000*.05);
    pose.position.y=road(pose.position.x,pose.position.z)??pose.position.y;
    for(const inside of [false,true]) for(const aspect of [.65,1.7]) {
      const camera=monzaFollowCameraPosition(pose,inside,aspect);
      const ceiling=oval(camera.x,camera.z);
      if(ceiling===null)continue;
      assert.ok(camera.y<ceiling-1,`Camera clips bridge at ${i}: ${camera.y}, roof ${ceiling}`);
      const lateral=Math.abs((camera.x-pose.position.x)*-pose.forward.z+(camera.z-pose.position.z)*pose.forward.x);
      assert.ok(lateral<7,`Camera crosses portal wall: ${lateral}`);
      checked++;
    }
  }
  assert.ok(checked>50);
});

test("delivered Monza geometry keeps the GP and pit lane open after compression", async () => {
  const audit = await auditMonzaSurfaces(await readFile(asset));
  assert.equal(audit.obstructions.triangles, 0, JSON.stringify(audit.obstructions.examples));
  assert.ok(audit.elevatedCrossings.samples > 0);
  assert.ok(audit.elevatedCrossings.minimumHeadroomMeters >= 4.5);
  assert.ok(audit.obstructions.checkedTriangles > 200_000);
  assert.ok(audit.pitJoins.samples > 0);
  assert.ok(audit.pitJoins.maximumStepMeters <= .06, JSON.stringify(audit.pitJoins));
  for (const layer of [audit.road, audit.edgePaint, audit.pitPaint]) {
    assert.ok(layer.triangles > 0);
    assert.equal(layer.intersections, 0);
    assert.equal(layer.missingSupport, 0);
    assert.ok(layer.minimumClearanceMeters > .005);
  }
});

test("corridor audit catches wall edges and vertical faces even with their centroids outside the road", () => {
  const road = [[[0,0,0],[10,0,0],[0,0,10]], [[10,0,0],[10,0,10],[0,0,10]]];
  const objects = new Map([
    ["pit wall", [[[9,0,2],[9,3,2],[15,3,2]]]],
    ["roof corner", [[[9,2,9],[25,2,9],[9,2,25]]]],
    ["unmapped oval bridge", [[[2,8,2],[3,8,2],[2,8,3]]]],
  ]);
  const audit = auditCorridorObjects(objects, road);
  assert.equal(audit.obstructions.length, 3);
  assert.equal(audit.elevated.length, 0);
});

test("the entire driving lap and pit replay stay on delivered asphalt", async () => {
  const meshes = await readMonzaMeshes(await readFile(asset));
  const gp = surfaceIndex(meshes.get("FIA_Monza_Centreline_12m_Mesh"));
  const pit = surfaceIndex(meshes.get("FIA_Pit_Lane_Mesh"));
  // Approximately half-metre spacing, with the full car width checked too.
  for (let i=0;i<=12000;i++) {
    const pose = sampleMonzaPose(i/12000);
    for (const lateral of [-1.1,0,1.1]) {
      const x=pose.position.x-pose.forward.z*lateral;
      const z=pose.position.z+pose.forward.x*lateral;
      assert.notEqual(gp(x,z), null, `Car leaves GP at progress ${i/12000}, lateral ${lateral}`);
    }
  }
  const points = MONZA_REPLAY_PATH.pitLanePoints;
  for (let i=1;i<points.length;i++) for(let step=0;step<=20;step++) {
    const t=step/20, a=points[i-1], b=points[i];
    const x=a[1]*(1-t)+b[1]*t, z=-a[2]*(1-t)-b[2]*t;
    const length=Math.hypot(b[1]-a[1],b[2]-a[2]);
    for (const lateral of [-1.1,0,1.1]) {
      const px=x+(b[2]-a[2])/length*lateral, pz=z+(b[1]-a[1])/length*lateral;
      assert.notEqual(pit(px,pz) ?? gp(px,pz), null, `Pit path leaves asphalt at ${i}:${step}:${lateral}`);
    }
  }
});

test("the map and driving lesson share the current Monza asset version", async () => {
  const [buffer, model, lesson, nextConfig] = await Promise.all([
    readFile(asset),
    readFile(new URL("../../src/data/monza-model.ts", import.meta.url), "utf8"),
    readFile(new URL("../../src/features/anatomy/monza-lesson-scene.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../next.config.ts", import.meta.url), "utf8"),
  ]);
  const hash = createHash("sha256").update(buffer).digest("hex").slice(0, 12);
  assert.ok(model.includes(`/f1/tracks/3d/monza.glb?v=${hash}`));
  assert.ok(model.includes(`/f1/tracks/3d/monza-preview.webp?v=${hash}`));
  assert.ok(nextConfig.includes('{ pathname: "/f1/tracks/3d/monza-preview.webp" }'));
  assert.ok(lesson.includes("useGLTF(MONZA_TRACK_MODEL.webgl.assetPath"));
  assert.ok(lesson.includes("useGLTF.clear(MONZA_TRACK_MODEL.webgl.assetPath"));
});
