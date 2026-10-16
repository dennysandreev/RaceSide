import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {createW17} from './w17-geometry.ts';
import {createEngineMotion} from './w17-engine-core.ts';
import {createSurfaceSampler} from './w17-surface.ts';
import {visibleInCooling} from './w17-model-cache.ts';
const model=createW17(),get=n=>model.root.getObjectByName(n),drive=get('Main coolant pump transmission'),motion=createEngineMotion(model.root),owned=new Set(),gears=[];
drive.traverse(o=>{owned.add(o);if(o.userData.engineMotion==='accessoryGear')gears.push(o);});
model.root.updateMatrixWorld(true);

test('both coolant pumps have meshing fixed-ratio paths from the crankshaft',()=>{
  assert.equal(gears.length,5);const input=get('Coolant drive gear crank');
  assert.equal(input.position.y,get('V6 crank and piston assembly').position.y);assert.equal(input.position.z,0);
  for(const gear of gears.filter(g=>g.userData.mate)){
    const parent=get(gear.userData.mate);assert.ok(parent);
    assert.ok(Math.abs(gear.position.distanceTo(parent.position)-gear.userData.pitchRadius-parent.userData.pitchRadius)<1e-9);
    assert.ok(Math.abs(gear.userData.ratio*gear.userData.teeth+parent.userData.ratio*parent.userData.teeth)<1e-9);
  }
  for(const side of[-1,1]){
    const output=get(`Coolant drive gear pump ${side}`),pump=get(`Main coolant pump ${side}`),shaft=get(`Coolant pump ${side} shaft`),journal=get(`Coolant drive pump ${side} front journal`);
    assert.ok(Math.hypot(output.position.y-pump.position.y,output.position.z-pump.position.z)<1e-9);
    assert.ok(Math.abs(new T.Box3().setFromObject(journal).max.x-new T.Box3().setFromObject(shaft).min.x)<1e-7);
    for(const angle of[0,.3,3.6]){motion(angle);assert.equal(get(`Coolant pump ${side} rotating assembly`).rotation.x,output.rotation.x);}
    assert.ok(visibleInCooling(output,side===1?'right-pump':'left-pump'));assert.equal(visibleInCooling(output,side===1?'left-pump':'right-pump'),false);
  }
  assert.ok(visibleInCooling(input,'left-pump')&&visibleInCooling(input,'right-pump'));assert.equal(visibleInCooling(input,'lt-pump'),false);
  motion(0);model.root.updateMatrixWorld(true);
});

test('all actual main coolant gear teeth remain separate throughout engagement',()=>{
  const profiles=new Map(),points=new Map();
  for(const gear of gears){
    const mesh=get(`${gear.name.replace('gear ','')} teeth`),g=mesh.geometry.clone();g.rotateZ(Math.PI/2);
    const projection=new T.Mesh(g);projection.updateMatrixWorld(true);profiles.set(gear,createSurfaceSampler([projection],'y'));
    const p=mesh.geometry.attributes.position,unique=new Map();for(let i=0;i<p.count;i++)unique.set([p.getY(i),p.getZ(i)].map(v=>Math.round(v*1e8)).join(),new T.Vector3(0,p.getY(i),p.getZ(i)));points.set(gear,[...unique.values()]);g.dispose();
  }
  for(let step=0;step<=48;step++){
    motion(step/48*Math.PI*2/44);model.root.updateMatrixWorld(true);
    for(const a of gears)for(const b of gears){
      if(a===b||a.position.distanceTo(b.position)>a.userData.pitchRadius+b.userData.pitchRadius+.004)continue;
      const transform=a.matrixWorld.clone().invert().multiply(b.matrixWorld),sample=profiles.get(a);
      for(const vertex of points.get(b)){const p=vertex.clone().applyMatrix4(transform);assert.equal(sample(-p.y,p.z,1),undefined,`${a.name}/${b.name}: crossed teeth`);}
    }
  }
  motion(0);model.root.updateMatrixWorld(true);
});

test('the cassette and both front casting bridges are closed and its crank key is seated',()=>{
  for(const name of['Coolant drive case perimeter','Coolant drive case rear cover','Coolant drive case front cover','Front crankcase coolant-drive bridge','Front crankcase transmission bridge']){
    const o=get(name),p=o.geometry.attributes.position,ix=o.geometry.index,edges=new Map();let volume=0;
    const key=i=>[p.getX(i),p.getY(i),p.getZ(i)].map(v=>Math.round(v*1e7)).join();
    for(let i=0;i<(ix?.count??p.count);i+=3){const ids=[0,1,2].map(j=>ix?ix.getX(i+j):i+j),v=ids.map(key);if(new Set(v).size<3)continue;const [a,b,c]=ids.map(i=>new T.Vector3().fromBufferAttribute(p,i));volume+=a.dot(b.cross(c))/6;for(let j=0;j<3;j++){const k=[v[j],v[(j+1)%3]].sort().join('/');edges.set(k,(edges.get(k)||0)+1);}}
    assert.ok(volume>0,`${name}: inverted solid`);assert.ok([...edges.values()].every(n=>n===2),`${name}: open or branching edges`);
  }
  const key=get('Coolant drive crank key'),shaft=get('Crank main-axis section 3'),gear=get('Coolant drive crank teeth');
  const p=new T.Box3().setFromObject(key).getCenter(new T.Vector3()),ray=new T.Raycaster(p,new T.Vector3(0,1,0),0,.003);
  for(const o of[shaft,gear])o.material.side=T.DoubleSide;const hits=ray.intersectObjects([shaft,gear],false);
  assert.ok(hits.length&&hits.every(h=>h.object===gear&&Math.abs(h.distance-.0016)<1e-6),'crank key has no matching pocket');
});

test('the two transmission rows and pump quill fit above the floor with intact drive connections',()=>{
  const floor=[];model.assemblies.get('floor').traverse(o=>{if(o.isMesh)floor.push(o);});const height=createSurfaceSampler(floor,'y');
  drive.traverse(o=>{if(!o.isMesh)return;const p=o.geometry.attributes.position;for(let i=0;i<p.count;i+=3){const v=new T.Vector3().fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld),floorY=height(v.x,v.z,1);if(floorY!==undefined)assert.ok(v.y>floorY+.002,`${o.name} enters floor`);}});
  const idler=get('MGU-K drive gear outer idler'),axis=get('Main coolant pump 1').position;
  assert.ok(Math.hypot(idler.position.y-axis.y,idler.position.z-axis.z)-idler.userData.pitchRadius-.002>.0051,'pump quill crosses moving MGU-K gear tips');
  const shaft=new T.Box3().setFromObject(get('MGU-K hollow shaft')),wheel=get('MGU-K drive gear motor');assert.ok(shaft.min.x<wheel.position.x-.004&&shaft.max.x>wheel.position.x+.004);
  const housing=new T.Box3().setFromObject(get('MGU-K end shield 1'));assert.ok(housing.max.x<new T.Box3().setFromObject(get('Coolant drive case rear cover')).min.x-.002);
});

test('cassette mounts seat on the crankcase and pump bearings are captured axially',()=>{
  const block=get('Cast V6 crankcase'),probe=new T.Mesh(block.geometry,new T.MeshBasicMaterial({side:T.DoubleSide}));probe.matrixWorld.copy(block.matrixWorld);
  for(let i=0;i<4;i++){
    const boss=get(`Coolant drive engine mounting boss ${i}`),b=new T.Box3().setFromObject(boss),p=b.getCenter(new T.Vector3());
    const hit=new T.Raycaster(new T.Vector3(b.max.x,p.y,p.z),new T.Vector3(-1,0,0),0,.01).intersectObject(probe,false)[0];
    assert.ok(hit&&Math.abs(hit.point.x-b.min.x)<1e-7,'mounting boss floats off the crankcase');
    const bolt=new T.Box3().setFromObject(get(`Coolant drive mounting bolt ${i}`));assert.ok(bolt.min.x>b.min.x&&bolt.min.x<b.max.x,'bolt misses its blind socket');
    assert.ok(new T.Box3().setFromObject(get(`Coolant drive mounting bolt head ${i}`)).max.x<drive.userData.plane-.0035,'bolt head enters the rotating gear plane');
  }
  probe.material.dispose();
  for(const side of[-1,1])for(const [x,lo,hi]of[[-.347,-.351,-.345],[-.328,-.334,-.326]]){
    const bearing=get(`Coolant drive pump ${side} bearing inner ${x}`),box=new T.Box3().setFromObject(bearing);
    assert.equal(bearing.parent,get(`Coolant drive gear pump ${side}`));
    const a=new T.Box3().setFromObject(get(`Coolant drive pump ${side} shaft shoulder ${lo}`)),b=new T.Box3().setFromObject(get(`Coolant drive pump ${side} shaft shoulder ${hi}`));
    assert.ok(Math.abs(a.max.x-box.min.x)<1e-7&&Math.abs(b.min.x-box.max.x)<1e-7,'bearing lacks an axial stop');
  }
});

const triangles=o=>{
  const p=o.geometry.attributes.position,ix=o.geometry.index,out=[];
  for(let i=0;i<(ix?.count??p.count);i+=3){const vs=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(p,ix?ix.getX(i+j):i+j).applyMatrix4(o.matrixWorld));out.push({triangle:new T.Triangle(...vs),bounds:new T.Box3().setFromPoints(vs),name:o.name});}return out;
};

test('the installed main pump drive clears neighboring surfaces without relocating coolant pumps',()=>{
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
  for(const side of[-1,1])assert.deepEqual(get(`Main coolant pump ${side}`).position.toArray(),[-.280,.190,side*.169]);
});
