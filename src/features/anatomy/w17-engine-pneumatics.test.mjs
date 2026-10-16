import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { createW17 } from "./w17-geometry.ts";
import { createEngineMotion, ENGINE_CORE } from "./w17-engine-core.ts";

const model=createW17();model.root.updateMatrixWorld(true);
const get=name=>model.root.getObjectByName(name),system=get("Engine pneumatic valve supply"),core=system.parent;
const parts=[],lines=[],valves=[];
model.root.traverse(o=>{if(o.isMesh&&o.userData.enginePneumatic)parts.push(o);if(o.userData.pneumaticRoute)lines.push(o);if(o.userData.engineMotion==="valve")valves.push(o);});
const vec=p=>new T.Vector3(...p),curve=line=>new T.CatmullRomCurve3(line.userData.pneumaticRoute.map(vec),false,"centripetal");

test("the bottle supplies both heads and all 24 valve chambers through connected lines",()=>{
  const {pneumaticPorts:ports,pneumaticConnections:edges}=system.userData,visited=new Set(["bottle"]);
  for(let i=0;i<edges.length;i++)for(const [a,b]of edges){if(visited.has(a))visited.add(b);if(visited.has(b))visited.add(a);}
  assert.equal(lines.filter(p=>!p.userData.electrical).length,26);
  for(const valve of valves)assert.ok(visited.has(`${valve.name} spring`),`${valve.name}: disconnected air spring`);
  for(const line of lines){
    const {pneumaticFrom:from,pneumaticTo:to}=line.userData,c=curve(line),m=core.matrixWorld.clone().invert().multiply(line.matrixWorld);
    assert.ok(c.getPoint(0).applyMatrix4(m).distanceTo(vec(ports[from].point))<1e-8,`${line.name}: loose inlet`);
    assert.ok(c.getPoint(1).applyMatrix4(m).distanceTo(vec(ports[to].point))<1e-8,`${line.name}: loose outlet`);
    assert.ok(c.getTangent(0).transformDirection(m).dot(vec(ports[from].axis))>.99,`${line.name}: inlet kink`);
    assert.ok(c.getTangent(1).transformDirection(m).dot(vec(ports[to].axis))<-.99,`${line.name}: outlet kink`);
    const samples=c.getSpacedPoints(600);
    for(let i=1;i<samples.length-1;i++){
      const a=samples[i-1],b=samples[i],d=samples[i+1],ab=b.clone().sub(a),bd=d.clone().sub(b),cross=new T.Vector3().crossVectors(ab,bd).length();
      if(cross>1e-14)assert.ok(ab.length()*bd.length()*d.distanceTo(a)/(2*cross)>line.userData.outerRadius*2,`${line.name}: collapsed bend`);
    }
  }
});

test("gas enters below the piston without cutting through the stem guide or seals",()=>{
  const move=createEngineMotion(core);
  for(const valve of valves){
    const guide=get(`${valve.name} guide assembly`),pair=valve.name.endsWith("-1")?-1:1;
    const start=guide.localToWorld(new T.Vector3(pair*.009,.0385,0)),direction=new T.Vector3(pair,0,0).transformDirection(guide.matrixWorld);
    assert.equal(new T.Raycaster(start,direction,0,.004).intersectObject(get(`${valve.name} pneumatic cylinder`)).length,0,`${valve.name}: closed gas port`);
  }
  for(let angle=0;angle<Math.PI*4;angle+=Math.PI/36){
    move(angle);core.updateMatrixWorld(true);
    for(const valve of valves){
      const guide=get(`${valve.name} guide assembly`),piston=get(`${valve.name} pneumatic piston`),transform=guide.matrixWorld.clone().invert().multiply(piston.matrixWorld),p=piston.geometry.attributes.position;
      let bottom=Infinity;for(let j=0;j<p.count;j++)bottom=Math.min(bottom,new T.Vector3().fromBufferAttribute(p,j).applyMatrix4(transform).y);
      assert.ok(bottom>.0385+.0009+.0003,`${valve.name}: piston covers supply port`);
      assert.ok(bottom>.037+.001,`${valve.name}: piston hits lower seal`);
      const shaft=get(`${valve.name} stem guide`);shaft.geometry.computeBoundingBox();assert.ok(shaft.geometry.boundingBox.max.y<bottom-.001);
    }
  }
  move(ENGINE_CORE.initialAngle);core.updateMatrixWorld(true);
});

test("supply tubes and the pressure-sensor lead stay separate at their full radius",()=>{
  const paths=lines.map(line=>({line,points:curve(line).getSpacedPoints(300).map(p=>p.applyMatrix4(line.matrixWorld))}));
  for(let i=0;i<paths.length;i++)for(let j=i+1;j<paths.length;j++){
    const a=paths[i],b=paths[j],clearance=a.line.userData.outerRadius+b.line.userData.outerRadius+.0001;
    if(!new T.Box3().setFromPoints(a.points).expandByScalar(clearance).intersectsBox(new T.Box3().setFromPoints(b.points)))continue;
    for(const p of a.points)assert.ok(b.points.every(q=>p.distanceToSquared(q)>clearance*clearance),`${a.line.name} crosses ${b.line.name}`);
  }
});

function faces(o){
  const p=o.geometry.attributes.position,index=o.geometry.index,out=[];
  for(let i=0;i<(index?.count??p.count);i+=3){const v=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(p,index?index.getX(i+j):i+j).applyMatrix4(o.matrixWorld));out.push({triangle:new T.Triangle(...v),bounds:new T.Box3().setFromPoints(v)});}
  return out;
}
const occupied=new T.Box3().setFromObject(system),obstacles=[];
model.root.traverse(o=>{if(!o.isMesh||o.isInstancedMesh||o.userData.enginePneumatic)return;const bounds=new T.Box3().setFromObject(o);if(bounds.intersectsBox(occupied))obstacles.push({o,bounds,faces:faces(o)});});

test("the vessel, manifolds and regulator are closed solids with outward-facing walls",()=>{
  const names=["gas bottle","regulator inlet block","regulator pressure chamber","regulator poppet","head manifold -1","head manifold 1"];
  for(const name of names){
    const object=get(`Pneumatic ${name}`),p=object.geometry.attributes.position,index=object.geometry.index,edges=new Map();let volume=0;
    for(let i=0;i<(index?.count??p.count);i+=3){
      const v=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(p,index?index.getX(i+j):i+j));volume+=v[0].dot(v[1].clone().cross(v[2]))/6;
      const rounded=v.map(p=>new T.Vector3(...p.toArray().map(x=>Math.round(x*1e7)))),ids=rounded.map(p=>p.toArray().join(","));
      if(new T.Triangle(...rounded).getArea()===0)continue; // Ignore faces collapsed at the same 0.1 µm weld tolerance.
      for(let j=0;j<3;j++){const a=ids[j],b=ids[(j+1)%3];if(a===b)continue;const key=[a,b].sort().join("/"),edge=edges.get(key)??[0,0];edge[0]++;edge[1]+=a<b?1:-1;edges.set(key,edge);}
    }
    assert.ok(volume>0,`${name}: inward-facing solid`);
    for(const [key,edge]of edges)assert.deepEqual(edge,[2,0],`${name}: unjoined edge ${key}`);
  }
});

test("head supply galleries stay open behind retained, drilled mounts",()=>{
  for(const side of[-1,1]){
    const group=get(`Pneumatic head distribution ${side}`),manifold=get(`Pneumatic head manifold ${side}`),centre=manifold.position.x;
    const cast=point=>group.localToWorld(vec(point)),dir=v=>vec(v).transformDirection(group.matrixWorld);
    assert.equal(new T.Raycaster(cast([centre,.216,-.051]),dir([0,0,1]),0,.102).intersectObject(manifold).length,0,"cross gallery closed");
    for(const kind of["intake","exhaust"]){
      const header=get(`Pneumatic header ${side} ${kind}`),position=header.position,sign=kind==="intake"?-side:side;
      const start=cast([centre,position.y,sign*.050]);
      assert.equal(new T.Raycaster(start,dir([-1,0,0]),0,.030).intersectObjects([manifold,get(`Head end wall ${side} front`),header]).length,0,"header ends against a solid wall");
    }
    for(const x of[-.635,-.535]){
      const foot=get(`Pneumatic bottle foot ${x}/${side}`),a=vec(foot.userData.pneumaticSeat.point).applyMatrix4(core.matrixWorld),head=get(foot.userData.pneumaticSeat.body);
      const direction=dir([0,0,-side]),probe=a.clone().add(new T.Vector3(.006,0,0)).addScaledVector(direction,.01);
      const hit=new T.Raycaster(probe,direction.clone().negate(),0,.02).intersectObject(head)[0];
      assert.ok(hit&&new T.Box3().setFromObject(foot).expandByScalar(.0001).containsPoint(hit.point),`${foot.name}: floating mount`);
      assert.equal(new T.Raycaster(a.clone().addScaledVector(direction,.01),direction.clone().negate(),0,.015).intersectObjects([foot,head]).length,0,"mounting bolt crosses a closed casting");
    }
  }
});

test("new pneumatic hardware clears adjacent engine, fuel, cooling and body geometry",()=>{
  const ray=new T.Ray(),hit=new T.Vector3(),errors=new Set();
  for(const object of parts){
    const bounds=new T.Box3().setFromObject(object),triangles=faces(object);
    for(const ob of obstacles){
      if(!bounds.intersectsBox(ob.bounds))continue;
      if(/^Pneumatic bottle (foot|brace)/.test(object.name)&&/^Cylinder head housing/.test(ob.o.name))continue;
      if(/clamp foot/.test(object.name)&&/^Cylinder head housing/.test(ob.o.name))continue;
      if(/manifold (stand|fixing)/.test(object.name)&&/^Head end wall .* front$/.test(ob.o.name))continue;
      if(/check body$/.test(object.name)&&ob.o.name===object.name.slice(10).replace(" check body"," pneumatic cylinder"))continue;
      const nearby=ob.faces.filter(f=>f.bounds.intersectsBox(bounds));
      collision:for(const a of triangles)for(const b of nearby){
        if(!a.bounds.intersectsBox(b.bounds))continue;
        for(const [f,g]of[[a,b],[b,a]])for(const [p,q]of[[f.triangle.a,f.triangle.b],[f.triangle.b,f.triangle.c],[f.triangle.c,f.triangle.a]]){
          const length=p.distanceTo(q);if(length<1e-9)continue;ray.set(p,q.clone().sub(p).normalize());
          if(ray.intersectTriangle(g.triangle.a,g.triangle.b,g.triangle.c,false,hit)&&hit.distanceTo(p)>1e-7&&hit.distanceTo(p)<length-1e-7){errors.add(`${object.name} / ${ob.o.name}`);break collision;}
        }
      }
    }
  }
  assert.deepEqual([...errors],[]);
});
