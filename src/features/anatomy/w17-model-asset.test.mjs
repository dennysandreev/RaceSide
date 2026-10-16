import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import * as T from "three";
import { createW17, explodeOffset, updateWingLinkages } from "./w17-geometry.ts";
import { decodeModelAsset } from "./w17-model-asset.ts";
import { decodeAirflowPaths } from "./w17-flow-cache.ts";
import { createAirflowPaths, sampleAirflowPoint } from "./w17-airflow.ts";

function baked(variant) {
  const bytes=gunzipSync(readFileSync(new URL(`../../../public/anatomy/model-${variant}.bin.gz`,import.meta.url)));
  return decodeModelAsset(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
}
const source=createW17(), loaded=baked("mercedes");

test("prepared model preserves every hierarchy, transform, material and triangle within 0.06 mm",()=>{
  let largestError=0;
  const compare=(a,b)=>{
    assert.equal(b.name,a.name); assert.equal(b.children.length,a.children.length,a.name);
    assert.ok(b.position.distanceTo(a.position)<1e-9,`${a.name}: moved`);
    // Matrix decomposition can represent a mirrored brake carrier with a
    // different negative scale axis and quaternion, but the same transform.
    a.updateMatrix();b.updateMatrix();
    a.matrix.elements.forEach((v,i)=>assert.ok(Math.abs(v-b.matrix.elements[i])<1e-9,`${a.name}: transform changed`));
    for(const key of["component","internal","cover","serviceCover","airflowCover","wheel","flap","brakeAxle","installedOnly","steeringSupply","actuator","actuatorPart","stroke","cockpitSection","cockpitDetail","engineMotion","engineCore","engineHead","engineJournal","side","cylinder","kind","pistonRing","fireSystem","fireMount","fireControl","fireCircuit","externalFire","mountSurface"])assert.equal(b.userData[key],a.userData[key],`${a.name}: ${key}`);
    if(a.userData.engineMotion==="valve")for(const key of["seat","axis"])assert.deepEqual(b.userData[key],a.userData[key],`${a.name}: ${key}`);
    if(["timingGear","accessoryGear","accessoryShaft"].includes(a.userData.engineMotion))for(const key of["ratio","phase","teeth","pitchRadius","mate"])assert.equal(b.userData[key],a.userData[key],`${a.name}: ${key}`);
    assert.equal(b.userData.motorTransmission,a.userData.motorTransmission,`${a.name}: transmission membership`);
    for(const key of["coolantPump","pumpDrive","oilPump","hydraulicDrive","hydraulicPump","hydraulicPumpCover","hydraulicBarrel"])assert.equal(b.userData[key],a.userData[key],`${a.name}: pump membership`);
    for(const key of["enginePneumatic","pneumaticRoute","pneumaticFrom","pneumaticTo","pneumaticPorts","pneumaticConnections","pneumaticSeat","electrical"])if(a.userData[key]!==undefined)assert.deepEqual(b.userData[key],a.userData[key],`${a.name}: ${key}`);
    for(const key of["engineIgnition","ignitionRoute","ignitionFrom","ignitionTo","ignitionEntry","ignitionEndpoint"])if(a.userData[key]!==undefined)assert.deepEqual(b.userData[key],a.userData[key],`${a.name}: ${key}`);
    assert.equal(b.userData.rearLight,a.userData.rearLight,`${a.name}: rear-light membership`);
    if(a.isMesh){
      assert.equal(b.material.name,a.material.name);assert.ok(b.material.color.equals(a.material.color));
      const ap=a.geometry.attributes.position,bp=b.geometry.attributes.position,ai=a.geometry.index,bi=b.geometry.index;
      assert.equal(bi?.count??bp.count,ai?.count??ap.count,`${a.name}: triangles lost`);
      const count=ai?.count??ap.count;
      for(let i=0;i<count;i+=Math.max(1,Math.floor(count/100))){
        const x=new T.Vector3().fromBufferAttribute(ap,ai?ai.getX(i):i),y=new T.Vector3().fromBufferAttribute(bp,bi?bi.getX(i):i);
        largestError=Math.max(largestError,x.distanceTo(y));
        assert.ok(x.distanceTo(y)<.00006,`${a.name}: surface moved ${x.distanceTo(y)}`);
      }
    }
    a.children.forEach((child,i)=>compare(child,b.children[i]));
  };
  compare(source.root,loaded.root);
  assert.ok(largestError<.00006);
});

test("prepared wing joints remain connected and rotate identically for all three variants",()=>{
  for(const variant of["mercedes","ferrari","red-bull"]){
    const a=variant==="mercedes"?source:createW17(variant,{rearWingOnly:true});
    const b=variant==="mercedes"?loaded:baked(variant);
    for(const fraction of[0,.35,1]){
      for(const model of[a,b]){
        model.root.traverse(part=>{if(part.userData.flap)part.quaternion.setFromAxisAngle(part.userData.hingeAxis,T.MathUtils.lerp(part.userData.closedAngle,part.userData.openAngle,fraction));});
        updateWingLinkages(model.linkages);model.root.updateMatrixWorld(true);
      }
      assert.equal(b.linkages.length,a.linkages.length);
      a.linkages.forEach((link,i)=>{
        assert.equal(b.linkages[i].fromOffset,link.fromOffset);
        assert.equal(b.linkages[i].toOffset,link.toOffset);
        assert.ok(link.mesh.position.distanceTo(b.linkages[i].mesh.position)<1e-8,`${variant}: detached linkage`);
        assert.ok(link.mesh.scale.distanceTo(b.linkages[i].mesh.scale)<1e-8);
      });
    }
  }
});

test("exploded assemblies all rise vertically and connected pairs stay together",()=>{
  for(const id of source.assemblies.keys()){
    const offset=explodeOffset[id];assert.ok(offset,`${id}: missing offset`);
    assert.equal(offset[0],0);assert.equal(offset[2],0);assert.ok(offset[1]>0,`${id}: moves down`);
  }
  for(const [a,b]of[["battery","inverter"],["bodywork","mirrors"],["floor","diffuser"],["tyres","brakes"]])assert.deepEqual(explodeOffset[a],explodeOffset[b]);
});

test("prepared airflow matches surface-sampled paths without rebuilding geometry in the browser",()=>{
  source.root.traverse(part=>{if(part.userData.flap)part.quaternion.setFromAxisAngle(part.userData.hingeAxis,part.userData.closedAngle);});updateWingLinkages(source.linkages);
  const actual=decodeAirflowPaths(JSON.parse(readFileSync(new URL("../../../public/anatomy/airflow-mercedes.json",import.meta.url),"utf8")));
  const expected=createAirflowPaths(source.root,source.linkages);
  assert.equal(actual.length,expected.length);
  for(let i=0;i<actual.length;i++){
    assert.equal(actual[i].id,expected[i].id);
    for(const fraction of[0,.5,1])for(let t=0;t<=1;t+=.025)assert.ok(sampleAirflowPoint(actual[i],t,fraction).distanceTo(sampleAirflowPoint(expected[i],t,fraction))<.000001);
  }
  assert.throws(()=>decodeAirflowPaths({version:1,paths:[{id:"broken",layer:"body",states:[[0,0,NaN,1,1,1]]}]}));
});
