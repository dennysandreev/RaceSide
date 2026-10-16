import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import {createW17,W17_AXLES,W17_WHEELS,W17_REFERENCE_HEIGHT,W17_REAR_LIGHT_OVERHANG} from "./w17-geometry.ts";
import {createSurfaceSampler} from "./w17-surface.ts";
import {visibleInPowertrain} from "./w17-model-cache.ts";

const model=createW17();model.root.updateMatrixWorld(true);
const part=name=>model.root.getObjectByName(name);
const bounds=name=>new T.Box3().setFromObject(part(name));

test("the rear impact structure stays behind the final-drive envelope and seats on the gearbox rear wall",()=>{
  const impact=bounds("Rear crash structure"),crown=bounds("Final drive crown wheel"),casing=bounds("Carbon gearbox casing");
  // Check the entire crown's rotational envelope, not just the visible teeth
  // at one angle. The old beam entered this envelope by 64 mm.
  assert.ok(impact.max.x<crown.min.x-.005,"rear impact beam enters the crown wheel envelope");
  assert.ok(impact.max.x<=casing.min.x+.00001,"impact beam extends into the transmission case");
  assert.ok(casing.min.x-impact.max.x<.012,"impact beam has no connection at the rear case face");
  const light=bounds("Rear rain light housing");
  assert.ok(Math.abs(light.max.x-impact.min.x)<.0001,"rear light floats off the impact structure");
});

test("the compact rear impact face keeps the lamp seated and within the retained wing outline",()=>{
  const impact=bounds("Rear crash structure"),lamp=bounds("Rear rain light housing"),centre=lamp.getCenter(new T.Vector3());
  assert.ok(Math.abs(W17_AXLES.rear-impact.min.x-W17_REAR_LIGHT_OVERHANG)<.00001);
  assert.ok(lamp.min.x>bounds("Rear endplate 1").min.x,"lamp projects beyond the retained wing's rear outline");
  assert.ok(impact.getSize(new T.Vector3()).x<.410,"oversized rear extension returned");
  assert.ok(Math.abs(impact.max.y-W17_REFERENCE_HEIGHT-.3725)<.00001,"aft impact roof uses the road instead of the reference plane");
  assert.ok(Math.abs(centre.y-W17_REFERENCE_HEIGHT-.300)<.00001,"lamp is not centred at reference Z=300 mm");
  assert.ok(Math.abs(centre.z)<1e-7);
  assert.ok(lamp.min.y>impact.min.y&&lamp.max.y<impact.max.y,"light overhangs its impact-member mounting face");
  for(let row=0;row<5;row++)for(let column=0;column<3;column++){
    const led=part(`Rear rain light LED ${row} ${column}`),box=bounds(led.name);
    assert.ok(box.intersectsBox(lamp),"lamp lens floats off its housing");
    assert.ok(box.min.x<lamp.min.x,"lamp lens is buried");
    const direction=new T.Vector3(0,1,0).applyQuaternion(led.quaternion);
    assert.ok(direction.dot(new T.Vector3(-1,0,0))>.9999,"lamp lens does not face rearwards");
  }
});

test("the extended rear impact member clears the exhaust, tail cover and diffuser",()=>{
  const impact=part("Rear crash structure"),top=createSurfaceSampler([impact],"y"),bottom=createSurfaceSampler([impact],"y");
  let upperChecks=0;
  for(const name of["Exhaust tailpipe","Tail heat shield"]){
    const mesh=part(name),p=mesh.geometry.attributes.position;
    for(let i=0;i<p.count;i++){
      const v=new T.Vector3().fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld),height=top(v.x,v.z,1);
      if(height===undefined)continue;
      assert.ok(v.y-height>.005,`${name} crosses the impact-member roof at ${v.toArray()}`);upperChecks++;
    }
  }
  assert.ok(upperChecks>100);
  const fence=part("Diffuser fence 0"),p=fence.geometry.attributes.position;let lowerChecks=0;
  for(let i=0;i<p.count;i++){
    const v=new T.Vector3().fromBufferAttribute(p,i).applyMatrix4(fence.matrixWorld),height=bottom(v.x,v.z,-1);
    if(height===undefined)continue;
    assert.ok(height-v.y>.005,"impact member enters the central diffuser fence");lowerChecks++;
  }
  assert.ok(lowerChecks>50);
});

test("rear drive shafts reach the wheel hubs through the brake spindle on both sides",()=>{
  for(const side of[-1,1]){
    const stub=part(`Rear drive stub ${side}`);assert.ok(stub,"outer CV joint has no drive stub");
    const box=bounds(stub.name),cv=bounds(`CV joint ${side}`),hub=bounds(`Rear ${side} hub flange ${side}`);
    assert.ok(box.intersectsBox(cv)&&box.intersectsBox(hub),"drive stops short of its CV or wheel hub");
    const centre=box.getCenter(new T.Vector3());
    assert.ok(Math.abs(centre.x-W17_AXLES.rear)<1e-6&&Math.abs(centre.y-W17_WHEELS.rear.radius)<1e-6);
    assert.equal(visibleInPowertrain(stub),true,"engine mode loses the wheel-end drive");
    assert.ok(bounds(`Rear ${side} wheel spindle extension`).intersectsBox(hub),"rotating spindle is disconnected from wheel flange");
  }
});

test("rear uprights and transmission casing have open bearing bores around the drive axis",()=>{
  for(const side of[-1,1]){
    for(const [name,y,from,to]of[[`Rear ${side} upright`,W17_WHEELS.rear.radius,.49,.60],["Carbon gearbox casing",.326,.08,.20]]){
      const ray=new T.Raycaster(new T.Vector3(W17_AXLES.rear,y,side*from),new T.Vector3(0,0,side),0,to-from);
      assert.equal(ray.intersectObject(part(name)).length,0,`${name} seals the shaft passage`);
    }
  }
});

test("the final drive has a toothed crown, a connected pinion and separate carrier space",()=>{
  const crown=part("Final drive crown wheel"),pinion=part("Final drive hypoid pinion");
  assert.ok(pinion,"the offset final drive has no hypoid pinion");
  assert.ok(crown.userData.teeth>20,"the crown wheel is only a smooth washer");
  assert.ok(bounds(pinion.name).intersectsBox(bounds("Gearbox main shaft")),"main shaft stops before the pinion");
  assert.ok(bounds(pinion.name).intersectsBox(bounds(crown.name)),"pinion cannot reach crown teeth");
  assert.ok(bounds(crown.name).intersectsBox(bounds("Differential drum")),"crown is detached from its carrier");
});

test("the pinion engages the crown tooth depth along a continuous contact track",()=>{
  const crown=part("Final drive crown wheel"),pinion=part("Final drive hypoid pinion");
  // Overlapping boxes alone accepted the old pair: only the tips grazed,
  // leaving the rest of the pinion visibly disconnected from the crown.
  assert.ok(bounds(crown.name).max.z-bounds(pinion.name).min.z>.006,"pinion only grazes the crown tooth tips");
  const material=new T.MeshBasicMaterial({side:T.DoubleSide});
  const probes=[crown,pinion].map(m=>{const p=new T.Mesh(m.geometry,material);p.matrixWorld.copy(m.matrixWorld);return p;});
  const ray=new T.Raycaster(),direction=new T.Vector3(0,0,1);
  let engagedRows=0;
  for(let row=0;row<=12;row++){
    const x=-1.647+row*.001;let closest=Infinity;
    for(let sample=0;sample<=144;sample++){
      ray.set(new T.Vector3(x,.228+sample*.00025,-.1),direction);
      const face=ray.intersectObject(probes[0]).at(-1),tooth=ray.intersectObject(probes[1])[0];
      if(!face||!tooth)continue;
      const gap=tooth.point.z-face.point.z;
      assert.ok(gap>=-.000002,`tooth surfaces intersect at ${x}, ${ray.ray.origin.y}`);
      closest=Math.min(closest,gap);
    }
    if(closest<.0012)engagedRows++;
  }
  material.dispose();
  assert.ok(engagedRows>=11,`only ${engagedRows} of 13 sections reach a mating flank`);
});

test("the installed final-drive tooth faces approach without penetrating each other or their carrier",()=>{
  const crown=part("Final drive crown wheel"),pinion=part("Final drive hypoid pinion"),carrier=part("Differential drum");
  const direction=new T.Vector3(.314,.596,.739).normalize(),point=new T.Vector3(),ray=new T.Raycaster();
  let closest=Infinity;
  for(const [mesh,other]of[[crown,pinion],[pinion,crown],[pinion,carrier]]){
    // A two-sided ray counts both entry and exit surfaces. Odd parity means
    // the vertex is embedded in another solid, even when their boxes overlap.
    const probe=new T.Mesh(other.geometry,new T.MeshBasicMaterial({side:T.DoubleSide}));
    probe.matrixWorld.copy(other.matrixWorld);
    const box=new T.Box3().setFromObject(other).expandByScalar(.003),p=mesh.geometry.attributes.position;
    for(let i=0;i<p.count;i++){
      point.fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld);if(!box.containsPoint(point))continue;
      ray.set(point,direction);const hits=ray.intersectObject(probe);
      const crossings=hits.filter((h,j)=>j===0||h.distance-hits[j-1].distance>1e-6);
      assert.equal(crossings.length%2,0,`${mesh.name} penetrates ${other.name}`);
      if(other!==carrier&&hits.length)closest=Math.min(closest,hits[0].distance);
    }
    probe.material.dispose();
  }
  assert.ok(closest<.001,"final-drive teeth still have a visible gap");
});

test("stationary differential cartridges seat the bearings and retain them on both sides",()=>{
  const probe=(name,point,direction,length)=>{
    const original=part(name),mesh=new T.Mesh(original.geometry,new T.MeshBasicMaterial({side:T.DoubleSide}));mesh.matrixWorld.copy(original.matrixWorld);
    const hits=new T.Raycaster(new T.Vector3(...point),new T.Vector3(...direction),0,length).intersectObject(mesh,false);mesh.material.dispose();return hits;
  };
  for(const side of[-1,1]){
    const cup=`Differential bearing cartridge ${side}`;
    for(const name of["cartridge flange","cartridge gasket","case bearing insert"]){
      const g=part(`Differential ${name} ${side}`).geometry,p=g.attributes.position,ix=g.index;let volume=0;
      for(let i=0;i<ix.count;i+=3){
        const [a,b,c]=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(p,ix.getX(i+j)));
        volume+=a.dot(b.cross(c))/6;
      }
      assert.ok(volume>0,`${name} has inward-facing walls`);
    }
    const radial=probe(cup,[-1.7+.0444,.326,side*.0965],[1,0,0],.008);
    assert.ok(radial.length&&Math.abs(radial[0].distance-.0001)<.00005,"outer race has no cylindrical seat");
    assert.ok(probe(cup,[-1.7+.043,.326,side*.0919],[0,0,-side],.004).length,"bearing has no inboard axial stop");
    assert.ok(probe(cup,[-1.7+.0459,.326,side*.1015],[1,0,0],.005).length,"retaining ring has no housing groove");
    assert.ok(bounds(cup).intersectsBox(bounds(`Differential cartridge flange ${side}`)));
    assert.ok(bounds(`Differential cartridge gasket ${side}`).intersectsBox(bounds("Carbon gearbox casing")));
    const pressure=probe(cup,[-1.766,.326,side*.130],[1,0,0],.024);
    assert.equal(pressure.length,0,"pressure union ends on a solid cylinder wall");
    const piston=probe(`Differential clutch piston ${side}`,[-1.740,.326,side*.130],[0,0,-side],.008);
    assert.ok(piston.length,"pressure passage misses its annular piston");
  }
  const skin=probe("Carbon gearbox casing",[-1.60,.30,.20],[0,0,-1],.2);
  const hits=skin.filter((h,i)=>!i||h.distance-skin[i-1].distance>1e-5);
  assert.equal(hits.length,2,"gearbox wall is not a hollow laminate");
  assert.ok(hits[1].distance-hits[0].distance>.0025&&hits[1].distance-hits[0].distance<.0045);
});
