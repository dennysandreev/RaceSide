import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { createW17 } from "./w17-geometry.ts";
import { createModelInstance, visibleInCockpit } from "./w17-model-cache.ts";
import { createSurfaceSampler, createHeightSampler } from "./w17-surface.ts";

const model=createW17();model.root.updateMatrixWorld(true);
const part=name=>model.root.getObjectByName(name), bounds=o=>new T.Box3().setFromObject(o);

test("seat is a closed laminate with open harness passages",()=>{
  const seat=part("Sculpted carbon seat"),g=seat.geometry,p=g.attributes.position,ix=g.index,edges=new Map();
  for(let i=0;i<ix.count;i+=3){
    for(const [a,b]of[[0,1],[1,2],[2,0]]){const x=ix.getX(i+a),y=ix.getX(i+b),key=x<y?`${x}/${y}`:`${y}/${x}`;edges.set(key,(edges.get(key)??0)+1);}
  }
  assert.ok([...edges.values()].every(n=>n===2),"open seat edge or harness slot wall");
  for(let i=0;i<p.count;i++)assert.ok(Number.isFinite(p.getX(i)+p.getY(i)+p.getZ(i)));
  for(const [x,z]of[[-.03,.078],[-.03,-.078],[.428,.025],[.428,-.025]]){
    assert.equal(new T.Raycaster(new T.Vector3(x,.7,z),new T.Vector3(0,-1,0),0,1).intersectObject(seat).length,0,"webbing passage is blocked by carbon");
  }
  assert.ok(new T.Raycaster(new T.Vector3(.35,.5,0),new T.Vector3(0,-1,0),0,1).intersectObject(seat).length>0,"seat pan missing");
});

test("all six harness straps reach an anchor and the common release buckle",()=>{
  const seatHeight=createHeightSampler(part("Sculpted carbon seat").geometry);
  const straps=[];model.assemblies.get("cockpit").traverse(o=>{if(o.userData.harness)straps.push(o);});
  assert.equal(straps.length,6);
  for(const strap of straps){
    const [kind,,side]=strap.name.split(" "),route=strap.userData.route;
    assert.ok(bounds(part(`${kind} harness anchor ${side}`)).expandByScalar(.001).containsPoint(new T.Vector3(...route[0])),`${strap.name}: detached anchor`);
    assert.ok(bounds(part("Harness buckle")).containsPoint(new T.Vector3(...route.at(-1))),`${strap.name}: detached tongue`);
    const p=strap.geometry.attributes.position;
    for(let i=0;i<p.count;i++){
      const x=p.getX(i),z=p.getZ(i);if(kind==="Shoulder"&&x<-.010||kind==="Sub"&&x>.405)continue;
      const y=seatHeight(x,z);if(y!==undefined)assert.ok(p.getY(i)>y+.003,`${strap.name}: webbing enters the seat`);
    }
  }
});

test("pedal pivots and master-cylinder brackets are supported by a frame seated on the tub",()=>{
  const cell=part("Forward survival cell deck");
  for(const x of[.91,1.24])for(const z of[-.116,.116]){
    const mount=part(`Pedal chassis mount ${x}/${z}`),b=bounds(mount),p=new T.Vector3(...mount.userData.seat);
    const hit=new T.Raycaster(p.clone().add(new T.Vector3(0,-.01,0)),new T.Vector3(0,1,0),0,.02).intersectObject(cell)[0];
    assert.ok(hit&&b.containsPoint(hit.point),"mount misses the lower chassis laminate");
    assert.ok(b.intersectsBox(bounds(part(`Pedal mounting rail ${z}`))));
  }
  for(const name of["Brake","Throttle"])for(const s of[-1,1]){
    assert.ok(bounds(part(`${name} pedal bearing pedestal ${s}`)).intersectsBox(bounds(part("Pedal crossmember 1.02"))),"floating pivot pedestal");
    assert.ok(bounds(part(`${name} pedal pivot bearing ${s}`)).intersectsBox(bounds(part(`${name} pedal pivot`))));
  }
  for(const s of[-1,1]){
    assert.ok(bounds(part(`Brake master mounting flange ${s}`)).intersectsBox(bounds(part("Pedal crossmember 1.13"))),"floating master cylinder");
    assert.ok(bounds(part(`Brake master pushrod ${s}`)).intersectsBox(bounds(part("Brake balance bar"))));
    assert.ok(bounds(part(`Brake master pushrod ${s}`)).intersectsBox(bounds(part(`Brake master cylinder ${s}`))));
  }
});

test("pedal hardware stays inside the hollow forward survival cell",()=>{
  const skin=createSurfaceSampler([part("Forward survival cell deck")],"y"),errors=[];
  const equipment=part("Cockpit equipment");
  equipment.traverse(o=>{
    if(!o.isMesh||!/^Brake|^Throttle|^Pedal/.test(o.name)||/chassis mount/.test(o.name))return;
    const p=o.geometry.attributes.position;
    for(let i=0;i<p.count;i++){
      const v=new T.Vector3().fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld);if(v.x<.90)continue;
      const low=skin(v.x,v.z,-1),high=skin(v.x,v.z,1);
      if(low===undefined||high===undefined||v.y<low+.001||v.y>high-.001){errors.push(o.name);break;}
    }
  });
  assert.deepEqual(errors,[]);
});

test("cockpit and steering previews share the installed wheel without duplicating the full-car geometry",()=>{
  const cockpit=createModelInstance("cockpit"),steering=createModelInstance("steering"),car=createModelInstance();
  assert.deepEqual([...cockpit.assemblies.keys()],["cockpit"]);
  assert.equal(cockpit.root.getObjectByName("Steering rack"),undefined,"rack makes the cockpit preview unnecessarily wide");
  for(const name of["Steering wheel carbon face","Steering display","Wheel display neutral indication","Gearshift paddle -1","Clutch paddle 1","Quick release boss"]){
    const a=cockpit.root.getObjectByName(name),b=steering.root.getObjectByName(name),c=car.root.getObjectByName(name);
    assert.ok(a&&b&&c,name);assert.equal(a.geometry,c.geometry);assert.equal(b.geometry,c.geometry);assert.notEqual(a.material,c.material);
    assert.ok(a.position.equals(c.position),"preview moved an installed control");
  }
  let count=0;car.root.traverse(o=>{if(o.name==="Complete steering wheel")count++;});assert.equal(count,1);
  for(const name of["Cockpit inner lining -1","Cockpit inner lining 1","Cockpit padded rim"])assert.equal(part(name).userData.serviceCover,true);
  assert.notEqual(part("Sculpted carbon seat").userData.serviceCover,true);
});

test("cockpit close-ups keep each complete assembly and exclude the other controls",()=>{
  const preview=createModelInstance("cockpit"), meshes=[];
  preview.root.traverse(o=>{if(o.isMesh)meshes.push(o);});
  for(const mesh of meshes){
    assert.equal(["seat","wheel","pedals"].filter(focus=>visibleInCockpit(mesh,focus)).length,1,`${mesh.name}: ambiguous close-up`);
    assert.ok(visibleInCockpit(mesh,"all"));
  }
  for(const [focus,names]of Object.entries({
    seat:["Sculpted carbon seat","Harness buckle","Shoulder harness -1","Rear headrest cushion"],
    wheel:["Steering display","Gearshift paddle -1","Quick release locking collar","Rotary selector BB"],
    pedals:["Brake pedal face","Throttle position sensor","Pedal chassis mount 0.91/-0.116","Brake master cylinder -1"],
  }))for(const name of names)assert.ok(visibleInCockpit(preview.root.getObjectByName(name),focus),name);
});

test("pedal tread does not fill the face perforations",()=>{
  for(const [name,z,width]of[["Brake",-.060,.075],["Throttle",.065,.050]]){
    const surfaces=[part(`${name} pedal face`),...[-.035,-.012,.012,.035].map(h=>part(`${name} pedal tread ${h}`))];
    const direction=new T.Vector3(1,0,0).applyAxisAngle(new T.Vector3(0,0,1),.18);
    for(const h of[-.025,0,.025])for(const w of[-width*.25,width*.25]){
      const origin=new T.Vector3(-.020,h,w).applyAxisAngle(new T.Vector3(0,0,1),.18).add(new T.Vector3(.974,.392,z));
      assert.equal(new T.Raycaster(origin,direction,0,.04).intersectObjects(surfaces).length,0,`${name}: blocked pedal hole`);
    }
    for(const surface of surfaces.slice(1))assert.ok(bounds(surface).intersectsBox(bounds(surfaces[0])),`${name}: floating tread`);
  }
});
