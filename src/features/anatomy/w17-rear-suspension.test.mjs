import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { createW17 } from "./w17-geometry.ts";
import { createSurfaceSampler } from "./w17-surface.ts";

const model=createW17();model.root.updateMatrixWorld(true);
const get=name=>model.root.getObjectByName(name),casing=get("Carbon gearbox casing");
const roof=createSurfaceSampler([casing],"y"),vector=p=>new T.Vector3(...p);

test("both rear rocker and damper feet seat across their complete gearbox footprint",()=>{
  for(const side of[-1,1])for(const name of["rocker","damper"]){
    const prefix=`Rear ${side} ${name} chassis bracket`,foot=get(`${prefix} foot`),p=foot.geometry.attributes.position;
    const columns=new Map();
    for(let i=0;i<p.count;i++){
      const v=new T.Vector3().fromBufferAttribute(p,i).applyMatrix4(foot.matrixWorld),key=`${v.x.toFixed(6)}/${v.z.toFixed(6)}`;
      const ys=columns.get(key)??[];ys.push(v.y);columns.set(key,ys);
      assert.ok(roof(v.x,v.z,1)!==undefined,`${prefix}: foot overhangs the casing`);
    }
    for(const [key,ys]of columns){
      const [x,z]=key.split("/").map(Number),y=roof(x,z,1);
      assert.ok(Math.min(...ys)<y-.0005&&Math.max(...ys)>y+.002,`${prefix}: foot not seated at ${key}`);
    }
    for(const dx of[-.019,.019]){
      const bolt=get(`${prefix} fixing ${dx}`),b=new T.Box3().setFromObject(bolt),c=b.getCenter(new T.Vector3());
      const seat=roof(c.x,c.z,1);
      assert.ok(b.min.y<seat-.004&&b.max.y>seat+.003,`${prefix}: bolt misses the casing`);
    }
  }
});

test("rear damper and spring surfaces stay above the differential casing",()=>{
  for(const side of[-1,1]){
    const group=get(`Rear ${side} inboard suspension`);
    for(const part of group.children.filter(p=>/ (spring|damper (piston|gland|cylinder|end cap|rear neck|fixed eye))/.test(p.name)&&!p.name.includes("bracket"))){
      const p=part.geometry.attributes.position;
      for(let i=0;i<p.count;i++){
        const v=new T.Vector3().fromBufferAttribute(p,i).applyMatrix4(part.matrixWorld),y=roof(v.x,v.z,1);
        if(y!==undefined)assert.ok(v.y>y+.002,`${part.name}: intersects gearbox at ${v.toArray()}`);
      }
    }
  }
});

test("rear rockers have useful leverage and wheel bump compresses their dampers",()=>{
  for(const side of[-1,1]){
    const j=get(`Rear ${side} inboard suspension`).userData.joints;
    const pivot=vector(j.pivot),a=vector(j.pushrod),b=vector(j.movingEye),fixed=vector(j.fixedEye);
    const wheel=vector(get(`Rear ${side} pushrod`).userData.terminal),axis=new T.Vector3(0,0,1);
    const r=a.clone().sub(pivot),s=b.clone().sub(pivot),input=a.clone().sub(wheel).normalize(),output=fixed.clone().sub(b).normalize();
    const inputLever=axis.clone().cross(r).dot(input),outputLever=axis.clone().cross(s).dot(output);
    assert.ok(Math.abs(inputLever)>.015,"pushrod is nearly aligned with the rocker pivot");
    assert.ok(Math.abs(outputLever)>.025,"damper has nearly no leverage on the rocker");
    assert.ok(input.y*outputLever/inputLever>0,"wheel bump extends rather than compresses the spring");
  }
});

test("the load-bearing gearbox remains under the suspension when the body is removed",()=>{
  assert.equal(casing.userData.structural,true,"cutaway removes the suspension's structural support");
  assert.equal(casing.userData.cover,true,"gearbox inspection must still open the casing");
});

test("installed rear inboard parts do not cut through exhaust, bodywork or neighbouring mechanisms",()=>{
  const inboard=[-1,1].flatMap(side=>get(`Rear ${side} inboard suspension`).children);
  const region=new T.Box3();inboard.forEach(p=>region.expandByObject(p));
  const material=new T.MeshBasicMaterial({side:T.DoubleSide}),obstacles=[];
  model.root.traverse(part=>{
    if(!part.isMesh||part.isInstancedMesh||inboard.includes(part)||/^Rear [-1]+ pushrod(?: inner joint)?$/.test(part.name))return;
    const bounds=new T.Box3().setFromObject(part);if(!region.intersectsBox(bounds))return;
    // Crop only the collision probe to this bay. Raycasting the complete
    // laminated body for every small fastener edge is unnecessarily costly.
    const p=part.geometry.attributes.position,index=part.geometry.index,positions=[];
    const vertices=[new T.Vector3(),new T.Vector3(),new T.Vector3()],triangleBounds=new T.Box3();
    for(let i=0;i<(index?.count??p.count);i+=3){
      triangleBounds.makeEmpty();
      vertices.forEach((v,j)=>{v.fromBufferAttribute(p,index?index.getX(i+j):i+j).applyMatrix4(part.matrixWorld);triangleBounds.expandByPoint(v);});
      if(triangleBounds.intersectsBox(region))vertices.forEach(v=>positions.push(v.x,v.y,v.z));
    }
    if(!positions.length)return;
    const geometry=new T.BufferGeometry();geometry.setAttribute("position",new T.Float32BufferAttribute(positions,3));
    const probe=new T.Mesh(geometry,material);
    obstacles.push({part,probe,bounds});
  });
  const errors=new Set(),ray=new T.Raycaster(),a=new T.Vector3(),b=new T.Vector3();
  for(const part of inboard){
    const bounds=new T.Box3().setFromObject(part),candidates=obstacles.filter(o=>o.bounds.intersectsBox(bounds)&&!(o.part===casing&&/chassis bracket (foot|fixing)/.test(part.name)));
    if(!candidates.length)continue;
    const p=part.geometry.attributes.position,index=part.geometry.index,edges=new Set();
    for(let i=0;i<(index?.count??p.count);i+=3)for(let j=0;j<3;j++){
      const u=index?index.getX(i+j):i+j,v=index?index.getX(i+(j+1)%3):i+(j+1)%3,key=u<v?`${u}/${v}`:`${v}/${u}`;
      if(edges.has(key))continue;edges.add(key);
      a.fromBufferAttribute(p,u).applyMatrix4(part.matrixWorld);b.fromBufferAttribute(p,v).applyMatrix4(part.matrixWorld);
      const length=a.distanceTo(b);if(length<.000002)continue;
      ray.set(a,b.clone().sub(a).normalize());ray.near=.000001;ray.far=length-.000001;
      for(const o of candidates)if(ray.intersectObject(o.probe,false).length)errors.add(`${part.name} / ${o.part.name}`);
    }
  }
  obstacles.forEach(o=>o.probe.geometry.dispose());material.dispose();assert.deepEqual([...errors],[]);
});
