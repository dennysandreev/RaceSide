import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import * as T from "three";
import { prepareRenderBatches } from "./w17-render-batches.ts";
import { decodeModelAsset } from "./w17-model-asset.ts";

test("static batches preserve transformed surfaces and retain original picking bounds",()=>{
  const root=new T.Group(),geometry=new T.BoxGeometry(1,1,1),material=new T.MeshStandardMaterial();
  const a=new T.Mesh(geometry,material),b=new T.Mesh(geometry,material);a.name="left";b.name="right";b.position.x=2;
  for(const part of[a,b])part.userData.component="cooling";root.add(a,b);root.updateMatrixWorld(true);
  const before=new T.Box3().setFromObject(root),original=geometry.attributes.position.array.slice();
  assert.deepEqual(prepareRenderBatches(root),{combined:2,batches:1});root.updateMatrixWorld(true);
  const batch=root.children.find(p=>p.userData.renderBatch),after=new T.Box3().setFromObject(batch);
  assert.ok(before.min.distanceTo(after.min)<1e-6&&before.max.distanceTo(after.max)<1e-6);
  assert.deepEqual(geometry.attributes.position.array,original);
  assert.equal(batch.geometry.index.count,geometry.index.count*2);
  const ray=new T.Raycaster(new T.Vector3(2,0,5),new T.Vector3(0,0,-1));
  assert.equal(ray.intersectObject(root,true)[0].object,batch);
  ray.layers.set(1);assert.equal(ray.intersectObject(root,true)[0].object,b);
  assert.equal(root.getObjectByName("left"),a);
  assert.deepEqual(prepareRenderBatches(root),{combined:0,batches:0});
});

test("batches respect cover and focus classes and never absorb independently moving meshes",()=>{
  const root=new T.Group(),material=new T.MeshStandardMaterial(),geometry=new T.BoxGeometry();
  const variants=[{}, {cover:true}, {serviceCover:true}, {airflowCover:true}, {structural:true}, {installedOnly:true}, {brakeAxle:"rear",brakeSide:-1}, {cockpitSection:"wheel"}, {coolantPump:"lt"}, {oilPump:true}, {hydraulicDrive:true}, {hydraulicPump:true}, {hydraulicPumpCover:true}, {hydraulicBarrel:true}, {steeringSupply:true}];
  for(const flags of variants)for(let i=0;i<2;i++){const p=new T.Mesh(geometry,material);p.userData={component:"engine",...flags};root.add(p);}
  const moving=new Set();
  for(const flags of[{engineMotion:"timingGear"},{flap:true},{wheel:true},{turboRotor:true},{brakeRotor:true},{}]){
    const p=new T.Mesh(geometry,material);p.userData={component:"engine",...flags};root.add(p);moving.add(p);
  }
  const result=prepareRenderBatches(root,moving);assert.equal(result.batches,variants.length);
  for(const part of moving)assert.equal(part.layers.mask,3,"moving mesh was frozen into a static batch");
  const batchFlags=root.children.filter(p=>p.userData.renderBatch).map(p=>Object.fromEntries(Object.entries(p.userData).filter(([k])=>!["component","renderBatch","sourceCount"].includes(k))));
  assert.deepEqual(batchFlags,variants);
  for(const batch of root.children.filter(p=>p.userData.renderBatch))assert.equal(batch.layers.mask,1);
});

test("installed model batching reduces draw surfaces without losing triangles or moving-node identity",()=>{
  const bytes=gunzipSync(readFileSync(new URL("../../../public/anatomy/model-mercedes.bin.gz",import.meta.url)));
  const model=decodeModelAsset(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  const count=()=>{let meshes=0,triangles=0;model.root.traverse(p=>{if(!p.isMesh||!(p.layers.mask&1))return;meshes++;triangles+=(p.geometry.index?.count??p.geometry.attributes.position.count)/3*(p.isInstancedMesh?p.count:1);});return{meshes,triangles};};
  const before=count(),links=model.linkages.map(link=>link.mesh),crank=model.root.getObjectByName("Crankshaft");
  prepareRenderBatches(model.root,new Set(links));const after=count();
  assert.equal(after.triangles,before.triangles);
  assert.ok(after.meshes<before.meshes*.25,`${before.meshes} -> ${after.meshes}: draw surfaces were not consolidated`);
  assert.equal(model.root.getObjectByName("Crankshaft"),crank);
  for(const mesh of links)assert.equal(mesh.layers.mask,3,"wing linkage was frozen");
});
