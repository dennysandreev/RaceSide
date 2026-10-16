import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import {createW17} from "./w17-geometry.ts";
import {createSurfaceSampler} from "./w17-surface.ts";

const model=createW17();model.root.updateMatrixWorld(true);
const part=name=>model.root.getObjectByName(name),system=part("Cockpit fire suppression assembly");
const parts=[];model.root.traverse(o=>{if(o.isMesh&&o.userData.fireSystem)parts.push(o);});
function triangles(object){
  const p=object.geometry.attributes.position,index=object.geometry.index,out=[],matrix=new T.Matrix4(),instance=new T.Matrix4();
  for(let copy=0;copy<(object.isInstancedMesh?object.count:1);copy++){
    matrix.copy(object.matrixWorld);if(object.isInstancedMesh){object.getMatrixAt(copy,instance);matrix.multiply(instance);}
    for(let i=0;i<(index?.count??p.count);i+=3){
      const v=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(p,index?index.getX(i+j):i+j).applyMatrix4(matrix));
      out.push({triangle:new T.Triangle(...v),bounds:new T.Box3().setFromPoints(v)});
    }
  }
  return out;
}

test("the fire assembly clears neighboring parts outside its intended structural fixings",()=>{
  const occupied=new T.Box3(),obstacles=[];
  for(const object of parts)occupied.expandByObject(object);
  model.root.traverse(o=>{
    if(!o.isMesh||o.userData.fireSystem)return;
    const bounds=new T.Box3().setFromObject(o);if(bounds.intersectsBox(occupied))obstacles.push({object:o,bounds,triangles:triangles(o)});
  });
  const ray=new T.Ray(),hit=new T.Vector3(),errors=new Set();
  for(const object of parts){
    const bounds=new T.Box3().setFromObject(object),faces=triangles(object);
    for(const obstacle of obstacles){
      if(!bounds.intersectsBox(obstacle.bounds))continue;
      if(object.userData.fireMount&&object.userData.mountSurface===obstacle.object.name)continue;
      if(/^Fire tray floor (pillar|fixing)/.test(object.name)&&["Survival cell lower shell","Lower chassis enclosure","Central floor-to-chassis fairing"].includes(obstacle.object.name))continue;
      if(/^Fire line clip (foot|stand|fixing)|^Fire nozzle bracket (foot|fixing)/.test(object.name)&&obstacle.object.name==="Cockpit inner lining -1")continue;
      for(const face of faces)for(const other of obstacle.triangles){
        if(!face.bounds.intersectsBox(other.bounds))continue;
        for(const [a,b]of[[face,other],[other,face]])for(const [p,q]of[[a.triangle.a,a.triangle.b],[a.triangle.b,a.triangle.c],[a.triangle.c,a.triangle.a]]){
          const length=p.distanceTo(q);if(length<1e-9)continue;
          ray.set(p,q.clone().sub(p).normalize());
          if(ray.intersectTriangle(b.triangle.a,b.triangle.b,b.triangle.c,false,hit)&&hit.distanceTo(p)>1e-7&&hit.distanceTo(p)<length-1e-7)errors.add(`${object.name} / ${obstacle.object.name}`);
        }
      }
    }
  }
  assert.deepEqual([...errors],[]);
  const vessel=new T.Box3().setFromObject(part("Fire extinguisher")),battery=new T.Box3().setFromObject(part("ES access lid"));
  assert.ok(vessel.min.y>battery.max.y+.006,"bottle rests on the battery lid");
  assert.ok(vessel.max.x<.5&&vessel.min.x>.30,"bottle leaves the under-seat bay");
});

test("every fire-system mesh stays inside the car's outer sidewalls",()=>{
  const outer=[];model.root.traverse(o=>{if(o.isMesh&&["monocoque","bodywork","floor"].includes(o.userData.component))outer.push(o);});
  const side=createSurfaceSampler(outer,"z");
  for(const object of parts){
    if(object.userData.externalFire)continue;
    const p=object.geometry.attributes.position;
    for(let i=0;i<p.count;i++){
      const v=new T.Vector3().fromBufferAttribute(p,i).applyMatrix4(object.matrixWorld);
      assert.ok(Number.isFinite(v.x+v.y+v.z),`${object.name}: invalid geometry`);
      let left=side(v.x,v.y,-1),right=side(v.x,v.y,1);
      // A ray through either real handle aperture has no exterior intersection.
      // Recover only that 8 mm opening's envelope from its adjacent solid rim.
      if(Math.hypot(v.x+.180,v.y-.700)<.0081){
        left=Math.min(left??Infinity,side(v.x-.010,v.y,-1)??Infinity,side(v.x+.010,v.y,-1)??Infinity);
        right=Math.max(right??-Infinity,side(v.x-.010,v.y,1)??-Infinity,side(v.x+.010,v.y,1)??-Infinity);
      }
      assert.ok(left!==undefined&&right!==undefined&&v.z>left&&v.z<right,`${object.name} protrudes at ${v.toArray()}`);
    }
  }
});

test("the retained bottle has a supported tray and both clamping bolts reach it",()=>{
  const floor=createSurfaceSampler(["Survival cell lower shell","Lower chassis enclosure","Central floor-to-chassis fairing"].map(part),"y");
  const tray=part("Fire bottle mounting tray"),trayBounds=new T.Box3().setFromObject(tray);
  for(const side of[-1,1]){
    const pillar=part(`Fire tray floor pillar ${side}`),bounds=new T.Box3().setFromObject(pillar),centre=bounds.getCenter(new T.Vector3()),height=floor(centre.x,centre.z,1);
    assert.ok(bounds.min.y<height&&bounds.max.y>height,"pillar misses the structural floor");
    assert.ok(bounds.intersectsBox(trayBounds),"pillar ends below the tray");
  }
  for(const z of[-.048,.080]){
    const strap=part(`Fire bottle retaining strap ${z}`),saddle=part(`Fire bottle saddle ${z}`),tab=part(`Fire strap tab ${z}`),bolt=part(`Fire strap fixing ${z}`);
    const bounds=o=>new T.Box3().setFromObject(o);
    assert.ok(bounds(saddle).intersectsBox(trayBounds)&&bounds(saddle).intersectsBox(bounds(strap)),"bottle saddle floats");
    assert.ok(bounds(bolt).intersectsBox(trayBounds)&&bounds(bolt).intersectsBox(bounds(tab)),"clamp bolt misses its tray");
    const ray=new T.Raycaster(new T.Vector3(.430,.191,z),new T.Vector3(-1,0,0),0,.012);
    assert.ok(ray.intersectObject(strap,false).length,"strap tab does not reach the retaining band");
  }
});

test("the cockpit line has joined terminals, smooth bends and an open inward-facing nozzle",()=>{
  const elbow=part("Fire outlet elbow").userData.route.map(p=>new T.Vector3(...p)),line=part("Fire cockpit discharge line").userData.route.map(p=>new T.Vector3(...p));
  assert.ok(elbow[0].distanceTo(new T.Vector3(...system.userData.ports.discharge))<1e-7);
  assert.ok(elbow.at(-1).distanceTo(line[0])<1e-7);
  assert.ok(line.at(-1).distanceTo(new T.Vector3(.266,.380,-.156))<1e-7);
  for(const points of[elbow,line])for(let i=1;i<points.length-1;i++){
    const a=points[i-1],b=points[i],c=points[i+1],cross=b.clone().sub(a).cross(c.clone().sub(b)).length();
    if(cross>1e-12){const radius=a.distanceTo(b)*b.distanceTo(c)*c.distanceTo(a)/(2*cross);assert.ok(radius>.016,`pinched discharge bend: ${radius}`);}
  }
  const ray=new T.Raycaster(new T.Vector3(.266,.380,-.164),new T.Vector3(0,0,1),0,.05);
  assert.equal(ray.intersectObjects([part("Fire nozzle socket"),part("Fire cockpit nozzle"),part("Fire nozzle mounting plate")],false).length,0,"solid wall closes the nozzle bore");
  assert.equal(parts.filter(p=>p.name==="Fire cockpit nozzle").length,1);
});

test("the independent activation pack contains its battery and has real control and connector openings",()=>{
  const battery=part("Fire independent battery"),bounds=new T.Box3().setFromObject(battery);
  assert.ok(bounds.min.x>.407&&bounds.max.x<.473&&bounds.min.y>.396&&bounds.max.y<.474&&bounds.min.z>-.180&&bounds.max.z<-.160);
  assert.equal(system.userData.fireActivation.independent,true);
  assert.ok(part("Fire battery cradle")&&part("Fire battery retainer")&&part("Fire arming lever"));
  const ray=new T.Raycaster();
  for(const x of[.426,.454]){
    ray.set(new T.Vector3(x,.456,-.145),new T.Vector3(0,0,-1));ray.far=.030;
    assert.equal(ray.intersectObject(part("Fire control enclosure lid"),false).length,0,"control is buried in a closed lid");
  }
  for(const [x,y,direction]of[[.421,.490,-1],[.459,.490,-1],[.440,.380,1]]){
    ray.set(new T.Vector3(x,y,-.170),new T.Vector3(0,direction,0));ray.far=.025;
    assert.equal(ray.intersectObject(part("Fire control enclosure walls"),false).length,0,"socket ends against a closed enclosure");
  }
  const button=new T.Box3().setFromObject(part("Fire driver activation button"));
  assert.ok(button.min.y>.44&&button.max.x<.45&&button.max.z>-.155,"driver control leaves the accessible side of the cockpit");
});

test("both remote handles have a 40 mm hook opening, supported switches and connected independent leads",()=>{
  const body=part("Continuous undercut sidepod shell"),inner=part("Bodywork inner laminate");
  for(const [i,side]of[-1,1].entries()){
    const handle=part(`Fire external pull ring ${side}`),centre=new T.Box3().setFromObject(handle).getCenter(new T.Vector3());
    for(const radius of[0,.0198])for(let k=0;k<12;k++){
      const a=k*Math.PI/6,ray=new T.Raycaster(new T.Vector3(centre.x+Math.cos(a)*radius,.710,centre.z+Math.sin(a)*radius),new T.Vector3(0,-1,0),0,.020);
      assert.equal(ray.intersectObject(handle,false).length,0,"hook opening is obstructed");
    }
    const port=new T.Vector3(...system.userData.fireActivation.external[i]);
    const route=part(`Fire external trigger cable ${side}`).userData.route;
    assert.ok(new T.Vector3(...route.at(-1)).distanceTo(port)<1e-7);
    assert.equal(part(`Fire external trigger cable ${side}`).userData.fireCircuit,"independent");
    assert.equal(part(`Fire external switch carrier ${side}`).userData.mountSurface,`Roll hoop ${side}`);
    const ray=new T.Raycaster(new T.Vector3(-.180,.700,side*.40),new T.Vector3(0,0,-side),0,.20);
    assert.equal(ray.intersectObjects([body,inner],false).length,0,"handle has no real passage through its cover");
  }
  const output=part("Fire firing-head cable").userData.route;
  const elbow=part("Fire firing-head angled backshell").userData.route;
  assert.ok(new T.Vector3(...output.at(-1)).distanceTo(new T.Vector3(...elbow.at(-1)))<1e-7);
  assert.ok(new T.Vector3(...elbow[0]).distanceTo(new T.Vector3(.440,.214,-.120))<1e-7);
});

test("the trigger loom passes beside the fuel cell through open protected side passages",()=>{
  for(const name of["Cockpit inner lining -1","Cockpit side -1"]){
    const ray=new T.Raycaster(new T.Vector3(.160,.480,-.160),new T.Vector3(0,0,-1),0,.15);
    assert.equal(ray.intersectObject(part(name),false).length,0,`${name} blocks the protected passage`);
    const sleeve=part(`Fire trigger passage ${name}`);
    assert.equal(sleeve.userData.mountSurface,name);
    assert.equal(ray.intersectObject(sleeve,false).length,0,"sleeve bore is closed");
  }
  for(const side of[-1,1]){
    const points=part(`Fire external trigger cable ${side}`).userData.route.map(p=>new T.Vector3(...p));
    assert.ok(points.some(p=>p.x<0&&p.y<.60&&p.z<-.26),"rear-running loom enters the fuel compartment");
    assert.ok(points.every(p=>Number.isFinite(p.x+p.y+p.z)));
  }
});
