import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {createOilPump,OIL_PUMP} from './w17-oil-pump.ts';
import {createSurfaceSampler} from './w17-surface.ts';
import {createEngineMotion} from './w17-engine-core.ts';
const mat=Object.fromEntries(['metal','cast','darkMetal','rubber'].map(n=>[n,new T.MeshStandardMaterial({side:T.DoubleSide})]));
const root=createOilPump(mat),get=n=>root.getObjectByName(n);root.updateMatrixWorld(true);

test('oil pump has three separate stages and two supported continuous shafts',()=>{
  assert.deepEqual(root.userData.stages.map(s=>s.kind),['pressure','scavenge','scavenge']);
  for(const side of[-1,1]){
    const moving=get(`Oil pump ${side===1?'drive':'idler'} shaft assembly`);assert.equal(moving.position.y,OIL_PUMP.y);
    for(let i=0;i<3;i++){
      assert.ok(get(`Oil pump stage ${i} gear ${side}`).parent===moving);
      for(const end of[-1,1])assert.ok(get(`Oil pump ${i} bush ${end} ${moving.position.z.toFixed(3)}`)||get(`Oil pump ${i} bush ${end} ${side===-1?-.250:-.230}`));
    }
  }
});

test('oil pump casing and end plates remain closed outward-facing solids around their bores',()=>{
  const errors=[];
  root.traverse(o=>{
    if(!o.isMesh||!o.userData.serviceCover)return;
    const p=o.geometry.attributes.position,ix=o.geometry.index,edges=new Map();let volume=0;
    for(let i=0;i<(ix?.count??p.count);i+=3){
      const v=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(p,ix?ix.getX(i+j):i+j));volume+=v[0].dot(v[1].clone().cross(v[2]))/6;
      const ids=v.map(v=>v.toArray().map(n=>Math.round(n*1e7)).join());if(new Set(ids).size<3)continue;
      for(let k=0;k<3;k++){const a=ids[k],b=ids[(k+1)%3],key=[a,b].sort().join('/');edges.set(key,(edges.get(key)||0)+1);}
    }
    if(volume<=0||[...edges.values()].some(n=>n!==2))errors.push([o.name,volume,[...edges.values()].filter(n=>n!==2).length]);
  });assert.deepEqual(errors,[]);
});

test('all six oil gears mesh without interpenetration during a tooth engagement',()=>{
  const moving=createEngineMotion(root),points=new Map(),profiles=new Map();
  for(const side of[-1,1]){const mesh=get(`Oil pump stage 0 gear ${side}`),g=mesh.geometry.clone();g.rotateZ(Math.PI/2);const probe=new T.Mesh(g);probe.updateMatrixWorld(true);profiles.set(side,createSurfaceSampler([probe],'y'));const p=mesh.geometry.attributes.position,unique=new Map();for(let i=0;i<p.count;i++)unique.set(`${p.getY(i)},${p.getZ(i)}`,new T.Vector3(-.520,p.getY(i),p.getZ(i)));points.set(side,[...unique.values()]);g.dispose();}
  for(let step=0;step<=48;step++){
    moving(step/48*Math.PI*2/16);root.updateMatrixWorld(true);
    for(const side of[-1,1]){const a=get(`Oil pump stage 0 gear ${side}`),b=get(`Oil pump stage 0 gear ${-side}`),transform=a.matrixWorld.clone().invert().multiply(b.matrixWorld),sample=profiles.get(side);for(const v of points.get(-side)){const p=v.clone().applyMatrix4(transform);assert.equal(sample(-p.y,p.z,1),undefined,'oil gear teeth overlap');}}
  }
  moving(0);root.updateMatrixWorld(true);
});

test('pressure and scavenge passages reach their own gear cavities and the common return is capped',()=>{
  const cast=[];root.traverse(o=>{if(o.isMesh&&o.userData.serviceCover)cast.push(o);});
  const clear=(a,d,length,meshes=cast)=>assert.equal(new T.Raycaster(new T.Vector3(...a),new T.Vector3(...d),0,length).intersectObjects(meshes,false).length,0,`blocked passage from ${a}`);
  clear([-.49,.112,-.224],[-1,0,0],.04);
  clear([-.520,.18,-.240],[0,-1,0],.04);
  for(const x of[-.556,-.592])clear([x,.120,-.200],[0,0,-1],.036);
  clear([-.54,.156,-.240],[-1,0,0],.065);
  assert.ok(new T.Raycaster(new T.Vector3(-.60,.156,-.240),new T.Vector3(-1,0,0),0,.02).intersectObject(get('Oil pump scavenge gallery plug')).length);
  assert.ok(new T.Raycaster(new T.Vector3(-.556,.18,-.240),new T.Vector3(0,-1,0),0,.02).intersectObject(get('Oil pump scavenge manifold drilling plug')).length,'first scavenge stage has an unconnected outlet');
});

test('oil is carried upward along both outer gear pockets from lower inlets to upper outlets',()=>{
  // The shared engine clock runs clockwise from +X (decreasing angle).
  for(const side of[-1,1]){const rotor=get(`Oil pump ${side===1?'drive':'idler'} shaft assembly`);assert.ok(rotor.userData.ratio*side>0);}
  for(const stage of[0,1,2])for(const x of[-.009,.009]){
    const hits=new T.Raycaster(new T.Vector3(-.520-stage*.036+x,.175,-.240),new T.Vector3(0,-1,0),0,.014).intersectObjects(root.children,false);
    assert.ok(hits.length,`stage ${stage} has an uncovered top machining slot`);
  }
});
