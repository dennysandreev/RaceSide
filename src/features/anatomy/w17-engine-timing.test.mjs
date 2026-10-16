import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import {createEngineCore,createEngineMotion} from "./w17-engine-core.ts";
import {createEngineHeads} from "./w17-engine-heads.ts";
import {createEngineTiming} from "./w17-engine-timing.ts";
import {createSurfaceSampler} from "./w17-surface.ts";

const materials=Object.fromEntries(["metal","cast","darkMetal","carbon","black","rubber"].map(k=>[k,new T.MeshStandardMaterial()]));
const core=createEngineCore(materials);core.add(createEngineHeads(materials));createEngineTiming(core,materials);
const motion=createEngineMotion(core),gears=[];core.traverse(p=>{if(p.userData.engineMotion==="timingGear")gears.push(p);});
const get=name=>core.getObjectByName(name);
motion(0);core.updateMatrixWorld(true);

test("all four camshafts have a continuous meshed drive from the crank with a 2:1 reduction",()=>{
  assert.equal(gears.length,11);
  for(const gear of gears){
    if(!gear.userData.mate){assert.equal(gear.name,"Timing gear crank");continue;}
    const parent=get(`Timing gear ${gear.userData.mate}`),a=gear.position,b=parent.position;
    assert.ok(parent,"disconnected timing gear");
    assert.ok(Math.abs(Math.hypot(a.y-b.y,a.z-b.z)-gear.userData.pitchRadius-parent.userData.pitchRadius)<1e-10,"pitch circles do not touch");
    const boxA=new T.Box3().setFromObject(get(`${gear.name} teeth`)),boxB=new T.Box3().setFromObject(get(`${parent.name} teeth`));
    assert.ok(Math.min(boxA.max.x,boxB.max.x)-Math.max(boxA.min.x,boxB.min.x)>.007,"mating tooth faces are in different planes");
    assert.ok(gear.userData.ratio*parent.userData.ratio<0,"mated gears turn in the same direction");
    const seen=new Set();let p=gear;
    while(p.userData.mate){assert.ok(!seen.has(p.name));seen.add(p.name);p=get(`Timing gear ${p.userData.mate}`);}
    assert.equal(p.name,"Timing gear crank");
  }
  for(const angle of[0,.7,Math.PI,Math.PI*4]){
    motion(angle);
    for(const side of[-1,1])for(const kind of["intake","exhaust"]){
      const cam=get(`Camshaft ${side} ${kind}`),gear=get(`Timing gear ${side} ${kind}`);
      assert.ok(Math.abs(gear.rotation.x-gear.userData.phase-cam.rotation.x)<1e-12);
      assert.ok(Math.abs(cam.rotation.x-angle/2)<1e-12);
    }
  }
  motion(0);core.updateMatrixWorld(true);
});

test("actual involute tooth meshes do not intersect through a complete tooth engagement",()=>{
  const profiles=new Map(),points=new Map();
  for(const gear of gears){
    const mesh=get(`${gear.name} teeth`),g=mesh.geometry.clone();g.rotateZ(Math.PI/2);
    const projection=new T.Mesh(g);projection.updateMatrixWorld(true);profiles.set(gear,createSurfaceSampler([projection],"y"));
    const p=mesh.geometry.attributes.position,unique=new Map();
    for(let i=0;i<p.count;i++)unique.set([p.getY(i),p.getZ(i)].map(v=>Math.round(v*1e8)).join(),new T.Vector3(0,p.getY(i),p.getZ(i)));
    points.set(gear,[...unique.values()]);g.dispose();
  }
  const pairs=[];
  for(let i=0;i<gears.length;i++)for(let j=i+1;j<gears.length;j++){
    const a=gears[i],b=gears[j],ba=new T.Box3().setFromObject(get(`${a.name} teeth`)),bb=new T.Box3().setFromObject(get(`${b.name} teeth`));
    if(Math.min(ba.max.x,bb.max.x)-Math.max(ba.min.x,bb.min.x)<1e-5)continue;
    if(Math.hypot(a.position.y-b.position.y,a.position.z-b.position.z)>a.userData.pitchRadius+b.userData.pitchRadius+.004)continue;
    pairs.push([a,b]);
  }
  assert.equal(pairs.length,10);
  const point=new T.Vector3();
  for(let step=0;step<=48;step++){
    motion(step/48*Math.PI*2/28);core.updateMatrixWorld(true);
    for(const pair of pairs)for(const [a,b]of[pair,pair.slice().reverse()]){
      const transform=a.matrixWorld.clone().invert().multiply(b.matrixWorld),sample=profiles.get(a);
      for(const vertex of points.get(b)){
        point.copy(vertex).applyMatrix4(transform);
        assert.equal(sample(-point.y,point.z,1),undefined,`${a.name}/${b.name}: interpenetrating teeth at ${step}/48`);
      }
    }
  }
  motion(0);core.updateMatrixWorld(true);
});

test("cam extensions have bored head walls and supported necks instead of detached gears",()=>{
  const ray=new T.Raycaster();
  for(const side of[-1,1])for(const kind of["intake","exhaust"]){
    const gear=get(`Timing gear ${side} ${kind}`),centre=gear.getWorldPosition(new T.Vector3()),wall=get(`Head end wall ${side} rear`),neck=get(`Camshaft ${side} ${kind} timing neck`);
    const extension=new T.Box3().setFromObject(get(`Camshaft ${side} ${kind} timing extension`)),shaft=new T.Box3().setFromObject(get(`Camshaft ${side} ${kind} shaft`));
    assert.ok(Math.abs(extension.max.x-shaft.min.x)<1e-6,"shaft stops short of camshaft");
    assert.ok(extension.min.x<centre.x-.005,"shaft stops short of gear hub");
    ray.set(new T.Vector3(-.793,centre.y,centre.z),new T.Vector3(1,0,0));ray.far=.050;
    assert.equal(ray.intersectObjects([wall,neck,get("Engine timing case front plate")],false).length,0,"solid wall across cam drive");
  }
});

test("timing walls and covers are closed solids around their service bores",()=>{
  for(const name of ["Engine timing case wall","Engine timing case front plate","Engine timing end cover -0.938"]){
    const mesh=get(name),p=mesh.geometry.attributes.position,index=mesh.geometry.index,edges=new Map();
    const vertex=i=>new T.Vector3().fromBufferAttribute(p,i).toArray().map(v=>Math.round(v*1e7)).join();
    for(let i=0;i<(index?.count??p.count);i+=3){
      const vertices=[0,1,2].map(j=>vertex(index?index.getX(i+j):i+j));
      for(let j=0;j<3;j++){
        const a=vertices[j],b=vertices[(j+1)%3];if(a===b)continue;
        const key=[a,b].sort().join("/"),edge=edges.get(key)??{count:0,winding:0};
        edge.count++;edge.winding+=a<b?1:-1;edges.set(key,edge);
      }
    }
    for(const [key,edge]of edges){assert.equal(edge.count,2,`${name}: unjoined edge ${key}`);assert.equal(edge.winding,0,`${name}: reversed face`);}
  }
});

test("rotating gear tips stay in the real hollow timing case",()=>{
  const wall=get("Engine timing case wall"),old=wall.material.side;wall.material.side=T.DoubleSide;
  const ray=new T.Raycaster(),origin=new T.Vector3();
  try{
    for(let step=0;step<12;step++){
      motion(step/12*Math.PI*2/28);core.updateMatrixWorld(true);
      for(const gear of gears){
        const mesh=get(`${gear.name} teeth`),p=mesh.geometry.attributes.position;
        for(let i=0;i<p.count;i+=13){
          origin.fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld);
          for(const axis of[new T.Vector3(0,1,0),new T.Vector3(0,0,Math.sign(origin.z)||1)]){
            ray.set(origin,axis);ray.far=1;
            const hit=ray.intersectObject(wall,false)[0];
            assert.ok(hit&&hit.distance>.002,`${gear.name} touches or escapes case wall`);
          }
        }
      }
    }
  }finally{wall.material.side=old;motion(0);core.updateMatrixWorld(true);}
});
