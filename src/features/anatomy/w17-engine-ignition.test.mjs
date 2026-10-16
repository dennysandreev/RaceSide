import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import {createW17} from "./w17-geometry.ts";
import {engineCylinderX,enginePistonPose} from "./w17-engine-core.ts";

const model=createW17();model.root.updateMatrixWorld(true);
const get=name=>model.root.getObjectByName(name),system=get("Engine ignition system"),lines=[],parts=[];
system.traverse(o=>{if(o.isMesh)parts.push(o);if(o.userData.ignitionRoute)lines.push(o);});
const curve=line=>new T.CatmullRomCurve3(line.userData.ignitionRoute.map(p=>new T.Vector3(...p)),false,"centripetal");
const bounds=name=>new T.Box3().setFromObject(get(name));

test("each cylinder has one coaxial seated plug, a ceramic insulator and a connected pencil coil",()=>{
  assert.equal(parts.filter(p=>/^Spark plug [-1]/.test(p.name)).length,6);
  assert.equal(parts.filter(p=>/^Ignition connector [-1]/.test(p.name)).length,6);
  for(const side of[-1,1])for(let i=0;i<3;i++){
    const id=`${side} ${i}`,unit=get(`Ignition unit ${id}`);
    assert.ok(Math.abs(unit.getWorldPosition(new T.Vector3()).x-engineCylinderX(side,i))<1e-9);
    assert.equal(get(`Spark plug insulator ${id}`).material.name,"Alumina insulator");
    for(const [a,b]of[["Spark plug terminal","Ignition terminal contact"],["Ignition terminal contact","Ignition HV contact"],["Ignition HV contact","Ignition HV winding termination"],["Ignition HV winding termination","Ignition secondary winding pack"],["Ignition socket","Ignition plug"]])assert.ok(bounds(`${a} ${id}`).intersectsBox(bounds(`${b} ${id}`)),`${a} / ${b}: disconnected`);
    for(const px of[-.003,0,.003]){
      const lead=bounds(`Ignition winding terminal lead ${id} ${px}`);
      assert.ok(lead.intersectsBox(bounds(`Ignition contact pin ${id} ${px}`)),"coil terminal pin is disconnected");
      assert.ok(lead.intersectsBox(bounds(`Ignition ${px===0?"secondary":"primary"} winding pack ${id}`)),"coil terminal misses its winding");
    }
    const seat=get(`Spark plug seat ${id}`);seat.geometry.computeBoundingBox();
    assert.ok(Math.abs(seat.geometry.boundingBox.min.y-.2105)<1e-7,"plug washer floats above the gallery roof");
    const well=get(`Spark plug dry well ${id}`);well.geometry.computeBoundingBox();
    assert.ok(Math.abs(well.geometry.boundingBox.min.y-.2105)<1e-7&&Math.abs(well.geometry.boundingBox.max.y-.299)<1e-7,"plug well does not seal between head and cover");
  }
});

test("the exposed spark gap stays open and the ground straps clear the pistons for the full cycle",()=>{
  for(const side of[-1,1])for(let i=0;i<3;i++){
    const id=`${side} ${i}`,electrode=get(`Spark plug centre electrode ${id}`),tip=get(`Spark plug ground tip ${id}`);
    electrode.geometry.computeBoundingBox();tip.geometry.computeBoundingBox();tip.updateMatrix();
    const tipBox=tip.geometry.boundingBox.clone().applyMatrix4(tip.matrix),gap=electrode.geometry.boundingBox.min.y-tipBox.max.y;
    assert.ok(Math.abs(gap-.0006)<1e-7,"spark gap closed or oversized");
    for(let angle=0;angle<=Math.PI*4;angle+=Math.PI/36){const piston=enginePistonPose(side,i,angle);assert.ok(tipBox.min.y-piston.crown.dot(piston.axis)>.004,"electrode reaches piston crown");}
    const unit=get(`Ignition unit ${id}`),origin=unit.localToWorld(new T.Vector3(0,.174,0)),axis=new T.Vector3(0,1,0).transformDirection(unit.matrixWorld);
    const hit=new T.Raycaster(origin,axis,0,.00049).intersectObjects([tip,electrode],false);assert.equal(hit.length,0,"solid crosses the firing gap");
  }
});

test("all six coil plugs join the ECU connector through physically continuous branches",()=>{
  assert.equal(lines.length,11);
  for(const line of lines){
    const points=curve(line).getSpacedPoints(600);
    for(let i=1;i<points.length-1;i++){
      const a=points[i-1],b=points[i],c=points[i+1],ab=b.clone().sub(a),bc=c.clone().sub(b),cross=ab.clone().cross(bc).length();
      if(cross>1e-14)assert.ok(ab.length()*bc.length()*c.distanceTo(a)/(2*cross)>line.userData.outerRadius*2,`${line.name}: folded cable bend`);
    }
  }
  for(const side of[-1,1]){
    const rail=get(`Ignition rail ${side}`),feed=get(`Ignition bank feed ${side}`),a=curve(feed).getPoint(1).applyMatrix4(feed.matrixWorld),b=curve(rail).getPoint(0).applyMatrix4(rail.matrixWorld);
    assert.ok(a.distanceTo(b)<1e-8,"bank feed misses its rail");
    assert.ok(curve(feed).getPoint(0).applyMatrix4(feed.matrixWorld).distanceTo(get("Ignition loom split").getWorldPosition(new T.Vector3()))<1e-8);
    for(let i=0;i<3;i++){
      const line=get(`Ignition coil lead ${side} ${i}`),c=curve(line),start=c.getPoint(0).applyMatrix4(line.matrixWorld),end=c.getPoint(1).applyMatrix4(line.matrixWorld);
      assert.ok(bounds(`Ignition plug ${side} ${i}`).distanceToPoint(start)<1e-7,"loose coil plug");
      const inRail=rail.worldToLocal(end.clone()),path=curve(rail),segment=new T.Line3(path.getPoint(0),path.getPoint(1));
      assert.ok(segment.closestPointToPoint(inRail,true,new T.Vector3()).distanceTo(inRail)<1e-8,"coil lead misses the bank loom");
    }
    for(let i=0;i<2;i++)assert.ok(bounds(`Ignition rail saddle ${side} ${i}`).intersectsBox(bounds(`Cam cover ${side}`)),"unsupported loom saddle");
  }
  const feed=get("Ignition supply loom"),start=curve(feed).getPoint(0).applyMatrix4(feed.matrixWorld);
  assert.ok(bounds("Engine harness mounting flange").distanceToPoint(start)<1e-7,"supply misses engine connector");
  assert.ok(bounds("Engine harness socket").intersectsBox(bounds("Engine harness mounting flange")));
});

test("the full cable volume clears the installed castings, oil tank, intake and neighboring hardware",()=>{
  const obstacles=[];model.root.traverse(o=>{if(o.isMesh&&!o.isInstancedMesh&&!o.userData.engineIgnition)obstacles.push({o,bounds:new T.Box3().setFromObject(o)});});
  const errors=[];
  for(const line of lines){
    const samples=curve(line).getSpacedPoints(400).map(p=>p.applyMatrix4(line.matrixWorld)),radius=line.userData.outerRadius,occupied=new T.Box3().setFromPoints(samples).expandByScalar(radius+.00005);
    for(const {o,bounds:box}of obstacles){
      if(!box.intersectsBox(occupied))continue;
      const p=o.geometry.attributes.position,ix=o.geometry.index,triangles=[];
      for(let j=0;j<(ix?.count??p.count);j+=3){
        const v=[0,1,2].map(k=>new T.Vector3().fromBufferAttribute(p,ix?ix.getX(j+k):j+k).applyMatrix4(o.matrixWorld)),b=new T.Box3().setFromPoints(v);
        if(b.intersectsBox(occupied))triangles.push({triangle:new T.Triangle(...v),b});
      }
      const closest=new T.Vector3();
      if(samples.some(point=>box.distanceToPoint(point)<radius+.00005&&triangles.some(t=>t.b.distanceToPoint(point)<radius+.00005&&t.triangle.closestPointToPoint(point,closest).distanceTo(point)<radius+.00005)))errors.push(`${line.name} / ${o.name}`);
    }
  }
  assert.deepEqual(errors,[]);
});
