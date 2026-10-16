import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {createW17} from './w17-geometry.ts';
import {createEngineMotion} from './w17-engine-core.ts';
import {visibleInHydraulics} from './w17-model-cache.ts';
import {HYDRAULIC_PUMP as P} from './w17-hydraulic-pump.ts';

const model=createW17(),get=n=>model.root.getObjectByName(n),motion=createEngineMotion(model.root);

test('the installed hydraulic pump contains a driven barrel and seven hollow piston/shoe assemblies',()=>{
  const rotor=get('Hydraulic pump rotating group');
  assert.ok(rotor,'pump remains a solid cylinder');
  assert.equal(rotor.children.filter(p=>p.userData.engineMotion==='hydraulicPiston').length,7);
  assert.ok(get('Hydraulic pump valve plate'));
  assert.ok(get('Hydraulic pump swashplate'));
  assert.ok(get('Hydraulic pump shoe retainer'));
  for(const angle of [0,.4,1.6,5.9]){
    motion(angle);
    assert.equal(rotor.rotation.x,get('Hydraulic drive output').rotation.x);
  }
  assert.ok(visibleInHydraulics(get('Hydraulic pump body'),'pump'));
  assert.equal(visibleInHydraulics(get('Hydraulic reservoir wall'),'pump'),false);
});

test('the shoe retainer is preloaded through an internal barrel spring, three pins and a spherical guide',()=>{
  assert.ok(get('Hydraulic pump barrel preload spring'),'retaining plate has no preload mechanism');
  assert.ok(get('Hydraulic pump retainer ball seat'));
  for(let i=0;i<3;i++)assert.ok(get(`Hydraulic pump retainer thrust pin ${i}`));
  assert.ok(get('Hydraulic pump preload rear washer'));
  assert.ok(get('Hydraulic pump preload front washer'));
});

test('pump castings, drilled barrel and hollow pistons are closed positive-volume solids',()=>{
  for(const name of ['body','end plate','front bearing cap','port block','valve plate','cylinder barrel','splined shaft','piston 0','slipper 0','swashplate','swash support','shoe retainer','retainer ball seat','barrel preload spring','preload rear washer','preload front washer']){
    const mesh=get(`Hydraulic pump ${name}`),p=mesh.geometry.attributes.position,ix=mesh.geometry.index,edges=new Map(),directions=new Map();let volume=0;
    for(let i=0;i<(ix?.count??p.count);i+=3){
      const vs=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(p,ix?ix.getX(i+j):i+j));
      volume+=vs[0].dot(vs[1].clone().cross(vs[2]))/6;
      const ids=vs.map(v=>v.toArray().map(x=>Math.round(x*1e7)).join());if(new Set(ids).size<3)continue;
      for(let j=0;j<3;j++){const a=ids[j],b=ids[(j+1)%3],key=[a,b].sort().join('/');edges.set(key,(edges.get(key)||0)+1);directions.set(key,(directions.get(key)||0)+(a<b?1:-1));}
    }
    assert.ok(volume>1e-12,`${name}: inverted or empty solid ${volume}`);
    assert.ok([...edges.values()].every(n=>n===2),`${name}: unmatched edges ${[...edges.values()].filter(n=>n!==2).length}`);
    if(['cylinder barrel','barrel preload spring'].includes(name))assert.ok([...directions.values()].every(n=>n===0),`${name}: reversed face`);
  }
});

test('preload forces have an uninterrupted seated path and real barrel clearances',()=>{
  motion(0);model.root.updateMatrixWorld(true);
  const box=name=>new T.Box3().setFromObject(get(`Hydraulic pump ${name}`));
  for(const [a,b]of[['preload rear washer','barrel preload spring'],['barrel preload spring','preload front washer'],['preload front washer','retainer thrust pin 0'],['retainer thrust pin 0','retainer ball seat']]){
    assert.ok(Math.abs(box(a).max.x-box(b).min.x)<2e-7,`${a} / ${b}: disconnected axial load path`);
  }
  const spring=get('Hydraulic pump barrel preload spring'),points=spring.geometry.attributes.position;
  for(let i=0;i<points.count;i++){
    const x=points.getX(i),r=Math.hypot(points.getY(i),points.getZ(i));
    assert.ok(x>=-.9930001&&x<=-.9829999&&r>.0041&&r<.0074,'spring cuts the shaft, washers or barrel');
  }
  withRays(['cylinder barrel'],hits=>{
    const rotor=get('Hydraulic pump rotating group');
    for(let i=0;i<3;i++){
      const t=i*Math.PI*2/3,p=new T.Vector3(0,Math.cos(t)*.0062,Math.sin(t)*.0062).applyMatrix4(rotor.matrixWorld);
      assert.equal(hits([-.9825,p.y,p.z],[-.9779,p.y,p.z]).length,0,'thrust pin crosses solid barrel');
    }
    assert.equal(hits([-.9935,P.y+.0065,P.z],[-.9815,P.y+.0065,P.z]).length,0,'spring chamber is plugged');
    assert.ok(hits([-.9945,P.y+.0065,P.z],[-.9935,P.y+.0065,P.z]).length,'rear spring shoulder missing');
  });
});

test('the retainer pivots on its spherical seat while clearing the shaft and swashplate',()=>{
  const retainer=get('Hydraulic pump shoe retainer'),guide=get('Hydraulic pump retainer ball seat'),data=guide.userData.sphericalGuide;
  const centre=new T.Vector3(data.centre,P.y,P.z),normal=new T.Vector3(Math.cos(P.angle),Math.sin(P.angle),0);
  for(let step=0;step<=48;step++){
    motion(-step*Math.PI/12);model.root.updateMatrixWorld(true);
    for(let i=0;i<32;i++){
      const angle=i*Math.PI/16,p=retainer.localToWorld(new T.Vector3(-.0021,Math.cos(angle)*data.seatRadius,Math.sin(angle)*data.seatRadius));
      assert.ok(Math.abs(p.distanceTo(centre)-data.radius)<1e-9,'retainer is unsupported by the ball seat');
      assert.ok(Math.hypot(p.y-P.y,p.z-P.z)>.0041,'retainer bore crosses the shaft');
    }
    const positions=guide.geometry.attributes.position;
    for(let i=0;i<positions.count;i++){
      const p=new T.Vector3().fromBufferAttribute(positions,i).applyMatrix4(guide.matrixWorld),distance=p.clone().sub(new T.Vector3(P.plane,P.y,P.z)).dot(normal);
      if(distance>=-1e-7){const local=get('Hydraulic pump swashplate').worldToLocal(p);assert.ok(Math.hypot(local.y,local.z)<.006,'guide crosses the swashplate bore');}
    }
  }
});

test('pistons stay engaged and every slipper stays on the swashplane throughout a revolution',()=>{
  const normal=new T.Vector3(Math.cos(P.angle),Math.sin(P.angle),0),plane=new T.Vector3(P.plane,P.y,P.z),retainer=get('Hydraulic pump shoe retainer');
  const rotor=get('Hydraulic pump rotating group'),pistons=rotor.children.filter(p=>p.userData.engineMotion==='hydraulicPiston');
  for(let step=0;step<=180;step++){
    motion(-step/180*Math.PI*4);model.root.updateMatrixWorld(true);
    for(const piston of pistons){
      const ball=piston.getWorldPosition(new T.Vector3()),shoe=piston.children[0];
      assert.ok(ball.x-.024>-.9958&&ball.x-.004>-.978,'piston leaves barrel or reaches valve plate');
      const contact=shoe.localToWorld(new T.Vector3(.0022,0,0));
      assert.ok(Math.abs(contact.clone().sub(plane).dot(normal))<1e-10,'slipper lifts from swashplate');
      const direction=new T.Vector3(1,0,0).transformDirection(shoe.matrixWorld);assert.ok(direction.distanceTo(normal)<1e-10);
      const local=retainer.worldToLocal(shoe.localToWorld(new T.Vector3(.0004,0,0))),phase=piston.userData.phase;
      assert.ok(Math.hypot(local.y-Math.cos(phase)*P.pitch,local.z-Math.sin(phase)*P.pitch)+.002<.0031,'retainer cuts a ball socket');
      const geometry=shoe.geometry.attributes.position;
      for(let i=0;i<geometry.count;i+=8){const p=new T.Vector3().fromBufferAttribute(geometry,i).applyMatrix4(shoe.matrixWorld);assert.ok(Math.hypot(p.y-P.y,p.z-P.z)<.017,'slipper crosses case wall');}
    }
  }
});

const withRays=(names,fn)=>{
  motion(0);model.root.updateMatrixWorld(true);const meshes=names.map(n=>get(`Hydraulic pump ${n}`)),materials=new Map(meshes.map(m=>[m.material,m.material.side]));
  for(const m of materials.keys())m.side=T.DoubleSide;
  const hits=(a,b)=>{const start=new T.Vector3(...a),v=new T.Vector3(...b).sub(start);return new T.Raycaster(start,v.clone().normalize(),1e-7,v.length()-1e-7).intersectObjects(meshes,false);};
  try{fn(hits);}finally{for(const [m,s]of materials)m.side=s;}
};

test('inlet, delivery gallery and barrel ports have separate continuous passages',()=>{
  withRays(['body','port block'],hits=>{
    assert.equal(hits([-.989,P.y,.146],[-.989,P.y,P.z+.016]).length,0,'inlet blocked by case');
    assert.equal(hits([-.968,.366,P.z],[-.968,P.y+.0208,P.z]).length,0,'delivery outlet blocked');
    assert.equal(hits([-1.0035,P.y+.0208,P.z],[-.9545,P.y+.0208,P.z]).length,0,'axial delivery gallery blocked');
    assert.ok(hits([-.980,P.y+.016,P.z],[-.980,P.y+.0208,P.z]).length,'delivery leaks into inlet case');
  });
  withRays(['valve plate'],hits=>{
    for(const t of [.7,1.6,2.4,3.8,4.7,5.6]){const y=P.y+P.pitch*Math.cos(t),z=P.z+P.pitch*Math.sin(t);assert.equal(hits([-.999,y,z],[-.995,y,z]).length,0,'kidney port blocked');}
    for(const t of[0,Math.PI]){const y=P.y+P.pitch*Math.cos(t);assert.ok(hits([-.999,y,P.z],[-.995,y,P.z]).length,'no separation between inlet and delivery');}
  });
  // A bore cannot overlap both kidney ports while crossing either dead land.
  assert.ok(2*Math.asin(.00255/P.pitch)<.60);
  // Clockwise engine rotation gives positive pump rotation. Positive Z must
  // therefore expand a chamber; negative Z must compress it.
  for(const t of [.5,2,3.5,5])assert.equal(Math.sign(Math.tan(P.angle)*P.pitch*Math.sin(t)),Math.sign(Math.sin(t)));
});

const triangles=o=>{
  const p=o.geometry.attributes.position,ix=o.geometry.index,out=[];
  for(let i=0;i<(ix?.count??p.count);i+=3){const vs=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(p,ix?ix.getX(i+j):i+j).applyMatrix4(o.matrixWorld));out.push({triangle:new T.Triangle(...vs),bounds:new T.Box3().setFromPoints(vs),name:o.name});}return out;
};

test('pump envelope clears installed engine, plumbing and transmission',()=>{
  motion(0);model.root.updateMatrixWorld(true);const owned=new Set(),bounds=new T.Box3(),neighbors=[];model.root.traverse(o=>{if(o.isMesh&&o.userData.hydraulicPump){owned.add(o);bounds.union(new T.Box3().setFromObject(o));}});
  model.root.traverse(o=>{if(o.isMesh&&!o.isInstancedMesh&&!owned.has(o)&&new T.Box3().setFromObject(o).intersectsBox(bounds))neighbors.push(o);});
  const cells=box=>{const a=box.min.clone().divideScalar(.015).floor(),b=box.max.clone().divideScalar(.015).floor(),keys=[];for(let x=a.x;x<=b.x;x++)for(let y=a.y;y<=b.y;y++)for(let z=a.z;z<=b.z;z++)keys.push(`${x},${y},${z}`);return keys;};
  const bins=new Map();
  for(const o of neighbors)for(const t of triangles(o)){
    if(!t.bounds.intersectsBox(bounds))continue;for(const k of cells(t.bounds)){const entries=bins.get(k)||[];entries.push(t);bins.set(k,entries);}
  }
  const ray=new T.Ray(),point=new T.Vector3(),errors=new Set();
  const crosses=(a,b)=>{for(const [p,q]of[[a.a,a.b],[a.b,a.c],[a.c,a.a]]){const length=p.distanceTo(q);if(length<1e-9)continue;ray.set(p,q.clone().sub(p).normalize());if(ray.intersectTriangle(b.a,b.b,b.c,false,point)&&point.distanceTo(p)>1e-7&&point.distanceTo(p)<length-1e-7)return true;}return false;};
  for(const o of owned){
    for(const a of triangles(o))for(const b of new Set(cells(a.bounds).flatMap(k=>bins.get(k)||[]))){
      const key=`${o.name}/${b.name}`;if(errors.has(key)||!a.bounds.intersectsBox(b.bounds))continue;
      // Shared axial end faces are intentional seats, with Float32 rounding.
      if(['x','y','z'].some(axis=>Math.min(a.bounds.max[axis],b.bounds.max[axis])-Math.max(a.bounds.min[axis],b.bounds.min[axis])<1e-7))continue;
      if(crosses(a.triangle,b.triangle)||crosses(b.triangle,a.triangle))errors.add(key);
    }
  }
  assert.deepEqual([...errors],[]);
});
