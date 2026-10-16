import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import {createW17} from "./w17-geometry.ts";
import {createModelInstance,visibleInCooling} from "./w17-model-cache.ts";

const model=createW17();model.root.updateMatrixWorld(true);
const get=name=>model.root.getObjectByName(name);

test("each main coolant pump contains an enclosed impeller with eight solid curved blades",()=>{
  for(const side of[-1,1]){
    const root=get(`Main coolant pump ${side}`),rotor=get(`Coolant pump ${side} impeller`),housing=get(`Coolant pump ${side}`);
    assert.ok(root&&rotor&&housing.userData.serviceCover);
    assert.ok(rotor.children.some(p=>p.name.endsWith("back shroud"))&&rotor.children.some(p=>p.name.endsWith("hub")));
    const blades=rotor.children.filter(p=>p.name.includes("impeller blade"));assert.equal(blades.length,8);
    for(const blade of blades){
      const p=blade.geometry.attributes.position,ix=blade.geometry.index,edges=new Map();let volume=0;
      const vertices=Array.from({length:p.count},(_,i)=>new T.Vector3().fromBufferAttribute(p,i));
      for(let i=0;i<ix.count;i+=3){
        const ids=[0,1,2].map(j=>ix.getX(i+j)),[a,b,c]=ids.map(j=>vertices[j]);
        volume+=a.dot(b.clone().cross(c))/6;
        for(const [a,b]of[[ids[0],ids[1]],[ids[1],ids[2]],[ids[2],ids[0]]]){const k=a<b?`${a}/${b}`:`${b}/${a}`;edges.set(k,(edges.get(k)??0)+1);}
      }
      assert.ok([...edges.values()].every(n=>n===2),`${blade.name}: open blade edges`);
      assert.ok(Math.abs(volume)>1e-8,`${blade.name}: zero-thickness blade`);
      for(const p of vertices){assert.ok(Math.hypot(p.x,p.z)<.025&&p.y>=.0334&&p.y<=.0416,"impeller crosses the chamber wall");}
    }
  }
});

test("pump shafts have two bearing rows and a separate wet-side face seal",()=>{
  for(const side of[-1,1]){
    const root=get(`Main coolant pump ${side}`),shaft=get(`Coolant pump ${side} shaft`);
    assert.ok(shaft.geometry.parameters.radiusTop===.0045);
    const balls=root.children.filter(p=>p.name.includes("bearing ball "));assert.equal(balls.length,20);
    for(const ball of balls)assert.ok(Math.abs(Math.hypot(ball.position.x,ball.position.z)-.007)<1e-9);
    const stationary=get(`Coolant pump ${side} stationary seal seat`),rotating=get(`Coolant pump ${side} rotating seal face`);
    stationary.geometry.computeBoundingBox();rotating.geometry.computeBoundingBox();
    assert.ok(Math.abs(stationary.geometry.boundingBox.max.y-rotating.geometry.boundingBox.min.y)<1e-8,"seal faces do not meet");
    assert.ok(rotating.geometry.boundingBox.max.y<.032,"seal intrudes into the impeller shroud");
    assert.ok(get(`Coolant pump ${side} seal spring`)&&get(`Coolant pump ${side} drive coupling`));
  }
});

test("pump mounting ears seat on the engine cover and bolts enter real holes",()=>{
  const cover=get("Engine timing end cover -0.296"),ray=new T.Raycaster();
  for(const side of[-1,1])for(let i=0;i<3;i++){
    const root=get(`Main coolant pump ${side}`),ear=get(`Coolant pump ${side} mounting ear ${i}`),bolt=get(`Coolant pump ${side} mounting bolt ${i}`);
    const centre=new T.Vector3(ear.position.x,0,ear.position.z).applyMatrix4(root.matrixWorld);
    ray.set(new T.Vector3(-.275,centre.y,centre.z),new T.Vector3(-1,0,0));ray.far=.025;
    assert.equal(ray.intersectObject(cover,false).length,0,"bolt enters an opaque end cover");
    ray.set(new T.Vector3(-.275,centre.y+.004,centre.z),new T.Vector3(-1,0,0));
    const contact=ray.intersectObject(cover,false)[0];assert.ok(contact,"mounting ear misses the engine casting");
    assert.ok(new T.Box3().setFromObject(ear).containsPoint(contact.point),"ear floats in front of its support");
    assert.ok(new T.Box3().setFromObject(ear).intersectsBox(new T.Box3().setFromObject(bolt)));
  }
});

test("pump discharge has an open volute port and a bored engine connection",()=>{
  const ray=new T.Raycaster(),cover=get("Engine timing end cover -0.296");
  for(const side of[-1,1]){
    const root=get(`Main coolant pump ${side}`),housing=get(`Coolant pump ${side}`),pipe=get(`Coolant pump ${side} discharge passage`);
    assert.equal(pipe.geometry.parameters.shapes.holes.length,1);
    const curve=pipe.geometry.parameters.options.extrudePath;
    for(let i=1;i<300;i++){
      const a=curve.getPoint((i-1)/300),b=curve.getPoint(i/300),c=curve.getPoint((i+1)/300);
      const ab=b.clone().sub(a),bc=c.clone().sub(b),ac=c.clone().sub(a),cross=ab.clone().cross(bc).length();
      if(cross>1e-15)assert.ok(ab.length()*bc.length()*ac.length()/(2*cross)>.0135,"discharge wall folds on its bend");
    }
    ray.set(new T.Vector3(-.010,.024,side*.023).applyMatrix4(root.matrixWorld),new T.Vector3(0,1,0));ray.far=.04;
    assert.equal(ray.intersectObject(housing,false).length,0,"closed casing blocks the discharge");
    const end=new T.Vector3(...root.userData.ports.outlet);
    ray.set(end.clone().add(new T.Vector3(.01,0,0)),new T.Vector3(-1,0,0));ray.far=.02;
    assert.equal(ray.intersectObject(cover,false).length,0,"closed engine cover blocks the water inlet");
    const bearing=get("MGU-K accessory transmission");
    if(side===1){ray.set(new T.Vector3(-.250,.190,.169),new T.Vector3(-1,0,0));ray.far=.045;assert.equal(ray.intersectObject(bearing,false).length,0,"pump shaft crosses the accessory casing");}
  }
});

test("pump discharge passages clear nearby fuel, cooling and structural parts",()=>{
  const closest=new T.Vector3(),errors=new Set();
  for(const side of[-1,1]){
    const root=get(`Main coolant pump ${side}`),pipe=get(`Coolant pump ${side} discharge passage`),curve=pipe.geometry.parameters.options.extrudePath;
    const points=curve.getSpacedPoints(250).map(p=>p.applyMatrix4(root.matrixWorld)),radius=.0095;
    const occupied=new T.Box3().setFromPoints(points).expandByScalar(radius);
    model.root.traverse(part=>{
      if(!part.isMesh||part.isInstancedMesh||part.userData.coolantPump===side)return;
      const b=new T.Box3().setFromObject(part);if(!b.intersectsBox(occupied))return;
      const candidates=points.filter(p=>b.distanceToPoint(p)<radius&&(!/Cast V6 crankcase|Engine timing end cover/.test(part.name)||p.x>-.272));
      const p=part.geometry.attributes.position,ix=part.geometry.index;
      for(let i=0;i<(ix?.count??p.count);i+=3){
        const vertices=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(p,ix?ix.getX(i+j):i+j).applyMatrix4(part.matrixWorld));
        const box=new T.Box3().setFromPoints(vertices),triangle=new T.Triangle(...vertices);
        if(candidates.some(v=>box.distanceToPoint(v)<radius&&triangle.closestPointToPoint(v,closest).distanceTo(v)<radius)){errors.add(`${pipe.name} / ${part.name}`);return;}
      }
    });
  }
  assert.deepEqual([...errors],[]);
});

test("cooling inspection shares the installed pumps and excludes unrelated hardware when focused",()=>{
  const isolated=createModelInstance("cooling");let count=0;
  isolated.root.traverse(part=>{
    if(!part.isMesh)return;
    if(typeof part.userData.coolantPump==="number"){
      count++;assert.ok(visibleInCooling(part,part.userData.coolantPump===1?"right-pump":"left-pump"));
      assert.equal(visibleInCooling(part,part.userData.coolantPump===1?"left-pump":"right-pump"),false);
    }else assert.equal(visibleInCooling(part,"left-pump"),part.userData.coolantPump==="main");
  });
  assert.ok(count>120,"pump internals missing from component view");
  assert.equal(isolated.root.getObjectByName("Coolant pump -1 impeller blade 0").geometry.getAttribute("position").count,get("Coolant pump -1 impeller blade 0").geometry.getAttribute("position").count);
});
