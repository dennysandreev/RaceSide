import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { advanceWingOpening, createW17, updateWingLinkages, W17_AXLES, W17_WHEELS } from "./w17-geometry.ts";
import { createSurfaceSampler } from "./w17-surface.ts";
import { createAirflowPaths, sampleAirflowPoint } from "./w17-airflow.ts";

const models=["mercedes","ferrari","red-bull"].map(name=>({name,...createW17(name)}));
function setOpening(model,fraction){
  model.root.traverse(part=>{if(part.userData.flap)part.quaternion.setFromAxisAngle(part.userData.hingeAxis,T.MathUtils.lerp(part.userData.closedAngle,part.userData.openAngle,fraction));});
  updateWingLinkages(model.linkages);model.root.updateMatrixWorld(true);
}

test("Miami wings share the closed installation height without changing their open mechanism",()=>{
  const reference=new T.Box3().setFromObject(models[0].root.getObjectByName("Rear endplate 1")).max.y;
  for(const model of models.slice(1)){
    setOpening(model,0);
    const endplate=new T.Box3().setFromObject(model.root.getObjectByName("Rear endplate 1"));
    assert.ok(Math.abs(endplate.max.y-reference)<.003,`${model.name}: endplate is installed above the comparison datum`);
    const assembly=new T.Box3().setFromObject(model.assemblies.get("rear-wing"));
    assert.ok(assembly.max.y<reference+.012,`${model.name}: closed mechanism stands above the wing`);
  }
});

test("Red Bull fixed profile retains positive incidence across its span",()=>{
  const mainplane=models[2].root.getObjectByName("Rear mainplane"),p=mainplane.geometry.attributes.position;
  for(let row=0;row<=32;row++){
    const leading=new T.Vector3().fromBufferAttribute(p,row*40),trailing=new T.Vector3().fromBufferAttribute(p,row*40+20);
    const incidence=Math.atan2(trailing.y-leading.y,leading.x-trailing.x);
    assert.ok(incidence>.06&&incidence<.32,`section ${row}: reversed or excessive incidence ${incidence}`);
  }
});

test("linear aero actuators keep rigid barrels and rods with their pistons inside the bore",()=>{
  for(const model of models){
    const bodies=model.linkages.filter(link=>link.mesh.userData.actuatorPart==="body");
    setOpening(model,0);
    const lengths=new Map(model.linkages.filter(link=>link.mesh.userData.actuator).map(link=>[link.mesh.name,link.mesh.scale.y]));
    try{
      for(let frame=0;frame<=100;frame++){
        setOpening(model,frame/100);
        for(const body of bodies){
          const members=model.linkages.filter(link=>link.mesh.userData.actuator===body.mesh.userData.actuator);
          const part=name=>members.find(link=>link.mesh.userData.actuatorPart===name).mesh;
          const axis=body.end.clone().applyQuaternion(body.wing.quaternion).add(body.wing.position).sub(body.anchor).normalize();
          const range=mesh=>{
            const centre=mesh.position.clone().sub(body.anchor).dot(axis);
            return [centre-mesh.scale.y/2,centre+mesh.scale.y/2];
          };
          for(const {mesh}of members)assert.ok(Math.abs(mesh.scale.y-lengths.get(mesh.name))<1e-10,`${model.name}: ${mesh.name} stretches`);
          const piston=range(part("piston")),barrel=range(body.mesh),gland=range(part("gland")),rod=range(part("rod"));
          assert.ok(piston[0]>barrel[0]+.001,`${model.name}: piston hits the end cap`);
          assert.ok(piston[1]<=gland[0]+1e-10,`${model.name}: piston leaves the bore`);
          assert.ok(rod[0]<gland[0]&&rod[1]>gland[1]+.006,`${model.name}: rod detaches from the gland`);
          assert.ok(piston[1]-piston[0]>.0029,"piston has no physical thickness");
        }
      }
    }finally{setOpening(model,0);}
  }
});

test("the W17 front wing has two driven upper panels and a stationary nose-supported profile",()=>{
  const model=models[0],front=model.assemblies.get("front-wing");
  const cylinders=model.linkages.filter(link=>link.wing.userData.component==="front-wing"&&link.mesh.userData.actuatorPart==="body");
  assert.equal(cylinders.length,2);
  const fixed=[-1,1].map(side=>model.root.getObjectByName(`Front primary flap ${side}`));
  const initial=fixed.map(part=>part.quaternion.clone());
  try{
    for(const fraction of[0,.25,.5,.75,1]){
      setOpening(model,fraction);
      fixed.forEach((part,i)=>assert.ok(part.quaternion.equals(initial[i]),"nose-supported profile moves"));
      const active=[];front.traverse(part=>{if(part.userData.flap)active.push(part);});
      assert.equal(active.length,2);
      assert.ok(active.every(part=>part.name.startsWith("Front secondary flap")));
    }
  }finally{setOpening(model,0);}
});

test("wing variants preserve the W17 chassis and replace only the rear assembly",()=>{
  const baseline=new Map();models[0].root.traverse(part=>{if(part.isMesh&&part.userData.component!=="rear-wing")baseline.set(part.name,part.geometry.attributes.position.array);});
  for(const model of models.slice(1)){
    model.root.traverse(part=>{if(part.isMesh&&part.userData.component!=="rear-wing")assert.deepEqual(part.geometry.attributes.position.array,baseline.get(part.name),part.name);});
    const profiles=model.assemblies.get("rear-wing").children.filter(part=>/^Rear (mainplane|active flap|upper flap)$/.test(part.name));
    assert.equal(profiles.length,3);
    model.root.traverse(part=>{if(part.isMesh)assert.ok(Array.from(part.geometry.attributes.position.array).every(Number.isFinite),part.name);});
  }
});

test("Miami variants invert in opposite directions and retain their distinct open heights",()=>{
  for(const model of models.slice(1)){
    setOpening(model,1);
    const flap=model.root.getObjectByName("Rear active flap"),upper=model.root.getObjectByName("Rear upper flap");
    assert.ok(new T.Vector3(0,1,0).applyQuaternion(flap.quaternion).y<-.98,"flap is not inverted");
    assert.ok(flap.quaternion.equals(upper.quaternion));
    assert.equal(Math.sign(flap.userData.openAngle-flap.userData.closedAngle),model.name==="ferrari"?1:-1);
    const top=new T.Box3().setFromObject(flap).union(new T.Box3().setFromObject(upper)).max.y;
    const endplate=new T.Box3().setFromObject(model.root.getObjectByName("Rear endplate 1"));
    if(model.name==="ferrari")assert.ok(top<endplate.max.y-.020,"Ferrari inverted profiles must remain below the endplate top");
    else assert.ok(top>endplate.max.y+.020,"Red Bull inverted profiles must rise above the endplate top");
  }
});

test("rear profiles retain a slot through 25 sampled positions and clear both tyres",()=>{
  const ray=new T.Raycaster(),down=new T.Vector3(0,-1,0);
  for(const model of models){
    const parts=model.assemblies.get("rear-wing").children.filter(part=>/^Rear (mainplane|active flap|upper flap)$/.test(part.name));
    const materials=new Map(parts.map(part=>[part.material,part.material.side]));parts.forEach(part=>part.material.side=T.DoubleSide);
    try{
      for(let frame=0;frame<=24;frame++){
        setOpening(model,frame/24);
        for(const z of [-.64,-.4,0,.4,.64])for(let x=-2.65;x<=-1.60;x+=.010){
          const ranges=parts.map(part=>{ray.set(new T.Vector3(x,1.8,z),down);const hits=ray.intersectObject(part,false).map(hit=>hit.point.y);return hits.length>1?[Math.min(...hits),Math.max(...hits)]:null;});
          for(let a=0;a<parts.length;a++)for(let b=a+1;b<parts.length;b++)if(ranges[a]&&ranges[b])assert.ok(Math.min(ranges[a][1],ranges[b][1])-Math.max(ranges[a][0],ranges[b][0])<.0001,`${model.name}: ${parts[a].name} / ${parts[b].name}, frame ${frame}, x ${x}, z ${z}`);
        }
        model.assemblies.get("rear-wing").traverse(part=>{
          if(!part.isMesh)return;const p=part.geometry.attributes.position;
          for(let i=0;i<p.count;i++){
            const v=new T.Vector3().fromBufferAttribute(p,i).applyMatrix4(part.matrixWorld);
            for(const side of [-1,1])assert.ok(!(Math.abs(v.z-side*W17_WHEELS.rear.track/2)<W17_WHEELS.rear.width/2+.003&&Math.hypot(v.x-W17_AXLES.rear,v.y-W17_WHEELS.rear.radius)<W17_WHEELS.rear.radius+.003),`${model.name}: ${part.name} intersects rear tyre`);
          }
        });
        for(const link of model.linkages.filter(link=>link.to===1&&!link.toOffset)){
          const end=new T.Vector3(0,link.mesh.scale.y*.5,0).applyQuaternion(link.mesh.quaternion).add(link.mesh.position);
          assert.ok(end.distanceTo(link.end.clone().applyQuaternion(link.wing.quaternion).add(link.wing.position))<1e-6,link.mesh.name);
        }
      }
    }finally{for(const [material,side] of materials)material.side=side;setOpening(model,0);}
  }
});

test("airflow clears rotating rear profiles at keyframes and between keyframes",()=>{
  const ray=new T.Raycaster(),a=new T.Vector3(),b=new T.Vector3(),direction=new T.Vector3();
  for(const model of models.slice(1)){
    setOpening(model,0);const paths=createAirflowPaths(model.root,model.linkages),surfaces=[],materials=new Map();
    model.assemblies.get("rear-wing").traverse(part=>{if(part.isMesh){surfaces.push(part);if(!materials.has(part.material))materials.set(part.material,part.material.side);part.material.side=T.DoubleSide;}});
    assert.equal(paths.find(path=>path.id==="rear-wing-1").states.length,25);
    try{
      for(let frame=0;frame<=48;frame++){
        const fraction=frame/48;setOpening(model,fraction);
        for(const path of paths.filter(path=>path.id.startsWith("rear-wing")||path.id.startsWith("roof")))for(const [dy,dz] of [[0,0],[.008,0],[-.008,0],[0,.008],[0,-.008]])for(let i=0;i<120;i++){
          sampleAirflowPoint(path,i/120,fraction,a);sampleAirflowPoint(path,(i+1)/120,fraction,b);a.y+=dy;a.z+=dz;b.y+=dy;b.z+=dz;
          direction.subVectors(b,a);ray.set(a,direction.clone().normalize());ray.far=direction.length();
          const hit=ray.intersectObjects(surfaces,false)[0];assert.ok(!hit,`${model.name}: ${path.id}, frame ${frame}: ${hit?.object.name} at ${hit?.point.toArray()}`);
        }
      }
    }finally{for(const [material,side] of materials)material.side=side;setOpening(model,0);}
  }
});


test("rear supports enter the wing and their pins and bearings stay beneath its skin",()=>{
  for(const model of models){
    setOpening(model,0);
    const mainplane=model.root.getObjectByName("Rear mainplane"),skin=createSurfaceSampler([mainplane],"y");
    for(const side of [-1,1]){
      const neck=model.root.getObjectByName(`Rear swan neck ${side}`),p=neck.geometry.attributes.position,{radialSegments:r,tubularSegments:n}=neck.geometry.parameters;
      assert.ok(!model.root.getObjectByName(`Mainplane mounting pad ${side}`));
      for(let j=0;j<=r;j++){
        const v=new T.Vector3().fromBufferAttribute(p,n*(r+1)+j);
        assert.ok(v.y>skin(v.x,v.z,-1)+.002&&v.y<skin(v.x,v.z,1)-.002,`${model.name}: support terminal is not inside the wing`);
      }
      for(const name of ["pin","bearing"]){
        const part=model.root.getObjectByName(`Mainplane internal ${name} ${side}`),vertices=part.geometry.attributes.position;
        for(let i=0;i<vertices.count;i++){
          const v=new T.Vector3().fromBufferAttribute(vertices,i).applyMatrix4(part.matrixWorld);
          assert.ok(v.y>skin(v.x,v.z,-1)&&v.y<skin(v.x,v.z,1),`${model.name}: ${name} projects through the skin`);
        }
      }
      const ray=new T.Raycaster(new T.Vector3(neck.userData.mount[0],neck.userData.mount[1]-.060,neck.userData.mount[2]),new T.Vector3(0,1,0),0,.06);
      assert.ok(ray.intersectObject(neck,false)[0],`${model.name}: support ends below its mounting axis`);
    }
  }
});

test("the complete upper rear profiles open across the span without fixed outer pieces",()=>{
  for(const model of models){
    assert.ok(!model.assemblies.get("rear-wing").children.some(part=>part.name.startsWith("Fixed rear")));
    for(const flap of model.assemblies.get("rear-wing").children.filter(part=>part.userData.flap)){
      const p=flap.geometry.attributes.position;
      const width=new T.Box3().setFromBufferAttribute(p).getSize(new T.Vector3()).z;
      assert.ok(width>1.35,`${model.name}: only the middle of the flap moves`);
      for(const ring of [0,16,32]){
        let travel=0;
        for(let j=0;j<40;j++){
          const point=new T.Vector3().fromBufferAttribute(p,ring*40+j);
          const closed=point.clone().applyAxisAngle(flap.userData.hingeAxis,flap.userData.closedAngle);
          const open=point.clone().applyAxisAngle(flap.userData.hingeAxis,flap.userData.openAngle);
          travel=Math.max(travel,closed.distanceTo(open));
        }
        assert.ok(travel>.035,`${model.name}: outer profile is fixed`);
      }
    }
    setOpening(model,0);
  }
});

test("wing presentation eases at both ends independently of frame rate",()=>{
  const samples=[];
  for(const fps of [30,60,144])for(const target of [0,1]){
    let motion={value:1-target,velocity:0};
    for(let frame=0;frame<fps;frame++){
      motion=advanceWingOpening(motion,target,1/fps);
      assert.ok(motion.value>=0&&motion.value<=1);
    }
    assert.deepEqual(motion,{value:target,velocity:0});
    let partial={value:1-target,velocity:0};
    for(let frame=0;frame<fps/6;frame++)partial=advanceWingOpening(partial,target,1/fps);
    samples.push(partial.value);
  }
  assert.ok(Math.abs(samples[0]-samples[2])<1e-12&&Math.abs(samples[2]-samples[4])<1e-12);
  const start={value:0,velocity:0},early=advanceWingOpening(start,1,.005),middle=advanceWingOpening(start,1,.08),late=advanceWingOpening(start,1,.4);
  assert.ok(early.velocity<middle.velocity/3&&late.velocity<middle.velocity/10);
  const reversal=advanceWingOpening(middle,0,.00001);
  assert.ok(Math.abs(reversal.velocity-middle.velocity)<.005,"reversing must preserve velocity");
  assert.ok(Math.abs(reversal.value-middle.value)<.0001,"reversing must preserve position");
  let motion=middle;
  for(let i=0;i<120;i++){
    motion=advanceWingOpening(motion,i<40?i%2:0,1/120);
    assert.ok(motion.value>=0&&motion.value<=1,"rapid clicks must not overshoot");
  }
  assert.deepEqual(advanceWingOpening(motion,0,2),{value:0,velocity:0});
  assert.deepEqual(advanceWingOpening(start,1,0),start);
});

test("Mercedes opens the full flap below the endplate top with a restrained lift",()=>{
  const model=models[0],flap=model.root.getObjectByName("Rear active flap"),positions=flap.geometry.attributes.position;
  const endplate=new T.Box3().setFromObject(model.root.getObjectByName("Rear endplate 1"));
  const closed=[],point=new T.Vector3();setOpening(model,0);
  for(let i=0;i<positions.count;i++)closed.push(point.fromBufferAttribute(positions,i).applyMatrix4(flap.matrixWorld).y);
  let lift=0,top=-Infinity;setOpening(model,1);
  for(let i=0;i<positions.count;i++){
    point.fromBufferAttribute(positions,i).applyMatrix4(flap.matrixWorld);
    lift=Math.max(lift,point.y-closed[i]);top=Math.max(top,point.y);
  }
  assert.ok(lift>.04&&lift<.085,"opening should lift the leading lip, not raise the whole wing");
  assert.ok(top<endplate.max.y-.015,"open flap must remain below the endplate top");
  setOpening(model,0);
});

test("Mercedes fixed mainplane has a shallow front contour and rises towards its trailing edge",()=>{
  const model=models[0],wing=model.root.getObjectByName("Rear mainplane"),p=wing.geometry.attributes.position;
  const leading=row=>new T.Vector3().fromBufferAttribute(p,row*40);
  const middle=leading(16);
  for(const row of[0,4,8,12,16,20,24,28,32]){
    const front=leading(row),rear=new T.Vector3().fromBufferAttribute(p,row*40+20);
    assert.ok(front.y-middle.y<.035,"outer leading edge is excessively raised");
    assert.ok(rear.y>=front.y-.001,"fixed section pitches down towards the rear");
    assert.ok(Math.abs(front.y-leading(32-row).y)<1e-7,"spanwise contour is not symmetric");
  }
  assert.ok(new T.Vector3().fromBufferAttribute(p,16*40+20).y-middle.y>.020,"centre section lacks incidence");
  const flap=model.root.getObjectByName("Rear active flap"),skin=createSurfaceSampler([flap],"y");
  for(const row of[0,4,8,12,16,20,24,28,32]){
    const rear=new T.Vector3().fromBufferAttribute(p,row*40+20),gap=skin(rear.x,rear.z,-1)-rear.y;
    assert.ok(gap>.007&&gap<.014,"closed profiles must retain a narrow, continuous slot");
  }
  const closed=Array.from(p.array);setOpening(model,1);
  assert.deepEqual(Array.from(p.array),closed,"fixed mainplane moves with the flap");setOpening(model,0);
});

test("Red Bull central actuator clears both moving profiles throughout its stroke",()=>{
  const model=models[2],parts=["Rear active flap","Rear upper flap"].map(name=>model.root.getObjectByName(name));
  const fixed=model.root.getObjectByName("Rear mainplane"),fixedSkin=createSurfaceSampler([fixed],"y");
  const horns=[-1,1].map(side=>model.root.getObjectByName(`Red Bull central drive horn ${side}`));
  const links=model.linkages.filter(link=>link.mesh.name.startsWith("Rear central actuator"));
  const ray=new T.Raycaster(),materials=new Map(parts.map(o=>[o.material,o.material.side]));parts.forEach(o=>o.material.side=T.DoubleSide);
  try{
    for(let frame=0;frame<=48;frame++){
      setOpening(model,frame/48);
      for(const horn of horns){
        const vertices=horn.geometry.attributes.position;
        for(let i=0;i<vertices.count;i++){
          const v=new T.Vector3().fromBufferAttribute(vertices,i).applyMatrix4(horn.matrixWorld),lo=fixedSkin(v.x,v.z,-1),hi=fixedSkin(v.x,v.z,1);
          assert.ok(lo===undefined||hi===undefined||v.y<lo-.001||v.y>hi+.001,"drive horn enters the fixed mainplane");
        }
      }
      for(const {mesh}of links){
        mesh.geometry.computeBoundingBox();
        const radius=mesh.geometry.boundingBox.max.x;
        for(let i=0;i<16;i++){
          const a=i*Math.PI/8,x=radius*Math.cos(a),z=radius*Math.sin(a);
          const start=new T.Vector3(x,-.5,z).applyMatrix4(mesh.matrixWorld),end=new T.Vector3(x,.5,z).applyMatrix4(mesh.matrixWorld),direction=end.clone().sub(start);
          ray.set(start,direction.clone().normalize());ray.far=direction.length();
          assert.equal(ray.intersectObjects(parts,false).length,0,`${mesh.name} crosses a flap at frame ${frame}`);
        }
      }
      const rod=links.find(link=>link.to===1&&!link.toOffset),joint=new T.Box3().setFromObject(model.root.getObjectByName("Red Bull moving actuator pin")).getCenter(new T.Vector3());
      assert.ok(joint.distanceTo(rod.end.clone().applyQuaternion(rod.wing.quaternion).add(rod.wing.position))<1e-6,"rod eye detaches from its moving pin");
    }
  }finally{for(const[m,side]of materials)m.side=side;setOpening(model,0);}
});
