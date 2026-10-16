import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import {createW17} from "./w17-geometry.ts";
import {createSurfaceSampler} from "./w17-surface.ts";

const model=createW17();model.root.updateMatrixWorld(true);
const part=name=>model.root.getObjectByName(name);
const deck=part("Forward survival cell deck"),deckHeight=createSurfaceSampler([deck],"y");
const pylon=part("Halo front pylon");

test("the Halo fairing enters the structural deck across its foot and buries its front cap",()=>{
  const points=pylon.geometry.attributes.position;
  let contacts=0;
  for(let i=0;i<points.count;i++){
    const p=new T.Vector3().fromBufferAttribute(points,i),height=deckHeight(p.x,p.z,1);
    if(p.x>.82&&p.x<.86&&p.y<.640){assert.ok(height>p.y+.004,"a lower foot edge floats above the deck");contacts++;}
    if(p.x>.876)assert.ok(height>p.y+.010,"the front cap projects into the open damper bay");
  }
  assert.ok(contacts>40,"not enough of the foot is seated");
  const shoe=part("Halo front attachment shoe"),p=shoe.geometry.attributes.position;
  for(let i=0;i<p.count;i+=7){
    const v=new T.Vector3().fromBufferAttribute(p,i).applyMatrix4(shoe.matrixWorld);
    assert.ok(deckHeight(v.x,v.z,1)>v.y+.002,"the metal shoe protrudes as a separate step");
  }
  const footLower=createSurfaceSampler([pylon],"y");
  assert.ok(footLower(.85,0,-1)<new T.Box3().setFromObject(shoe).max.y,"fairing detaches from its shoe");
});

const loom=part("Main loom"),curve=loom.geometry.parameters.path;
const radius=loom.userData.outerRadius;
const cylinderEnds=object=>[-1,1].map(sign=>new T.Vector3(0,sign*object.geometry.parameters.height/2,0).applyMatrix4(object.matrixWorld));

test("the wiring harness ends are seated in ECU and engine connector backshells",()=>{
  for(const [point,name]of[[curve.getPoint(0),"ECU harness backshell"],[curve.getPoint(1),"Engine harness strain relief"]]){
    assert.ok(cylinderEnds(part(name)).some(end=>end.distanceTo(point)<1e-7),`${name}: detached cable end`);
  }
  for(const [a,b]of[["ECU socket barrel 0","ECU harness locking ring"],["ECU harness locking ring","ECU harness backshell"],["Engine harness mounting flange","Engine timing end cover -0.296"],["Engine harness mounting flange","Engine harness socket"],["Engine harness socket","Engine harness plug"],["Engine harness plug","Engine harness strain relief"]]){
    assert.ok(new T.Box3().setFromObject(part(a)).expandByScalar(1e-6).intersectsBox(new T.Box3().setFromObject(part(b))),`${a} / ${b}: disconnected hardware`);
  }
  assert.ok(curve.getPoint(1).x>-.30,"the loom still has a loose tail under the exhaust");
});

test("loom clips follow the cable and have brackets seated on the structural side wall",()=>{
  const seat=createSurfaceSampler([part("Lower side enclosure -1")],"z");
  for(let i=0;i<3;i++){
    const clip=part(`Loom retaining clip ${i}`),c=curve.getPoint(clip.userData.routeT);
    const bounds=new T.Box3().setFromObject(clip),centre=bounds.getCenter(new T.Vector3());
    assert.ok(centre.distanceTo(c)<1e-6,"clip misses the cable");
    const bracket=new T.Box3().setFromObject(part(`Loom clip bracket ${i}`));
    assert.ok(bracket.containsPoint(new T.Vector3(c.x,c.y,seat(c.x,c.y,-1))),"bracket misses the chassis");
    assert.ok(bracket.intersectsBox(bounds),"clip floats beyond its bracket");
  }
});

test("the harness clears coolant pipes, radiator hardware and exhaust with its full radius",()=>{
  const points=curve.getSpacedPoints(600),pathBounds=new T.Box3().setFromPoints(points).expandByScalar(radius+.001);
  const closest=new T.Vector3(),errors=new Set();
  model.root.traverse(object=>{
    if(!object.isMesh||object.isInstancedMesh||!["cooling","exhaust"].includes(object.userData.component))return;
    const bounds=new T.Box3().setFromObject(object);
    if(!bounds.intersectsBox(pathBounds))return;
    const candidates=points.filter(p=>bounds.distanceToPoint(p)<radius+.001);
    const p=object.geometry.attributes.position,index=object.geometry.index;
    for(let i=0;i<(index?.count??p.count);i+=3){
      const vertices=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(p,index?index.getX(i+j):i+j).applyMatrix4(object.matrixWorld));
      const triangle=new T.Triangle(...vertices),box=new T.Box3().setFromPoints(vertices);
      if(candidates.some(v=>box.distanceToPoint(v)<radius+.001&&triangle.closestPointToPoint(v,closest).distanceTo(v)<radius+.001))errors.add(object.name);
    }
  });
  assert.deepEqual([...errors],[]);
});

test("the loom passes straight through the sealed service bore and remains separate from ES lines",()=>{
  const plate=part("Loom service connector plate"),boot=part("Loom service boot");
  const ray=new T.Raycaster(new T.Vector3(.123,.164,-.30),new T.Vector3(0,0,1),0,.04);
  assert.equal(ray.intersectObjects([plate,boot],false).length,0,"the cable enters an opaque plate");
  const inBore=curve.getSpacedPoints(600).filter(p=>p.z<-.258&&p.z>-.280&&p.x>0);
  assert.ok(inBore.length>4);
  for(const p of inBore)assert.ok(Math.hypot(p.x-.123,p.y-.164)<1e-6,"a bend clips the boot");
  for(const name of["ES coolant supply","ES coolant return","High voltage cable"]){
    const service=part(name),serviceCurve=new T.CatmullRomCurve3(service.userData.route.map(p=>new T.Vector3(...p)),false,"centripetal");
    const points=serviceCurve.getSpacedPoints(300),line=new T.Line3(),closest=new T.Vector3();
    for(const p of curve.getSpacedPoints(400))for(let i=1;i<points.length;i++){
      line.set(points[i-1],points[i]);
      assert.ok(line.closestPointToPoint(p,true,closest).distanceTo(p)>radius+service.userData.outerRadius+.001,`${name} crosses the loom`);
    }
  }
});
