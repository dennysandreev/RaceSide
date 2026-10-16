import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { createW17 } from "./w17-geometry.ts";
import { createSurfaceSampler } from "./w17-surface.ts";

const model=createW17();model.root.updateMatrixWorld(true);
const routes=[];model.root.traverse(part=>{if(part.userData.route)routes.push(part);});
const curveFor=part=>new T.CatmullRomCurve3(part.userData.route.map(p=>new T.Vector3(...p)),false,"centripetal");

// Test the occupied hose volume, not only whether its centre line happens to
// miss a fin. Radiator frames are inclined and mirrored in the installed car.
test("coolant and oil hoses clear both complete radiator envelopes",()=>{
  for(const side of [-1,1]){
    const pack=model.root.getObjectByName(`Radiator pack ${side}`),inverse=pack.matrixWorld.clone().invert();
    const bounds=new T.Box3(new T.Vector3(-.312,-.030,-.156),new T.Vector3(.312,.030,.156));
    for(const part of routes.filter(p=>p.userData.component==="cooling")){
      const curve=curveFor(part),radius=part.userData.outerRadius;
      for(let i=0;i<=240;i++){
        const point=curve.getPoint(i/240).applyMatrix4(inverse);
        assert.ok(bounds.distanceToPoint(point)>radius+.001,`${part.name} crosses radiator ${side} at ${i}/240`);
      }
    }
  }
});

const casings=[];
model.root.traverse(part=>{
  if(!part.isMesh||!/^(Cast V6 crankcase|Front crankcase transmission bridge|Cylinder head housing|Cam cover|MGU-K motor housing upper|MGU-K motor housing lower|Engine timing case wall|Engine timing case front plate|Engine timing end cover -0.938)$|^(Cylinder head housing|Cam cover) [-1]/.test(part.name))return;
  const p=part.geometry.attributes.position,index=part.geometry.index,triangles=[];
  for(let i=0;i<(index?.count??p.count);i+=3){
    const vertices=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(p,index?index.getX(i+j):i+j).applyMatrix4(part.matrixWorld));
    const triangle=new T.Triangle(...vertices);triangles.push({triangle,bounds:new T.Box3().setFromPoints(vertices)});
  }
  casings.push({part,bounds:new T.Box3().setFromObject(part),triangles});
});

test("external pipe walls stay outside engine covers and the motor housing",()=>{
  const errors=new Set(),closest=new T.Vector3();
  for(const part of routes.filter(p=>["cooling","intake","exhaust"].includes(p.userData.component))){
    const curve=curveFor(part),length=curve.getLength(),radius=part.userData.outerRadius;
    // The first/last 35 mm may enter their own connector. Everything between
    // those connections must have space for the full tube wall.
    for(let i=1;i<120;i++){
      const u=i/120;if(Math.min(u,1-u)*length<.035)continue;
      const point=curve.getPointAt(u);
      for(const casing of casings){
        if(casing.bounds.distanceToPoint(point)>radius+.002)continue;
        for(const {triangle,bounds} of casing.triangles){
          if(bounds.distanceToPoint(point)>radius+.002)continue;
          if(triangle.closestPointToPoint(point,closest).distanceTo(point)<radius+.001){errors.add(`${part.name} / ${casing.part.name}`);break;}
        }
      }
    }
  }
  assert.deepEqual([...errors],[]);
});

test("bolt-on oil hardware and the motor do not occupy the engine casting",()=>{
  const engine=casings.filter(c=>c.part.userData.component==="engine").map(c=>c.part),ray=new T.Raycaster();
  const bounds=new Map(engine.map(part=>[part,new T.Box3().setFromObject(part)]));
  const materials=new Map();engine.forEach(p=>{if(!materials.has(p.material))materials.set(p.material,p.material.side);p.material.side=T.DoubleSide;});
  const errors=new Set();
  try{
    for(const name of ["Oil pump stage 0","Oil pump stage 1","Oil pump stage 2","Oil filter housing","Oil cooler plate stack","MGU-K motor housing upper","MGU-K motor housing lower"]){
      const part=model.root.getObjectByName(name),p=part.geometry.attributes.position;
      for(let i=0;i<p.count;i+=11){
        const point=new T.Vector3().fromBufferAttribute(p,i).applyMatrix4(part.matrixWorld);
        ray.set(point,new T.Vector3(.031,1,.017).normalize());ray.far=1;
        for(const target of engine){
          // A point outside the casting bounds cannot be inside it. Distant
          // rays grazing a thin cover corner can merge entry/exit hits below
          // the deduplication tolerance and otherwise give a false odd count.
          if(!bounds.get(target).containsPoint(point))continue;
          const distances=ray.intersectObject(target,false).map(h=>h.distance).filter((d,j,all)=>j===0||d-all[j-1]>1e-6);
          if(distances.length%2)errors.add(`${name} inside ${target.name}`);
        }
      }
    }
  }finally{for(const [m,side]of materials)m.side=side;}
  assert.deepEqual([...errors],[]);
});

test("the airbox reducer shares its rear mouth with the intake duct",()=>{
  const reducer=model.root.getObjectByName("Airbox outlet reducer"),p=reducer.geometry.attributes.position;
  const duct=model.root.getObjectByName("Filtered air duct"),start=new T.Vector3(...duct.userData.route[0]);
  const ring=[];for(let i=0;i<p.count;i++)if(Math.abs(p.getX(i)-start.x)<1e-6)ring.push(new T.Vector3().fromBufferAttribute(p,i));
  assert.ok(ring.length>60);
  for(const point of ring){const radius=Math.hypot(point.y-start.y,point.z-start.z);assert.ok(Math.min(Math.abs(radius-.037),Math.abs(radius-.0345))<1e-6);}
  const ray=new T.Raycaster(start.clone().add(new T.Vector3(.008,0,0)),new T.Vector3(-1,0,0),0,.016);
  assert.ok(!ray.intersectObjects([reducer,duct],false).length,"an opaque cap blocks the connection");
  const rear=[];for(let i=0;i<p.count;i++)if(Math.abs(p.getX(i)+.24)<1e-6)rear.push(new T.Vector3().fromBufferAttribute(p,i));
  assert.ok(Math.max(...rear.map(p=>p.y))>.97&&Math.min(...rear.map(p=>p.y))<.89,"the duct does not cover the airbox rear opening");
});

test("cooling hoses stay away from the hot exhaust branches",()=>{
  const exhaust=routes.filter(p=>/^Exhaust (primary|collector|turbine feed)/.test(p.name)).map(part=>({part,points:curveFor(part).getSpacedPoints(240)}));
  const line=new T.Line3(),closest=new T.Vector3(),errors=[];
  for(const hose of routes.filter(p=>p.userData.component==="cooling")){
    const points=curveFor(hose).getSpacedPoints(120);
    for(const branch of exhaust){
      let gap=Infinity;
      for(const point of points)for(let i=1;i<branch.points.length;i++){
        line.set(branch.points[i-1],branch.points[i]);
        gap=Math.min(gap,line.closestPointToPoint(point,true,closest).distanceTo(point)-hose.userData.outerRadius-branch.part.userData.outerRadius);
      }
      if(gap<.012)errors.push(`${hose.name} / ${branch.part.name}: ${gap.toFixed(4)} m`);
    }
  }
  assert.deepEqual(errors,[]);
});

test("rebuilt head and nearby oil routes retain space for their inner tube walls",()=>{
  for(const part of routes.filter(p=>/^Cylinder intake runner |^Exhaust primary |^Oil pressure hose$|^Oil cooler feed hose$|^MGU-K coolant return$/.test(p.name))){
    const points=curveFor(part).getSpacedPoints(4000);
    for(let i=1;i<points.length-1;i++){
      const ab=points[i].clone().sub(points[i-1]),bc=points[i+1].clone().sub(points[i]),ac=points[i+1].clone().sub(points[i-1]);
      const cross=ab.clone().cross(bc).length();if(cross<1e-16)continue;
      const radius=ab.length()*bc.length()*ac.length()/(2*cross);
      assert.ok(radius>part.userData.outerRadius+.0002,`${part.name}: folded inner wall at ${points[i].toArray()}`);
    }
  }
});

test("six straight intake runners connect hollow head necks to real plenum underside ports",()=>{
  const plenum=model.root.getObjectByName("Intake plenum");
  for(const side of[-1,1])for(let i=0;i<3;i++){
    const runner=model.root.getObjectByName(`Cylinder intake runner ${side} ${i}`),outlet=model.root.getObjectByName(`Head intake outlet ${side} ${i}`),coupling=model.root.getObjectByName(`Cylinder intake coupling ${side} ${i}`);
    const [from,to]=runner.userData.route.map(v=>new T.Vector3(...v));
    assert.ok(Math.abs(from.x-to.x)+Math.abs(from.z-to.z)<1e-10&&to.y>from.y+.04,"runner folds around the plenum");
    for(const [dx,dz]of[[0,0],[.007,0],[-.007,0],[0,.007],[0,-.007]]){
      const ray=new T.Raycaster(from.clone().add(new T.Vector3(dx,-.002,dz)),new T.Vector3(0,1,0),0,.02);
      assert.equal(ray.intersectObjects([outlet,runner],false).length,0,"head neck has a blocked mouth");
      ray.set(to.clone().add(new T.Vector3(dx,-.02,dz)),new T.Vector3(0,1,0));ray.far=.04;
      assert.equal(ray.intersectObjects([runner,coupling,plenum],false).length,0,"solid plenum underside blocks the runner");
      const side=plenum.material.side;plenum.material.side=T.DoubleSide;
      try{ray.far=.2;assert.ok(ray.intersectObject(plenum,false).length,"port drilling removed the opposite plenum roof");}
      finally{plenum.material.side=side;}
    }
  }
});

test("Halo feet have structural seats that stay present with the body removed",()=>{
  const ray=new T.Raycaster(),cell=model.assemblies.get("monocoque");
  for(const [x,y,z,name]of[[.130,.650,-.237,"Halo rear attachment -1"],[.130,.650,.237,"Halo rear attachment 1"],[.852,.675,0,"Forward survival cell deck"],[-.20,.60,-.14,"Roll hoop attachment -1"],[-.20,.60,.14,"Roll hoop attachment 1"]]){
    const seat=cell.getObjectByName(name);assert.equal(seat.userData.structural,true);
    ray.set(new T.Vector3(x,y,z),new T.Vector3(0,-1,0));ray.far=.045;
    assert.ok(ray.intersectObject(seat,false).length,`${name}: floating foot`);
  }
  for(const side of[-1,1])assert.equal(cell.getObjectByName(`Cockpit side ${side}`).userData.structural,true);
});

test("the removable front crash structure seats on the matching monocoque face",()=>{
  const cell=model.root.getObjectByName("Forward survival cell deck"),nose=model.root.getObjectByName("Nose structural core");
  const jointX=new T.Box3().setFromObject(cell).max.x;
  assert.ok(jointX>1.7,"the front suspension mounts must remain behind the removable nose joint");
  const face=part=>{const p=part.geometry.attributes.position,points=[];for(let i=0;i<p.count;i++)if(Math.abs(p.getX(i)-jointX)<1e-6)points.push(new T.Vector3().fromBufferAttribute(p,i));return points;};
  const a=face(cell),b=face(nose);assert.ok(a.length>=40&&b.length>=40);
  // A service passage can subdivide the cap without changing its surface.
  // Compare the actual mating triangles rather than requiring equal vertices.
  const triangles=part=>{
    const p=part.geometry.attributes.position,ix=part.geometry.index,result=[];
    for(let i=0;i<ix.count;i+=3){const points=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(p,ix.getX(i+j)));if(points.every(v=>Math.abs(v.x-jointX)<1e-6))result.push(new T.Triangle(...points));}
    return result;
  };
  for(const [points,surface]of[[a,triangles(nose)],[b,triangles(cell)]])for(const p of points)assert.ok(surface.some(t=>t.closestPointToPoint(p,new T.Vector3()).distanceTo(p)<1e-6),"the mating contours leave a gap or step");
  assert.notEqual(cell.parent,nose.parent,"the replaceable crash structure must remain a distinct assembly");
});


test("the motor and timing case clear the floor and stay inside the assembled body",()=>{
  const floor=[];model.assemblies.get("floor").traverse(p=>{if(p.isMesh)floor.push(p);});
  const height=createSurfaceSampler(floor,"y"),body=model.root.getObjectByName("Continuous undercut sidepod shell");
  const roof=createSurfaceSampler([body],"y"),side=createSurfaceSampler([body],"z");
  for(const assembly of [model.assemblies.get("mguk"),model.root.getObjectByName("V6 mechanical timing drive")])assembly.traverse(part=>{
    if(!part.isMesh)return;const p=part.geometry.attributes.position;
    for(let i=0;i<p.count;i++){
      const v=new T.Vector3().fromBufferAttribute(p,i).applyMatrix4(part.matrixWorld),floorY=height(v.x,v.z,1),roofY=roof(v.x,v.z,1),outerZ=side(v.x,v.y,1);
      if(floorY!==undefined)assert.ok(v.y>floorY+.003,`${part.name} intersects floor: ${v.toArray()} / ${floorY}`);
      if(roofY!==undefined)assert.ok(v.y<roofY-.002,`${part.name} crosses the engine cover`);
      if(outerZ!==undefined)assert.ok(v.z<outerZ-.002,`${part.name} crosses the sidepod`);
    }
  });
});

test("sidepod skins enclose exhaust primaries, the motor return hose and radiator ears",()=>{
  const side=createSurfaceSampler([model.root.getObjectByName("Continuous undercut sidepod shell")],"z");
  let checked=0;
  model.root.traverse(part=>{
    if(!part.isMesh||!/^Exhaust primary |^MGU-K coolant return$|^Radiator mounting ear /.test(part.name))return;
    const p=part.geometry.attributes.position;
    for(let i=0;i<p.count;i++){
      const v=new T.Vector3().fromBufferAttribute(p,i).applyMatrix4(part.matrixWorld);
      const edge=side(v.x,v.y,Math.sign(v.z)||1);
      if(edge===undefined)continue;
      checked++;
      assert.ok(Math.abs(v.z)<Math.abs(edge)-.003,`${part.name} protrudes through sidepod at ${v.toArray()}`);
    }
  });
  assert.ok(checked>10000,"installed parts were not checked against the body");
});
