import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import {createW17} from "./w17-geometry.ts";
import {createSurfaceSampler} from "./w17-surface.ts";

const model=createW17();model.root.updateMatrixWorld(true);
const part=name=>model.root.getObjectByName(name);
const ecu=model.assemblies.get("electronics").children.filter(o=>/^FIA ECU|^ECU sealed|^ECU heat|^ECU mounting rail|^ECU mounting eye|^ECU socket|^ECU connector/.test(o.name));
const curve=part("Main loom").geometry.parameters.path,radius=part("Main loom").userData.outerRadius;
const occupied=new T.Box3().setFromPoints(curve.getPoints(200)).expandByScalar(.02);
for(const o of ecu)occupied.expandByObject(o);
const obstacles=[];
model.root.traverse(object=>{
  if(!object.isMesh||object.isInstancedMesh||object.userData.component==="electronics")return;
  const bounds=new T.Box3().setFromObject(object);if(!bounds.intersectsBox(occupied))return;
  const p=object.geometry.attributes.position,index=object.geometry.index,triangles=[];
  for(let i=0;i<(index?.count??p.count);i+=3){
    const vertices=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(p,index?index.getX(i+j):i+j).applyMatrix4(object.matrixWorld));
    triangles.push({triangle:new T.Triangle(...vertices),bounds:new T.Box3().setFromPoints(vertices)});
  }
  obstacles.push({object,bounds,triangles});
});

test("the complete ECU case, fins, sockets and mounting rails clear the seat, battery and tub skins",()=>{
  const errors=[];
  for(const object of ecu){
    const bounds=new T.Box3().setFromObject(object).expandByScalar(.001);
    for(const obstacle of obstacles){
      if(!obstacle.bounds.intersectsBox(bounds))continue;
      if(obstacle.triangles.some(t=>t.bounds.intersectsBox(bounds)&&bounds.intersectsTriangle(t.triangle)))errors.push(`${object.name} / ${obstacle.object.name}`);
    }
  }
  assert.deepEqual(errors,[]);
  const housing=new T.Box3().setFromObject(part("FIA ECU TAG-700 case"));
  const battery=new T.Box3().setFromObject(part("ES access lid")),tank=new T.Box3().setFromObject(part("Fuel bladder"));
  assert.ok(housing.min.y>battery.max.y+.006,"ECU sits on the battery lid");
  assert.ok(housing.min.x>tank.max.x+.010,"ECU occupies the fuel bladder");
});

test("the ECU tray has supported pillars and four vibration mounts through the mounting eyes",()=>{
  const seat=createSurfaceSampler([part("Survival cell lower shell")],"y"),tray=new T.Box3().setFromObject(part("ECU mounting tray"));
  for(const [x,z]of[[.120,-.168],[.150,.168],[.260,-.168],[.260,.168]]){
    const pillar=new T.Box3().setFromObject(part(`ECU tray pillar ${x} ${z}`)),height=seat(x,z,1);
    assert.ok(height>pillar.min.y&&height<pillar.max.y,"pillar floats over the cell");
    assert.ok(pillar.intersectsBox(tray),"pillar does not reach the tray");
    const hit=new T.Raycaster(new T.Vector3(x,.18,z),new T.Vector3(0,1,0),0,.02).intersectObject(part("ECU mounting tray"),false)[0];
    assert.ok(hit&&hit.point.y<pillar.max.y,"pillar ends below a notch instead of solid tray material");
  }
  for(const x of[.115,.265])for(const z of[-.145,.145]){
    const mount=new T.Box3().setFromObject(part(`ECU vibration mount ${x} ${z}`)),bolt=new T.Box3().setFromObject(part(`ECU mounting bolt ${x} ${z}`));
    const rail=new T.Box3().setFromObject(part(`ECU mounting rail ${z}`));
    assert.ok(Math.abs(mount.min.y-tray.max.y)<1e-7);
    assert.ok(Math.abs(mount.max.y-rail.min.y)<1e-7);
    assert.ok(bolt.min.y<=mount.min.y+1e-7&&bolt.max.y>rail.max.y,"bolt does not join mount and rail");
  }
});

test("the whole harness clears all neighboring skins and hardware outside its intended rubber boots",()=>{
  const closest=new T.Vector3(),errors=new Set();
  for(const point of curve.getSpacedPoints(800))for(const {object,bounds,triangles}of obstacles){
    if(bounds.distanceToPoint(point)>radius+.0003)continue;
    // The 6 mm rubber bore is the deliberate retaining contact, not a gap.
    const clearance=object.name==="Loom service boot"?radius-.0001:radius+.0003;
    if(triangles.some(t=>t.bounds.distanceToPoint(point)<clearance&&t.triangle.closestPointToPoint(point,closest).distanceTo(point)<clearance))errors.add(object.name);
  }
  assert.deepEqual([...errors],[]);
});

test("the engine harness passage is open on its connected side and capped on the opposite side",()=>{
  const pan=part("Lower chassis enclosure"),boot=part("Engine loom bulkhead boot"),cap=part("Engine loom opposite blanking plug");
  const ray=new T.Raycaster(new T.Vector3(-.245,.215,-.29),new T.Vector3(0,0,1),0,.12);
  assert.equal(ray.intersectObjects([pan,boot],false).length,0,"opaque surface blocks the cable");
  ray.set(new T.Vector3(-.245,.215,.29),new T.Vector3(0,0,-1));ray.far=.10;
  assert.ok(ray.intersectObject(cap,false).length,"unused side of the passage is left open");
  for(const point of curve.getSpacedPoints(800).filter(p=>p.x<-.24&&p.z<-.233&&p.z>-.261)){
    assert.ok(Math.hypot(point.x+.245,point.y-.215)<1e-6,"a bend starts inside the boot");
  }
  // The trimmed tub still carries the boot around its bore, rather than
  // leaving the connector floating at the new engine-bay boundary.
  for(const y of[.203,.227]){
    ray.set(new T.Vector3(-.245,y,-.29),new T.Vector3(0,0,1));ray.far=.06;
    const contact=ray.intersectObject(pan,false)[0];
    assert.ok(contact&&contact.point.z>-.262&&contact.point.z<-.230,"engine loom boot has no surrounding tub wall");
  }
});

test("the wiring and ECU remain inside the assembled outer envelope",()=>{
  const exterior=[];
  model.root.traverse(o=>{if(o.isMesh&&["bodywork","floor","monocoque"].includes(o.userData.component)&&!o.userData.internal)exterior.push(o);});
  const edge=createSurfaceSampler(exterior,"z");
  const points=curve.getSpacedPoints(200);
  for(const object of ecu){
    const b=new T.Box3().setFromObject(object);
    for(const x of[b.min.x,b.max.x])for(const y of[b.min.y,b.max.y])for(const z of[b.min.z,b.max.z])points.push(new T.Vector3(x,y,z));
  }
  for(const p of points){
    const left=edge(p.x,p.y,-1),right=edge(p.x,p.y,1);
    assert.ok(left!==undefined&&right!==undefined&&p.z>left&&p.z<right,`outside body at ${p.toArray()}`);
  }
});
