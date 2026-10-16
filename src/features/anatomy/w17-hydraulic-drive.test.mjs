import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {createW17} from './w17-geometry.ts';
import {createEngineMotion} from './w17-engine-core.ts';
import {createSurfaceSampler} from './w17-surface.ts';
import {visibleInHydraulics} from './w17-model-cache.ts';

const model=createW17(),get=n=>model.root.getObjectByName(n),motion=createEngineMotion(model.root);
model.root.updateMatrixWorld(true);

test('the hydraulic pump has a continuous fixed-ratio drive from the intake camshaft',()=>{
  const input=get('Hydraulic drive input'),output=get('Hydraulic drive output');
  assert.ok(input&&output,'the pump quill ends inside the timing cover without a driving gear');
  assert.ok(visibleInHydraulics(output,'pump-drive'));
  assert.equal(visibleInHydraulics(get('Hydraulic reservoir wall'),'pump-drive'),false);
  const cam=get('Camshaft 1 intake'),extension=get('Camshaft 1 intake timing extension'),quill=get('Hydraulic pump drive quill');
  const centre=cam.getWorldPosition(new T.Vector3());
  assert.ok(Math.hypot(input.position.y-centre.y,input.position.z-centre.z)<1e-9);
  assert.ok(Math.abs(input.position.distanceTo(output.position)-input.userData.pitchRadius-output.userData.pitchRadius)<1e-9);
  assert.equal(input.userData.ratio,.5);assert.equal(output.userData.ratio,-.5);
  for(const angle of[0,.4,1.6,5.9]){motion(angle);assert.equal(input.rotation.x,cam.rotation.x);assert.equal(output.rotation.x,angle*output.userData.ratio+output.userData.phase);}
  motion(0);model.root.updateMatrixWorld(true);
  const bounds=o=>new T.Box3().setFromObject(o);
  assert.ok(Math.abs(bounds(get('Hydraulic drive cam extension')).max.x-bounds(extension).min.x)<1e-7);
  assert.ok(Math.abs(bounds(get('Hydraulic drive output rear journal')).min.x-bounds(quill).max.x)<1e-7);
});

const drive=get('Hydraulic pump mechanical drive'),gears=[get('Hydraulic drive input'),get('Hydraulic drive output')];
test('hydraulic drive gears stay engaged without interpenetration through a tooth cycle',()=>{
  const profiles=new Map(),points=new Map();
  for(const gear of gears){
    const mesh=get(`${gear.name} teeth`),g=mesh.geometry.clone();g.rotateZ(Math.PI/2);
    const projection=new T.Mesh(g);projection.updateMatrixWorld(true);profiles.set(gear,createSurfaceSampler([projection],'y'));
    const p=mesh.geometry.attributes.position,unique=new Map();for(let i=0;i<p.count;i++)unique.set([p.getY(i),p.getZ(i)].map(v=>Math.round(v*1e8)).join(),new T.Vector3(0,p.getY(i),p.getZ(i)));points.set(gear,[...unique.values()]);g.dispose();
  }
  for(let step=0;step<=48;step++){
    motion(step/48*Math.PI*4/30);model.root.updateMatrixWorld(true);
    for(const a of gears)for(const b of gears){if(a===b)continue;
      const transform=a.matrixWorld.clone().invert().multiply(b.matrixWorld),sample=profiles.get(a);
      for(const vertex of points.get(b)){const p=vertex.clone().applyMatrix4(transform);assert.equal(sample(-p.y,p.z,1),undefined,`${a.name}/${b.name}: crossed teeth`);}
    }
  }
  motion(0);model.root.updateMatrixWorld(true);
});

test('native timing cover, hydraulic cassette and bored pump flange are closed solids',()=>{
  for(const name of['Engine timing end cover -0.938','Hydraulic drive case perimeter','Hydraulic drive case rear plate','Hydraulic drive case front plate','Hydraulic pump mounting flange']){
    const mesh=get(name),p=mesh.geometry.attributes.position,ix=mesh.geometry.index,edges=new Map();let volume=0;
    for(let i=0;i<(ix?.count??p.count);i+=3){const v=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(p,ix?ix.getX(i+j):i+j));volume+=v[0].dot(v[1].clone().cross(v[2]))/6;const ids=v.map(p=>p.toArray().map(n=>Math.round(n*1e7)).join());if(new Set(ids).size<3)continue;for(let j=0;j<3;j++){const k=[ids[j],ids[(j+1)%3]].sort().join('/');edges.set(k,(edges.get(k)||0)+1);}}
    assert.ok(volume>0,name);assert.ok([...edges.values()].every(n=>n===2),`${name}: open edges`);
  }
});

test('pump flange, timing cover and cassette share real fixing and shaft bores',()=>{
  const cover=get('Engine timing end cover -0.938'),flange=get('Hydraulic pump mounting flange'),rear=get('Hydraulic drive case rear plate'),front=get('Hydraulic drive case front plate'),targets=[cover,flange,rear,front];
  const materials=new Map(targets.map(m=>[m.material,m.material.side]));for(const m of materials.keys())m.side=T.DoubleSide;
  try{
    for(const [y,z]of drive.userData.mounts){
      const ray=new T.Raycaster(new T.Vector3(-.941,y,z),new T.Vector3(1,0,0),0,.044);assert.equal(ray.intersectObjects([cover,rear,front],false).length,0,'blocked cassette mount');
    }
    for(let i=0;i<3;i++){const a=i*Math.PI*2/3,ray=new T.Raycaster(new T.Vector3(-.954,.335+Math.cos(a)*.025,.115+Math.sin(a)*.025),new T.Vector3(1,0,0),0,.024);assert.equal(ray.intersectObjects([cover,flange],false).length,0,'blocked pump fixing');}
    const centre=new T.Raycaster(new T.Vector3(-.952,.335,.115),new T.Vector3(1,0,0),0,.054);assert.equal(centre.intersectObjects(targets,false).length,0,'blocked driven shaft');
  }finally{for(const [m,s]of materials)m.side=s;}
  assert.ok(Math.abs(new T.Box3().setFromObject(flange).max.x-new T.Box3().setFromObject(cover).min.x)<1e-7);
});
const triangles=o=>{
  const p=o.geometry.attributes.position,ix=o.geometry.index,out=[];
  for(let i=0;i<(ix?.count??p.count);i+=3){const vs=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(p,ix?ix.getX(i+j):i+j).applyMatrix4(o.matrixWorld));out.push({triangle:new T.Triangle(...vs),bounds:new T.Box3().setFromPoints(vs),name:o.name});}return out;
};

test('hydraulic cassette and shafts clear the installed engine, plumbing and other parts',()=>{
  motion(0);model.root.updateMatrixWorld(true);const owned=new Set();drive.traverse(o=>owned.add(o));const bounds=new T.Box3().setFromObject(drive),neighbors=[];
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
      // A flexible radial seal intentionally contacts the rotating quill.
      if(o.name==='Hydraulic pump drive quill'&&b.name==='Hydraulic pump drive seal')continue;
      const key=`${o.name}/${b.name}`;if(errors.has(key)||!a.bounds.intersectsBox(b.bounds))continue;
      // Shared axial end faces are intentional seats, with Float32 rounding.
      if(Math.min(a.bounds.max.x,b.bounds.max.x)-Math.max(a.bounds.min.x,b.bounds.min.x)<1e-7)continue;
      if(crosses(a.triangle,b.triangle)||crosses(b.triangle,a.triangle))errors.add(key);
    }
  });
  assert.deepEqual([...errors],[]);
});
