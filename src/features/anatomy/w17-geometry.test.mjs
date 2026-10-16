import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { createW17, W17_AXLES, W17_WHEELS, W17_REFERENCE_HEIGHT, updateWingLinkages } from "./w17-geometry.ts";
import { components } from "./catalog.ts";
import { createSurfaceSampler } from "./w17-surface.ts";

const model=createW17();model.root.updateMatrixWorld(true);

function assertClosedShell(parts){
  const edges=new Map();
  for(const part of parts){
    const positions=part.geometry.attributes.position,index=part.geometry.index?.array??Array.from({length:positions.count},(_,i)=>i);
    const vertex=i=>[positions.getX(i),positions.getY(i),positions.getZ(i)].map(v=>Math.round(v*1e6)).join(",");
    for(let i=0;i<index.length;i+=3){
      const vertices=[vertex(index[i]),vertex(index[i+1]),vertex(index[i+2])];
      // Boolean cuts can leave sub-micron slivers. Once quantisation collapses
      // a triangle, neither of its coincident edges belongs to this topology.
      if(new Set(vertices).size<3)continue;
      for(let j=0;j<3;j++){
        const a=vertices[j],b=vertices[(j+1)%3];if(a===b)continue;
        const key=a<b?`${a}/${b}`:`${b}/${a}`,edge=edges.get(key)??{faces:0,winding:0};
        edge.faces++;edge.winding+=a<b?1:-1;edges.set(key,edge);
      }
    }
  }
  for(const [edge,{faces,winding}] of edges){
    assert.equal(faces,2,`unjoined or branching shell edge: ${edge}`);
    assert.equal(winding,0,`flipped shell face: ${edge}`);
  }
}

test("all selectable assemblies contain finite physical meshes, without image skins",()=>{
  assert.deepEqual([...model.assemblies.keys()].sort(),components.map(c=>c.id).sort());
  const populated=new Set();
  model.root.traverse(o=>{
    if(!o.isMesh)return;populated.add(o.userData.component);
    for(const attribute of Object.values(o.geometry.attributes))assert.ok(Array.from(attribute.array).every(Number.isFinite),o.name);
    assert.equal(o.material.map,null,`${o.name} must use neutral materials`);
    assert.ok(o.geometry.boundingSphere.radius>0,`${o.name} must have physical extent`);
  });
  assert.deepEqual([...populated].sort(),components.map(c=>c.id).sort());
});

test("both sidepod mouths remain open through the body cap",()=>{
  const body=model.assemblies.get("bodywork"),cooling=model.assemblies.get("cooling"),ray=new T.Raycaster();
  for(const side of [-1,1])assertClosedShell([model.root.getObjectByName(`Recessed sidepod inlet ${side}`)]);
  // Probe above and below the right inlet's physical branch divider. Its
  // middle is deliberately solid; the upper branch feeds the LT radiator.
  for(const side of [-1,1])for(const [z,y] of [[.33,.539],[.36,.541],[.41,.541],[.46,.542],[.46,.558],[.52,.554]]){
    ray.set(new T.Vector3(.8,y,side*z),new T.Vector3(-1,0,0));
    const hit=ray.intersectObjects([body,cooling],true)[0];
    const duct=side===1&&y>.552?"Charge radiator inlet duct":`Radiator inlet duct ${side}`;
    assert.ok([`Recessed sidepod inlet ${side}`,duct].includes(hit?.object.name),`the body cap blocks the inlet at ${z}, ${y}: ${hit?.object.name}`);
    assert.ok(hit.point.x<.5,"the throat is a disc over the opening rather than a recessed duct");
  }
  ray.set(new T.Vector3(.8,.550,.46),new T.Vector3(-1,0,0));
  const divider=ray.intersectObjects([body,cooling],true)[0];
  assert.equal(divider?.object.name,"Cooling inlet branch splitter");
  assert.ok(divider.point.x<.5,"the branch divider must sit inside the inlet");
});

test("crank, clutch and gearbox share the reference axis with the main shaft above it",()=>{
  const centre=name=>new T.Box3().setFromObject(model.root.getObjectByName(name)).getCenter(new T.Vector3());
  // The rotating counterweights are eccentric; their bounding-box centre is
  // not the crank axis. The crank group's origin is its bearing datum.
  const crank=model.root.getObjectByName("Crankshaft").getWorldPosition(new T.Vector3()),input=centre("Gearbox input shaft"),clutch=centre("Clutch splined hub"),main=centre("Gearbox main shaft"),barrel=centre("Gear selector barrel");
  assert.ok(Math.abs(crank.y-W17_REFERENCE_HEIGHT-.09)<1e-6);
  for(const part of [input,clutch])assert.ok(Math.hypot(part.y-crank.y,part.z-crank.z)<1e-6,"broken concentric drive axis");
  assert.ok(main.y>input.y&&Math.abs(main.z)<.03);
  const separation=Math.hypot(main.y-input.y,main.z-input.z);assert.ok(separation>=.09&&separation<=.11);
  assert.ok(barrel.y>main.y);
  const shaft=new T.Box3().setFromObject(model.root.getObjectByName("Gearbox input shaft")),hub=new T.Box3().setFromObject(model.root.getObjectByName("Clutch splined hub"));
  assert.ok(shaft.max.x>hub.min.x&&shaft.min.x<hub.max.x,"input shaft does not enter the clutch hub");
});

test("the eight gear pairs fit inside the casing and respect the longitudinal layout",()=>{
  const casing=model.root.getObjectByName("Carbon gearbox casing"),ray=new T.Raycaster(),cluster=new T.Box3();
  for(const name of ["Primary ratio gear","Main ratio gear"])for(let i=1;i<=8;i++){
    const part=model.root.getObjectByName(`${name} ${i}`),bounds=new T.Box3().setFromObject(part);cluster.union(bounds);
    const p=part.geometry.attributes.position;
    for(let vertex=0;vertex<p.count;vertex+=23){
      const v=new T.Vector3().fromBufferAttribute(p,vertex).applyMatrix4(part.matrixWorld);
      for(const direction of [new T.Vector3(0,-1,0),new T.Vector3(0,0,-1),new T.Vector3(0,0,1)]){
        const origin=v.clone().addScaledVector(direction,-2);ray.set(origin,direction);
        const hit=ray.intersectObject(casing)[0];assert.ok(hit&&hit.distance<2,`${part.name} escapes casing at ${v.toArray()}`);
      }
    }
  }
  assert.ok(cluster.max.x-cluster.min.x>=.175);
  assert.ok(cluster.max.x-W17_AXLES.rear>=.390&&cluster.max.x-W17_AXLES.rear<=.450);
  const diff=new T.Box3().setFromObject(model.root.getObjectByName("Differential drum")).getCenter(new T.Vector3());
  assert.ok(diff.y-W17_REFERENCE_HEIGHT>=.260&&diff.y-W17_REFERENCE_HEIGHT<=.280);
});

test("service assemblies stay above the floor and expose the clutch plate pack when opened",()=>{
  for(const id of ["engine","clutch","gearbox"]){
    assert.ok(new T.Box3().setFromObject(model.assemblies.get(id)).min.y>.074,`${id} penetrates the central floor`);
  }
  const clutch=model.assemblies.get("clutch");
  assert.equal(clutch.children.filter(part=>part.name.startsWith("Carbon clutch plate")).length,7);
  const y=W17_REFERENCE_HEIGHT+.09+.040,z=.002,ray=new T.Raycaster(new T.Vector3(-2,y,z),new T.Vector3(1,0,0));
  assert.ok(ray.intersectObject(clutch)[0]?.object.userData.serviceCover);
  const uncovered=clutch.children.filter(part=>!part.userData.serviceCover);
  assert.match(ray.intersectObjects(uncovered)[0]?.object.name??"",/^Carbon clutch plate/);
});

test("the ECU has four recessed connector inserts and enclosed pin arrays",()=>{
  for(let i=0;i<4;i++){
    const pins=model.root.getObjectByName(`ECU connector pins ${i}`),barrel=model.root.getObjectByName(`ECU socket barrel ${i}`);
    assert.ok(pins.isInstancedMesh&&pins.count>40);
    const b=new T.Box3().setFromObject(pins),socket=new T.Box3().setFromObject(barrel);
    assert.ok(socket.containsBox(b),`connector ${i} pins protrude beyond the socket`);
  }
  assert.ok(model.root.getObjectByName("Main loom").userData.installedOnly,"whole-car wiring must not shrink the isolated ECU view");
});

test("the four wheel centres are symmetric and all tyre geometry fits the 1900 mm envelope",()=>{
  const wheels=model.assemblies.get("tyres").children.filter(o=>o.userData.wheel);
  assert.equal(wheels.length,4);
  for(const wheel of wheels){
    const spec=wheel.userData.front?W17_WHEELS.front:W17_WHEELS.rear;
    assert.equal(wheel.position.x,wheel.userData.front?W17_AXLES.front:W17_AXLES.rear);
    assert.equal(wheel.position.y,spec.radius);
    assert.equal(wheel.position.z,wheel.userData.side*spec.track/2);
    const box=new T.Box3().setFromObject(wheel);
    assert.ok(box.max.z<=.95001&&box.min.z>=-.95001,JSON.stringify(box));
    assert.ok(Math.abs(box.min.y)<.00001);
  }
});

test("the assembled sidepod encloses the motor and inverter at their service positions",()=>{
  const ray=new T.Raycaster();
  for(const [x,y] of [[-.16,.30],[-.60,.32],[-.44,.50],[0,.53]]){
    ray.set(new T.Vector3(x,y,5),new T.Vector3(0,0,-1));
    assert.equal(ray.intersectObject(model.root)[0]?.object.name,"Continuous undercut sidepod shell",`${x}, ${y}`);
  }
});

test("the complete V6 encloses all six cylinder barrels until its service covers are removed",()=>{
  const engine=model.assemblies.get("engine"),ray=new T.Raycaster();
  for(const side of [-1,1])for(const x of [-.81,-.61,-.41]){
    ray.set(new T.Vector3(x,1.2,side*.94),new T.Vector3(0,-1,-side).normalize());
    const first=ray.intersectObject(engine)[0];
    assert.ok(first?.object.userData.serviceCover,`exposed cylinder at ${x}, ${side}: ${first?.object.name}`);
    ray.set(new T.Vector3(x,2,side*.13),new T.Vector3(0,-1,0));
    assert.ok(ray.intersectObject(engine)[0]?.object.userData.serviceCover,"individual barrels break through the casting inside the V");
  }
  assert.ok(engine.children.some(part=>part.userData.serviceCover&&!part.userData.cover),"removing the car body must leave the engine casting intact");
});

test("the airbox throat is visibly open and the cockpit is recessed",()=>{
  const ray=new T.Raycaster(new T.Vector3(5,.926,.065),new T.Vector3(-1,0,0));
  const intakeHits=ray.intersectObject(model.assemblies.get("intake"));
  assert.equal(intakeHits[0]?.object.name,"Airbox outlet reducer");
  assert.ok(intakeHits[0].point.x<-.24,"the throat must open into the reducer rather than end at a backing plate");
  const exterior=[];model.root.traverse(o=>{if(o.isMesh&&(!o.userData.internal||o.userData.component==="intake"))exterior.push(o);});
  const first=ray.intersectObjects(exterior,false)[0];
  assert.match(first?.object.name??"",/^(Airbox outlet reducer|Roll hoop)/,"bodywork obstructs the airbox opening");
  assert.ok(first.point.x<-.12,"visible airbox internals must sit behind the inlet lip");
  ray.set(new T.Vector3(.35,5,0),new T.Vector3(0,-1,0));
  const bodyHits=ray.intersectObject(model.assemblies.get("bodywork"));
  assert.ok(!bodyHits[0]||bodyHits[0].point.y<.25,"the outer shell must not close the cockpit over the seat");
  const seatHit=ray.intersectObject(model.root.getObjectByName("Sculpted carbon seat"))[0];
  assert.ok(seatHit&&seatHit.point.y<.30,"the open cockpit must retain its real seat");
});

test("halo fairing faces point outwards and the swept pylon meets the bridge and chassis",()=>{
  for(const name of ["Halo aerodynamic fairing"]){
    const {geometry}=model.root.getObjectByName(name),p=geometry.attributes.position,n=geometry.attributes.normal;
    for(const ring of [20,60,80,120,140]){
      const centre=new T.Vector3();for(let j=0;j<20;j++)centre.add(new T.Vector3().fromBufferAttribute(p,ring*20+j));centre.divideScalar(20);
      for(let j=0;j<20;j++){
        const index=ring*20+j,radial=new T.Vector3().fromBufferAttribute(p,index).sub(centre);
        assert.ok(radial.dot(new T.Vector3().fromBufferAttribute(n,index))>0,`${name}: inward face ${index}`);
      }
    }
  }
  const pylon=model.root.getObjectByName("Halo front pylon"),p=pylon.geometry.attributes.position,n=pylon.geometry.attributes.normal;
  const rings=p.count/40;
  for(let ring=1;ring<rings-1;ring++){
    const centre=new T.Vector3();for(let j=0;j<40;j++)centre.add(new T.Vector3().fromBufferAttribute(p,ring*40+j));centre.divideScalar(40);
    for(let j=0;j<40;j++){
      const radial=new T.Vector3().fromBufferAttribute(p,ring*40+j).sub(centre);radial.x=0;
      assert.ok(radial.dot(new T.Vector3().fromBufferAttribute(n,ring*40+j))>0,"pylon has an inward-facing surface");
    }
  }
  const pylonBox=new T.Box3().setFromObject(pylon),bridgeBox=new T.Box3().setFromObject(model.root.getObjectByName("Halo aerodynamic fairing"));
  assert.ok(pylonBox.intersectsBox(bridgeBox),"front pylon detaches from the halo bridge");
  assert.ok(pylonBox.max.x>.84&&pylonBox.min.y<.66,"front fairing does not reach its chassis attachment");
});

test("the tapered airbox remains hollow and its lip has a raked front edge",()=>{
  const airbox=model.root.getObjectByName("Open airbox shell"),p=airbox.geometry.attributes.position;
  const front=[],rear=[];
  for(let i=0;i<p.count;i++){const v=new T.Vector3().fromBufferAttribute(p,i);if(v.x>-.10)front.push(v);if(v.x<-.235)rear.push(v);}
  assert.ok(Math.max(...rear.map(v=>Math.abs(v.z)))<Math.max(...front.map(v=>Math.abs(v.z)))*.8,"airbox is still a constant-width extrusion");
  const upper=front.filter(v=>v.y>.97),lower=front.filter(v=>v.y<.89);
  assert.ok(Math.max(...upper.map(v=>v.x))-Math.max(...lower.map(v=>v.x))>.02,"mouth has no fore-aft rake");
  for(const z of [-.065,0,.065]){
    const hit=new T.Raycaster(new T.Vector3(2,.93,z),new T.Vector3(-1,0,0)).intersectObject(model.assemblies.get("intake"))[0];
    assert.equal(hit?.object.name,"Airbox outlet reducer");assert.ok(hit.point.x<-.24);
  }
});

test("the open airbox joining rim and upper bridge stay beneath the outer intake skin",()=>{
  const shell=model.root.getObjectByName("Open airbox shell");
  const side=createSurfaceSampler([shell],"z"),top=createSurfaceSampler([shell],"y");
  for(const name of["Recessed airbox throat","Roll hoop upper bridge"]){
    const part=model.root.getObjectByName(name),p=part.geometry.attributes.position;
    for(let i=0;i<p.count;i++){
      const v=new T.Vector3().fromBufferAttribute(p,i).applyMatrix4(part.matrixWorld);
      if(name==="Recessed airbox throat"){
        const edge=side(v.x,v.y,Math.sign(v.z)||1);
        assert.ok(edge!==undefined&&Math.abs(v.z)<Math.abs(edge)-.001,`${name}: corner outside the intake at ${v.toArray()}`);
      }else{
        const roof=top(v.x,v.z,1);
        assert.ok(roof!==undefined&&v.y<roof-.001,`${name}: protrudes above the intake roof`);
      }
    }
  }
});

test("the T-camera has seated feet, a connected mast and exposed fore/aft windows",()=>{
  const shell=model.root.getObjectByName("Open airbox shell"),roof=createSurfaceSampler([shell],"y"),foot=model.root.getObjectByName("Camera mounting foot"),mast=model.root.getObjectByName("Camera mounting mast"),head=model.root.getObjectByName("Onboard camera");
  const headBox=new T.Box3().setFromObject(head),mastBox=new T.Box3().setFromObject(mast),footBox=new T.Box3().setFromObject(foot),size=headBox.getSize(new T.Vector3());
  assert.ok(size.z>size.y*7&&size.x>size.y*3,"camera head should read as a transverse rectangular bar");
  assert.ok(mastBox.clone().expandByScalar(1e-6).intersectsBox(headBox)&&mastBox.intersectsBox(footBox),"floating camera mast");
  const p=foot.geometry.attributes.position;let min=Infinity,max=-Infinity;
  for(let i=0;i<p.count;i++){
    const v=new T.Vector3().fromBufferAttribute(p,i),surface=roof(v.x,v.z,1);assert.ok(surface!==undefined,"camera foot overhangs intake");
    min=Math.min(min,v.y-surface);max=Math.max(max,v.y-surface);
  }
  assert.ok(min<0&&min>-.001&&max>.003&&max<.004,"foot does not seat against the arched roof");
  for(const direction of[-1,1]){
    const lens=model.root.getObjectByName(`Camera lens ${direction}`),bezel=model.root.getObjectByName(`Camera lens bezel ${direction}`);
    const ray=new T.Raycaster(new T.Vector3(direction,1.0745,direction*.094),new T.Vector3(-direction,0,0));
    assert.equal(ray.intersectObjects([head,bezel,lens])[0]?.object,lens,"camera window is covered by its housing");
  }
});

test("rear inboard dampers and their fixed brackets fit beneath the assembled tail cover",()=>{
  const body=["Tail heat shield","Continuous undercut sidepod shell"].map(name=>model.root.getObjectByName(name));
  assertClosedShell([body[0]]);
  const edge=createSurfaceSampler(body,"z");let checked=0;
  for(const side of[-1,1])model.root.getObjectByName(`Rear ${side} inboard suspension`).traverse(part=>{
    if(!part.isMesh||!/damper|spring/.test(part.name))return;
    const p=part.geometry.attributes.position;
    for(let i=0;i<p.count;i++){
      const v=new T.Vector3().fromBufferAttribute(p,i).applyMatrix4(part.matrixWorld);
      let skin=edge(v.x,v.y,side);
      for(const panel of body)for(const profile of panel.userData.suspensionPassages??[]){
        const point=new T.Vector2(v.x,v.y),polygon=profile.map(p=>new T.Vector2(...p));
        if(!polygon.every((a,j)=>{const b=polygon[(j+1)%polygon.length];return (b.x-a.x)*(point.y-a.y)-(b.y-a.y)*(point.x-a.x)>=0;}))continue;
        // A glimpse through a new suspension slot is legitimate. The damper
        // must still lie inside the surrounding skin, not protrude through it.
        let nearest,distance=Infinity;
        polygon.forEach((a,j)=>{
          const b=polygon[(j+1)%polygon.length],d=b.clone().sub(a),q=a.clone().addScaledVector(d,T.MathUtils.clamp(point.clone().sub(a).dot(d)/d.lengthSq(),0,1));
          if(q.distanceToSquared(point)<distance){distance=q.distanceToSquared(point);nearest=q.add(new T.Vector2(d.y,-d.x).normalize().multiplyScalar(.001));}
        });
        const rim=edge(nearest.x,nearest.y,side);
        if(rim!==undefined&&(skin===undefined||Math.abs(rim)>Math.abs(skin)))skin=rim;
      }
      assert.ok(skin!==undefined&&Math.abs(v.z)<Math.abs(skin)-.003,`${part.name}: exposed through tail cover at ${v.toArray()}`);
      checked++;
    }
  });
  assert.ok(checked>5000);
});

test("the rear body and heat shield share a flush upper contour without a shoulder step",()=>{
  const body=model.root.getObjectByName("Continuous undercut sidepod shell"),shield=model.root.getObjectByName("Tail heat shield");
  const join=new T.Box3().setFromObject(body).min.x,ray=new T.Raycaster();
  const radius=(part,x,angle)=>{
    const direction=new T.Vector3(0,Math.cos(angle),Math.sin(angle)),origin=new T.Vector3(x,(.518+(x+1.98)*.246+.31)/2,0);
    ray.set(origin.clone().addScaledVector(direction,.4),direction.clone().negate());ray.far=.4;
    const hit=ray.intersectObject(part,false)[0];assert.ok(hit,`${part.name}: missing skin at ${x}/${angle}`);
    return hit.point.distanceTo(origin);
  };
  for(let i=-12;i<=12;i++){
    const angle=i/12*Math.PI*.55;
    const aft=radius(shield,join-.002,angle),forward=radius(body,join+.002,angle);
    assert.ok(Math.abs(aft-forward)<.0035,`raised edge at angle ${angle}: ${aft-forward}`);
    const aftSlope=(aft-radius(shield,join-.022,angle))/.02;
    const forwardSlope=(radius(body,join+.022,angle)-forward)/.02;
    assert.ok(Math.abs(forwardSlope-aftSlope)<.12,`kink at angle ${angle}: ${aftSlope}/${forwardSlope}`);
  }
  const roof=createSurfaceSampler([body,shield],"y");
  for(let x=-1.94;x< -1.30;x+=.02){
    const height=roof(x,0,1),next=roof(x+.02,0,1);
    assert.ok(height!==undefined&&next!==undefined);
    const slope=(next-height)/.02;
    assert.ok(slope>.10&&slope<.40,`tail ridge dips or turns abruptly at ${x}: ${slope}`);
  }
});

test("aft sidepod shoulders retain the fuller taper visible in the launch top and rear views",()=>{
  const body=model.root.getObjectByName("Continuous undercut sidepod shell"),sidewall=createSurfaceSampler([body],"z");
  // Broad fit bands from KA 12, normalised by the forward sidepod width and
  // checked against KA 7. These constrain the premature pinching of the old
  // cover; they are not millimetre measurements of Mercedes bodywork.
  for(const [x,minimum,maximum] of [[-1.25,.265,.34],[-.90,.420,.485]]){
    const widths=[];
    for(const side of[-1,1]){
      let width=0;for(let y=.25;y<.75;y+=.002)width=Math.max(width,side*(sidewall(x,y,side)??0));
      assert.ok(width>=minimum&&width<=maximum,`premature or excessive shoulder taper at ${x}/${side}: ${width}`);widths.push(width);
    }
    assert.ok(Math.abs(widths[0]-widths[1])<.0001,"shoulder fit is asymmetric");
  }
});

test("the shortened fin has a smooth crown and a continuous seated root above the exhaust",()=>{
  const fin=model.root.getObjectByName("Shark fin"),body=model.root.getObjectByName("Continuous undercut sidepod shell");
  assertClosedShell([fin]);
  const bounds=new T.Box3().setFromObject(fin);
  assert.ok(bounds.min.x>W17_AXLES.rear+.28,"fin still extends into the rear exhaust shield");
  const roof=createSurfaceSampler([body],"y"),edge=createSurfaceSampler([fin],"y");
  for(let i=0;i<=100;i++){
    const x=T.MathUtils.lerp(-1.395,-.30,i/100),skin=roof(x,.004,1),root=edge(x,0,-1);
    assert.ok(skin!==undefined&&root!==undefined,`missing fin root at ${x}`);
    assert.ok(skin-root>.002&&skin-root<.009,`fin root floats or cuts too far into the cover at ${x}`);
  }
  let previousSlope;
  for(let x=-1.30;x<-.40;x+=.01){
    const top=edge(x,0,1),next=edge(x+.01,0,1),slope=(next-top)/.01;
    assert.ok(top>roof(x,0,1),`fin crown is buried at ${x}`);
    assert.ok(slope>0&&slope<.40,`fin crown reverses or rises abruptly at ${x}`);
    if(previousSlope!==undefined)assert.ok(Math.abs(slope-previousSlope)<.025,`kink in fin crown at ${x}`);
    previousSlope=slope;
  }
});

test("two thin roll-hoop blades leave three inlet channels and join their bridge and structural feet",()=>{
  assert.equal(model.root.getObjectByName("Airbox central divider"),undefined);
  const exterior=[];model.root.traverse(part=>{if(part.isMesh&&(!part.userData.internal||part.userData.component==="intake"))exterior.push(part);});
  for(const y of [.916,.93,.944])for(const z of[-.060,0,.060]){
    const hit=new T.Raycaster(new T.Vector3(2,y,z),new T.Vector3(-1,0,0)).intersectObjects(exterior,false)[0];
    assert.ok(["Airbox outlet reducer","Filtered air duct"].includes(hit?.object.name),`channel blocked at ${y}/${z}: ${hit?.object.name}`);
    assert.ok(hit.point.x<-.24,"the channel ends at a cap ahead of the reducer");
  }
  const bridge=new T.Box3().setFromObject(model.root.getObjectByName("Roll hoop upper bridge"));
  for(const side of[-1,1]){
    const blade=model.root.getObjectByName(`Roll hoop ${side}`),p=blade.geometry.attributes.position,n=blade.geometry.attributes.normal;
    assertClosedShell([blade]);
    for(let row=1;row<8;row++){
      const centre=new T.Vector3();for(let j=0;j<32;j++)centre.add(new T.Vector3().fromBufferAttribute(p,row*32+j));centre.divideScalar(32);
      for(let j=0;j<32;j++){
        const vertex=new T.Vector3().fromBufferAttribute(p,row*32+j),radial=vertex.clone().sub(centre);
        assert.ok(radial.dot(new T.Vector3().fromBufferAttribute(n,row*32+j))>0,"inward blade surface");
        if(centre.y>.86)assert.ok(Math.abs(radial.z)<=.00451,"inlet partition has become a thick round tube");
      }
    }
    const foot=new T.Vector3().fromBufferAttribute(p,32*9),top=new T.Vector3().fromBufferAttribute(p,32*9+1);
    assert.ok(new T.Box3().setFromObject(model.root.getObjectByName(`Roll hoop attachment ${side}`)).containsPoint(foot));
    assert.ok(bridge.containsPoint(top));
  }
});

test("the rear cockpit body lip leaves a clean opening above the headrest",()=>{
  const opening=new T.Box3(new T.Vector3(-.085,.40,-.20),new T.Vector3(.07,.664,.20));
  for(const name of["Continuous undercut sidepod shell","Bodywork inner laminate"]){
    const part=model.root.getObjectByName(name),p=part.geometry.attributes.position,index=part.geometry.index;
    for(let i=0;i<index.count;i+=3){
      const vertices=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(p,index.getX(i+j)).applyMatrix4(part.matrixWorld));
      assert.ok(!opening.intersectsTriangle(new T.Triangle(...vertices)),`${name}: a body triangle intrudes into the headrest opening`);
    }
  }
});

test("rear endplates clear both tyres over their entire curved surface",()=>{
  for(const side of [-1,1]){
    const plate=model.root.getObjectByName(`Rear endplate ${side}`),p=plate.geometry.attributes.position;
    for(let i=0;i<p.count;i++){
      const point=new T.Vector3().fromBufferAttribute(p,i).applyMatrix4(plate.matrixWorld);
      const insideWidth=Math.abs(point.z-side*W17_WHEELS.rear.track/2)<W17_WHEELS.rear.width/2+.004;
      const insideRadius=Math.hypot(point.x-W17_AXLES.rear,point.y-W17_WHEELS.rear.radius)<W17_WHEELS.rear.radius+.004;
      assert.ok(!(insideWidth&&insideRadius),`${plate.name} penetrates tyre at ${point.toArray()}`);
    }
  }
});

test("three active flap panels rotate about fixed hinges and their actuator rods remain connected",()=>{
  const flaps=[];model.root.traverse(o=>{if(o.userData.flap)flaps.push(o);});
  assert.equal(flaps.length,3);
  for(const fraction of [0,.25,.5,.75,1]){
    for(const flap of flaps){
      flap.quaternion.setFromAxisAngle(flap.userData.hingeAxis,T.MathUtils.lerp(flap.userData.closedAngle,flap.userData.openAngle,fraction));
      assert.deepEqual(flap.position.toArray(),flap.userData.pivot);
      assert.ok(flap.userData.hingeAxis.clone().applyQuaternion(flap.quaternion).distanceTo(flap.userData.hingeAxis)<1e-6);
    }
    updateWingLinkages(model.linkages);
    for(const link of model.linkages.filter(link=>link.to===1&&!link.toOffset)){
      const end=new T.Vector3(0,.5*link.mesh.scale.y,0).applyQuaternion(link.mesh.quaternion).add(link.mesh.position);
      const expected=link.end.clone().applyQuaternion(link.wing.quaternion).add(link.wing.position);
      assert.ok(end.distanceTo(expected)<1e-6,`${link.mesh.name} detached from flap`);
    }
  }
});

test("wheel interiors are occluded by a rim or brake drum behind each spoke gap",()=>{
  const tyres=model.assemblies.get("tyres");
  for(const wheel of tyres.children.filter(o=>o.userData.wheel)){
    const side=wheel.userData.side;
    const ray=new T.Raycaster(new T.Vector3(wheel.position.x+.08,wheel.position.y+.07,side*2),new T.Vector3(0,0,-side));
    const hits=ray.intersectObjects([wheel,model.assemblies.get("brakes")],true);
    assert.ok(hits.some(hit=>/drum|spoke/.test(hit.object.name)),`see-through ${wheel.name}`);
  }
});


test("front wing and fixed endplates clear both front tyres in all aero positions",()=>{
  const wing=model.assemblies.get("front-wing");
  for(const fraction of [0,.25,.5,.75,1]){
    wing.traverse(o=>{if(o.userData.flap)o.quaternion.setFromAxisAngle(o.userData.hingeAxis,T.MathUtils.lerp(o.userData.closedAngle,o.userData.openAngle,fraction));});model.root.updateMatrixWorld(true);
    wing.traverse(o=>{
      if(!o.isMesh)return;const p=o.geometry.attributes.position;
      for(let i=0;i<p.count;i++){
        const point=new T.Vector3().fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld);
        for(const side of [-1,1]){
          const insideWidth=Math.abs(point.z-side*W17_WHEELS.front.track/2)<W17_WHEELS.front.width/2+.004;
          const insideRadius=Math.hypot(point.x-W17_AXLES.front,point.y-W17_WHEELS.front.radius)<W17_WHEELS.front.radius+.004;
          assert.ok(!(insideWidth&&insideRadius),`${o.name} intersects tyre at ${point.toArray()}`);
        }
      }
    });
  }
});

test("every exposed suspension and steering link terminates at the chassis or gearbox",()=>{
  model.root.updateMatrixWorld(true);
  let count=0;
  model.root.traverse(part=>{
    if(!part.userData.anchor)return;count++;
    const anchor=new T.Vector3(...part.userData.anchor);
    if(part.userData.rockerMount){
      const prefix=part.name.replace(" pushrod", ""),inboard=model.root.getObjectByName(`${prefix} inboard suspension`);
      assert.ok(anchor.distanceTo(new T.Vector3(...inboard.userData.joints.pushrod))<1e-8,`${part.name} misses the rocker bearing`);
      return;
    }
    {
      const joint=part.name.startsWith("Front ")&&part.name.includes("track rod")?model.root.getObjectByName(`Steering rack joint ${Math.sign(anchor.z)}`):model.root.getObjectByName(`${part.name} spherical bearing`);
      assert.ok(joint,`${part.name} has no mechanical joint`);
      assert.ok(new T.Box3().setFromObject(joint).getCenter(new T.Vector3()).distanceTo(anchor)<1e-6,`${part.name} misses its joint`);
      return;
    }
  });
  assert.equal(count,24);
});

test("the front suspension bay and its removable lid have closed physical walls",()=>{
  assertClosedShell([model.root.getObjectByName("Forward survival cell deck")]);
  assertClosedShell([model.root.getObjectByName("Front suspension access cover")]);
});

test("suspension fairings have a solid aerofoil section and taper into their joints",()=>{
  model.root.traverse(part=>{
    if(!part.userData.armLength)return;
    const p=part.geometry.attributes.position,bounds=new T.Box3().setFromBufferAttribute(p);
    const thickness=bounds.max.z-bounds.min.z,chord=bounds.max.x-bounds.min.x;
    assert.ok(thickness>=.0179&&thickness<=.0281,`${part.name} is flat or oversized`);
    assert.ok(chord>=.0439&&chord<=.0751,`${part.name} has the wrong fairing chord`);
    assert.ok(thickness/chord>.25&&thickness/chord<.60,`${part.name} still has a blade-thin section`);
    const root=[];
    for(let i=0;i<p.count;i++)if(Math.abs(p.getY(i)-bounds.min.y)<1e-6)root.push(p.getX(i));
    assert.ok(Math.max(...root)-Math.min(...root)<chord*.7,`${part.name} has a blunt joint end`);
    assertClosedShell([part]);
    const index=part.geometry.index;let volume=0;
    for(let i=0;i<index.count;i+=3){
      const a=new T.Vector3().fromBufferAttribute(p,index.getX(i)),b=new T.Vector3().fromBufferAttribute(p,index.getX(i+1)),c=new T.Vector3().fromBufferAttribute(p,index.getX(i+2));
      volume+=a.dot(b.cross(c))/6;
    }
    assert.ok(volume>0,`${part.name} has inside-out faces`);
  });
});

test("the thicker suspension fairings clear the front and rear tyre envelopes",()=>{
  model.root.updateMatrixWorld(true);
  model.root.traverse(part=>{
    if(!part.userData.armLength)return;
    const p=part.geometry.attributes.position;
    for(let i=0;i<p.count;i++){
      const point=new T.Vector3().fromBufferAttribute(p,i).applyMatrix4(part.matrixWorld);
      for(const axle of ["front","rear"])for(const side of [-1,1]){
        const spec=W17_WHEELS[axle];
        const inWidth=Math.abs(point.z-side*spec.track/2)<spec.width/2;
        const inRadius=Math.hypot(point.x-W17_AXLES[axle],point.y-spec.radius)<spec.radius;
        assert.ok(!(inWidth&&inRadius),`${part.name} penetrates a ${axle} tyre`);
      }
    }
  });
});

test("front flap drives and inboard bearings are mounted on the nose",()=>{
  const nose=model.root.getObjectByName("Silver nose skin"),ray=new T.Raycaster();model.root.updateMatrixWorld(true);
  for(const side of [-1,1])for(const name of ["primary","secondary"]){
    assert.ok(model.root.getObjectByName(`Front ${name} nose bearing ${side}`));
    if(name==="primary")continue;
    const link=model.linkages.find(link=>link.mesh.name===`Front ${name} actuator ${side} body`);
    const clevis=model.root.getObjectByName(`Front ${name} actuator ${side} fixed clevis`);
    ray.set(new T.Vector3(link.anchor.x,link.anchor.y,side*.3),new T.Vector3(0,0,-side));
    const hit=ray.intersectObject(nose,false)[0];
    assert.ok(hit&&Math.abs(link.anchor.z-hit.point.z)<.004,"actuator anchor floats clear of the nose");
    assert.ok(clevis.position.distanceTo(link.anchor)<1e-8,"fixed clevis does not follow its mounted anchor");
  }
});

test("nose width tapers continuously without the pinched middle seen in the earlier model",()=>{
  // Sample the rendered cross-section. The removable fairing now includes
  // an inner laminate and cut edges, so vertex order is no longer a contour.
  const g=model.root.getObjectByName("Silver nose skin").geometry,p=g.attributes.position,ix=g.index,widths=[];
  for(let x=1.20;x<=2.40;x+=.04){
    let width=0;
    for(let i=0;i<ix.count;i+=3)for(let e=0;e<3;e++){
      const a=ix.getX(i+e),b=ix.getX(i+(e+1)%3),ax=p.getX(a),bx=p.getX(b);
      if(x<Math.min(ax,bx)||x>Math.max(ax,bx)||Math.abs(bx-ax)<1e-9)continue;
      width=Math.max(width,Math.abs(T.MathUtils.lerp(p.getZ(a),p.getZ(b),(x-ax)/(bx-ax))));
    }
    widths.push([x,width]);
  }
  for(let i=1;i<widths.length;i++){
    assert.ok(widths[i][1]<=widths[i-1][1]+1e-5,"nose narrows and then widens again");
    assert.ok((widths[i-1][1]-widths[i][1])/(widths[i][0]-widths[i-1][0])<.17,"abrupt waist in the nose sides");
  }
  assert.ok(widths.find(([x])=>x>1.60)[1]>.15,"middle nose is still too narrow");
});

test("assembled monocoque keeps its enclosing lower panels visible",()=>{
  const parts=["Survival cell lower shell","Lower side enclosure -1","Lower side enclosure 1","Cockpit side -1","Cockpit side 1"].map(name=>model.root.getObjectByName(name));
  for(const part of parts)assert.equal(part.userData.internal,false,`${part.name} is hidden in the assembled car`);
  for(const x of [.1,.4,.7])for(const y of [.22,.28,.36])for(const side of [-1,1]){
    const hit=new T.Raycaster(new T.Vector3(x,y,side),new T.Vector3(0,0,-side),0,1).intersectObjects(parts,false)[0];
    assert.ok(hit,`open side of the survival cell at ${x}, ${y}, ${side}`);
  }
  const fairing=model.root.getObjectByName("Central floor-to-chassis fairing"),p=fairing.geometry.attributes.position;
  const front=Array.from({length:p.count},(_,i)=>new T.Vector3().fromBufferAttribute(p,i)).filter(v=>Math.abs(v.x-1.37)<1e-6);
  assert.ok(front.length&&Math.abs(Math.max(...front.map(v=>v.y))-.077)<1e-6,"the fairing leading edge must blend into the floor");
});

test("the tub tray and its floor fairing end ahead of the installed engine and sump",()=>{
  const engine=["Cast V6 crankcase","Dry sump","Sump end wall -0.272","Engine timing end cover -0.296","Engine timing end cover -0.938"];
  for(const name of["Lower chassis enclosure","Central floor-to-chassis fairing"]){
    const panel=new T.Box3().setFromObject(model.root.getObjectByName(name));
    for(const part of engine){
      const bounds=new T.Box3().setFromObject(model.root.getObjectByName(part));
      assert.ok(panel.min.x>bounds.max.x+.005,`${name} extends into ${part}`);
    }
    const cell=new T.Box3().setFromObject(model.root.getObjectByName("Survival cell lower shell"));
    assert.ok(panel.intersectsBox(cell),`${name} no longer meets the survival cell`);
  }
  const floor=new T.Box3().setFromObject(model.root.getObjectByName("Carbon floor"));
  const sump=new T.Box3().setFromObject(model.root.getObjectByName("Dry sump"));
  assert.ok(sump.min.y>floor.max.y+.002,"the sump must remain clear of the floor");
});

test("the rising floor pan closes the lower chassis gap without a detached central pod",()=>{
  const fairing=model.root.getObjectByName("Central floor-to-chassis fairing"),floor=model.root.getObjectByName("Carbon floor"),keel=model.root.getObjectByName("Front suspension keel");
  assertClosedShell([fairing]);
  assertClosedShell([model.root.getObjectByName("Lower chassis enclosure")]);
  assert.equal(fairing.userData.component,"floor");assert.equal(fairing.userData.internal,false);
  const nose=model.root.getObjectByName("Forward survival cell deck"),tray=model.root.getObjectByName("Survival cell lower shell");
  const ray=new T.Raycaster(),old=keel.material.side,noseSide=nose.material.side,traySide=tray.material.side;keel.material.side=T.DoubleSide;nose.material.side=T.DoubleSide;tray.material.side=T.DoubleSide;
  try{
    for(const x of [.55,.70,.85,1.0,1.16])for(const z of [-.10,0,.10]){
      ray.set(new T.Vector3(x,.8,z),new T.Vector3(0,-1,0));
      // The under-seat pan now meets the actual lower tub, below the ES/ECU
      // cavity; farther forward it continues into the keel and nose.
      const top=ray.intersectObject(fairing,false)[0]?.point.y,cell=ray.intersectObjects([tray,keel,nose],false).map(hit=>hit.point.y);
      assert.ok(top>Math.min(...cell)&&top<Math.max(...cell),`floor pan does not enter the lower chassis at ${x}/${z}`);
    }
    for(const x of [.2,.55,.9,1.2,1.35]){
      ray.set(new T.Vector3(x,0,0),new T.Vector3(0,1,0));
      const bottom=ray.intersectObject(fairing,false)[0]?.point.y;
      const base=new T.Box3().setFromObject(floor);
      assert.ok(bottom>=base.min.y&&bottom<=base.max.y,`pan floats above the floor at ${x}`);
    }
  }finally{keel.material.side=old;nose.material.side=noseSide;tray.material.side=traySide;}
});

test("inner floor returns close the view into the body through both inlet channels",()=>{
  const exterior=[];model.root.traverse(part=>{if(part.isMesh&&!part.userData.internal)exterior.push(part);});
  for(const side of [-1,1]){
    const panel=model.root.getObjectByName(`Inner floor return ${side}`);
    assertClosedShell([panel]);assert.equal(panel.userData.internal,false);
    for(const y of [.035,.043,.055]){
      const ray=new T.Raycaster(new T.Vector3(2,y,side*.366),new T.Vector3(-1,.54/6.3,-side*.32/6.3).normalize());
      const hit=ray.intersectObjects(exterior,false)[0];
      assert.ok([`Sculpted floor shoulder ${side}`,`Inner floor return ${side}`].includes(hit?.object.name),`rear internals are visible through the floor inlet: ${side}/${y}/${hit?.object.name}`);
    }
  }
});

test("the front floor shoulder rounds down to the floor and closes the visible triangular opening",()=>{
  const ray=new T.Raycaster(),base=new T.Box3().setFromObject(model.root.getObjectByName("Carbon floor"));
  for(const side of [-1,1]){
    const shoulder=model.root.getObjectByName(`Sculpted floor shoulder ${side}`);
    for(const z of [.30,.35,.40]){
      const hits=[.09,.13,.20].map(y=>{
        ray.set(new T.Vector3(1.1,y,side*z),new T.Vector3(-1,0,0));
        const hit=ray.intersectObject(shoulder,false)[0];
        assert.ok(hit&&hit.point.x>.46,`open front shoulder at ${side*z}/${y}`);
        return hit.point.x;
      });
      assert.ok(hits[0]>hits[2]+.12,"the shoulder ends as a vertical wall instead of a descending surface");
    }
    ray.set(new T.Vector3(.8,.8,side*.30),new T.Vector3(0,-1,0));
    const landing=ray.intersectObject(shoulder,false)[0];
    assert.ok(landing&&landing.point.y>=base.min.y&&landing.point.y<=base.max.y,"rounded shoulder floats above the floor");
    assert.ok(landing.normal.y>.98,"shoulder does not flatten as it meets the floor");
  }
});

test("nose saddles sit on the mainplane and enter the nose with a closed outward shell",()=>{
  const wing=model.root.getObjectByName("Front mainplane"),nose=model.root.getObjectByName("Silver nose skin"),ray=new T.Raycaster();
  const side=nose.material.side;nose.material.side=T.DoubleSide;model.root.updateMatrixWorld(true);
  try{
    for(const sign of [-1,1]){
      const mount=model.root.getObjectByName(`Front mounting pylon ${sign}`),p=mount.geometry.attributes.position;
      assertClosedShell([mount]);
      for(let i=0;i<40;i++){
        const v=new T.Vector3().fromBufferAttribute(p,i).applyMatrix4(mount.matrixWorld);
        ray.set(new T.Vector3(v.x,1,v.z),new T.Vector3(0,-1,0));
        const foot=ray.intersectObject(wing,false)[0];
        assert.ok(foot&&Math.abs(foot.point.y-v.y-.001)<2e-6,`${mount.name} floats above the wing`);
        const top=new T.Vector3().fromBufferAttribute(p,p.count-40+i).applyMatrix4(mount.matrixWorld);
        ray.set(new T.Vector3(top.x,1,top.z),new T.Vector3(0,-1,0));
        const skin=ray.intersectObject(nose,false).map(hit=>hit.point.y);
        assert.ok(skin.length>=2&&top.y>Math.min(...skin)&&top.y<Math.max(...skin),`${mount.name} misses the nose underside`);
      }
      ray.set(new T.Vector3(3,.14,sign*.09),new T.Vector3(-1,0,0));
      assert.ok(ray.intersectObject(mount,false).length,"saddle faces point inward");
    }
  }finally{nose.material.side=side;}
});

test("front flap inner sections clear the wider nose throughout their travel",()=>{
  const nose=model.root.getObjectByName("Silver nose skin"),ray=new T.Raycaster();
  for(const side of [-1,1])for(const name of ["primary","secondary"]){
    const flap=model.root.getObjectByName(`Front ${name} flap ${side}`),initial=flap.quaternion.clone(),p=flap.geometry.attributes.position;
    try{for(let step=0;step<=12;step++){
      flap.quaternion.setFromAxisAngle(flap.userData.hingeAxis,T.MathUtils.lerp(flap.userData.closedAngle,flap.userData.openAngle,step/12));flap.updateMatrixWorld(true);
      for(let i=0;i<p.count;i++){
        const v=new T.Vector3().fromBufferAttribute(p,i).applyMatrix4(flap.matrixWorld);if(Math.abs(v.z)>.20)continue;
        ray.set(new T.Vector3(v.x,v.y,side*.4),new T.Vector3(0,0,-side));
        const hit=ray.intersectObject(nose,false)[0];
        assert.ok(!hit||Math.abs(v.z)-Math.abs(hit.point.z)>.003,`${flap.name} cuts into the nose at step ${step}`);
      }
    }}finally{flap.quaternion.copy(initial);flap.updateMatrixWorld(true);}
  }
});

test("the front mainplane rises to a narrow slot below the next element",()=>{
  const main=model.root.getObjectByName("Front mainplane"),flap=model.root.getObjectByName("Front primary flap 1"),ray=new T.Raycaster();
  const sides=[main.material.side,flap.material.side];main.material.side=T.DoubleSide;flap.material.side=T.DoubleSide;
  flap.quaternion.setFromAxisAngle(flap.userData.hingeAxis,flap.userData.closedAngle);model.root.updateMatrixWorld(true);
  try{
    for(const z of [.18,.30,.45]){
      ray.set(new T.Vector3(2.36,1,z),new T.Vector3(0,-1,0));
      const upper=Math.max(...ray.intersectObject(main,false).map(hit=>hit.point.y));
      const lower=Math.min(...ray.intersectObject(flap,false).map(hit=>hit.point.y));
      assert.ok(lower-upper>.005&&lower-upper<.035,`incorrect inter-element slot at ${z}: ${lower-upper}`);
    }
  }finally{main.material.side=sides[0];flap.material.side=sides[1];}
});

test("front profiles stop at the inner endplate face instead of piercing the outer skin",()=>{
  const wing=model.assemblies.get("front-wing");
  for(const part of wing.children){
    if(!/mainplane|Fixed outer/.test(part.name))continue;
    const p=part.geometry.attributes.position;
    for(let i=0;i<p.count;i++){
      const v=new T.Vector3().fromBufferAttribute(p,i).applyMatrix4(part.matrixWorld);
      assert.ok(Math.abs(v.z)<=.9231,`${part.name} protrudes through endplate: ${v.z}`);
    }
  }
});

test("fixed front tips retain their section and meet the closed flaps at the hinge seam",()=>{
  for(const side of [-1,1])for(const name of ["primary","secondary"]){
    const flap=model.root.getObjectByName(`Front ${name} flap ${side}`),tip=model.root.getObjectByName(`Fixed outer ${name} tip ${side}`);
    flap.quaternion.setFromAxisAngle(flap.userData.hingeAxis,flap.userData.closedAngle);model.root.updateMatrixWorld(true);
    const point=(part,ring,vertex)=>new T.Vector3().fromBufferAttribute(part.geometry.attributes.position,ring*40+vertex).applyMatrix4(part.matrixWorld);
    for(const vertex of [0,10,20,30]){
      assert.ok(point(flap,side>0?32:0,vertex).distanceTo(point(tip,side>0?0:32,vertex))<.023,`${tip.name} breaks the closed wing profile`);
    }
    for(let ring=0;ring<=32;ring++)assert.ok(point(tip,ring,0).distanceTo(point(tip,ring,20))>.125,`${tip.name} collapses into a cropped tab`);
  }
});

test("front floor boards have three separate swept blades with open slots",()=>{
  for(const side of [-1,1]){
    const parts=["Front floor vane","Middle floor vane","Lower floor vane"].map(name=>model.root.getObjectByName(`${name} ${side}`));
    assert.ok(parts.every(Boolean),"the floor board is still one uninterrupted wall");
    for(const part of parts)assertClosedShell([part]);
    for(const x of [.55,.70,.90]){
      for(const y of [.148,.227]){
        const ray=new T.Raycaster(new T.Vector3(x,y,side*.95),new T.Vector3(0,0,-side),0,.30);
        assert.equal(ray.intersectObjects(parts,false).length,0,`closed floor-board slot at ${x}, ${y}`);
      }
      for(const y of [.12,.18,.27]){
        const ray=new T.Raycaster(new T.Vector3(x,y,side*.95),new T.Vector3(0,0,-side),0,.30);
        assert.ok(ray.intersectObjects(parts,false).length,`missing floor-board blade at ${x}, ${y}`);
      }
    }
    const bounds=new T.Box3().setFromObject(parts[0]);
    assert.ok(bounds.max.y<.37&&bounds.max.y>.35,"upper floor board does not follow the launch side silhouette");
  }
});

test("front floor board stays seat on the floor and their leading returns face outwards",()=>{
  for(const side of [-1,1]){
    const base=model.root.getObjectByName("Carbon floor");
    for(const x of [.58,.92]){
      const stay=model.root.getObjectByName(`Floor board stay ${side} ${x}`),bounds=new T.Box3().setFromObject(stay);
      const z=stay.position.z,hit=new T.Raycaster(new T.Vector3(x,.5,z),new T.Vector3(0,-1,0)).intersectObject(base)[0];
      assert.ok(hit&&bounds.min.y<hit.point.y&&bounds.max.y>.25,"floor-board stay is detached from the floor");
      for(const [name,y]of [["Lower floor vane",.12],["Middle floor vane",.18],["Front floor vane",.245]]){
        const blade=model.root.getObjectByName(`${name} ${side}`);
        const joint=new T.Raycaster(new T.Vector3(x,y,0),new T.Vector3(0,0,side)).intersectObject(blade)[0];
        assert.ok(joint&&bounds.containsPoint(joint.point),`${name}: unsupported blade`);
      }
    }
    for(const name of ["Floor vane leading return","Middle floor vane leading return","Lower floor vane leading return"]){
      const part=model.root.getObjectByName(`${name} ${side}`),n=part.geometry.attributes.normal;
      assertClosedShell([part]);
      assert.ok(n.getZ(6*21+2)*side>0&&n.getX(6*21+18)>0,"leading return is inside out");
    }
  }
});

test("floor inlet blades project ahead of the board with attached roots and open slots",()=>{
  model.root.updateMatrixWorld(true);
  for(const side of [-1,1]){
    const boards=["Front floor vane","Middle floor vane","Lower floor vane","Floor vane leading return","Middle floor vane leading return","Lower floor vane leading return"].map(name=>model.root.getObjectByName(`${name} ${side}`));
    const front=model.root.getObjectByName(`Floor vane leading return ${side}`);
    const blades=[0,1,2].map(i=>model.root.getObjectByName(`Side floor louvre ${side} ${i}`));
    for(const blade of blades){
      assertClosedShell([blade]);
      const bounds=new T.Box3().setFromObject(blade);
      assert.ok(bounds.max.x>new T.Box3().setFromObject(front).max.x+.15,"inlet blade is hidden behind the board");
      const p=blade.geometry.attributes.position;
      for(let row=0;row<9;row++){
        const v=new T.Vector3().fromBufferAttribute(p,row*17+16).applyMatrix4(blade.matrixWorld);
        const hit=new T.Raycaster(new T.Vector3(v.x,v.y,0),new T.Vector3(0,0,side)).intersectObjects(boards,false)[0];
        assert.ok(hit&&hit.point.distanceTo(v)<.0001,"inlet blade root has no physical attachment");
      }
    }
    for(const x of [1.10,1.17,1.22]){
      const hits=new T.Raycaster(new T.Vector3(x,.5,side*.64),new T.Vector3(0,-1,0)).intersectObjects(blades,false);
      const heights=blades.map(blade=>hits.find(hit=>hit.object===blade)?.point.y);
      assert.ok(heights.every(Number.isFinite),"missing blade in the stepped floor inlet");
      assert.ok(heights[1]-heights[0]>.05&&heights[2]-heights[1]>.10,"inlet slots are blocked");
    }
  }
});

test("outer floor lips are thin seated laminates with closed ends",()=>{
  for(const side of [-1,1]){
    const lip=model.root.getObjectByName(`Outer floor lip ${side}`);assertClosedShell([lip]);
    const floor=model.root.getObjectByName("Carbon floor"),shoulder=model.root.getObjectByName(`Sculpted floor shoulder ${side}`);
    for(const x of [-1.4,-1.1,-.7,-.2,.2,.6,.9]){
      const edge=new T.Raycaster(new T.Vector3(x,.067,side*.95),new T.Vector3(0,0,-side)).intersectObject(floor)[0];
      // The rear shoulder climbs above the flat base; its outer lip still
      // needs a thin section and a seated inboard root at that local height.
      assert.ok(edge,"missing outer floor edge");
      const z=edge.point.z-side*.018,topRay=new T.Raycaster(new T.Vector3(x,.5,z),new T.Vector3(0,-1,0));
      const top=topRay.intersectObject(lip)[0],base=topRay.intersectObjects([floor,shoulder],false)[0];
      assert.ok(top&&base,"the edge lip does not cover its seating surface");
      assert.ok(top.point.y-base.point.y>0&&top.point.y-base.point.y<.005,"floor lip is a raised bead");
      const bottom=new T.Raycaster(new T.Vector3(x,0,z),new T.Vector3(0,1,0)).intersectObject(lip)[0];
      assert.ok(bottom&&top.point.y-bottom.point.y<.0045,"outer lip is too thick");
      assert.ok(bottom.point.y<=base.point.y+.001,"outer lip floats above the floor");
    }
  }
});

test("the rear floor shoulder rises ahead of the tyre and all floor skins clear the tyres",()=>{
  for(const side of [-1,1]){
    const shoulder=model.root.getObjectByName(`Sculpted floor shoulder ${side}`);
    const height=x=>new T.Raycaster(new T.Vector3(x,.6,side*.44),new T.Vector3(0,-1,0)).intersectObject(shoulder,false)[0]?.point.y;
    assert.ok(height(-1.48)>height(-1.28)&&height(-1.28)>height(-.85)+.015,"rear floor must descend into the long channel, not form a central mound");
    for(let layer=0;layer<2;layer++)assertClosedShell([model.root.getObjectByName(`Stepped floor edge ${side} ${layer}`)]);
    for(let layer=0;layer<2;layer++){
      const vane=model.root.getObjectByName(`Rear floor turning vane ${side} ${layer}`);assertClosedShell([vane]);
      const p=vane.geometry.attributes.position;
      for(let row=0;row<=48;row++){
        const v=new T.Vector3().fromBufferAttribute(p,row*11);
        const hit=new T.Raycaster(new T.Vector3(v.x,.7,v.z),new T.Vector3(0,-1,0)).intersectObject(shoulder,false)[0];
        assert.ok(hit&&Math.abs(v.y-hit.point.y-.0025)<2e-6,"rear vane root floats off the floor");
      }
    }
    assert.equal(model.root.getObjectByName(`Floor board outer panel ${side}`),undefined,"the old fascia closes the blade slots");
    const fence=model.root.getObjectByName(`Rear tyre floor fence ${side}`);assertClosedShell([fence]);
    const fp=fence.geometry.attributes.position;
    assert.ok(fence.geometry.boundingBox.max.y>.18,"small upright ahead of the rear tyre is missing");
    for(let row=0;row<=64;row++){
      const v=new T.Vector3().fromBufferAttribute(fp,row*13),hit=new T.Raycaster(new T.Vector3(v.x,.7,v.z),new T.Vector3(0,-1,0)).intersectObject(shoulder,false)[0];
      assert.ok(hit&&Math.abs(v.y-hit.point.y-.002)<2e-6,"rear upright floats above the floor");
    }
  }
  model.assemblies.get("floor").traverse(part=>{
    if(!part.isMesh)return;
    const p=part.geometry.attributes.position;
    for(let i=0;i<p.count;i++){
      const v=new T.Vector3().fromBufferAttribute(p,i).applyMatrix4(part.matrixWorld);
      for(const axle of ["front","rear"])for(const side of [-1,1]){
        const wheel=W17_WHEELS[axle];
        const insideWidth=Math.abs(v.z-side*wheel.track/2)<wheel.width/2+.004;
        const insideRadius=Math.hypot(v.x-W17_AXLES[axle],v.y-wheel.radius)<wheel.radius+.004;
        assert.ok(!(insideWidth&&insideRadius),`${part.name} intersects ${axle} tyre at ${v.toArray()}`);
      }
    }
  });
});

test("rear active flap trailing edge stays on the physical hinge line in both aero modes",()=>{
  const flap=model.root.getObjectByName("Rear active flap"),p=flap.geometry.attributes.position;
  for(const angle of [flap.userData.closedAngle,flap.userData.openAngle]){
    flap.quaternion.setFromAxisAngle(flap.userData.hingeAxis,angle);flap.updateMatrixWorld(true);
    // Each chord ring has 40 vertices; vertex 20 is the trailing edge.
    for(let ring=0;ring<33;ring++){
      const point=new T.Vector3().fromBufferAttribute(p,ring*40+20).applyMatrix4(flap.matrixWorld);
      assert.ok(Math.hypot(point.x-flap.position.x,point.y-flap.position.y)<1e-6);
    }
  }
});

test("the floor covers the wear plank from above and the front wing clears ground",()=>{
  const floor=model.assemblies.get("floor");
  for(const x of [-1.7,-1,0,.7,1.25])for(const z of [-.14,0,.14]){
    const first=new T.Raycaster(new T.Vector3(x,2,z),new T.Vector3(0,-1,0)).intersectObject(floor)[0];
    assert.ok(first&&first.object.name!=="Central wear plank",`plank exposed from above at ${x}, ${z}`);
  }
  const wingBox=new T.Box3().setFromObject(model.assemblies.get("front-wing"));
  assert.ok(wingBox.min.y>.055,"front wing below its nominal ride-height clearance");
});

test("diffuser surfaces clear the full rotating envelopes of the gears and input bearings",()=>{
  const obstacles=[];
  model.assemblies.get("diffuser").traverse(part=>{
    if(!part.isMesh)return;
    const p=part.geometry.attributes.position,index=part.geometry.index;
    for(let i=0;i<(index?.count??p.count);i+=3){
      const v=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(p,index?index.getX(i+j):i+j).applyMatrix4(part.matrixWorld));
      obstacles.push({name:part.name,triangle:new T.Triangle(...v)});
    }
  });
  const errors=new Set();
  model.assemblies.get("gearbox").traverse(part=>{
    if(!part.isMesh||!(/ratio gear|Gearbox input bearing/.test(part.name)))return;
    const bounds=new T.Box3().setFromObject(part);
    if(part.userData.pitchRadius){
      const centre=bounds.getCenter(new T.Vector3()),r=part.userData.pitchRadius+.00235;
      bounds.min.y=centre.y-r;bounds.max.y=centre.y+r;bounds.min.z=-r;bounds.max.z=r;
    }
    bounds.expandByScalar(.002);
    for(const obstacle of obstacles)if(bounds.intersectsTriangle(obstacle.triangle))errors.add(`${part.name} / ${obstacle.name}`);
  });
  assert.deepEqual([...errors],[]);
});

test("the closed diffuser roofs and centre divider do not cut through the gearbox casing",()=>{
  const parts=["Diffuser roof -1","Diffuser roof 1","Diffuser fence 0"].map(name=>model.root.getObjectByName(name));
  parts.forEach(part=>assertClosedShell([part]));
  const triangles=part=>{
    const p=part.geometry.attributes.position,index=part.geometry.index,result=[];
    for(let i=0;i<(index?.count??p.count);i+=3){
      const v=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(p,index?index.getX(i+j):i+j).applyMatrix4(part.matrixWorld));
      result.push({triangle:new T.Triangle(...v),bounds:new T.Box3().setFromPoints(v)});
    }
    return result;
  };
  const casing=triangles(model.root.getObjectByName("Carbon gearbox casing")),ray=new T.Ray(),hit=new T.Vector3();
  const crosses=(a,b)=>{
    for(const [p,q]of[[a.a,a.b],[a.b,a.c],[a.c,a.a]]){
      const length=p.distanceTo(q);if(length<1e-9)continue;
      ray.set(p,q.clone().sub(p).normalize());
      if(ray.intersectTriangle(b.a,b.b,b.c,false,hit)&&hit.distanceTo(p)>1e-7&&hit.distanceTo(p)<length-1e-7)return true;
    }
    return false;
  };
  for(const part of parts)for(const a of triangles(part))for(const b of casing){
    if(!a.bounds.intersectsBox(b.bounds))continue;
    assert.ok(!crosses(a.triangle,b.triangle)&&!crosses(b.triangle,a.triangle),`${part.name} intersects the gearbox casing`);
  }
  // The centre divider still seats into the central floor land and retains
  // the original rear exit height after relieving the gearbox bay.
  const fence=parts[2],p=fence.geometry.attributes.position;
  const floor=new T.Box3().setFromObject(model.root.getObjectByName("Carbon floor"));
  assert.ok(new T.Box3().setFromObject(fence).intersectsBox(floor));
  assert.ok(Array.from({length:p.count},(_,i)=>p.getX(i)<-2.069&&p.getY(i)>.236).some(Boolean));
});

test("the diffuser opens upwards from the floor instead of sitting over a second flat sheet",()=>{
  const surfaces=[];model.root.traverse(part=>{if(part.isMesh&&!part.userData.internal)surfaces.push(part);});
  for(const side of [-1,1])for(const z of [.20,.34]){
    let previousHeight=0;
    for(const x of [-1.32,-1.5,-1.7,-1.9]){
      const ray=new T.Raycaster(new T.Vector3(x,0,side*z),new T.Vector3(0,1,0));
      const first=ray.intersectObjects(surfaces,false)[0];
      assert.equal(first?.object.name,`Diffuser roof ${side}`,`blocked exit at ${x}, ${side*z}`);
      assert.ok(first.point.y>previousHeight+.02,"diffuser passage must expand toward its exit");
      previousHeight=first.point.y;
    }
  }
});

test("floor shoulders and body share an uninterrupted physical boundary on both sides",()=>{
  const body=model.root.getObjectByName("Continuous undercut sidepod shell"),points=body.geometry.attributes.position;
  for(const side of [-1,1]){
    const floor=model.root.getObjectByName(`Sculpted floor shoulder ${side}`),p=floor.geometry.attributes.position,n=floor.geometry.attributes.normal;
    for(let ring=0;ring<body.userData.shellRings;ring++){
      const seamIndex=body.userData.floorSeams[side>0?1:0][ring];
      const a=new T.Vector3().fromBufferAttribute(points,seamIndex);
      const b=new T.Vector3().fromBufferAttribute(p,ring*17);
      assert.ok(a.distanceTo(b)<1e-7,`open body/floor seam: ${side}, ${ring}`);
      const bodyNormal=new T.Vector3().fromBufferAttribute(body.geometry.attributes.normal,seamIndex);
      assert.ok(bodyNormal.distanceTo(new T.Vector3().fromBufferAttribute(n,ring*17))<1e-7,"body/floor shading breaks at the shared edge");
      assert.ok(n.getY(ring*17+13)>0,"floor upper surface faces downwards");
    }
  }
});

test("the floor shoulder has inward thickness without a projecting lip below the sidepod",()=>{
  for(const side of [-1,1]){
    const floor=model.root.getObjectByName(`Sculpted floor shoulder ${side}`),p=floor.geometry.attributes.position;
    assertClosedShell([floor]);
    for(const x of [-.95,-.3,.1]){
      let row=0;
      for(let candidate=1;candidate<model.root.getObjectByName("Continuous undercut sidepod shell").userData.shellRings;candidate++){
        if(Math.abs(p.getX(candidate*17)-x)<Math.abs(p.getX(row*17)-x))row=candidate;
      }
      const seam=new T.Vector3().fromBufferAttribute(p,row*17);
      for(const below of [.001,.002,.003]){
        const ray=new T.Raycaster(new T.Vector3(seam.x,seam.y-below,side*1.5),new T.Vector3(0,0,-side));
        const hit=ray.intersectObject(floor)[0];
        assert.ok(hit,`open shoulder under seam at ${side}, ${x}, ${below}`);
        assert.ok(Math.abs(hit.point.z)<Math.abs(seam.z)-.00015,`the laminate edge sticks out instead of following the undercut at ${side}, ${x}, ${below}`);
      }
    }
  }
});

test("the bodywork is a thin laminate with an open underside, not a second floor across the engine bay",()=>{
  const body=model.root.getObjectByName("Continuous undercut sidepod shell"),inner=model.root.getObjectByName("Bodywork inner laminate");
  assert.ok(inner&&inner.userData.component==="bodywork"&&inner.userData.cover);
  for(const x of [-.95,-.70,-.40])for(const z of [-.07,.07]){
    const ray=new T.Raycaster(new T.Vector3(x,.08,z),new T.Vector3(0,1,0),0,1.2);
    const hit=ray.intersectObjects([body,inner],false)[0];
    assert.ok(hit&&hit.object===inner,`missing inner skin at ${x}, ${z}`);
    assert.ok(hit.point.y>.45,`bodywork closes the engine bay below its cover at ${x}, ${z}`);
  }
  for(const x of[.12,.30,.48])for(const z of[-.12,0,.12]){
    // The electrical cavity ends below the cockpit's rising front lip.
    const ray=new T.Raycaster(new T.Vector3(x,.08,z),new T.Vector3(0,1,0),0,.23);
    assert.equal(ray.intersectObjects([body,inner],false).length,0,"removable skin crosses the electrical bay below the seat");
  }
  const p=body.geometry.attributes.position,n=body.geometry.attributes.normal,index=body.geometry.index,ray=new T.Raycaster();
  for(let i=180;i<index.count;i+=1257){
    // Sample inside a face. A ray aimed exactly at a Float32 shared vertex can
    // miss both adjacent inner triangles despite their correct 2.5 mm offset.
    const point=new T.Vector3(),normal=new T.Vector3();
    for(let j=0;j<3;j++){point.add(new T.Vector3().fromBufferAttribute(p,index.getX(i+j)));normal.add(new T.Vector3().fromBufferAttribute(n,index.getX(i+j)));}
    point.divideScalar(3);normal.normalize();
    if(point.y<.35||point.x>.25||point.x<-1.4)continue;
    // At a suspension opening, the normal ray can meet the rounded return
    // instead of the parallel inner skin. Its topology is checked below.
    if((body.userData.suspensionPassages??[]).some(profile=>profile.some((v,j)=>new T.Line3(new T.Vector3(...v,0),new T.Vector3(...profile[(j+1)%profile.length],0)).closestPointToPoint(new T.Vector3(point.x,point.y,0),true,new T.Vector3()).distanceTo(new T.Vector3(point.x,point.y,0))<.004)))continue;
    // From the cavity toward the cover: only the nearby inner laminate should
    // be hit before reaching the measured exterior point.
    ray.set(point.clone().addScaledVector(normal,-.012),normal);ray.near=0;ray.far=.02;
    const hit=ray.intersectObject(inner,false)[0];
    assert.ok(hit,`no inner laminate opposite exterior face ${i/3}`);
    assert.ok(hit.point.distanceTo(point)>=.0015&&hit.point.distanceTo(point)<=.004,`laminate thickness changes at ${i}`);
  }
  for(const part of [body,inner]){
    const used=new Set(Array.from(part.geometry.index.array));
    assert.equal(used.size,part.geometry.attributes.position.count,`${part.name} has nonphysical discarded vertices in its bounds`);
  }
  // Exterior, inner surface and edge returns form one closed sheet of material.
  // Every spatial edge needs exactly two opposite faces. The opening is empty
  // space, not an unjoined wall or a cap folded across the cockpit/inlet contour.
  assertClosedShell([body,inner]);
});

test("the rear body opens into the tail cooling cavity without a hidden bulkhead",()=>{
  const body=model.root.getObjectByName("Continuous undercut sidepod shell");
  const probe=new T.Mesh(body.geometry,new T.MeshBasicMaterial({side:T.DoubleSide}));
  probe.matrixWorld.copy(body.matrixWorld);
  const rear=new T.Box3().setFromObject(body).min.x;
  for(const y of[.37,.39,.414,.44])for(const z of[-.09,-.0745,.0745,.09]){
    const hits=new T.Raycaster(new T.Vector3(rear-.005,y,z),new T.Vector3(1,0,0),0,.010).intersectObject(probe,false);
    assert.equal(hits.length,0,`a rear cap blocks cooling air at ${y}, ${z}`);
  }
  probe.material.dispose();
});

test("the tail cooling outlet is open around the exhaust sleeve and has closed laminate rims",()=>{
  const shield=model.root.getObjectByName("Tail heat shield");
  assertClosedShell([shield]);
  const probe=new T.Mesh(shield.geometry,new T.MeshBasicMaterial({side:T.DoubleSide}));
  probe.matrixWorld.copy(shield.matrixWorld);
  for(const side of[-1,1])for(const y of[.501,.503,.505]){
    const ray=new T.Raycaster(new T.Vector3(-1.99,y,side*.034),new T.Vector3(1,0,0),0,.025);
    assert.equal(ray.intersectObject(probe,false).length,0,"a cap seals the cooling outlet beside the exhaust sleeve");
  }
  for(const side of[-1,1]){
    const stay=model.root.getObjectByName(`Tail exhaust sleeve stay ${side}`);
    assert.ok(stay,"the exhaust sleeve has no support inside the open outlet");
    const bounds=new T.Box3().setFromObject(stay),centre=bounds.getCenter(new T.Vector3());
    const hits=new T.Raycaster(new T.Vector3(centre.x,centre.y,0),new T.Vector3(0,0,side),0,.15).intersectObject(probe,false);
    const inside=hits.filter(hit=>hit.point.z>=bounds.min.z&&hit.point.z<=bounds.max.z);
    assert.ok(inside.length>=2,"the stay must enter both the sleeve and the outer wall");
  }
  probe.material.dispose();
});

test("each wheel has a connected paired-spoke face, recessed annulus and detailed centre lock",()=>{
  for(const wheel of model.assemblies.get("tyres").children.filter(o=>o.userData.wheel)){
    const side=wheel.userData.side,web=wheel.children.find(o=>o.name.includes(`forged paired-spoke web ${side}`));
    assert.ok(web);assert.equal(web.userData.spokePairs,6);
    assert.equal(wheel.children.filter(o=>o.name.includes("forged paired-spoke web")).length,1);
    assert.equal(web.geometry.parameters.shapes.holes.length,13,"twelve windows plus the spindle bore");
    const ray=new T.Raycaster();
    for(let i=0;i<12;i++){
      const angle=i*Math.PI/6,origin=new T.Vector3(Math.cos(angle)*.12,Math.sin(angle)*.12,side*.4).applyMatrix4(wheel.matrixWorld);
      ray.set(origin,new T.Vector3(0,0,-side));ray.far=.8;
      assert.ok(!ray.intersectObject(web,false)[0],`spoke window ${i} is capped by a broken face`);
    }
    assert.equal(wheel.children.filter(o=>o.name.includes("locking finger")).length,6);
    assert.equal(wheel.children.filter(o=>o.name.includes("centre lock ")&&!o.name.includes("recess")).length,1);
    const lip=wheel.children.find(o=>o.name.endsWith(`rim lip ${side}`));lip.geometry.computeBoundingBox();
    assert.ok(Math.abs(lip.geometry.boundingBox.getSize(new T.Vector3()).x-.468)<.001,"rim flange must overlap the 457.2 mm bead seat");
    const bowl=wheel.children.find(o=>o.name.includes("recessed rim bowl"));
    const radii=Array.from({length:bowl.geometry.attributes.position.count},(_,i)=>Math.hypot(bowl.geometry.attributes.position.getX(i),bowl.geometry.attributes.position.getY(i)));
    assert.ok(Math.min(...radii)<.153&&Math.max(...radii)>.22);
  }
});

test("body interpolation stays inside the reference height and the halo bridge has no central dip",()=>{
  const body=model.root.getObjectByName("Continuous undercut sidepod shell");
  assert.ok(body.geometry.boundingBox.max.y<=1.001,"engine cover overshoots the reference stations");
  const p=model.root.getObjectByName("Halo aerodynamic fairing").geometry.attributes.position;
  const ringHeight=ring=>Array.from({length:20},(_,i)=>p.getY(ring*20+i)).reduce((a,b)=>a+b,0)/20;
  const centre=ringHeight(80);
  for(let ring=60;ring<=100;ring++)assert.ok(ringHeight(ring)-centre<.015,"halo front bridge dips below its shoulders");
});

test("sampled front and rear wing sections retain a slot throughout the flap movement",()=>{
  const ray=new T.Raycaster(),down=new T.Vector3(0,-1,0),materials=new Map();
  const section=(part,x,z)=>{
    ray.set(new T.Vector3(x,2,z),down);
    const heights=ray.intersectObject(part,false).map(hit=>hit.point.y);
    return heights.length<2?null:[Math.min(...heights),Math.max(...heights)];
  };
  try{
    for(const id of ["front-wing","rear-wing"]){
      const parts=model.assemblies.get(id).children.filter(o=>/^(Rear mainplane|Rear active flap|Front mainplane|Front (primary|secondary) flap -?1)$/.test(o.name));
      for(const part of parts){if(!materials.has(part.material))materials.set(part.material,part.material.side);part.material.side=T.DoubleSide;}
      for(const fraction of id==="front-wing"?Array.from({length:25},(_,i)=>i/24):[0,.25,.5,.75,1]){
        for(const part of parts)if(part.userData.flap)part.quaternion.setFromAxisAngle(part.userData.hingeAxis,T.MathUtils.lerp(part.userData.closedAngle,part.userData.openAngle,fraction));
        model.root.updateMatrixWorld(true);
        const bounds=new T.Box3();for(const part of parts)bounds.union(new T.Box3().setFromObject(part));
        for(let z=-.6;z<=.60001;z+=.1)for(let x=bounds.min.x;x<=bounds.max.x;x+=.007){
          const slices=parts.map(part=>({part,range:section(part,x,z)})).filter(slice=>slice.range);
          for(let i=0;i<slices.length;i++)for(let j=i+1;j<slices.length;j++){
            const a=slices[i],b=slices[j],overlap=Math.min(a.range[1],b.range[1])-Math.max(a.range[0],b.range[0]);
            assert.ok(overlap<.0001,`${a.part.name} intersects ${b.part.name} at ${x}, ${z}, opening ${fraction}`);
          }
        }
      }
    }
  }finally{
    for(const [material,side] of materials)material.side=side;
    model.root.traverse(o=>{if(o.userData.flap)o.quaternion.setFromAxisAngle(o.userData.hingeAxis,o.userData.closedAngle);});
    model.root.updateMatrixWorld(true);
  }
});

test("halo follows the side-reference crown and widens into enclosed rear feet",()=>{
  const halo=model.root.getObjectByName("Halo aerodynamic fairing"),p=halo.geometry.attributes.position;
  assertClosedShell([halo]);
  for(const [px,top,bottom] of [[720,91,114],[750,84,100],[780,77,92],[805,71,88]]){
    const ys=[];
    for(let i=0;i<p.count;i++)if(Math.abs(p.getX(i)-(px-665)*3.4/940)<.009)ys.push(307-p.getY(i)/(3.4/940));
    assert.ok(ys.length>0);
    assert.ok(Math.abs(Math.min(...ys)-top)<4,`halo upper contour at ${px}`);
    assert.ok(Math.abs(Math.max(...ys)-bottom)<4,`halo inner opening at ${px}`);
  }
  const body=model.root.getObjectByName("Continuous undercut sidepod shell"),b=body.geometry.attributes.position;
  for(let i=0;i<b.count;i++)if(b.getX(i)>-.11&&b.getX(i)<.025)assert.ok(b.getY(i)<.81,"bodywork projects as a horn ahead of the airbox");
});

test("front endplates form one closed channel with a rounded outer return",()=>{
  for(const side of [-1,1]){
    const plate=model.root.getObjectByName(`Front endplate ${side}`);assertClosedShell([plate]);
    assert.ok(!model.root.getObjectByName(`Curved front footplate ${side}`),"a separate foot leaves an overlapping seam");
    const ray=new T.Raycaster();
    for(const x of [2.20,2.30,2.40]){
      const heights=[];
      for(const z of [.79,.82,.85,.88,.90,.92,.94]){
        ray.set(new T.Vector3(x,.6,side*z),new T.Vector3(0,-1,0));
        const hit=ray.intersectObject(plate,false)[0];
        assert.ok(hit,`endplate has no continuous outer channel at ${x}, ${side*z}`);
        heights.push(hit.point.y);
      }
      const crest=Math.max(...heights);
      assert.ok(crest-Math.min(...heights)>.040,"outer channel is a flat or pointed shelf");
      assert.ok(crest-heights.at(-1)>.020,"outer lip does not curl down after its rounded crest");
    }
  }
});

test("mainplane follows the curved endplate inner wall without projecting through it",()=>{
  const main=model.root.getObjectByName("Front mainplane"),p=main.geometry.attributes.position,ray=new T.Raycaster();model.root.updateMatrixWorld(true);
  for(const sign of [-1,1]){
    const plate=model.root.getObjectByName(`Front endplate ${sign}`),old=plate.material.side;plate.material.side=T.DoubleSide;let seated=0;
    try{
      for(let i=0;i<p.count;i++){
        const v=new T.Vector3().fromBufferAttribute(p,i).applyMatrix4(main.matrixWorld);
        if(v.z*sign<=.57)continue;
        ray.set(new T.Vector3(v.x,v.y,0),new T.Vector3(0,0,sign));
        const hit=ray.intersectObject(plate,false)[0];if(!hit)continue;
        assert.ok(Math.abs(v.z)<=Math.abs(hit.point.z)+.001,`mainplane pierces endplate at ${v.toArray()}`);
        if(Math.abs(Math.abs(v.z)-Math.abs(hit.point.z))<.001)seated++;
      }
      assert.ok(seated>=16,"mainplane edge has no physical contact with the endplate");
    }finally{plate.material.side=old;}
  }
});

test("the mainplane cap cannot show through the outside of the curved endplate",()=>{
  const main=model.root.getObjectByName("Front mainplane"),ray=new T.Raycaster();model.root.updateMatrixWorld(true);
  for(const side of [-1,1]){
    const plate=model.root.getObjectByName(`Front endplate ${side}`),p=plate.geometry.attributes.position,ix=plate.geometry.index.array;
    // Sample the actual outer skin, including the heel. Checking only the
    // mainplane perimeter misses a planar cap bridging across a concave wall.
    for(let i=0;i<48*80*6;i+=3){
      const [a,b,c]=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(p,ix[i+j]).applyMatrix4(plate.matrixWorld));
      const centre=a.clone().add(b).add(c).multiplyScalar(1/3);
      const normal=b.clone().sub(a).cross(c.clone().sub(a)).normalize();
      ray.set(centre.clone().addScaledVector(normal,.05),normal.clone().negate());
      const hit=ray.intersectObjects([plate,main],false)[0];
      assert.ok(hit?.object!==main||hit.distance>=.05-.00005,`mainplane shows through endplate at ${centre.toArray()}`);
    }
  }
});

test("front outboard vanes have closed sections and a continuous attached root",()=>{
  model.root.updateMatrixWorld(true);
  for(const side of [-1,1]){
    const vane=model.root.getObjectByName(`Front outboard vane ${side}`),plate=model.root.getObjectByName(`Front endplate ${side}`);
    assertClosedShell([vane]);
    const bounds=new T.Box3().setFromObject(vane);
    assert.ok(bounds.max.z-bounds.min.z>.20,"outboard vane does not span the outer channel");
    const ray=new T.Raycaster(),p=vane.geometry.attributes.position;
    for(let i=0;i<=24;i++){
      const v=new T.Vector3().fromBufferAttribute(p,i).applyMatrix4(vane.matrixWorld);
      ray.set(new T.Vector3(v.x,v.y,side*1.1),new T.Vector3(0,0,-side));
      const hit=ray.intersectObject(plate,false)[0];
      assert.ok(hit&&hit.point.distanceTo(v)<.0001,`floating outboard vane root at ${v.toArray()}`);
    }
  }
});

test("nose cooling inlet and its supporting skins remain closed outward solids",()=>{
  for(const name of["Nose driver cooling scoop","Cockpit nose ventilation duct","Silver nose skin","Forward survival cell deck","Front suspension access cover"]){
    const part=model.root.getObjectByName(name);assert.ok(part,name);assertClosedShell([part]);
    const p=part.geometry.attributes.position,ix=part.geometry.index;let volume=0;
    for(let i=0;i<ix.count;i+=3){const [a,b,c]=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(p,ix.getX(i+j)));volume+=a.dot(b.cross(c))/6;}
    assert.ok(volume>0,`${name}: inside-out surface`);
  }
});

test("nose ventilation has an open route into the cockpit clear of halo, suspension and steering",()=>{
  model.root.updateMatrixWorld(true);
  const corridor=new T.Box3(new T.Vector3(.63,.55,-.08),new T.Vector3(1.28,.69,.08)),parts=[],materials=new Map();
  model.root.traverse(p=>{if(p.isMesh&&new T.Box3().setFromObject(p).intersectsBox(corridor)){
    parts.push(p);if(!materials.has(p.material))materials.set(p.material,p.material.side);p.material.side=T.DoubleSide;
  }});
  const stations=[[1.27,.6754],[1.250,.673],[1.200,.667],[1.120,.647],[1.050,.630],[.920,.605],[.850,.590],[.750,.560],[.680,.560],[.64,.560]];
  try{
    for(const z of[-.05,0,.05])for(const offset of[-.005,0,.005])for(let i=1;i<stations.length;i++){
      const a=new T.Vector3(stations[i-1][0],stations[i-1][1]+offset,z),b=new T.Vector3(stations[i][0],stations[i][1]+offset,z),d=b.clone().sub(a);
      const hit=new T.Raycaster(a,d.clone().normalize(),.000001,d.length()-.000001).intersectObjects(parts,false)[0];
      assert.ok(!hit,`vent blocked by ${hit?.object.name} at ${hit?.point.toArray()}`);
    }
  }finally{for(const [m,side]of materials)m.side=side;}
});

test("nose probes and both antennae sit on conforming feet with open forward probe tips",()=>{
  const nose=model.root.getObjectByName("Silver nose skin"),surface=createSurfaceSampler([nose],"y");
  for(const name of["Nose air-data mast","Nose antenna 0","Nose antenna 1"]){
    const foot=model.root.getObjectByName(`${name} mounting foot`);assertClosedShell([foot]);
    const p=foot.geometry.attributes.position;
    for(let i=0;i<33;i++)assert.ok(Math.abs(p.getY(i)-surface(p.getX(i),p.getZ(i),1))<.000002,`${name}: floating mounting foot`);
    for(const side of[-1,1])assert.ok(model.root.getObjectByName(`${name} fixing ${side}`));
  }
  const mast=model.root.getObjectByName("Nose air-data mast");
  for(let i=0;i<2;i++){
    const probe=model.root.getObjectByName(`Nose air-data probe ${i}`),axis=new T.Vector3(0,1,0).applyQuaternion(probe.quaternion),tip=probe.position.clone().addScaledVector(axis,.052);
    const ray=new T.Raycaster(tip.clone().addScaledVector(axis,.005),axis.clone().negate(),0,.065);
    const hit=ray.intersectObjects([probe,mast],false)[0];
    assert.equal(hit?.object,mast,"probe tip is capped or detached from its mast");
  }
});

test("the nose scoop encloses the duct shoulders without exposed black corners",()=>{
  const skin=createSurfaceSampler([model.root.getObjectByName("Silver nose skin"),model.root.getObjectByName("Nose driver cooling scoop")],"y");
  const duct=model.root.getObjectByName("Cockpit nose ventilation duct"),p=duct.geometry.attributes.position;
  for(let i=0;i<p.count/2;i++){
    const x=p.getX(i);if(x<1.03)continue;
    const y=skin(x,p.getZ(i),1);assert.ok(y!==undefined&&y-p.getY(i)>.001,`duct protrudes through nose scoop at ${x}, ${p.getZ(i)}`);
  }
});

test("nose equipment follows the launch side-view order and mast height",()=>{
  model.root.updateMatrixWorld(true);
  const bounds=name=>new T.Box3().setFromObject(model.root.getObjectByName(name));
  const mast=bounds("Nose air-data mast"),scoop=bounds("Nose driver cooling scoop");
  const frontAerial=bounds("Nose antenna 0 whip"),rearAerial=bounds("Nose antenna 1 whip");
  assert.ok(mast.min.y>.635&&mast.min.y<.660,"mast base does not follow the fitted nose roof");
  assert.ok(mast.max.y>.790&&mast.max.y<.815,"probe mast is hidden below the front tyre crown");
  assert.ok(mast.min.x>frontAerial.max.x&&frontAerial.min.x>scoop.max.x);
  assert.ok(scoop.min.x>rearAerial.max.x,"aft aerial intersects the cooling scoop");
});

test("nose service joint is recessed and its fixings have closed driver sockets",()=>{
  const nose=model.root.getObjectByName("Silver nose skin"),skin=createSurfaceSampler([nose],"y");
  const joint=model.root.getObjectByName("Nose service panel recessed joint");assertClosedShell([joint]);
  const p=joint.geometry.attributes.position;
  // The groove at the rounded rear edge is below both neighbouring roof
  // samples, not an added black line proud of the surface.
  const x=.983,z=0,roof=(skin(x-.003,z,1)+skin(x+.003,z,1))/2;
  assert.ok(roof-skin(x,z,1)>.00035,"panel joint is not recessed");
  for(let i=2;i<p.count;i+=4){
    assert.ok(Math.abs(p.getY(i)-skin(p.getX(i),p.getZ(i),1)-.00002)<.000003,"seal floats above groove");
  }
  for(const side of[-1,1])for(let i=0;i<3;i++){
    const fixing=model.root.getObjectByName(`Nose service panel fixing ${side} ${i}`);assertClosedShell([fixing]);
    const axis=new T.Vector3(0,1,0).applyQuaternion(fixing.quaternion);
    const hit=new T.Raycaster(fixing.position.clone().addScaledVector(axis,.005),axis.clone().negate(),0,.007).intersectObject(fixing,false)[0];
    assert.ok(hit&&hit.distance>.0053,"driver recess is capped flush");
  }
});
