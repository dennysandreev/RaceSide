import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { createEngineCore,createEngineMotion,ENGINE_CORE,ENGINE_VALVETRAIN,enginePistonPose } from "./w17-engine-core.ts";
import { createEngineHeads } from "./w17-engine-heads.ts";

const mat=Object.fromEntries(["metal","cast","darkMetal","carbon","black","rubber"].map(n=>[n,new T.MeshStandardMaterial({side:T.DoubleSide})]));
const core=createEngineCore(mat);core.add(createEngineHeads(mat));const move=createEngineMotion(core);
const valves=[],cams=[];core.traverse(p=>{if(p.userData.engineMotion==="valve")valves.push(p);if(p.userData.engineMotion==="camshaft")cams.push(p);});
const get=name=>core.getObjectByName(name);

test("two cylinder heads contain 24 seated valves and four supported camshafts",()=>{
  assert.equal(valves.length,24);assert.equal(cams.length,4);
  for(const valve of valves){
    const {kind}=valve.userData,p=get(`${valve.name} head and stem`).geometry.attributes.position;
    let radius=0;for(let i=0;i<p.count;i++)radius=Math.max(radius,Math.hypot(p.getX(i),p.getZ(i)));
    assert.ok(Math.abs(radius*2-(kind==="intake"?.033:.028))<1e-7);
    assert.ok(get(`${valve.name} stem guide`));assert.ok(get(`${valve.name} pneumatic piston`));assert.ok(get(`${valve.name} pneumatic cap`));
  }
  for(const cam of cams){
    const {side,kind}=cam.userData;
    for(let i=0;i<4;i++)assert.ok(get(`Cam bearing ${side} ${kind}/${i}`));
  }
});

test("cam lobes retain contact with their buckets and valves clear the piston over a four-stroke cycle",()=>{
  for(let angle=0;angle<=Math.PI*4;angle+=Math.PI/36){
    move(angle);core.updateMatrixWorld(true);
    for(const valve of valves){
      const {side,cylinder,kind,axis}=valve.userData,pair=valve.name.endsWith("-1")?-1:1,lobe=get(`Cam lobe ${side} ${cylinder} ${kind} ${pair}`),bucket=get(`${valve.name} bucket`);
      const direction=new T.Vector3(...axis).transformDirection(valve.parent.matrixWorld),face=new T.Vector3(0,.083,0).applyMatrix4(valve.matrixWorld),lp=lobe.geometry.attributes.position;
      let nearest=Infinity;
      for(let j=0;j<lp.count;j++)nearest=Math.min(nearest,new T.Vector3().fromBufferAttribute(lp,j).applyMatrix4(lobe.matrixWorld).sub(face).dot(direction));
      assert.ok(Math.abs(nearest)<.00004,`${valve.name}: cam/bucket gap ${nearest}`);
      assert.ok(bucket.visible);
      const piston=enginePistonPose(side,cylinder,angle).crown;
      // In the common crank-centred bank frame, the crown plane is normal to Y.
      const crown=piston.dot(enginePistonPose(side,cylinder,angle).axis),vp=get(`${valve.name} head and stem`).geometry.attributes.position;
      valve.updateMatrix();for(let j=0;j<vp.count;j++){
        const v=new T.Vector3().fromBufferAttribute(vp,j).applyMatrix4(valve.matrix);
        if(Math.hypot(v.x-ENGINE_CORE.centreX-(cylinder-1)*ENGINE_CORE.pitch-side*ENGINE_CORE.bankStagger/2,v.z)<.040)assert.ok(v.y>crown+.0001,`${valve.name}: valve/piston collision`);
      }
    }
  }
  move(ENGINE_CORE.initialAngle);core.updateMatrixWorld(true);
});

test("valve guides and pneumatic chambers have actual stem bores",()=>{
  move(ENGINE_CORE.initialAngle);core.updateMatrixWorld(true);
  for(const valve of valves){
    const guide=get(`${valve.name} guide assembly`),axis=new T.Vector3(0,1,0).transformDirection(guide.matrixWorld),start=guide.localToWorld(new T.Vector3(0,.005,0));
    const ray=new T.Raycaster(start,axis,0,.070);
    const walls=["stem guide","pneumatic cylinder","pneumatic lower seal","pneumatic cap"].map(n=>get(`${valve.name} ${n}`));
    assert.equal(ray.intersectObjects(walls,false).length,0,`${valve.name}: blocked stem bore`);
    assert.ok(ENGINE_VALVETRAIN.stemDiameter>=.00495);
  }
});

test("chamber roofs and oval port adapters are closed solids with outward faces",()=>{
  const key=v=>v.toArray().map(x=>Math.round(x*1e7)).join(",");
  core.traverse(part=>{
    if(!part.isMesh||!/^Head (intake|exhaust) outlet|^Cylinder head [-1]|^Head port gallery roof/.test(part.name))return;
    const p=part.geometry.attributes.position,index=part.geometry.index,edges=new Map();let volume=0;
    for(let i=0;i<(index?.count??p.count);i+=3){
      const v=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(p,index?index.getX(i+j):i+j));
      volume+=v[0].dot(v[1].clone().cross(v[2]))/6;
      for(let j=0;j<3;j++){
        const a=key(v[j]),b=key(v[(j+1)%3]);if(a===b)continue;
        const id=[a,b].sort().join("/"),edge=edges.get(id)??[0,0];
        edge[0]++;edge[1]+=a<b?1:-1;edges.set(id,edge);
      }
    }
    assert.ok(volume>0,`${part.name}: inward-facing solid`);
    for(const edge of edges.values())assert.deepEqual(edge,[2,0],`${part.name}: open or reversed edge`);
  });
});
