import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {createW17} from './w17-geometry.ts';
import {createEngineMotion} from './w17-engine-core.ts';
import {createSurfaceSampler} from './w17-surface.ts';
import {visibleInCooling} from './w17-model-cache.ts';
const model=createW17(),get=n=>model.root.getObjectByName(n),drive=get('Oil pump transmission'),motion=createEngineMotion(model.root),owned=new Set(),gears=[];
drive.traverse(o=>{owned.add(o);if(o.userData.engineMotion==='accessoryGear')gears.push(o);});
model.root.updateMatrixWorld(true);

test('oil stages follow a fixed mechanical path from the main coolant shaft',()=>{
  const source=get('Coolant drive gear pump -1'),input=get('Oil drive gear 0'),output=get('Oil drive gear 2'),pump=get('Oil pump drive shaft assembly');
  assert.equal(input.position.y,source.position.y);assert.equal(input.position.z,source.position.z);
  assert.equal(output.position.y,pump.position.y);assert.ok(Math.abs(output.position.z-pump.position.z)<1e-9);
  assert.equal(output.userData.ratio,.6875);
  for(const i of[1,2]){const a=get(`Oil drive gear ${i-1}`),b=get(`Oil drive gear ${i}`);assert.ok(Math.abs(a.position.distanceTo(b.position)-a.userData.pitchRadius-b.userData.pitchRadius)<1e-9);}
  for(const angle of[0,.2,1.4,6.28]){motion(angle);assert.equal(input.rotation.x,source.rotation.x);assert.equal(pump.rotation.x,output.rotation.x);}
  motion(0);model.root.updateMatrixWorld(true);
  assert.ok(Math.abs(new T.Box3().setFromObject(get('Oil drive shaft 2')).min.x-new T.Box3().setFromObject(get('Oil pump 1 front journal')).max.x)<1e-7);
  assert.ok(visibleInCooling(output,'oil-pump'));assert.equal(visibleInCooling(output,'left-pump'),false);
});

test('oil transmission covers and modified engine bridge are closed solids',()=>{
  for(const name of['Oil drive case perimeter','Oil drive case rear cover','Oil drive case front cover','Front crankcase transmission bridge']){
    const mesh=get(name),p=mesh.geometry.attributes.position,ix=mesh.geometry.index,edges=new Map();let volume=0;
    for(let i=0;i<(ix?.count??p.count);i+=3){const v=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(p,ix?ix.getX(i+j):i+j));volume+=v[0].dot(v[1].clone().cross(v[2]))/6;const ids=v.map(p=>p.toArray().map(n=>Math.round(n*1e7)).join());if(new Set(ids).size<3)continue;for(let j=0;j<3;j++){const k=[ids[j],ids[(j+1)%3]].sort().join('/');edges.set(k,(edges.get(k)||0)+1);}}
    assert.ok(volume>0,name);assert.ok([...edges.values()].every(n=>n===2),`${name}: open edges`);
  }
});

test('oil pump transmission and cartridges stay above the actual floor',()=>{
  const floor=[];model.assemblies.get('floor').traverse(o=>{if(o.isMesh)floor.push(o);});const surface=createSurfaceSampler(floor,'y');
  for(const root of[drive,get('Dry-sump pump stages')])root.traverse(o=>{if(!o.isMesh)return;const p=o.geometry.attributes.position;for(let i=0;i<p.count;i+=3){const v=new T.Vector3().fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld),height=surface(v.x,v.z,1);if(height!==undefined)assert.ok(v.y-height>.002,`${o.name}: floor clearance ${v.y-height}`);}});
});
test('oil drive gears remain clear during a complete engagement',()=>{
  const profiles=new Map(),points=new Map();
  for(const gear of gears){
    const mesh=get(`${gear.name} teeth`),g=mesh.geometry.clone();g.rotateZ(Math.PI/2);
    const projection=new T.Mesh(g);projection.updateMatrixWorld(true);profiles.set(gear,createSurfaceSampler([projection],'y'));
    const p=mesh.geometry.attributes.position,unique=new Map();for(let i=0;i<p.count;i++)unique.set([p.getY(i),p.getZ(i)].map(v=>Math.round(v*1e8)).join(),new T.Vector3(0,p.getY(i),p.getZ(i)));points.set(gear,[...unique.values()]);g.dispose();
  }
  for(let step=0;step<=48;step++){
    motion(step/48*Math.PI*2/12);model.root.updateMatrixWorld(true);
    for(const a of gears)for(const b of gears){
      if(a===b||a.position.distanceTo(b.position)>a.userData.pitchRadius+b.userData.pitchRadius+.004)continue;
      const transform=a.matrixWorld.clone().invert().multiply(b.matrixWorld),sample=profiles.get(a);
      for(const vertex of points.get(b)){const p=vertex.clone().applyMatrix4(transform);assert.equal(sample(-p.y,p.z,1),undefined,`${a.name}/${b.name}: crossed teeth`);}
    }
  }
  motion(0);model.root.updateMatrixWorld(true);
});

const triangles=o=>{
  const p=o.geometry.attributes.position,ix=o.geometry.index,out=[];
  for(let i=0;i<(ix?.count??p.count);i+=3){const vs=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(p,ix?ix.getX(i+j):i+j).applyMatrix4(o.matrixWorld));out.push({triangle:new T.Triangle(...vs),bounds:new T.Box3().setFromPoints(vs),name:o.name});}return out;
};

test('the oil drive clears adjacent housings, pipes and mounting surfaces',()=>{
  motion(0);model.root.updateMatrixWorld(true);const bounds=new T.Box3().setFromObject(drive),neighbors=[];
  model.root.traverse(o=>{if(o.isMesh&&!o.isInstancedMesh&&!owned.has(o)&&new T.Box3().setFromObject(o).intersectsBox(bounds))neighbors.push(o);});
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
});

test('the auxiliary cassette is retained by the existing coolant-case bolts and seated spacers',()=>{
  const rear=new T.Box3().setFromObject(get('Oil drive case rear cover'));
  for(const i of[5,6]){
    const spacer=new T.Box3().setFromObject(get(`Oil drive mount spacer ${i}`)),head=new T.Box3().setFromObject(get(`Coolant drive case screw head ${i}`)),bolt=new T.Box3().setFromObject(get(`Coolant drive case screw ${i}`));
    assert.ok(Math.abs(spacer.max.x-rear.min.x)<1e-7);
    assert.ok(Math.abs(head.min.x-rear.max.x)<1e-7);
    assert.ok(bolt.min.x<spacer.min.x&&bolt.max.x>rear.max.x);
  }
});

test('tank-feed passages open only the left-side internal panels',()=>{
  for(const [name,x,y,lo,hi]of[['Lower side enclosure -1',-.160,.183,.17,.26],['Lower chassis enclosure',-.160,.183,.18,.28]]){
    const part=get(name),probe=new T.Mesh(part.geometry,new T.MeshBasicMaterial({side:T.DoubleSide}));probe.matrixWorld.copy(part.matrixWorld);
    assert.equal(new T.Raycaster(new T.Vector3(x,y,-lo),new T.Vector3(0,0,-1),0,hi-lo).intersectObject(probe,false).length,0,name);
    if(name==='Lower chassis enclosure')assert.ok(new T.Raycaster(new T.Vector3(x,y,lo),new T.Vector3(0,0,1),0,hi-lo).intersectObject(probe,false).length);
    probe.material.dispose();
  }
});
