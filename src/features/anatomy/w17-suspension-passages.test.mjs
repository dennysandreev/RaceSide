import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { createW17 } from "./w17-geometry.ts";

const model=createW17();model.root.updateMatrixWorld(true);
const skins=["Silver nose skin","Continuous undercut sidepod shell","Bodywork inner laminate","Tail heat shield",...[-1,1].map(s=>`Cockpit shoulder fairing ${s}`)].map(n=>model.root.getObjectByName(n));

test("suspension load paths pass through body panels without intersecting them",()=>{
  for(const axle of ["Front","Rear"])for(const side of [-1,1])for(const label of ["upper wishbone 0","upper wishbone 1","lower wishbone 0","lower wishbone 1","pushrod","track rod"]){
    const arm=model.root.getObjectByName(`${axle} ${side} ${label}`),a=new T.Vector3(...arm.userData.anchor),b=new T.Vector3(...arm.userData.terminal);
    const ray=new T.Raycaster(b,a.clone().sub(b).normalize(),0,a.distanceTo(b));
    const hits=ray.intersectObjects(skins,false);
    assert.equal(hits.length,0,`${arm.name}: bodywork blocks the load path ${hits.map(h=>`${h.object.name} ${h.point.toArray()}`)}`);
  }
});

test("rear wishbones and toe links terminate at supported gearbox joints",()=>{
  for(const side of [-1,1])for(const label of ["upper wishbone 0","upper wishbone 1","lower wishbone 0","lower wishbone 1","track rod"]){
    const arm=model.root.getObjectByName(`Rear ${side} ${label}`),bearing=model.root.getObjectByName(`${arm.name} spherical bearing`);
    assert.ok(bearing,`${arm.name}: no structural joint`);
    assert.ok(new T.Box3().setFromObject(bearing).getCenter(new T.Vector3()).distanceTo(new T.Vector3(...arm.userData.anchor))<1e-6);
    const foot=model.root.getObjectByName(`${arm.name} gearbox bracket foot`);
    assert.ok(foot&&!foot.userData.cover,"mount must remain when bodywork is removed");
    const bounds=new T.Box3().setFromObject(foot),p=bounds.getCenter(new T.Vector3()),direction=new T.Vector3(...foot.userData.seatDirection);
    const hit=new T.Raycaster(p.clone().addScaledVector(direction,-.03),direction,0,.06).intersectObject(model.root.getObjectByName("Carbon gearbox casing"),false)[0];
    assert.ok(hit&&bounds.containsPoint(hit.point),`${arm.name}: bracket floats above gearbox`);
  }
});

test("the fairing sections, not just their centre lines, clear the body apertures",()=>{
  for(const axle of ["Front","Rear"])for(const side of [-1,1])for(const label of ["upper wishbone 0","upper wishbone 1","lower wishbone 1","pushrod","track rod"]){
    const arm=model.root.getObjectByName(`${axle} ${side} ${label}`),p=arm.geometry.attributes.position;
    // Check every longitudinal surface line over the inboard half, not only
    // a selection of leading/trailing edges or the centre of the fairing.
    for(let ring=0;ring<12;ring++)for(let j=0;j<40;j++){
      const a=new T.Vector3().fromBufferAttribute(p,ring*40+j).applyMatrix4(arm.matrixWorld),b=new T.Vector3().fromBufferAttribute(p,(ring+1)*40+j).applyMatrix4(arm.matrixWorld);
      const length=a.distanceTo(b),direction=b.clone().sub(a).normalize();
      assert.equal(new T.Raycaster(a,direction,1e-6,length-1e-6).intersectObjects(skins,false).length,0,`${arm.name}: skin crosses fairing section ${ring}/${j}`);
    }
  }
});
