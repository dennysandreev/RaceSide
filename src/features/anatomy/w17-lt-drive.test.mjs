import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {createW17} from './w17-geometry.ts';
import {createEngineMotion} from './w17-engine-core.ts';
import {createSurfaceSampler} from './w17-surface.ts';
import {visibleInCooling} from './w17-model-cache.ts';

const model=createW17(),get=name=>model.root.getObjectByName(name),drive=get('LT coolant pump geared drive'),motion=createEngineMotion(model.root);
model.root.updateMatrixWorld(true);
const gears=['cam','pump'].map(name=>get(`LT drive ${name} rotor`));

test('the LT pump has a continuous supported drive from its actual camshaft',()=>{
  const cam=get('Camshaft 1 intake'),shaft=get('Camshaft 1 intake shaft'),pump=get('Low-temperature coolant pump');
  const input=gears[0].getWorldPosition(new T.Vector3()),output=gears[1].getWorldPosition(new T.Vector3());
  for(const [a,b]of[[input,cam.getWorldPosition(new T.Vector3())],[output,pump.getWorldPosition(new T.Vector3())]])assert.ok(Math.hypot(a.y-b.y,a.z-b.z)<1e-9);
  assert.ok(Math.abs(input.distanceTo(output)-gears[0].userData.pitchRadius-gears[1].userData.pitchRadius)<1e-9);
  for(const [a,b]of[[shaft,get('LT drive cam rear journal')],[get('LT drive pump front journal'),get('LT coolant pump shaft')]]){
    const aa=new T.Box3().setFromObject(a),bb=new T.Box3().setFromObject(b);
    assert.ok(Math.abs(aa.max.x-bb.min.x)<1e-7||Math.abs(aa.min.x-bb.max.x)<1e-7,'detached drive shaft end');
  }
  const moving=get('LT pump rotating assembly');assert.equal(moving.children.filter(p=>p.name.includes('impeller blade')).length,8);
  for(const angle of[0,.8,Math.PI*2]){
    motion(angle);model.root.updateMatrixWorld(true);
    const a=new T.Vector3(0,1,0).transformDirection(cam.matrixWorld),b=new T.Vector3(0,1,0).transformDirection(gears[0].matrixWorld);
    assert.ok(a.distanceTo(b)<1e-9,'take-off loses the camshaft phase');
    assert.equal(moving.rotation.x,gears[1].rotation.x,'impeller spins independently of the output pinion');
    assert.equal(gears[0].userData.ratio,-gears[1].userData.ratio);
  }
  motion(0);model.root.updateMatrixWorld(true);
});

test('LT drive teeth mesh without interpenetration over a complete tooth engagement',()=>{
  const profiles=new Map(),points=new Map();
  for(const [i,gear]of gears.entries()){
    const mesh=get(`LT drive ${i?'pump':'cam'} gear`),g=mesh.geometry.clone();g.rotateZ(Math.PI/2);
    const projection=new T.Mesh(g);projection.updateMatrixWorld(true);profiles.set(gear,createSurfaceSampler([projection],'y'));
    const p=mesh.geometry.attributes.position,unique=new Map();
    for(let j=0;j<p.count;j++)unique.set([p.getY(j),p.getZ(j)].map(v=>Math.round(v*1e8)).join(),new T.Vector3(0,p.getY(j),p.getZ(j)));
    points.set(gear,[...unique.values()]);g.dispose();
  }
  for(let step=0;step<=48;step++){
    motion(step/48*Math.PI*4/drive.userData.teeth);model.root.updateMatrixWorld(true);
    for(const a of gears)for(const b of gears){
      if(a===b)continue;const transform=a.matrixWorld.clone().invert().multiply(b.matrixWorld),sample=profiles.get(a);
      for(const vertex of points.get(b)){const p=vertex.clone().applyMatrix4(transform);assert.equal(sample(-p.y,p.z,1),undefined,`teeth cross at ${step}/48`);}
    }
  }
  motion(0);model.root.updateMatrixWorld(true);
});

test('the LT drive has closed case walls, retained bearings and actual mounting bores',()=>{
  for(const name of['case perimeter','case front cover','case rear cover','cam bearing carrier']){
    const o=get(`LT drive ${name}`),p=o.geometry.attributes.position,ix=o.geometry.index,edges=new Map();
    const key=i=>[p.getX(i),p.getY(i),p.getZ(i)].map(v=>Math.round(v*1e7)).join();let volume=0;
    for(let i=0;i<(ix?.count??p.count);i+=3){
      const ids=[0,1,2].map(j=>ix?ix.getX(i+j):i+j),v=ids.map(key);if(new Set(v).size<3)continue;
      const [a,b,c]=ids.map(i=>new T.Vector3().fromBufferAttribute(p,i));volume+=a.dot(b.cross(c))/6;
      for(let j=0;j<3;j++){const k=[v[j],v[(j+1)%3]].sort().join('/');edges.set(k,(edges.get(k)||0)+1);}
    }
    assert.ok(volume>0,`${name}: inverted wall`);assert.ok([...edges.values()].every(n=>n===2),`${name}: unclosed wall`);
  }
  for(const sign of[-1,1]){
    const ear=get(`LT drive head mounting ear ${sign}`),b=new T.Box3().setFromObject(ear),p=b.getCenter(new T.Vector3()),head=get('Head end wall 1 front');
    const probe=new T.Mesh(head.geometry,new T.MeshBasicMaterial({side:T.DoubleSide}));probe.matrixWorld.copy(head.matrixWorld);
    assert.equal(new T.Raycaster(new T.Vector3(b.max.x,p.y,p.z),new T.Vector3(-1,0,0),0,.03).intersectObject(probe,false).length,0,'bolt enters solid head wall');
    const hit=new T.Raycaster(new T.Vector3(b.max.x,p.y+.003,p.z),new T.Vector3(-1,0,0),0,.03).intersectObject(probe,false)[0];
    assert.ok(hit&&Math.abs(hit.point.x-b.min.x)<1e-6,'mounting foot misses the head');probe.material.dispose();
  }
  const box=part=>new T.Box3().setFromObject(part),touch=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,'bearing has an axial retention gap');
  for(const kind of['cam','pump'])for(const [side,x]of[['rear',-.357],['front',-.343]]){
    const inner=get(`LT drive ${kind} bearing inner ${x}`),outer=get(`LT drive ${kind} bearing outer ${x}`);
    assert.equal(inner.parent,get(`LT drive ${kind} rotor`),'inner race must turn with its shaft');
    assert.equal(outer.parent,drive,'outer race must stay seated in the case');
    const race=box(inner),shoulder=box(get(`LT drive ${kind} ${side} shoulder`)),retainer=box(get(`LT drive ${kind} ${side} retainer`));
    touch(side==='rear'?race.max.x:race.min.x,side==='rear'?shoulder.min.x:shoulder.max.x);
    touch(side==='rear'?race.min.x:race.max.x,side==='rear'?retainer.max.x:retainer.min.x);
  }
  drive.traverse(p=>{if(p.isMesh){assert.ok(visibleInCooling(p,'lt-pump'));assert.equal(visibleInCooling(p,'left-pump'),false);}});
});

test('moving tooth tips remain inside the hollow drive case with radial clearance',()=>{
  const wall=get('LT drive case perimeter'),probe=new T.Mesh(wall.geometry,new T.MeshBasicMaterial({side:T.DoubleSide}));probe.matrixWorld.copy(wall.matrixWorld);
  const ray=new T.Raycaster(),tips=gears.map((gear,i)=>{
    const p=get(`LT drive ${i?'pump':'cam'} gear`).geometry.attributes.position,unique=new Map();
    for(let j=0;j<p.count;j++)if(Math.hypot(p.getY(j),p.getZ(j))>gear.userData.pitchRadius){
      const v=new T.Vector3(0,p.getY(j),p.getZ(j));unique.set(v.toArray().map(v=>Math.round(v*1e7)).join(),v);
    }
    return [...unique.values()];
  });
  try{
    for(let step=0;step<12;step++){
      motion(step/12*Math.PI*4/drive.userData.teeth);model.root.updateMatrixWorld(true);
      gears.forEach((gear,i)=>{const centre=gear.getWorldPosition(new T.Vector3());for(const tip of tips[i]){
        const p=tip.clone().applyMatrix4(gear.matrixWorld);ray.set(p,p.clone().sub(centre).normalize());ray.far=.2;
        const hit=ray.intersectObject(probe,false)[0];assert.ok(hit&&hit.distance>.0018,'tooth touches or escapes the casting');
      }});
    }
  }finally{probe.material.dispose();motion(0);model.root.updateMatrixWorld(true);}
});

const triangles=o=>{
  const p=o.geometry.attributes.position,ix=o.geometry.index,out=[];
  for(let i=0;i<(ix?.count??p.count);i+=3){const vs=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(p,ix?ix.getX(i+j):i+j).applyMatrix4(o.matrixWorld));out.push({triangle:new T.Triangle(...vs),bounds:new T.Box3().setFromPoints(vs),name:o.name});}return out;
};

test('the installed LT drive clears neighboring surfaces without moving the pump or its hoses',()=>{
  motion(0);model.root.updateMatrixWorld(true);const bounds=new T.Box3().setFromObject(drive),neighbors=[];
  model.root.traverse(o=>{if(o.isMesh&&!o.isInstancedMesh&&!o.userData.pumpDrive&&new T.Box3().setFromObject(o).intersectsBox(bounds))neighbors.push(o);});
  const cells=box=>{const a=box.min.clone().divideScalar(.015).floor(),b=box.max.clone().divideScalar(.015).floor(),keys=[];for(let x=a.x;x<=b.x;x++)for(let y=a.y;y<=b.y;y++)for(let z=a.z;z<=b.z;z++)keys.push(`${x},${y},${z}`);return keys;};
  const bins=new Map();
  for(const o of neighbors)for(const t of triangles(o)){
    if(!t.bounds.intersectsBox(bounds))continue;for(const k of cells(t.bounds)){const entries=bins.get(k)||[];entries.push(t);bins.set(k,entries);}
  }
  const ray=new T.Ray(),point=new T.Vector3(),errors=new Set();
  const crosses=(a,b)=>{for(const [p,q]of[[a.a,a.b],[a.b,a.c],[a.c,a.a]]){const length=p.distanceTo(q);if(length<1e-9)continue;ray.set(p,q.clone().sub(p).normalize());if(ray.intersectTriangle(b.a,b.b,b.c,false,point)&&point.distanceTo(p)>1e-7&&point.distanceTo(p)<length-1e-7)return true;}return false;};
  drive.traverse(o=>{
    if(!o.isMesh)return;
    for(const a of triangles(o))for(const b of new Set(cells(a.bounds).flatMap(k=>bins.get(k)||[]))){
      const key=`${o.name}/${b.name}`;if(errors.has(key)||!a.bounds.intersectsBox(b.bounds))continue;
      // Shared axial end faces are intentional seats, with Float32 rounding.
      if(Math.min(a.bounds.max.x,b.bounds.max.x)-Math.max(a.bounds.min.x,b.bounds.min.x)<1e-7)continue;
      if(crosses(a.triangle,b.triangle)||crosses(b.triangle,a.triangle))errors.add(key);
    }
  });
  assert.deepEqual([...errors],[]);
  assert.deepEqual(get('Low-temperature coolant pump').position.toArray(),[-.255,.383,.238]);
});
