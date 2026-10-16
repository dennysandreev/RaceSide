import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { createModelInstance, replaceRearWing, visibleInPowertrain } from "./w17-model-cache.ts";
import { createHeightSampler } from "./w17-surface.ts";

const model=createModelInstance();model.root.updateMatrixWorld(true);

test("the engine view keeps the installed electrical, fuel and cooling circuits with the drive unit",()=>{
  for(const name of [
    "ES access lid", "High voltage cable", "Motor cable plug", "Main loom", "Engine harness plug",
    "Fuel bladder", "Direct injector 1 0", "Fuel rail -1",
    "Coolant hot line 1", "Coolant return line -1", "Oil cooler return hose",
    "ES coolant supply", "ES coolant return", "MGU-K coolant return", "Charge warm water line",
    "Filtered air duct", "Gearbox input shaft", "Primary ratio gear 1", "Main ratio gear 8",
    "Half shaft -1", "Half shaft 1", "Clutch flywheel flange",
  ]){
    const part=model.root.getObjectByName(name);assert.ok(part?.isMesh,`${name}: missing installed part`);
    assert.equal(visibleInPowertrain(part),true,`${name}: powertrain connection disappears`);
  }
  const visible=new Set();model.root.traverse(part=>{if(part.isMesh&&visibleInPowertrain(part))visible.add(part.userData.component);});
  assert.deepEqual([...visible].sort(),["engine","turbo","intake","exhaust","fuel","cooling","mguk","battery","inverter","electronics","clutch","gearbox","differential","hydraulics"].sort());
});

test("the engine view opens only the gearbox casing without changing the cached geometry",()=>{
  const covers=[];model.root.traverse(part=>{if(part.isMesh&&part.userData.component==="gearbox"&&part.userData.cover)covers.push(part);});
  assert.ok(covers.some(part=>part.name==="Carbon gearbox casing"));
  assert.ok(covers.some(part=>part.name==="Clutch bell casing"));
  assert.ok(covers.some(part=>part.name.startsWith("Gearbox casing seam bolt")));
  for(const cover of covers)assert.equal(visibleInPowertrain(cover),false,`${cover.name}: casing hardware remains`);
  for(const group of model.assemblies.values())group.traverse(part=>{
    const geometry=part.geometry,position=part.position.clone(),visible=part.visible;
    visibleInPowertrain(part);
    assert.equal(part.geometry,geometry);assert.ok(part.position.equals(position));assert.equal(part.visible,visible);
    if(part.isMesh&&part.userData.component==="engine"&&part.userData.serviceCover)assert.equal(visibleInPowertrain(part),true,"the assembled engine was also stripped");
  });
});

test("component previews reuse geometry but retain independent transforms and materials",()=>{
  const preview=createModelInstance("front-wing");assert.equal(preview.assemblies.size,1);
  const a=model.root.getObjectByName("Front mainplane"),b=preview.root.getObjectByName("Front mainplane");
  assert.equal(a.geometry,b.geometry);assert.notEqual(a.material,b.material);
  b.position.y+=1;assert.notEqual(a.position.y,b.position.y);
  for(const link of preview.linkages){assert.ok(preview.root.getObjectByProperty("uuid",link.mesh.uuid));assert.ok(preview.root.getObjectByProperty("uuid",link.wing.uuid));}
});

test("switching the rear wing preserves every other object and its geometry",()=>{
  const stable=[];model.root.traverse(part=>{if(part.userData.component!=="rear-wing")stable.push([part,part.geometry]);});
  for(const variant of ["ferrari","red-bull","mercedes"]){
    assert.equal(replaceRearWing(model,variant),true);
    for(const [part,geometry] of stable){assert.ok(model.root.getObjectByProperty("uuid",part.uuid));assert.equal(part.geometry,geometry);}
    for(const link of model.linkages)assert.ok(model.root.getObjectByProperty("uuid",link.mesh.uuid));
    assert.equal(model.root.children.filter(p=>p.name==="rear-wing").length,1);
  }
  assert.equal(replaceRearWing(model,"mercedes"),false);
});

test("indexed floor sampler preserves the original triangle intersections",()=>{
  const ray=new T.Raycaster();
  for(const side of [-1,1]){
    const shoulder=model.root.getObjectByName(`Sculpted floor shoulder ${side}`),height=createHeightSampler(shoulder.geometry);
    for(let x=-1.46;x<1.02;x+=.071)for(let z=.36;z<.81;z+=.039){
      ray.set(new T.Vector3(x,.7,side*z),new T.Vector3(0,-1,0));
      const y=ray.intersectObject(shoulder)[0]?.point.y,actual=height(x,side*z);
      if(y===undefined)assert.equal(actual,undefined);else assert.ok(Math.abs(y-actual)<1e-6,`surface shifted at ${x}/${z}: ${y}/${actual}`);
    }
  }
});
