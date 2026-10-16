import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { createW17, W17_WHEELS } from "./w17-geometry.ts";
import { W17_BRAKES } from "./w17-brakes.ts";

const model=createW17();model.root.updateMatrixWorld(true);
const brakes=model.assemblies.get("brakes");

test("front and rear carbon discs use the 2026 diameter ranges and real radial bores",()=>{
  for(const front of [true,false])for(const side of [-1,1]){
    const spec=front?W17_BRAKES.front:W17_BRAKES.rear,prefix=`${front?"Front":"Rear"} ${side}`;
    const disc=model.root.getObjectByName(`${prefix} carbon friction disc`),bounds=disc.geometry.boundingBox;
    const diameter=bounds.max.x-bounds.min.x,thickness=bounds.max.z-bounds.min.z;
    assert.ok(front?diameter>=.325&&diameter<=.345:diameter>=.260&&diameter<=.280001);
    assert.ok(thickness<=.034);
    assert.equal(disc.material.name,"Carbon-carbon friction material");
    for(const index of [0,7,31,80])for(let row=0;row<spec.rows;row++){
      const angle=index*2*Math.PI/spec.channels,z=(row-(spec.rows-1)/2)*.0044;
      const origin=new T.Vector3(Math.cos(angle)*.21,Math.sin(angle)*.21,z).applyMatrix4(disc.matrixWorld);
      const direction=new T.Vector3(-Math.cos(angle),-Math.sin(angle),0).transformDirection(disc.matrixWorld);
      const ray=new T.Raycaster(origin,direction,0,.21-spec.innerRadius+.0001);
      assert.equal(ray.intersectObject(disc).length,0,`${prefix}: blocked radial bore ${index}/${row}`);
      // A nearby ray through the ligament must hit real carbon, not an empty ring.
      const offset=angle+Math.PI/spec.channels;
      ray.set(new T.Vector3(Math.cos(offset)*.21,Math.sin(offset)*.21,z).applyMatrix4(disc.matrixWorld),new T.Vector3(-Math.cos(offset),-Math.sin(offset),0).transformDirection(disc.matrixWorld));
      assert.ok(ray.intersectObject(disc).length>0,`${prefix}: missing material between bores`);
    }
    const frictionOrigin=new T.Vector3((spec.radius+spec.innerRadius)/2,0,.08).applyMatrix4(disc.matrixWorld);
    const ray=new T.Raycaster(frictionOrigin,new T.Vector3(0,0,-1).transformDirection(disc.matrixWorld),0,.16);
    assert.ok(ray.intersectObject(disc).length>0,"friction face is open");
    ray.set(new T.Vector3(0,0,.08).applyMatrix4(disc.matrixWorld),new T.Vector3(0,0,-1).transformDirection(disc.matrixWorld));
    assert.equal(ray.intersectObject(disc).length,0,"rotor centre is a solid disc");
  }
});

test("pads, piston banks and bridges clear the rotating friction disc",()=>{
  for(const front of [true,false])for(const side of [-1,1]){
    const prefix=`${front?"Front":"Rear"} ${side}`,spec=front?W17_BRAKES.front:W17_BRAKES.rear;
    const assembly=model.root.getObjectByName(`${prefix} brake assembly`);
    let pads=0,pistons=0,bridges=0;
    assembly.traverse(part=>{
      if(!part.isMesh)return;
      if(/carbon pad/.test(part.name))pads++;
      if(/caliper piston/.test(part.name))pistons++;
      if(/caliper bridge/.test(part.name))bridges++;
      if(!/carbon pad|monobloc caliper bank|caliper piston|caliper bridge/.test(part.name))return;
      const vertices=part.geometry.attributes.position;
      for(let i=0;i<vertices.count;i++){
        const p=assembly.worldToLocal(new T.Vector3().fromBufferAttribute(vertices,i).applyMatrix4(part.matrixWorld));
        assert.ok(Math.abs(p.z)>spec.thickness/2+.0001||Math.hypot(p.x,p.y)>spec.radius+.0001,`${part.name} intersects the rotor at ${p.toArray()}`);
      }
    });
    assert.equal(pads,2);assert.equal(pistons,6);assert.equal(bridges,4);
  }
});

test("stationary brake shrouds close spoke gaps while fitting inside the wheel barrel",()=>{
  for(const front of [true,false])for(const side of [-1,1]){
    const prefix=`${front?"Front":"Rear"} ${side}`,wheel=front?W17_WHEELS.front:W17_WHEELS.rear;
    const assembly=model.root.getObjectByName(`${prefix} brake assembly`),rotor=model.root.getObjectByName(`${prefix} rotating brake`);
    const shield=model.root.getObjectByName(`${prefix} brake drum outer face`);
    assert.equal(shield.parent,assembly);assert.equal(shield.userData.serviceCover,true);
    const original=shield.matrixWorld.clone();rotor.rotation.z=.6;model.root.updateMatrixWorld(true);
    assert.deepEqual(shield.matrixWorld.elements,original.elements,"shroud rotates with wheel");
    rotor.rotation.z=0;model.root.updateMatrixWorld(true);
    const limit=wheel.track/2+wheel.width/2;
    for(const part of assembly.children.filter(part=>part.isMesh&&!/upright|mounting|hollow brake cooling/.test(part.name))){
      const p=part.geometry.attributes.position;
      for(let i=0;i<p.count;i++){
        const v=new T.Vector3().fromBufferAttribute(p,i).applyMatrix4(part.matrixWorld);
        assert.ok(Math.abs(v.z)<limit-.01,`${part.name} leaves wheel outboard face`);
        assert.ok(Math.hypot(v.x-assembly.position.x,v.y-assembly.position.y)<.209,`${part.name} intersects barrel`);
      }
    }
    for(const [dx,dy] of [[.08,.07],[.11,-.07],[-.09,-.08]]){
      const ray=new T.Raycaster(new T.Vector3(assembly.position.x+dx,assembly.position.y+dy,side*2),new T.Vector3(0,0,-side));
      assert.ok(ray.intersectObject(shield).length>0,"spoke gap sees through carbon drum");
    }
  }
});

test("all four hydraulic lines terminate at actual caliper ports",()=>{
  for(const front of [true,false])for(const side of [-1,1]){
    const prefix=`${front?"Front":"Rear"} ${side}`,port=model.root.getObjectByName(`${prefix} hydraulic port`),hose=model.root.getObjectByName(`${prefix} brake hose`);
    const end=(hose.geometry.parameters.path??hose.geometry.parameters.options.extrudePath).getPoint(1),box=new T.Box3().setFromObject(port).expandByScalar(.0001);
    assert.ok(box.containsPoint(end),`${prefix}: hose disconnected`);
    assert.equal(hose.userData.installedOnly,true);
    assert.equal(port.userData.brakeAxle,front?"front":"rear");
    assert.equal(port.userData.brakeSide,side);
  }
  assert.equal(brakes.children.filter(c=>c.name.endsWith("brake assembly")).length,4);
});

test("cooling inlets stay open through the inboard heat shield",()=>{
  for(const front of [true,false])for(const side of [-1,1]){
    const prefix=`${front?"Front":"Rear"} ${side}`,duct=model.root.getObjectByName(`${prefix} hollow brake cooling inlet`),shield=model.root.getObjectByName(`${prefix} brake inboard heat shield`);
    const path=duct.geometry.parameters.options.extrudePath;
    for(let i=0;i<40;i++){
      const from=path.getPoint(i/40).applyMatrix4(duct.matrixWorld),to=path.getPoint((i+1)/40).applyMatrix4(duct.matrixWorld);
      const direction=to.clone().sub(from),ray=new T.Raycaster(from,direction.clone().normalize(),0,direction.length());
      assert.equal(ray.intersectObjects([duct,shield],false).length,0,`${prefix}: blocked cooling duct at ${i}/40`);
    }
  }
});
