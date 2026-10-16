import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { createW17 } from "./w17-geometry.ts";
import { createSurfaceSampler } from "./w17-surface.ts";

const model=createW17();model.root.updateMatrixWorld(true);
const get=name=>model.root.getObjectByName(name),gate=get("Exhaust wastegate"),ports=gate.userData.ports;
const ray=new T.Raycaster();

test("the wastegate contains a seated axial poppet, guide, diaphragm and supported return spring",()=>{
  for(const name of["valve seat","poppet","valve stem","stem guide","diaphragm","diaphragm plate","return spring","spring upper seat","gas chamber","actuator lower bowl","actuator cap"]){
    const part=get(`Wastegate ${name}`);assert.ok(part?.isMesh,name);assert.ok(part.userData.internal);assert.equal(part.userData.component,"exhaust");
  }
  // A closed circular sealing interface, opening through axial lift only.
  const poppet=get("Wastegate poppet"),seat=get("Wastegate valve seat");
  ray.set(gate.localToWorld(new T.Vector3(.0145,.012,0)),new T.Vector3(1,0,0));ray.far=.015;
  assert.ok(ray.intersectObject(poppet)[0],"valve face does not cover its seat");
  assert.ok(new T.Box3().setFromObject(poppet).intersectsBox(new T.Box3().setFromObject(seat)));
  const spring=new T.Box3().setFromObject(get("Wastegate return spring")),plate=new T.Box3().setFromObject(get("Wastegate diaphragm plate")),upper=new T.Box3().setFromObject(get("Wastegate spring upper seat"));
  assert.ok(Math.abs(spring.min.x-plate.max.x)<.001);assert.ok(spring.max.x>=upper.min.x);
});

test("the bypass connects before the turbine and returns into the same tailpipe through open side ports",()=>{
  assert.deepEqual(get("Wastegate inlet pipe").userData.route.at(-1),ports.inlet);
  assert.deepEqual(get("Wastegate return pipe").userData.route[0],ports.outlet);
  const cases=[["Exhaust turbine feed",-1.1915,.450,-.140,-.208,-1],["Exhaust tailpipe",-1.31,.510,-.08,0,1]];
  for(const[name,x,y,z,centreZ,direction]of cases){
    const pipe=get(name),side=pipe.material.side;pipe.material.side=T.DoubleSide;
    try{
      ray.set(new T.Vector3(x,y,z),new T.Vector3(0,0,direction));ray.far=.18;
      const hit=ray.intersectObject(pipe)[0];
      assert.ok(hit&&(hit.point.z-centreZ)*direction>.010,`${name}: capped branch or missing opposite wall: ${hit?.point.toArray()}`);
    }finally{pipe.material.side=side;}
  }
  ray.set(gate.localToWorld(new T.Vector3(0,.034,.050)),new T.Vector3(0,0,-1));ray.far=.039;
  assert.equal(ray.intersectObjects([get("Wastegate gas chamber"),get("Wastegate outlet neck")]).length,0,"outlet is closed by its casting");
  assert.ok(get("Wastegate return pipe").userData.route.at(-1)[0]<get("Single-shaft turbocharger").userData.ports.exhaustOutlet[0]);
});

test("the wastegate bracket joins both mounting ears to the real engine end cover",()=>{
  for(const z of[-.204,-.156]){
    const ear=get(`Wastegate mounting eye ${z<-.18?-.024:.024}`),bracket=get(`Wastegate bracket eye ${z}`),bolt=get(`Wastegate mounting bolt ${z}`),pad=get(`Wastegate engine pad ${z}`),strut=get(`Wastegate support strut ${z}`);
    assert.ok(new T.Box3().setFromObject(ear).intersectsBox(new T.Box3().setFromObject(bolt)));
    assert.ok(new T.Box3().setFromObject(bracket).intersectsBox(new T.Box3().setFromObject(strut)));
    assert.ok(new T.Box3().setFromObject(pad).intersectsBox(new T.Box3().setFromObject(strut)));
    ray.set(new T.Vector3(-.99,.370,z),new T.Vector3(1,0,0));ray.far=.07;
    const hit=ray.intersectObject(get("Engine timing end cover -0.938"))[0];
    assert.ok(hit&&new T.Box3().setFromObject(pad).containsPoint(hit.point),"pad floats behind the engine");
  }
});

test("wastegate hardware and full-radius pipes clear neighboring assemblies and stay under the body",()=>{
  const solids=[];model.root.traverse(o=>{
    if(!o.isMesh||o.isInstancedMesh||o.userData.component==="exhaust"||o.name==="Wastegate boost reference union")return;
    const box=new T.Box3().setFromObject(o);if(box.max.x< -1.7||box.min.x>-.91||box.max.y<.30||box.min.y>.65)return;
    const p=o.geometry.attributes.position,ix=o.geometry.index,triangles=[];
    for(let i=0;i<(ix?.count??p.count);i+=3){const points=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(p,ix?ix.getX(i+j):i+j).applyMatrix4(o.matrixWorld));triangles.push({t:new T.Triangle(...points),b:new T.Box3().setFromPoints(points)});}
    solids.push({o,box,triangles});
  });
  const errors=new Set(),closest=new T.Vector3();
  gate.traverse(o=>{
    if(!o.isMesh)return;const bounds=new T.Box3().setFromObject(o);
    for(const s of solids)if(s.box.intersectsBox(bounds)&&s.triangles.some(({t,b})=>b.intersectsBox(bounds)&&bounds.intersectsTriangle(t)))errors.add(`${o.name} / ${s.o.name}`);
  });
  for(const name of["Wastegate inlet pipe","Wastegate return pipe","Wastegate pressure reference"]){
    const pipe=get(name),curve=new T.CatmullRomCurve3(pipe.userData.route.map(p=>new T.Vector3(...p)),false,"centripetal"),points=curve.getSpacedPoints(200),r=pipe.userData.outerRadius;
    for(let i=0;i<points.length;i++){
      if(name==="Wastegate pressure reference"&&i<8)continue; // insertion into its own boost union
      for(const s of solids){if(s.box.distanceToPoint(points[i])>r+.001)continue;if(s.triangles.some(({t,b})=>b.distanceToPoint(points[i])<r+.001&&t.closestPointToPoint(points[i],closest).distanceTo(points[i])<r+.001))errors.add(`${name} / ${s.o.name}`);}
    }
  }
  assert.deepEqual([...errors],[]);
});

test("the tailpipe clears the rear drivetrain and exits level above the rain light",()=>{
  const pipe=get("Exhaust tailpipe"),curve=new T.CatmullRomCurve3(pipe.userData.route.map(p=>new T.Vector3(...p)),false,"centripetal"),radius=pipe.userData.outerRadius+.001;
  const points=curve.getSpacedPoints(300).filter(p=>p.x< -1.28),occupied=new T.Box3().setFromPoints(points).expandByScalar(radius),solids=[];
  model.root.traverse(o=>{
    if(!o.isMesh||o.isInstancedMesh||["exhaust","turbo"].includes(o.userData.component))return;
    const bounds=new T.Box3().setFromObject(o);if(!bounds.intersectsBox(occupied))return;
    const p=o.geometry.attributes.position,index=o.geometry.index,triangles=[];
    for(let i=0;i<(index?.count??p.count);i+=3){
      const vertices=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(p,index?index.getX(i+j):i+j).applyMatrix4(o.matrixWorld)),box=new T.Box3().setFromPoints(vertices);
      if(box.intersectsBox(occupied))triangles.push({box,triangle:new T.Triangle(...vertices)});
    }
    solids.push({o,bounds,triangles});
  });
  const nearest=new T.Vector3(),errors=new Set();
  for(const p of points)for(const s of solids){
    if(s.bounds.distanceToPoint(p)>radius)continue;
    if(s.triangles.some(({box,triangle})=>box.distanceToPoint(p)<radius&&triangle.closestPointToPoint(p,nearest).distanceTo(p)<radius))errors.add(s.o.name);
  }
  assert.deepEqual([...errors],[]);
  const end=curve.getPoint(1),overDiff=points.reduce((a,b)=>Math.abs(a.x+1.7)<Math.abs(b.x+1.7)?a:b);
  assert.ok(end.y<overDiff.y-.018&&end.y<=.470,"outlet remains unnecessarily high after clearing the gearbox");
  // Keep the last 150 mm straight: flattening only the final tangent still
  // leaves a bent exit whose lower edge projects down onto the light.
  const axis=curve.getTangent(1);
  for(const p of points.filter(p=>p.x<=end.x+.150)){
    assert.ok(Math.abs(p.y-end.y)<1e-6&&Math.abs(p.z)<1e-6,"the final outlet section is not level and straight");
  }
  assert.ok(axis.x<-.999&&Math.abs(axis.y)<1e-6&&Math.abs(axis.z)<1e-6);
  const lamp=new T.Box3().setFromObject(get("Rear rain light housing"));
  assert.ok(end.y-pipe.userData.outerRadius>lamp.max.y+.015,"the outlet projects into the rain light");
  for(let i=0;i<16;i++){
    const angle=i*Math.PI/8;
    ray.set(end.clone().add(new T.Vector3(0,Math.cos(angle)*pipe.userData.outerRadius,Math.sin(angle)*pipe.userData.outerRadius)),axis);ray.far=.35;
    assert.equal(ray.intersectObject(get("Rear rain light housing"),false).length,0,"a projected outlet edge hits the rain light");
  }
  ray.set(end.clone().add(new T.Vector3(-.01,0,0)),new T.Vector3(1,0,0));ray.far=.20;
  assert.equal(ray.intersectObject(pipe).length,0,"tailpipe outlet has a closing face");
});

test("the wastegate return has round bends and clears the other exhaust branches",()=>{
  const pipe=get("Wastegate return pipe"),radius=pipe.userData.outerRadius;
  const curve=new T.CatmullRomCurve3(pipe.userData.route.map(p=>new T.Vector3(...p)),false,"centripetal");
  const points=curve.getSpacedPoints(800),start=points[0],end=points.at(-1);
  assert.ok(curve.getTangent(0).z>.999,"return is not aligned with its valve outlet");
  assert.ok(curve.getTangent(1).z>.999,"return is not aligned with its tailpipe port");
  for(let i=1;i<points.length-1;i++){
    const a=points[i-1],b=points[i],c=points[i+1],area2=b.clone().sub(a).cross(c.clone().sub(a)).length();
    const bend=a.distanceTo(b)*b.distanceTo(c)*c.distanceTo(a)/(2*area2);
    assert.ok(bend>radius*1.5,`return folds its bore at ${b.toArray()}: bend radius ${bend}`);
  }
  const region=new T.Box3().setFromPoints(points).expandByScalar(radius+.001),solids=[];
  model.root.traverse(o=>{
    if(!o.isMesh||o.isInstancedMesh||o===pipe||o.userData.component!=="exhaust")return;
    const bounds=new T.Box3().setFromObject(o);if(!bounds.intersectsBox(region))return;
    const p=o.geometry.attributes.position,ix=o.geometry.index,triangles=[];
    for(let i=0;i<(ix?.count??p.count);i+=3){
      const vertices=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(p,ix?ix.getX(i+j):i+j).applyMatrix4(o.matrixWorld));
      const box=new T.Box3().setFromPoints(vertices);
      if(box.intersectsBox(region))triangles.push({box,triangle:new T.Triangle(...vertices)});
    }
    solids.push({o,bounds,triangles});
  });
  const outletParts=new Set(["Wastegate outlet neck","Wastegate outlet V-band flange","Wastegate outlet pipe clamp"]);
  const closest=new T.Vector3(),errors=new Set();
  for(const p of points)for(const s of solids){
    // These are the two joined interfaces, not clearance obstacles. Keep the
    // exemption local so a later bend cannot cross the same parent pipe.
    if(outletParts.has(s.o.name)&&p.distanceTo(start)<.018)continue;
    if(s.o.name==="Exhaust tailpipe"&&p.distanceTo(end)<.033)continue;
    if(s.bounds.distanceToPoint(p)>radius+.001)continue;
    if(s.triangles.some(({box,triangle})=>box.distanceToPoint(p)<radius+.001&&triangle.closestPointToPoint(p,closest).distanceTo(p)<radius+.001))errors.add(s.o.name);
  }
  assert.deepEqual([...errors],[]);
});

test("the tail shield and body join enclose the descending pipe and leave an open aft outlet",()=>{
  const shield=get("Tail heat shield"),pipe=get("Exhaust tailpipe"),curve=new T.CatmullRomCurve3(pipe.userData.route.map(p=>new T.Vector3(...p)),false,"centripetal"),points=curve.getSpacedPoints(400);
  for(const x of[-1.95,-1.88,-1.78,-1.66]){
    const centre=points.reduce((a,b)=>Math.abs(a.x-x)<Math.abs(b.x-x)?a:b);
    ray.set(new T.Vector3(centre.x,.8,0),new T.Vector3(0,-1,0));ray.far=.4;
    const hit=ray.intersectObject(shield)[0];
    assert.ok(hit&&hit.point.y>centre.y+pipe.userData.outerRadius+.002,`the pipe emerges through the shield roof at ${x}`);
  }
  // Check the whole pipe wall where the black shield meets the body. A roof
  // check alone misses an exhaust bore breaking out through the tapered sides.
  const skin=createSurfaceSampler([shield,get("Continuous undercut sidepod shell")],"z"),p=pipe.geometry.attributes.position;
  let checked=0;
  for(let i=0;i<p.count;i++){
    const v=new T.Vector3().fromBufferAttribute(p,i).applyMatrix4(pipe.matrixWorld);
    if(v.x< -1.64||v.x> -1.40)continue;
    const edge=skin(v.x,v.y,Math.sign(v.z)||1);
    assert.ok(edge!==undefined&&Math.abs(edge)>Math.abs(v.z)+.003,`pipe exposed at body/shield join: ${v.toArray()}`);
    checked++;
  }
  assert.ok(checked>200);
  const body=get("Continuous undercut sidepod shell"),front=new T.Box3().setFromObject(shield).max.x;
  const lip=shield.geometry.attributes.position,oldSide=body.material.side;
  body.material.side=T.DoubleSide;
  let lipChecked=0;
  try{
    for(let i=0;i<lip.count;i++){
      const v=new T.Vector3().fromBufferAttribute(lip,i).applyMatrix4(shield.matrixWorld);
      if(v.x<front-.0041||v.y<.40)continue;
      const origin=new T.Vector3(v.x,.40,0),direction=v.clone().sub(origin);
      ray.set(origin,direction.clone().normalize());ray.far=.45;
      const hit=ray.intersectObject(body,false)[0];
      assert.ok(hit&&hit.distance>direction.length()+.003,`tail shield end face stands proud of body: ${v.toArray()}`);
      lipChecked++;
    }
  }finally{body.material.side=oldSide;}
  assert.ok(lipChecked>20);
  const end=points.at(-1),direction=curve.getTangent(1).negate();
  ray.set(end,direction);ray.far=.09;
  assert.equal(ray.intersectObjects([shield,get("Exhaust outlet shield rim")]).length,0,"shield caps the aft exhaust opening");
});
