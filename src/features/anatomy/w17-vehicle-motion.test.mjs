import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import * as T from "three";
import { decodeModelAsset } from "./w17-model-asset.ts";
import { prepareVehicleMotion, createVehicleMotion, wheelRatio } from "./w17-vehicle-motion.ts";
import { prepareRenderBatches } from "./w17-render-batches.ts";
import { createHoverInspection } from "./w17-inspection.ts";
import { ENGINE_CORE } from "./w17-engine-core.ts";

const bytes=gunzipSync(readFileSync(new URL("../../../public/anatomy/model-mercedes.bin.gz",import.meta.url)));
const model=decodeModelAsset(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
model.root.updateMatrixWorld(true);
const get=name=>model.root.getObjectByName(name);
const original=[];model.root.traverse(part=>{if(part.isMesh)original.push({part,geometry:part.geometry,matrix:part.matrixWorld.clone()});});
prepareVehicleMotion(model.root);

test("motion pivots retain every installed mesh and world transform before batching",()=>{
  for(const {part,geometry,matrix}of original){
    assert.equal(part.geometry,geometry);
    assert.ok(model.root.getObjectByProperty("uuid",part.uuid),part.name);
    part.matrixWorld.elements.forEach((value,i)=>assert.ok(Math.abs(value-matrix.elements[i])<1e-10,`${part.name}: moved during preparation`));
  }
  const count=original.length;let after=0;model.root.traverse(p=>{if(p.isMesh&&!p.userData.renderBatch)after++;});assert.equal(after,count);
  const input=get("Gearbox input rotation");prepareVehicleMotion(model.root);assert.equal(get("Gearbox input rotation"),input);
});

prepareRenderBatches(model.root,new Set(model.linkages.map(link=>link.mesh)));
const move=createVehicleMotion(model.root);
const initialStatic=["Carbon gearbox casing","Gear selector barrel","Differential clutch piston 1","Rear rain light housing","Front 1 upper wishbone 0"].map(name=>({part:get(name),matrix:get(name)?.matrixWorld.clone()}));

test("the drivetrain stays synchronized through a full cycle while casings and hydraulics remain stationary",()=>{
  const wheels=[];model.root.traverse(p=>{if(p.userData.wheel)wheels.push(p);});assert.equal(wheels.length,4);
  for(const travel of[-.2,-1.1,-Math.PI*2,-Math.PI*4]){
    move(ENGINE_CORE.initialAngle+travel);model.root.updateMatrixWorld(true);
    const angle=(name,axis,expected)=>assert.ok(get(name).quaternion.angleTo(new T.Quaternion().setFromAxisAngle(axis,expected))<1e-7,name);
    angle("Gearbox input rotation",new T.Vector3(1,0,0),travel);
    angle("Gearbox output rotation",new T.Vector3(1,0,0),travel*-36/64);
    angle("Differential carrier rotation",new T.Vector3(0,0,1),travel*wheelRatio);
    for(let i=0;i<8;i++)angle(`Gearbox ratio ${i+1} rotation`,new T.Vector3(1,0,0),travel*-(24+i*4)/(76-i*4));
    for(const wheel of wheels)assert.ok(wheel.quaternion.angleTo(get("Differential carrier rotation").quaternion)<1e-7,wheel.name);
    for(const {part,matrix}of initialStatic){assert.ok(part);part.matrixWorld.elements.forEach((value,i)=>assert.ok(Math.abs(value-matrix.elements[i])<1e-10,`${part.name}: stationary part rotates`));}
    // The tilted shaft must spin around its own line, not orbit the output.
    for(const side of[-1,1]){
      const shaft=get(`Half shaft ${side}`),pivot=get(`Half shaft rotation ${side}`);
      const centre=shaft.geometry.boundingBox.getCenter(new T.Vector3()).applyMatrix4(shaft.matrixWorld);
      assert.ok(centre.distanceTo(pivot.getWorldPosition(new T.Vector3()))<1e-6);
    }
  }
  move(ENGINE_CORE.initialAngle);model.root.updateMatrixWorld(true);
});

test("moving batched draw surfaces inherit their pivot and the two brake discs rotate in the same world direction",()=>{
  const batch=get("Gearbox input rotation").children.find(p=>p.userData.renderBatch);assert.ok(batch);
  const before=batch.matrixWorld.clone();move(ENGINE_CORE.initialAngle-.7);model.root.updateMatrixWorld(true);
  assert.notDeepEqual(batch.matrixWorld.elements,before.elements);
  const rotors=[];model.root.traverse(p=>{if(p.userData.brakeRotor)rotors.push(p);});assert.equal(rotors.length,4);
  for(const part of rotors){
    const p=new T.Vector3(1,0,0).applyQuaternion(part.quaternion);
    assert.ok(p.y<0,`${part.name}: rolls backwards`);
  }
  move(ENGINE_CORE.initialAngle);model.root.updateMatrixWorld(true);
});

test("hover fades only private shell materials, restores them exactly and leaves geometry and inner parts intact",()=>{
  const body=get("Continuous undercut sidepod shell"),casePart=get("Cast V6 crankcase"),gear=get("Primary ratio gear 1"),geometry=body.geometry;
  const oldCaseMaterial=casePart.material,gearMaterial=gear.material;
  const inspect=createHoverInspection(model.root);
  assert.notEqual(casePart.material,oldCaseMaterial);
  inspect("bodywork",.016,true);
  assert.equal(body.material.opacity,.22);assert.equal(casePart.material.opacity,.22);
  assert.equal(gear.material,gearMaterial);assert.equal(gear.material.opacity,1);
  assert.equal(oldCaseMaterial.opacity,1);assert.equal(body.geometry,geometry);assert.equal(body.castShadow,false);
  assert.equal(body.material.depthWrite,false);
  for(let i=0;i<100;i++)inspect(null,.016);
  assert.equal(body.material.opacity,1);assert.equal(casePart.material.opacity,1);
  assert.equal(body.material.transparent,false);assert.equal(body.material.depthWrite,true);assert.equal(body.castShadow,true);
  assert.equal(inspect(null,.016).moving,false);
  inspect.dispose();
});

test("cooling airflow reveals its outer shells while mechanisms remain opaque and hover stays reversible",()=>{
  const body=get("Continuous undercut sidepod shell"),duct=get("Radiator inlet duct 1"),engine=get("Cast V6 crankcase"),gear=get("Primary ratio gear 1");
  const sources=[body,duct,engine,gear].map(p=>p.material),inspect=createHoverInspection(model.root);
  inspect(null,.016,true,true);
  assert.equal(body.material.opacity,.12);assert.equal(duct.material.opacity,.12);
  assert.equal(engine.material.opacity,1);assert.equal(gear.material.opacity,1);
  assert.equal(body.material.depthWrite,false);assert.equal(duct.castShadow,false);
  inspect("engine",.016,true,true);
  assert.equal(engine.material.opacity,.22);assert.equal(body.material.opacity,.12);
  // Assembled mode must restore every faded shell immediately, even while
  // the pointer and airflow remain active, then allow inspection again.
  inspect("engine",.016,false,true,false);
  for(const part of[body,duct,engine,gear]){
    assert.equal(part.material.opacity,1);assert.equal(part.material.transparent,false);
    assert.equal(part.material.depthWrite,true);
  }
  assert.equal(body.castShadow,true);assert.equal(duct.castShadow,true);
  assert.equal(inspect("bodywork",.016,false,true,false).moving,false);
  inspect("engine",.016,true,true,true);
  assert.equal(engine.material.opacity,.22);assert.equal(body.material.opacity,.12);
  inspect("engine",.016,true,false);
  assert.equal(body.material.opacity,1);assert.equal(duct.material.opacity,1);assert.equal(engine.material.opacity,.22);
  inspect(null,.016,true,false);
  for(const part of[body,duct,engine,gear])assert.equal(part.material.opacity,1);
  inspect.dispose();
  [body,duct,engine,gear].forEach((p,i)=>assert.equal(p.material,sources[i]));
});
