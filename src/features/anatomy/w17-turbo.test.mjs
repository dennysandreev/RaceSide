import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { createW17 } from "./w17-geometry.ts";

const model=createW17();model.root.updateMatrixWorld(true);
const turbo=model.root.getObjectByName("Single-shaft turbocharger"),rotor=turbo.getObjectByName("Turbo rotating assembly"),ports=turbo.userData.ports;
const cases=[];turbo.traverse(part=>{if(part.isMesh&&part.userData.serviceCover)cases.push(part);});

// Close only the real suspension cutouts for the envelope test. A ray
// through an intentional service opening is not evidence of a protrusion.
// The temporary patches follow the actual cut edges in 3D; the installed
// body stays open and keeps its separate passage/laminate tests.
function bodyEnvelope(body){
  const p=body.geometry.attributes.position,index=body.geometry.index,edges=new Map();
  const point=i=>new T.Vector3().fromBufferAttribute(p,i);
  const key=i=>point(i).toArray().map(n=>Math.round(n*1e6)).join(",");
  for(let i=0;i<index.count;i+=3)for(let j=0;j<3;j++){
    const a=index.getX(i+j),b=index.getX(i+(j+1)%3),ka=key(a),kb=key(b);
    if(ka===kb)continue;
    const id=ka<kb?`${ka}/${kb}`:`${kb}/${ka}`,edge=edges.get(id);
    if(edge)edge.count++;else edges.set(id,{a,b,count:1});
  }
  const boundary=[...edges.values()].filter(edge=>edge.count===1),positions=Array.from(p.array),indices=Array.from(index.array);
  for(const profile of body.userData.suspensionPassages){
    const lines=profile.map((a,i)=>new T.Line3(new T.Vector3(...a,0),new T.Vector3(...profile[(i+1)%profile.length],0)));
    const onRim=i=>{const v=point(i);v.z=0;return lines.some(line=>line.closestPointToPoint(v,true,new T.Vector3()).distanceTo(v)<.00002);};
    const rim=[...new Set(boundary.filter(edge=>onRim(edge.a)&&onRim(edge.b)).flatMap(edge=>[edge.a,edge.b]))].map(point);
    for(const side of[-1,1]){
      const points=rim.filter(v=>v.z*side>0);
      assert.ok(points.length>=3,"suspension opening has no traceable body rim");
      const centre=points.reduce((sum,v)=>sum.add(v),new T.Vector3()).divideScalar(points.length);
      points.sort((a,b)=>Math.atan2(a.y-centre.y,a.x-centre.x)-Math.atan2(b.y-centre.y,b.x-centre.x));
      const offset=positions.length/3,triangles=T.ShapeUtils.triangulateShape(points.map(v=>new T.Vector2(v.x,v.y)),[]);
      assert.ok(triangles.length>0,"suspension rim could not be closed for the envelope check");
      points.forEach(v=>positions.push(...v.toArray()));triangles.forEach(t=>indices.push(...t.map(i=>offset+i)));
    }
  }
  const geometry=new T.BufferGeometry();geometry.setAttribute("position",new T.Float32BufferAttribute(positions,3));geometry.setIndex(indices);
  const envelope=new T.Mesh(geometry,new T.MeshBasicMaterial({side:T.DoubleSide}));
  envelope.matrix.copy(body.matrixWorld);envelope.matrixAutoUpdate=false;envelope.updateMatrixWorld(true);return envelope;
}

test("turbo wheels share one shaft and meet the 2026 wheel diameter and axial envelopes",()=>{
  const boxes=[];
  for(const name of ["Compressor","Turbine"]){
    const parts=rotor.children.filter(part=>part.userData.turboBlade===name),box=new T.Box3();let radius=0;
    assert.equal(parts.length,name==="Compressor"?12:11);
    for(const part of parts){
      box.expandByObject(part);const p=part.geometry.attributes.position;
      for(let i=0;i<p.count;i++){
        const point=new T.Vector3().fromBufferAttribute(p,i).applyMatrix4(part.matrixWorld);
        radius=Math.max(radius,Math.hypot(point.y-.51,point.z));
      }
    }
    const length=box.max.x-box.min.x;
    assert.ok(radius*2>=(name==="Compressor"?.100:.090)&&radius*2<=(name==="Compressor"?.110:.100));
    assert.ok(length>=(name==="Compressor"?.030:.035)&&length<=(name==="Compressor"?.035:.040));
    boxes.push(box);assert.equal(turbo.getObjectByName(`${name} wheel hub`).parent,rotor);
  }
  assert.ok(boxes[0].min.x-boxes[1].max.x<.175);
  const shaft=turbo.getObjectByName("Turbo shaft"),box=new T.Box3().setFromObject(shaft);
  assert.equal(shaft.parent,rotor);assert.ok(box.min.x<boxes[1].min.x&&box.max.x>boxes[0].max.x);
});

test("axial turbo ports open onto real wheels and tangential ports open into hollow scrolls",()=>{
  const ray=new T.Raycaster();
  for(const compressor of [true,false]){
    const name=compressor?"Compressor":"Turbine",sign=compressor?1:-1,port=new T.Vector3(...ports[compressor?"airInlet":"exhaustOutlet"]);
    for(const angle of [.2,1.4,2.7,4.1,5.3]){
      ray.set(port.clone().add(new T.Vector3(sign*.005,.020*Math.cos(angle),.020*Math.sin(angle))),new T.Vector3(-sign,0,0));ray.far=.11;
      const first=ray.intersectObject(turbo,true)[0];
      assert.ok(first?.object.name.startsWith(`${name} wheel`)||first?.object.name.startsWith(`${name} curved blade`),`opaque inlet at ${name}/${angle}: ${first?.object.name}`);
    }
    const outlet=new T.Vector3(...ports[compressor?"chargeOutlet":"exhaustInlet"]),side=compressor?1:-1;
    const outward=new T.Vector3(0,-Math.sin(.60),side*Math.cos(.60));
    ray.set(outlet.clone().addScaledVector(outward,.01),outward.clone().negate());ray.far=.072;
    const hit=ray.intersectObjects(cases,false)[0];
    assert.ok(!hit,`${name} scroll port is capped by ${hit?.object.name}`);
  }
});

test("curved blade roots join their hubs and rotating tips clear both casings",()=>{
  const ray=new T.Raycaster(),materials=new Map();
  cases.forEach(part=>{if(!materials.has(part.material))materials.set(part.material,part.material.side);part.material.side=T.DoubleSide;});
  try{
    for(const part of rotor.children.filter(part=>part.userData.turboBlade)){
      const hub=rotor.getObjectByName(`${part.userData.turboBlade} wheel hub`),p=part.geometry.attributes.position;
      for(const row of [4,10,17]){
        const point=new T.Vector3().fromBufferAttribute(p,row*9).applyMatrix4(part.matrixWorld),radial=point.clone().sub(new T.Vector3(point.x,.51,0)).normalize();
        ray.set(point.clone().addScaledVector(radial,.002),radial.clone().negate());ray.far=.004;
        assert.ok(ray.intersectObject(hub,false)[0],`${part.name} has a detached root`);
      }
      for(const row of [0,8,16,24]){
        const local=new T.Vector3().fromBufferAttribute(p,row*9+8);
        for(let step=0;step<24;step++){
          const a=local.clone().applyAxisAngle(new T.Vector3(1,0,0),step*Math.PI/12).add(rotor.position);
          const b=local.clone().applyAxisAngle(new T.Vector3(1,0,0),(step+1)*Math.PI/12).add(rotor.position),direction=b.clone().sub(a);
          ray.set(a,direction.clone().normalize());ray.far=direction.length();
          const hit=ray.intersectObjects(cases,false)[0];assert.ok(!hit,`${part.name} strikes ${hit?.object.name} while rotating`);
        }
      }
    }
  }finally{for(const [material,side] of materials)material.side=side;}
});

test("inlet and exhaust ducts meet turbo ports with uncapped bores",()=>{
  for(const [name,key,end] of [["Filtered air duct","airInlet",-1],["Exhaust tailpipe","exhaustOutlet",0],["Exhaust turbine feed","exhaustInlet",-1]]){
    const part=model.root.getObjectByName(name),route=part.userData.route;
    assert.deepEqual(route.at(end),ports[key],`${name}: disconnected turbo port`);
    const curve=new T.CatmullRomCurve3(route.map(point=>new T.Vector3(...point)),false,"centripetal"),t=end===0?.001:.999;
    const ray=new T.Raycaster(curve.getPoint(t),curve.getTangent(t).multiplyScalar(end===0?1:-1),0,.004);
    assert.ok(!ray.intersectObject(part,false)[0],`${name}: solid duct end`);
  }
  const junction=model.root.getObjectByName("Exhaust turbine feed").userData.route[0];
  for(const side of [-1,1])assert.deepEqual(model.root.getObjectByName(`Exhaust collector ${side}`).userData.route.at(-1),junction);
  assert.ok(!model.root.getObjectByName("Dark exhaust opening"),"the exhaust is still closed by a black disc");
});

test("the installed turbo stays inside the body and its mounting eyes are drilled through",()=>{
  const body=bodyEnvelope(model.root.getObjectByName("Continuous undercut sidepod shell")),ray=new T.Raycaster();
  turbo.traverse(part=>{
    if(!part.isMesh)return;const p=part.geometry.attributes.position;
    for(let i=0;i<p.count;i+=83){
      const point=new T.Vector3().fromBufferAttribute(p,i).applyMatrix4(part.matrixWorld);
      for(const direction of [new T.Vector3(0,-1,0),new T.Vector3(0,0,point.z>0?-1:1)]){
        ray.set(point.clone().addScaledVector(direction,-1),direction);ray.far=2;
        const hit=ray.intersectObject(body,false)[0];
        assert.ok(hit&&hit.distance<1.002,`${part.name} protrudes from the body at ${point.toArray()}`);
      }
    }
  });
  // A point outside the repaired opening must still fail containment.
  ray.set(new T.Vector3(-1.213,.532,1),new T.Vector3(0,0,-1));ray.far=2;
  const side=ray.intersectObject(body,false)[0];assert.ok(side);
  const outside=side.point.clone().add(new T.Vector3(0,0,.005));
  ray.set(outside.clone().add(new T.Vector3(0,0,1)),new T.Vector3(0,0,-1));
  assert.ok(ray.intersectObject(body,false)[0].distance>1.002,"the envelope accepts an outside point through a suspension opening");
  body.geometry.dispose();body.material.dispose();
  for(const side of [-1,1]){
    ray.set(new T.Vector3(-1.12,.49,side*.045),new T.Vector3(0,-1,0));ray.far=.016;
    const hit=ray.intersectObjects([turbo.getObjectByName(`Turbo support foot ${side}`),turbo.getObjectByName(`Turbo mounting eye ${side}`)],false)[0];
    assert.ok(!hit,"turbo mounting bolt bore is blocked");
  }
});
