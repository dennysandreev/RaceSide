import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { createW17 } from "./w17-geometry.ts";
import { createSurfaceSampler } from "./w17-surface.ts";

const model=createW17();model.root.updateMatrixWorld(true);
const cooling=model.assemblies.get("cooling"),pack=model.root.getObjectByName("Cooling and lubrication pack");

const oilPumpLines=[
  ["Oil reservoir supply hose","Oil reservoir supply","Oil pump supply"],
  ["Oil pressure hose","Oil pressure outlet","Oil filter feed"],
  ["Sump scavenge hose 0","Sump pickup 0","Scavenge 0"],
  ["Sump scavenge hose 1","Sump pickup 1","Scavenge 1"],
  ["Oil cooler feed hose","Oil scavenge outlet","Oil cooler inlet"],
];

test("main coolant hoses enter all four radiator unions along the socket axis",()=>{
  for(const side of[-1,1])for(const [line,from,to]of[
    ["hot",`Engine ${side} hot`,`Radiator ${side} hot`],
    ["return",`Radiator ${side} cold`,`Engine ${side} cold`],
  ]){
    const hose=model.root.getObjectByName(`Coolant ${line} line ${side}`);
    const curve=new T.CatmullRomCurve3(hose.userData.route.map(p=>new T.Vector3(...p)),false,"centripetal");
    for(const [t,fitting,sign]of[[0,from,1],[1,to,-1]]){
      const socket=model.root.getObjectByName(`${fitting} socket`),axis=new T.Vector3(0,1,0).transformDirection(socket.matrixWorld);
      assert.ok(curve.getPoint(t).distanceTo(new T.Vector3(...pack.userData.ports[fitting]))<1e-8,"detached hose");
      assert.ok(curve.getTangent(t).multiplyScalar(sign).dot(axis)>.999,`${hose.name} crosses ${fitting} sideways`);
      const terminal=curve.getPoint(t),points=curve.getSpacedPoints(1200);
      for(const d of [.004,.008,.012]){
        const target=terminal.clone().addScaledVector(axis,d);
        assert.ok(Math.min(...points.map(p=>p.distanceTo(target)))<.001,`${fitting}: no straight coupling section`);
      }
    }
  }
});

test("the inboard radiator elbow routes its return clear of the electrical cooling lines",()=>{
  const elbow=model.root.getObjectByName("Radiator 1 cold elbow"),socket=model.root.getObjectByName("Radiator 1 cold socket");
  assert.equal(elbow.geometry.parameters.shapes.holes.length,1,"solid elbow blocks the coolant");
  const axis=new T.Vector3(0,1,0).transformDirection(socket.matrixWorld);
  assert.ok(axis.z>.9,"the outlet must face the clear outboard corridor");
  const bend=elbow.geometry.parameters.options.extrudePath;
  assert.ok(bend.getTangent(1).dot(axis)>.999,"elbow and union do not share a tangent");
  assert.ok(bend.getPoint(1).distanceTo(socket.getWorldPosition(new T.Vector3()))<1e-8,"elbow is detached from the socket");
  const hose=model.root.getObjectByName("Coolant return line 1");
  const curve=part=>new T.CatmullRomCurve3(part.userData.route.map(p=>new T.Vector3(...p)),false,"centripetal");
  const points=curve(hose).getSpacedPoints(500),segment=new T.Line3(),closest=new T.Vector3();
  for(const name of["ES coolant supply","MGU-K coolant return"]){
    const neighbor=model.root.getObjectByName(name),route=curve(neighbor).getSpacedPoints(500);let clearance=Infinity;
    for(const p of points)for(let i=1;i<route.length;i++){
      segment.set(route[i-1],route[i]);clearance=Math.min(clearance,segment.closestPointToPoint(p,true,closest).distanceTo(p)-hose.userData.outerRadius-neighbor.userData.outerRadius);
    }
    assert.ok(clearance>.002,`${name}: coolant hoses overlap (${clearance})`);
  }
});

test("main radiator returns clear the tub, lower pan and adjacent installed hardware",()=>{
  const closest=new T.Vector3(),instanceMatrix=new T.Matrix4(),errors=new Set();
  for(const side of[-1,1]){
    const hose=model.root.getObjectByName(`Coolant return line ${side}`),radius=hose.userData.outerRadius+.0005;
    const points=new T.CatmullRomCurve3(hose.userData.route.map(p=>new T.Vector3(...p)),false,"centripetal").getSpacedPoints(600);
    const occupied=new T.Box3().setFromPoints(points).expandByScalar(radius);
    const fittings=[`Radiator ${side} cold socket`,`Radiator ${side} cold collar`,`Engine ${side} cold socket`,`Engine ${side} cold collar`];
    model.root.traverse(part=>{
      if(!part.isMesh||part.name.startsWith(hose.name)||fittings.includes(part.name))return;
      const bounds=new T.Box3().setFromObject(part);if(!bounds.intersectsBox(occupied))return;
      const candidates=points.filter(p=>bounds.distanceToPoint(p)<radius),position=part.geometry.attributes.position,index=part.geometry.index;
      if(!candidates.length)return;
      for(let copy=0;copy<(part.isInstancedMesh?part.count:1);copy++){
        const transform=part.matrixWorld.clone();
        if(part.isInstancedMesh){part.getMatrixAt(copy,instanceMatrix);transform.multiply(instanceMatrix);}
        for(let i=0;i<(index?.count??position.count);i+=3){
          const vertices=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(position,index?index.getX(i+j):i+j).applyMatrix4(transform));
          const box=new T.Box3().setFromPoints(vertices),triangle=new T.Triangle(...vertices);
          if(candidates.some(p=>box.distanceToPoint(p)<radius&&triangle.closestPointToPoint(p,closest).distanceTo(p)<radius)){
            errors.add(`${hose.name} / ${part.name}`);return;
          }
        }
      }
    });
  }
  assert.deepEqual([...errors],[]);
});

test("radiator return bends retain room for their inner walls",()=>{
  for(const side of[-1,1]){
    const hose=model.root.getObjectByName(`Coolant return line ${side}`);
    const curve=new T.CatmullRomCurve3(hose.userData.route.map(p=>new T.Vector3(...p)),false,"centripetal"),points=curve.getSpacedPoints(2000);
    let minimum=Infinity;
    for(let i=1;i<points.length-1;i++){
      const a=points[i].clone().sub(points[i-1]),b=points[i+1].clone().sub(points[i]),cross=a.clone().cross(b).length();
      if(cross<1e-12)continue;
      minimum=Math.min(minimum,a.length()*b.length()*points[i+1].distanceTo(points[i-1])/(2*cross));
    }
    assert.ok(minimum>hose.userData.outerRadius*1.2,`${hose.name}: pinched inner bend (${minimum})`);
  }
});

test("upward pump inlets join open pump mouths without a floating or blocked connection",()=>{
  for(const side of[-1,1]){
    const pump=model.root.getObjectByName(`Coolant pump ${side}`),elbow=model.root.getObjectByName(`Coolant pump inlet elbow ${side}`);
    const socket=model.root.getObjectByName(`Engine ${side} cold socket`),bend=elbow.geometry.parameters.options.extrudePath;
    assert.equal(elbow.geometry.parameters.shapes.holes.length,1);
    assert.ok(bend.getPoint(1).distanceTo(socket.getWorldPosition(new T.Vector3()))<1e-8);
    assert.ok(bend.getTangent(1).dot(new T.Vector3(0,1,0))>.999);
    const mouth=bend.getPoint(0),bounds=new T.Box3().setFromObject(pump);
    assert.ok(Math.abs(bounds.max.x-mouth.x)<1e-7,"inlet elbow floats in front of the pump");
    const ray=new T.Raycaster(mouth.clone().add(new T.Vector3(.001,0,0)),new T.Vector3(-1,0,0),0,.04);
    assert.equal(ray.intersectObject(pump,false).length,0,"an opaque pump cover caps the inlet");
    ray.set(mouth.clone().add(new T.Vector3(.001,.020,0)),new T.Vector3(-1,0,0));
    assert.ok(ray.intersectObject(pump,false).length,"pump cover is missing around the bore");
  }
});

test("dry-sump pump ports are distinct and each hose meets its fitting coaxially",()=>{
  const names=["Oil pump supply","Oil pressure outlet","Scavenge 0","Scavenge 1","Oil scavenge outlet"];
  for(let i=0;i<names.length;i++)for(let j=i+1;j<names.length;j++){
    const a=new T.Vector3(...pack.userData.ports[names[i]]),b=new T.Vector3(...pack.userData.ports[names[j]]);
    assert.ok(a.distanceTo(b)>.030,`${names[i]} overlaps ${names[j]}`);
  }
  for(const [name,from,to]of oilPumpLines){
    const part=model.root.getObjectByName(name),curve=new T.CatmullRomCurve3(part.userData.route.map(p=>new T.Vector3(...p)),false,"centripetal");
    for(const [t,fitting,sign]of[[0,from,1],[1,to,-1]]){
      const socket=model.root.getObjectByName(`${fitting} socket`),axis=new T.Vector3(0,1,0).transformDirection(socket.matrixWorld);
      assert.ok(curve.getTangent(t).multiplyScalar(sign).dot(axis)>.995,`${name}: crosses ${fitting} sideways`);
      const end=new T.Vector3(...pack.userData.ports[fitting]);
      assert.ok(curve.getPoint(t).distanceTo(end)<1e-8,`${name}: detached end`);
      for(const d of [.005,.010]){
        const point=end.clone().addScaledVector(axis,d),nearest=Math.min(...curve.getSpacedPoints(400).map(p=>p.distanceTo(point)));
        assert.ok(nearest<.002,`${name}: bends across its terminal collar`);
      }
    }
  }
});

test("the five local oil-pump lines have room for both hose walls",()=>{
  const lines=oilPumpLines.map(([name])=>{
    const hose=model.root.getObjectByName(name);
    return {name,radius:hose.userData.outerRadius,points:new T.CatmullRomCurve3(hose.userData.route.map(p=>new T.Vector3(...p)),false,"centripetal").getSpacedPoints(400)};
  });
  const segment=new T.Line3(),closest=new T.Vector3();
  for(let i=0;i<lines.length;i++)for(let j=i+1;j<lines.length;j++){
    let gap=Infinity;const a=lines[i],b=lines[j];
    for(const p of a.points)for(let k=1;k<b.points.length;k++){
      segment.set(b.points[k-1],b.points[k]);gap=Math.min(gap,segment.closestPointToPoint(p,true,closest).distanceTo(p)-a.radius-b.radius);
    }
    assert.ok(gap>.001,`${a.name} touches ${b.name}: ${gap}`);
  }
});

test("radiator cores contain coolant bores and open air passages between real folded fins",()=>{
  const ray=new T.Raycaster();
  for(const side of [-1,1]){
    const group=model.root.getObjectByName(`Radiator pack ${side}`),tubes=model.root.getObjectByName(`Radiator fluid tubes ${side}`),fins=model.root.getObjectByName(`Radiator folded fins ${side}`);
    assert.ok(tubes.isInstancedMesh&&fins.isInstancedMesh);
    const normal=new T.Vector3(0,-1,0).transformDirection(group.matrixWorld);
    let open=0,blocked=0;
    for(let x=-.009;x<.009;x+=.0037)for(let z=-.10;z<.10;z+=.047){
      ray.set(new T.Vector3(x,.05,z).applyMatrix4(group.matrixWorld),normal);ray.far=.10;
      if(ray.intersectObjects([tubes,fins])[0])blocked++;else open++;
    }
    assert.ok(open>blocked,"the radiator is a solid plate instead of a porous core");
    assert.ok(blocked>1,"the core has no physical tubes or fins");
    const matrix=new T.Matrix4();tubes.getMatrixAt(14,matrix);const centre=new T.Vector3().setFromMatrixPosition(matrix);
    const direction=new T.Vector3(0,0,1).transformDirection(group.matrixWorld);
    ray.set(new T.Vector3(centre.x,0,-.111).applyMatrix4(group.matrixWorld),direction);ray.far=.222;
    assert.ok(!ray.intersectObject(tubes)[0],"coolant tube bore is capped");
  }
});

test("every cooling hose ends on two real sockets with a continuous bore",()=>{
  const ports=Object.values(pack.userData.ports).map(p=>new T.Vector3(...p)),ray=new T.Raycaster();
  let count=0;
  cooling.traverse(part=>{
    if(!part.userData.route)return;count++;
    for(const p of [part.userData.route[0],part.userData.route.at(-1)]){
      const point=new T.Vector3(...p);assert.ok(ports.some(port=>port.distanceTo(point)<1e-6),`${part.name}: loose hose end`);
    }
    const points=part.userData.route.map(p=>new T.Vector3(...p)),curve=new T.CatmullRomCurve3(points,false,"centripetal");
    for(const t of [.001,.999]){
      const axis=curve.getTangent(t).multiplyScalar(t<.5?1:-1);ray.set(curve.getPoint(t),axis);ray.far=.004;
      assert.ok(!ray.intersectObject(part)[0],`${part.name}: solid hose end`);
    }
  });
  assert.ok(count>=10);
  for(const name of ["Dry-sump oil reservoir","Dry-sump pump stages","Oil filter housing","Oil heat exchanger"])assert.ok(model.root.getObjectByName(name),name);
});

test("the charge radiator return enters its rear-facing union without folding back",()=>{
  const hose=model.root.getObjectByName("Charge warm water line"),socket=model.root.getObjectByName("Charge radiator hot socket");
  const curve=new T.CatmullRomCurve3(hose.userData.route.map(p=>new T.Vector3(...p)),false,"centripetal");
  const outlet=new T.Vector3(0,1,0).transformDirection(socket.matrixWorld);
  assert.ok(outlet.x<-.99,"the union must face the incoming hose, toward the rear");
  assert.ok(curve.getTangent(1).negate().dot(outlet)>.995,"hose folds across the end of the union");
  const end=curve.getPoint(1);
  for(let t=.9;t<=1;t+=.005){
    const p=curve.getPoint(t);
    assert.ok(p.x<=end.x+1e-6,"the hose doubles back past its connection");
    assert.ok(curve.getTangent(t).dot(outlet)<-.99,"a sharp bend remains immediately before the union");
  }
});

test("radiator duct walls are closed laminates with two open rims seated on the throat and core",()=>{
  for(const side of [-1,1]){
    const duct=model.root.getObjectByName(`Radiator inlet duct ${side}`),position=duct.geometry.attributes.position,index=duct.geometry.index.array,edges=new Map();
    for(let i=0;i<index.length;i+=3)for(let j=0;j<3;j++){
      const a=index[i+j],b=index[i+(j+1)%3],key=a<b?`${a}/${b}`:`${b}/${a}`,value=edges.get(key)??[0,0];value[0]++;value[1]+=a<b?1:-1;edges.set(key,value);
    }
    for(const [key,[count,winding]] of edges){assert.equal(count,2,key);assert.equal(winding,0,key);}
    assert.ok(position.count>2000);assert.equal(duct.userData.serviceCover,true);
    const entry=model.root.getObjectByName(`Recessed sidepod inlet ${side}`),throat=entry.geometry.attributes.position,n=entry.userData.inletVertices;
    for(let i=0;i<64;i++){
      const point=new T.Vector3().fromBufferAttribute(position,i);let closest=Infinity;
      for(let j=0;j<n;j++){
        const a=new T.Vector3().fromBufferAttribute(throat,n+j),b=new T.Vector3().fromBufferAttribute(throat,n+(j+1)%n);
        closest=Math.min(closest,new T.Line3(a,b).closestPointToPoint(point,true,new T.Vector3()).distanceTo(point));
      }
      const onSplitter=side===1&&Math.abs(point.y-.548)<1e-6;
      assert.ok(closest<.003||onSplitter,`inlet root gap ${closest}`);
    }
  }
});

test("cooling pack remains inside the sidepod from above and from both sides",()=>{
  const body=model.root.getObjectByName("Continuous undercut sidepod shell");
  const roof=createSurfaceSampler([body],"y"),sidewall=createSurfaceSampler([body],"z");
  cooling.traverse(part=>{
    if(!part.isMesh)return;const position=part.geometry.attributes.position;
    for(let instance=0;instance<(part.isInstancedMesh?part.count:1);instance++){
      const transform=part.matrixWorld.clone();if(part.isInstancedMesh){const matrix=new T.Matrix4();part.getMatrixAt(instance,matrix);transform.multiply(matrix);}
      for(let i=0;i<position.count;i++){
        const point=new T.Vector3().fromBufferAttribute(position,i).applyMatrix4(transform);assert.ok(point.y>.080,`${part.name}: below floor`);
        if(Math.abs(point.z)<.26)continue;
        const height=roof(point.x,point.z,1),width=sidewall(point.x,point.y,Math.sign(point.z));
        if(height!==undefined)assert.ok(point.y<height+.002,`${part.name} crosses the roof at ${point.toArray()}`);
        if(width!==undefined)assert.ok(Math.abs(point.z)<Math.abs(width)+.002,`${part.name} crosses the sidewall at ${point.toArray()}`);
      }
    }
  });
});

for(const name of ["Oil cooler return hose","Sump scavenge hose 0","Sump scavenge hose 1","Oil reservoir supply hose"])test(`${name} clears the floor, engine, structure and neighboring pipes`,()=>{
  const hose=model.root.getObjectByName(name),curve=new T.CatmullRomCurve3(hose.userData.route.map(p=>new T.Vector3(...p)),false,"centripetal");
  const occupied=new T.Box3().setFromPoints(curve.getSpacedPoints(100)).expandByScalar(hose.userData.outerRadius+.001),solids=[];
  model.root.traverse(o=>{
    if(!o.isMesh||o.isInstancedMesh||[hose.name,hose.userData.from,hose.userData.to].some(prefix=>o.name.startsWith(prefix)))return;
    const bounds=new T.Box3().setFromObject(o);if(!bounds.intersectsBox(occupied))return;
    const p=o.geometry.attributes.position,index=o.geometry.index,triangles=[];
    for(let i=0;i<(index?.count??p.count);i+=3){
      const points=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(p,index?index.getX(i+j):i+j).applyMatrix4(o.matrixWorld));
      const box=new T.Box3().setFromPoints(points);if(box.intersectsBox(occupied))triangles.push({box,triangle:new T.Triangle(...points)});
    }
    solids.push({o,bounds,triangles});
  });
  const nearest=new T.Vector3(),errors=new Set(),radius=hose.userData.outerRadius+.001;
  for(const p of curve.getSpacedPoints(400))for(const s of solids){
    if(s.bounds.distanceToPoint(p)>radius)continue;
    if(s.triangles.some(({box,triangle})=>box.distanceToPoint(p)<radius&&triangle.closestPointToPoint(p,nearest).distanceTo(p)<radius))errors.add(s.o.name);
  }
  assert.deepEqual([...errors],[]);
  for(const [t,name,sign]of[[0,hose.userData.from+" socket",1],[1,hose.userData.to+" socket",-1]]){
    const socket=model.root.getObjectByName(name),axis=new T.Vector3(0,1,0).transformDirection(socket.matrixWorld);
    assert.ok(curve.getTangent(t).multiplyScalar(sign).dot(axis)>.995,`${name}: hose folds across its fitting`);
  }
  const points=curve.getSpacedPoints(2500);let minimum=Infinity;
  for(let i=1;i<points.length-1;i++){
    const a=points[i].clone().sub(points[i-1]),b=points[i+1].clone().sub(points[i]),cross=a.clone().cross(b).length();
    if(cross>1e-14)minimum=Math.min(minimum,a.length()*b.length()*points[i+1].distanceTo(points[i-1])/(2*cross));
  }
  assert.ok(minimum>hose.userData.outerRadius*1.5,`${name}: inner wall folds across the bend`);
});

test("oil return and scavenge elbows have continuous fluid bores",()=>{
  for(const name of["Oil reservoir return elbow","Scavenge 1 inlet elbow"]){
    const elbow=model.root.getObjectByName(name);
    assert.ok(elbow?.geometry.parameters.shapes.holes.length===1,`${name} has no fluid bore`);
  }
});

test("sidepod inlet walls clear the cockpit shoulder fairings on both sides",()=>{
  const closest=new T.Vector3();
  for(const side of[-1,1]){
    const fairing=model.root.getObjectByName(`Cockpit shoulder fairing ${side}`),p=fairing.geometry.attributes.position,index=fairing.geometry.index;
    const triangles=[];
    for(let i=0;i<index.count;i+=3){
      const vertices=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(p,index.getX(i+j)).applyMatrix4(fairing.matrixWorld));
      triangles.push({box:new T.Box3().setFromPoints(vertices),triangle:new T.Triangle(...vertices)});
    }
    for(const name of[`Recessed sidepod inlet ${side}`,`Radiator inlet duct ${side}`]){
      const wall=model.root.getObjectByName(name),points=wall.geometry.attributes.position;
      for(let i=0;i<points.count;i++){
        const point=new T.Vector3().fromBufferAttribute(points,i).applyMatrix4(wall.matrixWorld);
        for(const {box,triangle}of triangles){
          if(box.distanceToPoint(point)>.002)continue;
          assert.ok(triangle.closestPointToPoint(point,closest).distanceTo(point)>.002,`${name} touches cockpit fairing at ${point.toArray()}`);
        }
      }
    }
  }
});

test("radiator shrouds cover the whole core face without crossed or open wall strips",()=>{
  const ray=new T.Raycaster();
  for(const side of[-1,1]){
    const radiator=model.root.getObjectByName(`Radiator pack ${side}`),shroud=model.root.getObjectByName(`Radiator inlet duct ${side}`);
    const normal=new T.Vector3(0,1,0).transformDirection(radiator.matrixWorld);
    for(const x of[-.28,-.22,-.16,-.10,-.04,.02,.08,.14,.20,.26,.28])for(const z of[-.10,-.075,-.05,-.025,0,.025,.05,.075,.10]){
      ray.set(new T.Vector3(x,.5,z).applyMatrix4(radiator.matrixWorld),normal.clone().negate());ray.far=.477;
      const hit=ray.intersectObject(shroud)[0];
      assert.ok(hit,`exposed radiator ${side} at ${x}, ${z}`);
    }
  }
});
