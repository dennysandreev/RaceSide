import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import {createW17} from "./w17-geometry.ts";
import {createEngineMotion} from "./w17-engine-core.ts";
import {createSurfaceSampler} from "./w17-surface.ts";

const model=createW17(),get=name=>model.root.getObjectByName(name);
model.root.updateMatrixWorld(true);

test("the motor has a complete fixed-ratio geared connection to the crankshaft",()=>{
  const drive=get("MGU-K geared transmission");assert.ok(drive,"motor transmission contains no gears");
  const gears=[];drive.traverse(p=>{if(p.userData.engineMotion==="accessoryGear")gears.push(p);});
  assert.equal(gears.length,4);
  const crank=get("MGU-K drive gear crank"),output=get("MGU-K drive gear motor"),shaft=get("MGU-K hollow shaft");
  assert.ok(Math.abs(crank.position.y-get("V6 crank and piston assembly").position.y)<1e-9);
  assert.equal(crank.position.z,0);
  const motorAxis=shaft.getWorldPosition(new T.Vector3());
  assert.ok(Math.hypot(output.position.y-motorAxis.y,output.position.z-motorAxis.z)<1e-9);
  for(const gear of gears.filter(g=>g.userData.mate)){
    const parent=gears.find(g=>g.name===gear.userData.mate);
    assert.ok(parent,"broken drive path");
    assert.ok(Math.abs(parent.position.distanceTo(gear.position)-parent.userData.pitchRadius-gear.userData.pitchRadius)<1e-9);
    assert.ok(Math.abs(parent.userData.ratio*parent.userData.teeth+gear.userData.ratio*gear.userData.teeth)<1e-9);
  }
  const motion=createEngineMotion(model.root),rotor=get("MGU-K rotor assembly");
  for(const angle of[0,.7,Math.PI*2]){
    motion(angle);
    assert.ok(Math.abs(output.rotation.x-rotor.rotation.x)<1e-9,"motor is animated independently of its transmission");
  }
});

test("actual transmission teeth clear one another throughout a complete engagement",()=>{
  const gears=[],profiles=new Map(),points=new Map(),drive=get("MGU-K geared transmission");
  drive.traverse(p=>{if(p.userData.engineMotion==="accessoryGear")gears.push(p);});
  for(const gear of gears){
    const mesh=get(`${gear.name} teeth`),g=mesh.geometry.clone();g.rotateZ(Math.PI/2);
    const projection=new T.Mesh(g);projection.updateMatrixWorld(true);profiles.set(gear,createSurfaceSampler([projection],"y"));
    const p=mesh.geometry.attributes.position,unique=new Map();
    for(let i=0;i<p.count;i++)unique.set([p.getY(i),p.getZ(i)].map(v=>Math.round(v*1e8)).join(),new T.Vector3(0,p.getY(i),p.getZ(i)));
    points.set(gear,[...unique.values()]);g.dispose();
  }
  const motion=createEngineMotion(model.root),point=new T.Vector3();
  for(let step=0;step<=48;step++){
    motion(step/48*Math.PI*2/44);model.root.updateMatrixWorld(true);
    for(const a of gears)for(const b of gears){
      if(a===b||a.position.distanceTo(b.position)>a.userData.pitchRadius+b.userData.pitchRadius+.004)continue;
      const transform=a.matrixWorld.clone().invert().multiply(b.matrixWorld),sample=profiles.get(a);
      for(const vertex of points.get(b)){
        point.copy(vertex).applyMatrix4(transform);
        assert.equal(sample(-point.y,point.z,1),undefined,`${a.name}/${b.name}: interpenetrating teeth at ${step}/48`);
      }
    }
  }
  motion(0);model.root.updateMatrixWorld(true);
});

test("transmission covers are closed hollow solids with bored spindle and pump passages",()=>{
  for(const name of["MGU-K accessory transmission","MGU-K transmission front cover","MGU-K transmission rear cover","Crank main-axis section 3","Front crankcase transmission bridge"]){
    const part=get(name),p=part.geometry.attributes.position,ix=part.geometry.index,edges=new Map();
    const key=i=>[p.getX(i),p.getY(i),p.getZ(i)].map(v=>Math.round(v*1e7)).join();
    for(let i=0;i<(ix?.count??p.count);i+=3){
      const v=[0,1,2].map(j=>key(ix?ix.getX(i+j):i+j));if(new Set(v).size<3)continue;
      for(let j=0;j<3;j++){const a=v[j],b=v[(j+1)%3],k=a<b?`${a}/${b}`:`${b}/${a}`;edges.set(k,(edges.get(k)??0)+1);}
    }
    assert.ok([...edges.values()].every(n=>n===2),`${name} has a torn or branching wall`);
  }
  const ray=new T.Raycaster(new T.Vector3(-.295,.190,.169),new T.Vector3(-1,0,0),0,.009);
  assert.equal(ray.intersectObject(get("MGU-K transmission front cover"),false).length,0,"front cover blocks the pump quill");
});

test("the crank key, motor splines and structural mounting faces are physically connected",()=>{
  createEngineMotion(model.root)(0);model.root.updateMatrixWorld(true);
  const crank=get("Crank main-axis section 3"),wheel=get("MGU-K drive gear crank teeth"),key=get("MGU-K crank drive key");
  const point=new T.Box3().setFromObject(key).getCenter(new T.Vector3()),ray=new T.Raycaster(point,new T.Vector3(0,1,0),0,.003);
  crank.material.side=T.DoubleSide;wheel.material.side=T.DoubleSide;
  const contacts=ray.intersectObjects([crank,wheel],false);
  assert.ok(contacts.length&&contacts.every(hit=>hit.object===wheel&&Math.abs(hit.distance-.0016)<1e-6),"key has no machined pocket or hub contact");
  for(let i=0;i<4;i++){
    const spacer=get(`MGU-K mounting spacer ${i}`),b=new T.Box3().setFromObject(spacer),centre=b.getCenter(new T.Vector3());
    centre.y+=.003;ray.set(new T.Vector3(-.330,centre.y,centre.z),new T.Vector3(1,0,0));ray.far=.05;
    const hits=ray.intersectObject(get("Engine timing end cover -0.296"),false);
    assert.ok(hits.length&&Math.abs(hits[0].point.x-b.max.x)<1e-6,"mount floats in front of engine plate");
    ray.set(new T.Vector3(-.280,b.getCenter(new T.Vector3()).y,centre.z),new T.Vector3(-1,0,0));ray.far=.025;
    assert.equal(ray.intersectObjects([get("Engine timing end cover -0.296"),get("MGU-K transmission front cover")],false).length,0,"bolt crosses a solid mounting face");
  }
  const driven=get("MGU-K drive gear motor"),shaftBounds=new T.Box3().setFromObject(get("MGU-K hollow shaft"));
  assert.ok(shaftBounds.min.x<driven.position.x-.004&&shaftBounds.max.x>driven.position.x+.004,"motor shaft does not enter the driven hub");
});

test("the local transmission pocket preserves the rest of the front crankcase wall",()=>{
  const block=get("Front crankcase coolant-drive bridge"),bridge=get("Front crankcase transmission bridge"),p=block.geometry.attributes.position,ix=block.geometry.index,ray=new T.Raycaster();
  bridge.material.side=T.DoubleSide;let checked=0;
  for(let i=0;i<(ix?.count??p.count);i+=3){
    const v=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(p,ix?ix.getX(i+j):i+j).applyMatrix4(block.matrixWorld));
    if(!v.every(p=>Math.abs(p.x+.321)<1e-6))continue;
    const centre=v.reduce((a,b)=>a.add(b),new T.Vector3()).divideScalar(3);
    if(centre.z>-.060&&centre.y<.270)continue;
    centre.x=-.320;ray.set(centre,new T.Vector3(1,0,0));ray.far=.030;
    const hits=ray.intersectObject(bridge,false);
    assert.ok(hits.length&&Math.abs(hits[0].point.x+.298)<1e-6,"bank casting stops behind the front engine cover");checked++;
  }
  assert.ok(checked>3,"front casting was not sampled");
});

test("the installed transmission keeps clearance from the floor, motor, oil tank and pump",()=>{
  model.root.updateMatrixWorld(true);
  const floor=[];model.assemblies.get("floor").traverse(p=>{if(p.isMesh)floor.push(p);});
  const height=createSurfaceSampler(floor,"y"),drive=get("MGU-K geared transmission");
  const neighbours=["MGU-K motor housing lower","MGU-K motor housing upper","MGU-K end shield 1","MGU-K shaft seal 1","Dry-sump oil reservoir","Coolant pump 1","Coolant pump 1 mounting sleeve","Coolant pump 1 shaft","Cast V6 crankcase","Front crankcase transmission bridge","MGU-K power socket","MGU-K power mounting boss","MGU-K power insulator","MGU-K coolant inlet boss","MGU-K coolant in union","ES coolant return","ES coolant return clamp 1","High voltage cable","Motor cable plug","Front mounting boss 1 0.38"].map(get);
  const ray=new T.Raycaster(),point=new T.Vector3(),errors=new Set();
  for(const part of neighbours)part.material.side=T.DoubleSide;
  drive.traverse(part=>{
    if(!part.isMesh)return;const p=part.geometry.attributes.position;
    for(let i=0;i<p.count;i+=3){
      point.fromBufferAttribute(p,i).applyMatrix4(part.matrixWorld);
      const floorY=height(point.x,point.z,1);
      if(floorY!==undefined&&point.y<floorY+.002)errors.add(`${part.name} crosses floor`);
      for(const other of neighbours){
        const box=new T.Box3().setFromObject(other);if(!box.containsPoint(point))continue;
        ray.set(point,new T.Vector3(.031,1,.017).normalize());ray.far=1;
        const hits=ray.intersectObject(other,false).map(h=>h.distance).filter((d,j,all)=>j===0||d-all[j-1]>1e-6);
        if(hits[0]>1e-6&&hits.length%2)errors.add(`${part.name} inside ${other.name}`);
      }
    }
  });
  assert.deepEqual([...errors],[]);
});
