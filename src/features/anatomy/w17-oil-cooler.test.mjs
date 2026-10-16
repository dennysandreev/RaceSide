import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { createW17 } from "./w17-geometry.ts";
import { createSurfaceSampler } from "./w17-surface.ts";

const model=createW17();model.root.updateMatrixWorld(true);
const cooler=model.root.getObjectByName("Oil heat exchanger");
const world=p=>new T.Vector3(...p).applyMatrix4(cooler.matrixWorld);
const direction=p=>new T.Vector3(...p).transformDirection(cooler.matrixWorld);

test("oil cooler has open longitudinal oil passages, separate from its air gaps",()=>{
  const ray=new T.Raycaster();
  for(let row=0;row<12;row++)for(let channel=0;channel<8;channel++){
    ray.set(world([-.110,row*.005,(channel-3.5)*.0108]),direction([1,0,0]));ray.far=.220;
    assert.equal(ray.intersectObject(cooler,true).length,0,`blocked oil passage ${row}/${channel}`);
  }
  for(let row=0;row<11;row++){
    let open=0,blocked=0;
    for(let x=0;x<20;x++){
      ray.set(world([-.080+x*.00815,row*.005+.0025,-.050]),direction([0,0,1]));ray.far=.100;
      if(ray.intersectObject(cooler,true).length)blocked++;else open++;
    }
    assert.ok(open>10,`air row ${row} is mostly closed`);
    assert.ok(blocked>0,"air channels have no folded fins");
    ray.set(world([.001,row*.005,-.050]),direction([0,0,1]));
    assert.ok(ray.intersectObject(cooler,true).length,"oil and air passages share an open wall");
  }
  for(const side of[-1,1]){
    ray.set(world([side*.116,.028,0]),direction([-side,0,0]));ray.far=.025;
    assert.equal(ray.intersectObject(cooler,true).length,0,`header ${side} blocks its hose union`);
  }
});

test("oil cooler clears the actual inner body laminate instead of only its exterior paint surface",()=>{
  const skin=model.root.getObjectByName("Bodywork inner laminate"),edge=createSurfaceSampler([skin],"z"),roof=createSurfaceSampler([skin],"y");
  const errors=[];
  cooler.traverse(part=>{
    if(!part.isMesh)return;
    const positions=part.geometry.attributes.position;
    for(let i=0;i<positions.count;i++){
      const p=new T.Vector3().fromBufferAttribute(positions,i).applyMatrix4(part.matrixWorld),z=edge(p.x,p.y,-1),y=roof(p.x,p.z,1);
      if(z!==undefined&&p.z<z+.001||y!==undefined&&p.y>y-.001){errors.push(part.name);break;}
    }
  });
  assert.deepEqual(errors,[]);
});

test("four isolated mounting ears have open bores and sit on supported crossbars",()=>{
  const ray=new T.Raycaster();
  for(const side of[-1,1])for(const zSide of[-1,1]){
    const ear=model.root.getObjectByName(`Oil cooler mounting ear ${side} ${zSide}`),bush=model.root.getObjectByName(`Oil cooler rubber bush ${side} ${zSide}`);
    assert.ok(ear&&bush,"missing resilient mounting corner");
    ray.set(world([side*.100,-.012,zSide*.062]),direction([0,1,0]));ray.far=.014;
    assert.equal(ray.intersectObject(ear).length,0,"mounting bolt misses the ear bore");
    const bar=model.root.getObjectByName(`Oil cooler support crossbar ${side}`),strut=model.root.getObjectByName(`Oil cooler support strut ${side}`);
    assert.ok(new T.Box3().setFromObject(bar).intersectsBox(new T.Box3().setFromObject(strut)),"mounting rail has no support");
    assert.ok(new T.Box3().setFromObject(bush).distanceToPoint(world([side*.100,-.021,zSide*.062]))<1e-6,"bush floats above its seat");
  }
});

test("the support feet bolt into blind bosses seated on the actual head casting",()=>{
  const head=model.root.getObjectByName("Cylinder head housing -1"),frame=head.matrixWorld;
  const ray=new T.Raycaster(),axis=new T.Vector3(0,0,1).transformDirection(frame);
  for(const [side,x]of[[-1,-.670],[1,-.485]])for(const dx of[-.008,.008]){
    const boss=model.root.getObjectByName(`Oil cooler head boss ${side} ${dx}`),base=model.root.getObjectByName(`Oil cooler head boss base ${side} ${dx}`);
    const origin=new T.Vector3(x+dx,.274,-.090).applyMatrix4(frame);ray.set(origin,axis);ray.far=.030;
    const hits=ray.intersectObjects([boss,base]);
    assert.ok(hits.length&&Math.abs(hits[0].distance-.019)<1e-6,"blind socket is blocked at the mouth or open through the head");
    const casting=ray.intersectObject(head)[0];
    assert.ok(casting&&Math.abs(casting.distance-.029)<1e-6,"mounting boss does not seat on the casting wall");
    const foot=model.root.getObjectByName(`Oil cooler support foot ${side}`);
    assert.equal(ray.intersectObject(foot).length,0,"mounting bolt misses the foot bore");
  }
});

test("oil cooler braces clear the exhaust, valve cover and neighboring plumbing",()=>{
  const nearest=new T.Vector3(),errors=new Set();
  for(const side of[-1,1]){
    const strut=model.root.getObjectByName(`Oil cooler support strut ${side}`),curve=new T.CatmullRomCurve3(strut.userData.mountRoute.map(p=>new T.Vector3(...p)),false,"centripetal");
    const points=curve.getSpacedPoints(100),box=new T.Box3().setFromPoints(points).expandByScalar(.005),solids=[];
    model.root.traverse(p=>{
      if(!p.isMesh||p.isInstancedMesh||p.userData.oilCoolerMount||p.userData.oilCooler||p.userData.component==="bodywork")return;
      const bounds=new T.Box3().setFromObject(p);if(!bounds.intersectsBox(box))return;
      const a=p.geometry.attributes.position,ix=p.geometry.index,triangles=[];
      for(let i=0;i<(ix?.count??a.count);i+=3){
        const vertices=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(a,ix?ix.getX(i+j):i+j).applyMatrix4(p.matrixWorld));
        const bound=new T.Box3().setFromPoints(vertices);if(bound.intersectsBox(box))triangles.push({bound,triangle:new T.Triangle(...vertices)});
      }
      solids.push({p,bounds,triangles});
    });
    for(const point of points)for(const s of solids){
      if(s.bounds.distanceToPoint(point)>.0045)continue;
      if(s.triangles.some(t=>t.bound.distanceToPoint(point)<.0045&&t.triangle.closestPointToPoint(point,nearest).distanceTo(point)<.0045))errors.add(s.p.name);
    }
  }
  assert.deepEqual([...errors],[]);
});

test("oil cooler return has no pinched bends and enters both unions axially",()=>{
  const hose=model.root.getObjectByName("Oil cooler return hose"),curve=new T.CatmullRomCurve3(hose.userData.route.map(p=>new T.Vector3(...p)),false,"centripetal");
  const points=curve.getSpacedPoints(3000);let minimum=Infinity;
  for(let i=1;i<points.length-1;i++){
    const a=points[i].clone().sub(points[i-1]),b=points[i+1].clone().sub(points[i]),cross=a.clone().cross(b).length();
    if(cross<1e-14)continue;
    minimum=Math.min(minimum,a.length()*b.length()*points[i+1].distanceTo(points[i-1])/(2*cross));
  }
  // A geometric fold check, not a manufacturer's hose-rating claim.
  assert.ok(minimum>hose.userData.outerRadius*2,`return hose pinches its inner wall (${minimum})`);
  for(const [t,name,sign]of[[0,"Oil cooler outlet socket",-1],[1,"Oil reservoir return socket",1]]){
    const socket=model.root.getObjectByName(name),box=new T.Box3().setFromObject(socket);
    assert.ok(box.distanceToPoint(curve.getPoint(t))<1e-6,"hose is detached from its union");
    assert.ok(curve.getTangent(t).dot(new T.Vector3(sign,0,0))>.999,"hose enters its union at an angle");
  }
});
