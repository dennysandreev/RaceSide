import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import {createW17} from "./w17-geometry.ts";
import {createModelInstance} from "./w17-model-cache.ts";

const model=createW17();model.root.updateMatrixWorld(true);
const system=model.root.getObjectByName("Complete fuel system");
const part=name=>model.root.getObjectByName(name);
const ports=system.userData.ports;
const vector=p=>new T.Vector3(...p);

test("the cell encloses supported pumps, the collector, filter and the complete flow meter",()=>{
  const skins=[part("Fuel bladder side -1"),part("Fuel bladder side 1")];
  const material=skins[0].material,old=material.side;material.side=T.DoubleSide;
  try{
    for(const name of["Fuel lift pump -1","Fuel lift pump 1","Fuel primer pump","Fuel collector base","Fuel flow meter","Fuel filter"]){
      const body=part(name);assert.ok(body,name);const p=body.geometry.attributes.position;
      for(let i=0;i<p.count;i+=5){
        const point=new T.Vector3().fromBufferAttribute(p,i).applyMatrix4(body.matrixWorld);
        for(const [index,sign]of[[-1,-1],[1,1]]){
          const hit=new T.Raycaster(point,new T.Vector3(0,0,sign)).intersectObject(skins[index<0?0:1],false)[0];
          assert.ok(hit&&hit.distance>.0003,`${name} leaves the bladder at ${point.toArray()}`);
        }
      }
    }
  }finally{material.side=old;}
  assert.ok(part("Fuel collector side 1").userData.serviceCover);
  assert.ok(part("Fuel bladder side 1").userData.serviceCover);
  const meter=new T.Box3().setFromObject(part("Fuel flow meter"));
  for(const support of system.children.filter(p=>p.name.startsWith("Fuel meter support")))assert.ok(new T.Box3().setFromObject(support).intersectsBox(meter),"meter floats above its supports");
});

test("the bladder and independent service plate have actual openings at the four fluid unions",()=>{
  for(const name of["feed","filler","sample","vent"]){
    const point=vector(ports[name]);point.x-=.015;
    const ray=new T.Raycaster(point,new T.Vector3(1,0,0),0,.032);
    assert.equal(ray.intersectObjects([part("Fuel bladder"),part("Fuel service plate")],false).length,0,`${name} union is blocked by a solid wall`);
  }
  assert.equal(system.children.filter(p=>p.name.startsWith("Fuel closure bolt")).length,12);
});

test("engine fuel lines terminate in the pump and rails without loose ends",()=>{
  for(const [name,from,to]of[
    ["Fuel low-pressure engine feed",ports.breakaway,ports.pumpIn],
    ["Fuel high-pressure first rail",ports.pumpOut,ports["rail-1"]],
    ["Fuel rail crossover",ports["rail-1"],ports.rail1],
  ]){
    const route=part(name).userData.route;
    assert.ok(vector(route[0]).distanceTo(vector(from))<1e-8,name);
    assert.ok(vector(route.at(-1)).distanceTo(vector(to))<1e-8,name);
    for(const endpoint of[from,to]){
      const hardware=[];system.traverse(o=>{if(o.isMesh&&!o.userData.route)hardware.push(o);});
      assert.ok(hardware.some(o=>new T.Box3().setFromObject(o).distanceToPoint(vector(endpoint))<.001),`${name} ends without a fitting`);
    }
  }
});

test("six injectors reach their rails through drilled cylinder head and cover wells",()=>{
  for(const side of[-1,1])for(let i=0;i<3;i++){
    const injector=part(`Direct injector ${side} ${i}`),axis=new T.Vector3(0,1,0).transformDirection(injector.matrixWorld);
    const tip=injector.getWorldPosition(new T.Vector3()),start=tip.clone().addScaledVector(axis,-.015);
    const surfaces=[part(`Cam cover ${side}`),part(`Cylinder head housing ${side}`),part(`Cylinder head ${side} ${i}`)];
    assert.equal(new T.Raycaster(start,axis,0,.150).intersectObjects(surfaces,false).length,0,"injector passes through an opaque cover");
    const top=tip.clone().addScaledVector(axis,injector.userData.injectorLength);
    assert.ok(new T.Box3().setFromObject(part(`Fuel rail ${side}`)).distanceToPoint(top)<.006,"injector is detached from rail");
    const cylinderAxis=new T.Vector3(0,Math.SQRT1_2,side*Math.SQRT1_2);
    assert.ok(Math.abs(axis.angleTo(cylinderAxis)*180/Math.PI-70)<.001,"injector angle leaves the cylinder lateral plane specification");
  }
});

const routes=system.children.filter(p=>p.userData.route);
const occupied=new T.Box3();for(const route of routes)occupied.expandByObject(route);
const obstacles=[];model.root.traverse(o=>{
  if(!o.isMesh||o.isInstancedMesh||o.userData.component==="fuel")return;
  const bounds=new T.Box3().setFromObject(o);if(!bounds.intersectsBox(occupied))return;
  const p=o.geometry.attributes.position,index=o.geometry.index,triangles=[];
  for(let i=0;i<(index?.count??p.count);i+=3){
    const vertices=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(p,index?index.getX(i+j):i+j).applyMatrix4(o.matrixWorld));
    const bounds=new T.Box3().setFromPoints(vertices);if(bounds.intersectsBox(occupied))triangles.push({triangle:new T.Triangle(...vertices),bounds});
  }
  obstacles.push({o,bounds,triangles});
});

test("every fuel route clears the actual surrounding structural, radiator and engine surfaces",()=>{
  const nearest=new T.Vector3(),errors=new Set();
  for(const route of routes){
    const curve=new T.CatmullRomCurve3(route.userData.route.map(vector),false,"centripetal"),radius=route.userData.outerRadius+.0003;
    for(const p of curve.getSpacedPoints(350))for(const obstacle of obstacles){
      if(obstacle.bounds.distanceToPoint(p)>radius)continue;
      if(obstacle.triangles.some(t=>t.bounds.distanceToPoint(p)<radius&&t.triangle.closestPointToPoint(p,nearest).distanceTo(p)<radius))errors.add(`${route.name} / ${obstacle.o.name}`);
    }
  }
  assert.deepEqual([...errors],[]);
});

test("fuel detail shares the installed bladder, pumps and injector geometry",()=>{
  const detail=createModelInstance("fuel"),installed=createModelInstance();
  for(const name of["Fuel bladder","Fuel flow meter","Fuel primer pump","Fuel high-pressure pump","Direct injector 1 0"]){
    assert.equal(detail.root.getObjectByName(name).geometry,installed.root.getObjectByName(name).geometry);
    assert.notEqual(detail.root.getObjectByName(name).material,installed.root.getObjectByName(name).material);
  }
});
