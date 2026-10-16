import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { createW17, W17_REFERENCE_HEIGHT } from "./w17-geometry.ts";
import { ENGINE_CORE, ENGINE_STROKE, createEngineMotion, engineCylinderX, engineValveEvent } from "./w17-engine-core.ts";
import { createModelInstance } from "./w17-model-cache.ts";

const model=createW17();model.root.updateMatrixWorld(true);
const core=model.root.getObjectByName("V6 crank and piston assembly"),get=name=>model.root.getObjectByName(name);
const motion=createEngineMotion(core),crankHeight=W17_REFERENCE_HEIGHT+.09;

test("the installed V6 contains six connected piston and rod assemblies",()=>{
  const pistons=[], rods=[];
  model.root.traverse(part=>{
    if(part.userData.engineMotion==="piston")pistons.push(part);
    if(part.userData.engineMotion==="rod")rods.push(part);
  });
  assert.equal(pistons.length,6);
  assert.equal(rods.length,6);
});

test("V6 bore, spacing, deck, pins and stroke use the published dimensions",()=>{
  assert.ok(Math.abs(6*Math.PI*.040**2*ENGINE_STROKE-.0016)<1e-12);
  for(const side of[-1,1])for(let i=0;i<3;i++){
    const liner=get(`Cylinder barrel ${side} ${i}`),bank=liner.parent;
    assert.ok(Math.abs(bank.position.x-engineCylinderX(side,i))<1e-12);
    if(i)assert.ok(Math.abs(bank.position.x-get(`Cylinder barrel ${side} ${i-1}`).parent.position.x-.101)<1e-12);
    const axis=new T.Vector3(0,1,0).transformDirection(bank.matrixWorld);
    const origin=bank.getWorldPosition(new T.Vector3());
    assert.ok(Math.abs(origin.y-crankHeight)<1e-9&&Math.abs(origin.z)<1e-9);
    assert.ok(Math.abs(axis.y-Math.SQRT1_2)<1e-9&&Math.abs(axis.z-side*Math.SQRT1_2)<1e-9);
    const p=liner.geometry.attributes.position,radii=[];
    for(let j=0;j<p.count;j++)radii.push(Math.hypot(p.getX(j),p.getZ(j)));
    assert.ok(Math.abs(Math.min(...radii)-.040)<1e-7);
    const bounds=new T.Box3().setFromBufferAttribute(p);
    assert.ok(Math.abs(bounds.max.y+liner.position.y-.168)<1e-7);
    assert.equal(new T.Raycaster(origin,axis,0,.18).intersectObject(liner,false).length,0,"liner is a solid cylinder");
    const pin=get(`Cylinder ${side} ${i} wrist pin`).geometry.attributes.position;
    let maximum=0;for(let j=0;j<pin.count;j++)maximum=Math.max(maximum,Math.hypot(pin.getX(j),pin.getZ(j)));
    assert.ok(Math.abs(maximum*2-.0185)<1e-7);
  }
});

test("three shared journals, six rods and pins stay connected throughout a revolution",()=>{
  const journals=[];core.traverse(p=>{if(p.userData.engineJournal!==undefined)journals.push(p);});assert.equal(journals.length,3);
  const distances=new Map();
  for(let angle=0;angle<=Math.PI*2;angle+=Math.PI/36){
    motion(angle);model.root.updateMatrixWorld(true);
    for(const side of[-1,1])for(let i=0;i<3;i++){
      const name=`Cylinder ${side} ${i}`,rod=get(`${name} connecting rod`),piston=get(`${name} piston assembly`);
      const big=rod.getWorldPosition(new T.Vector3()),small=new T.Vector3(0,.120,0).applyMatrix4(rod.matrixWorld),pin=piston.getWorldPosition(new T.Vector3());
      assert.ok(small.distanceTo(pin)<1e-8,`${name}: detached wrist pin`);
      assert.ok(Math.abs(big.distanceTo(pin)-.120)<1e-8);
      const journal=get(`Crank rod journal ${i}`).getWorldPosition(new T.Vector3());
      assert.ok(Math.hypot(big.y-journal.y,big.z-journal.z)<1e-8,`${name}: detached big end`);
      assert.ok(Math.abs(big.x-journal.x)+.0182/2<.0394/2,"rod leaves the common bearing journal");
      const distance=Math.hypot(pin.y-crankHeight,pin.z),key=`${side}/${i}`;
      const range=distances.get(key)??[Infinity,-Infinity];range[0]=Math.min(range[0],distance);range[1]=Math.max(range[1],distance);distances.set(key,range);
      const shape=get(`${name} piston crown and skirt`).geometry.attributes.position;
      for(let j=0;j<shape.count;j+=17){
        const radius=Math.hypot(shape.getX(j),shape.getZ(j));assert.ok(radius<.04,"piston cuts through liner");
        assert.ok(distance+shape.getY(j)<.168&&distance+shape.getY(j)>.064,"piston leaves its liner");
      }
    }
  }
  for(const [min,max]of distances.values())assert.ok(Math.abs(max-min-ENGINE_STROKE)<.00006,"wrong piston travel");
  motion(ENGINE_CORE.initialAngle);model.root.updateMatrixWorld(true);
});

test("every piston has a hollow pin passage and three separately seated split rings",()=>{
  for(const side of[-1,1])for(let i=0;i<3;i++){
    const name=`Cylinder ${side} ${i}`,piston=get(`${name} piston assembly`),rings=[];
    piston.traverse(p=>{if(p.userData.pistonRing)rings.push(p);});
    assert.equal(rings.filter(r=>r.userData.pistonRing==="compression").length,2);
    assert.equal(rings.filter(r=>r.userData.pistonRing==="oil").length,1);
    piston.updateMatrixWorld(true);
    piston.traverse(part=>{
      if(!part.isMesh)return;
      part.updateMatrix();const points=part.geometry.attributes.position;
      for(let j=0;j<points.count;j++){
        const v=new T.Vector3().fromBufferAttribute(points,j).applyMatrix4(part.matrix);
        assert.ok(Math.hypot(v.x,v.z)<.04,`${part.name}: pin hardware leaves the bore`);
      }
    });
    const skirt=get(`${name} piston crown and skirt`),origin=new T.Vector3(-.05,0,0).applyMatrix4(piston.matrixWorld),direction=new T.Vector3(1,0,0).transformDirection(piston.matrixWorld);
    assert.equal(new T.Raycaster(origin,direction,0,.1).intersectObject(skirt,false).length,0,"wrist pin crosses solid skirt walls");
    for(const ring of rings){
      const p=ring.geometry.attributes.position;let max=0;
      for(let j=0;j<p.count;j++)max=Math.max(max,Math.hypot(p.getX(j),p.getZ(j)));
      assert.ok(max<.04&&max>.0399,"ring does not fit the 80 mm bore");
    }
  }
});

test("the moving core and liners occupy an actual cavity in the engine casting",()=>{
  const block=get("Cast V6 crankcase"),material=block.material,old=material.side;material.side=T.DoubleSide;
  const bounds=new T.Box3().setFromObject(block);
  try{
    for(const angle of[0,Math.PI/6,Math.PI/3,Math.PI/2,Math.PI,Math.PI*1.5]){
      motion(angle);model.root.updateMatrixWorld(true);
      core.traverse(part=>{
        if(!part.isMesh||part.userData.engineHead||/^Crank bearing|mounting foot|saddle|washer|seal/.test(part.name))return;
        const p=part.geometry.attributes.position;
        for(let j=0;j<p.count;j+=19){
          const point=new T.Vector3().fromBufferAttribute(p,j).applyMatrix4(part.matrixWorld);
          if(point.x<=bounds.min.x+1e-6||point.x>=bounds.max.x-1e-6)continue;
          // Discrete deck bores now have solid bridges between cylinders.
          // An outside ray can cross those bridges twice; only odd parity
          // means this sampled mechanism point itself is inside the casting.
          const hits=new T.Raycaster(point,new T.Vector3(1,0,0),.0000001,1).intersectObject(block,false);
          const distances=new Set(hits.map(hit=>Math.round(hit.distance*1e7)));
          assert.equal(distances.size%2,0,`${part.name}: solid casting through mechanism at ${point.toArray()}`);
        }
      });
    }
  }finally{material.side=old;motion(ENGINE_CORE.initialAngle);model.root.updateMatrixWorld(true);}
});

test("the corrected cylinder centres also position the injectors, ignition and exhaust ports",()=>{
  for(const side of[-1,1])for(let i=0;i<3;i++){
    const x=engineCylinderX(side,i);
    for(const name of[`Ignition connector ${side} ${i}`,`Direct injector ${side} ${i}`])assert.ok(Math.abs(get(name).getWorldPosition(new T.Vector3()).x-x)<1e-8,name);
    assert.ok(Math.abs(get(`Exhaust primary ${side} ${i}`).userData.route[0][0]-x)<1e-8);
  }
});

test("engine inspection animates its own transforms while sharing installed geometry",()=>{
  const installed=createModelInstance(),detail=createModelInstance("engine");
  const name="Cylinder 1 1 piston assembly",carPiston=installed.root.getObjectByName(name),detailPiston=detail.root.getObjectByName(name),before=carPiston.position.clone();
  assert.equal(installed.root.getObjectByName("Cylinder 1 1 piston crown and skirt").geometry,detail.root.getObjectByName("Cylinder 1 1 piston crown and skirt").geometry);
  createEngineMotion(detail.root)(2.1);
  assert.ok(carPiston.position.equals(before),"detail motion changes the installed car");
  assert.ok(detailPiston.position.distanceTo(before)>.005,"piston animation does not move");
  const valveName="Valve 1 1 intake 1",carValve=installed.root.getObjectByName(valveName),detailValve=detail.root.getObjectByName(valveName),rest=carValve.position.clone();
  assert.equal(installed.root.getObjectByName(`${valveName} head and stem`).geometry,detail.root.getObjectByName(`${valveName} head and stem`).geometry);
  const event=engineValveEvent(1,1,"intake");createEngineMotion(detail.root)(event);
  assert.ok(carValve.position.equals(rest),"detail changes the installed valve");
  assert.ok(detailValve.position.distanceTo(new T.Vector3(...detailValve.userData.seat))>.0069,"valve stays closed at maximum lift");
  assert.ok(Math.abs(detail.root.getObjectByName("Camshaft 1 intake").rotation.x-event/2)<1e-12,"camshaft does not run at half crank speed");
});
