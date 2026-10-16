import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { createW17, updateWingLinkages } from "./w17-geometry.ts";
import { createAirflowPaths, sampleAirflowPoint } from "./w17-airflow.ts";

const model=createW17(),initial=new Map();
model.root.traverse(part=>initial.set(part.uuid,{position:part.position.clone(),quaternion:part.quaternion.clone()}));
const paths=createAirflowPaths(model.root,model.linkages);

test("airflow construction preserves the assembled geometry and moving-wing state",()=>{
  model.root.traverse(part=>{
    assert.ok(part.position.equals(initial.get(part.uuid).position),part.name);
    assert.ok(part.quaternion.equals(initial.get(part.uuid).quaternion),part.name);
  });
});

test("flow routes cover the body, underfloor and both wings with finite forward-to-aft paths",()=>{
  for(const layer of ["body","floor","wings"])assert.ok(paths.some(path=>path.layer===layer));
  for(const end of ["front","rear"])assert.ok(paths.some(path=>path.id.startsWith(`${end}-wing`)));
  for(const path of paths)for(const points of [path.corner,path.straight]){
    assert.equal(points.length,path.corner.length);
    for(let i=0;i<points.length;i++){
      assert.ok(points[i].toArray().every(Number.isFinite));assert.ok(points[i].y>=.0149,"flow passes through the road");
      if(i&&path.layer!=="cooling")assert.ok(points[i].x<points[i-1].x,"air travels toward the nose");
    }
  }
  const wing=paths.find(path=>path.id==="rear-wing-1");
  assert.ok(wing.corner.at(-1).y>wing.straight.at(-1).y+.2,"wing modes do not change the illustrated deflection");
});

test("streamlines and their marker clearance avoid assembled surfaces throughout the wing transition",()=>{
  const surfaces=[],materials=new Map(),ray=new T.Raycaster(),a=new T.Vector3(),b=new T.Vector3(),direction=new T.Vector3();
  model.root.traverse(part=>{
    if(!part.isMesh||part.userData.internal)return;surfaces.push(part);
    if(!materials.has(part.material))materials.set(part.material,part.material.side);part.material.side=T.DoubleSide;
  });
  try{
    for(const fraction of [0,.25,.5,.75,1]){
      model.root.traverse(part=>{if(part.userData.flap)part.quaternion.setFromAxisAngle(part.userData.hingeAxis,T.MathUtils.lerp(part.userData.closedAngle,part.userData.openAngle,fraction));});updateWingLinkages(model.linkages);model.root.updateMatrixWorld(true);
      for(const path of paths.filter(p=>p.layer!=="cooling"))for(const [dy,dz] of [[0,0],[.008,0],[-.008,0],[0,.008],[0,-.008]])for(let i=0;i<120;i++){
        sampleAirflowPoint(path,i/120,fraction,a);sampleAirflowPoint(path,(i+1)/120,fraction,b);a.y+=dy;a.z+=dz;b.y+=dy;b.z+=dz;
        direction.subVectors(b,a);ray.set(a,direction.clone().normalize());ray.far=direction.length();
        const hit=ray.intersectObjects(surfaces,false)[0];assert.ok(!hit,`${path.id}, aero ${fraction}: ${hit?.object.name} at ${hit?.point.toArray()}`);
      }
    }
  }finally{
    for(const [material,side] of materials)material.side=side;
    model.root.traverse(part=>part.quaternion.copy(initial.get(part.uuid).quaternion));updateWingLinkages(model.linkages);model.root.updateMatrixWorld(true);
  }
});
