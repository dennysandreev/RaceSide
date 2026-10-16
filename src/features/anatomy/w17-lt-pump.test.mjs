import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import {createW17} from "./w17-geometry.ts";
import {createModelInstance,visibleInCooling} from "./w17-model-cache.ts";

const model=createW17();model.root.updateMatrixWorld(true);
const get=name=>model.root.getObjectByName(name);

test("the shared charge-air cooling circuit has a supported mechanical pump drive",()=>{
  assert.equal(Boolean(get("Charge coolant electric pump")),false,"charge-air coolant cannot use an electric-only pump");
  const pump=get("Low-temperature coolant pump");assert.ok(pump);
  for(const name of["shaft","drive coupling","mounting flange","bearing inner race 0.002","bearing outer race 0.002","stationary seal seat","rotating seal face"]){
    assert.ok(get(`LT coolant pump ${name}`),name);
  }
  const flange=get("LT coolant pump mounting flange"),cover=get("Engine timing end cover -0.296");
  for(const d of[-.013,.013]){
    const foot=get(`LT coolant pump mounting foot ${d}`),bounds=new T.Box3().setFromObject(foot);
    assert.ok(bounds.intersectsBox(new T.Box3().setFromObject(cover)),"pump foot floats ahead of its mounting");
    assert.ok(bounds.expandByScalar(1e-6).intersectsBox(new T.Box3().setFromObject(flange)),"foot is detached from flange");
  }
});

test("the LT pump has eight solid blades inside an open wet chamber and contacting seal faces",()=>{
  const pump=get("Low-temperature coolant pump"),blades=[];pump.traverse(p=>{if(p.isMesh&&p.name.includes("impeller blade"))blades.push(p);});
  assert.equal(blades.length,8);
  for(const blade of blades){
    const p=blade.geometry.attributes.position;let volume=0;
    for(let i=0;i<p.count;i+=3){const [a,b,c]=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(p,i+j));volume+=a.dot(b.cross(c))/6;}
    assert.ok(Math.abs(volume)>1e-8,"zero-thickness impeller blade");
    for(let i=0;i<p.count;i++)assert.ok(Math.hypot(p.getX(i),p.getZ(i))<.022&&p.getY(i)>.0339&&p.getY(i)<.0431,"blade crosses the chamber");
  }
  assert.equal(pump.children.filter(p=>p.name.includes("bearing ball")).length,20);
  const fixed=get("LT coolant pump stationary seal seat"),rotating=get("LT coolant pump rotating seal face");
  fixed.geometry.computeBoundingBox();rotating.geometry.computeBoundingBox();
  assert.ok(Math.abs(fixed.geometry.boundingBox.max.y-rotating.geometry.boundingBox.min.y)<1e-8);
  const casing=get("LT coolant pump housing"),ray=new T.Raycaster();
  for(const [origin,direction]of[[[-.212,.383,.246],[0,-1,0]],[[-.200,.383,.238],[0,1,0]],[[-.18,.383,.238],[-1,0,0]]]){
    ray.set(new T.Vector3(...origin),new T.Vector3(...direction));ray.far=.040;
    assert.equal(ray.intersectObject(casing,false).length,0,"closed pump port");
  }
});

test("LT pump bolts and shaft pass through bored mounting faces",()=>{
  const head=get("Cylinder head housing 1"),cover=get("Engine timing end cover -0.296"),flange=get("LT coolant pump mounting flange"),ray=new T.Raycaster();
  for(const [y,z]of[[.383,.238],[.396,.225],[.370,.251]]){
    ray.set(new T.Vector3(-.25,y,z),new T.Vector3(-1,0,0));ray.far=.065;
    assert.equal(ray.intersectObjects([head,cover,flange],false).length,0,"opaque casting blocks a drive or mounting bore");
  }
  for(const d of[-.013,.013]){
    const y=.383-d,z=.238+d+.003;
    ray.set(new T.Vector3(-.15,y,z),new T.Vector3(-1,0,0));ray.far=.20;
    const contact=ray.intersectObjects([head,cover],false)[0];assert.ok(contact,"mounting bolt misses its structural support");
    ray.set(new T.Vector3(-.34,y,z),new T.Vector3(1,0,0));ray.far=.10;
    const rear=ray.intersectObject(get(`LT coolant pump mounting foot ${d}`),false)[0];assert.ok(rear);
    assert.ok(Math.abs(rear.point.x-contact.point.x)<.0015,"mounting foot is detached from engine");
  }
});

const changedLines=["Charge cooled water line","ES coolant supply","Charge expansion hose"];
test("the relocated LT lines retain continuous bores and unpinched bends",()=>{
  const pack=get("Cooling and lubrication pack");
  for(const name of changedLines){
    const pipe=get(name),curve=new T.CatmullRomCurve3(pipe.userData.route.map(p=>new T.Vector3(...p)),false,"centripetal");
    for(const t of[0,1])assert.ok(Object.values(pack.userData.ports).some(p=>curve.getPoint(t).distanceTo(new T.Vector3(...p))<1e-8));
    assert.equal(pipe.geometry.parameters.shapes.holes.length,1);
    const points=curve.getSpacedPoints(800);
    for(let i=1;i<points.length-1;i++){
      const ab=points[i].clone().sub(points[i-1]),bc=points[i+1].clone().sub(points[i]),ac=points[i+1].distanceTo(points[i-1]),cross=ab.clone().cross(bc).length();
      if(cross>1e-13)assert.ok(ab.length()*bc.length()*ac/(2*cross)>pipe.userData.outerRadius*1.1,`${name}: pinched bend at ${points[i].toArray()}`);
    }
  }
  for(const [name,socket,t]of[["Charge cooled water line","Charge pump inlet",1],["ES coolant supply","Charge pump outlet",0],["Charge expansion hose","Charge pump bleed",1]]){
    const curve=new T.CatmullRomCurve3(get(name).userData.route.map(p=>new T.Vector3(...p)),false,"centripetal");
    const axis=new T.Vector3(0,1,0).transformDirection(get(`${socket} socket`).matrixWorld);
    assert.ok(curve.getTangent(t).multiplyScalar(t?-1:1).dot(axis)>.999,`${name}: sideways socket entry`);
  }
});

test("new LT routes and casing clear the installed neighboring surfaces",()=>{
  const closest=new T.Vector3(),errors=new Set(),sources=changedLines.map(name=>{
    const o=get(name);return{name,points:new T.CatmullRomCurve3(o.userData.route.map(p=>new T.Vector3(...p)),false,"centripetal").getSpacedPoints(600),radius:o.userData.outerRadius+.0003};
  });
  const casing=get("LT coolant pump housing"),p=casing.geometry.attributes.position;
  sources.push({name:casing.name,points:Array.from({length:p.count},(_,i)=>new T.Vector3().fromBufferAttribute(p,i).applyMatrix4(casing.matrixWorld)),radius:.0003});
  for(const source of sources){
    const occupied=new T.Box3().setFromPoints(source.points).expandByScalar(source.radius);
    model.root.traverse(o=>{
      if(!o.isMesh||o.isInstancedMesh||o.userData.coolantPump==="lt"||o.name.startsWith(source.name))return;
      // These are the line's actual sealing fittings, not nearby obstacles.
      if(source.name==="ES coolant supply"&&["ES service boot supply","ES coolant in union"].includes(o.name))return;
      if(source.name==="Charge expansion hose"&&o.name.startsWith("Charge expansion return"))return;
      if(source.name==="Charge cooled water line"&&o.name.startsWith("Charge radiator cold"))return;
      const bounds=new T.Box3().setFromObject(o);if(!bounds.intersectsBox(occupied))return;
      const candidates=source.points.filter(p=>bounds.distanceToPoint(p)<source.radius),p=o.geometry.attributes.position,ix=o.geometry.index;
      for(let i=0;i<(ix?.count??p.count);i+=3){
        const v=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(p,ix?ix.getX(i+j):i+j).applyMatrix4(o.matrixWorld)),b=new T.Box3().setFromPoints(v),triangle=new T.Triangle(...v);
        if(candidates.some(p=>b.distanceToPoint(p)<source.radius&&triangle.closestPointToPoint(p,closest).distanceTo(p)<source.radius)){errors.add(`${source.name} / ${o.name}`);return;}
      }
    });
  }
  assert.deepEqual([...errors],[]);
});

test("LT pump inspection keeps the shared installed internals and excludes other assemblies",()=>{
  const instance=createModelInstance("cooling");let visible=0;
  instance.root.traverse(p=>{if(!p.isMesh)return;if(visibleInCooling(p,"lt-pump")){visible++;assert.equal(p.userData.coolantPump,"lt");assert.equal(visibleInCooling(p,"right-pump"),false);}});
  assert.ok(visible>50);
  assert.equal(instance.root.getObjectByName("LT coolant pump impeller blade 0").geometry.attributes.position.count,get("LT coolant pump impeller blade 0").geometry.attributes.position.count);
});
