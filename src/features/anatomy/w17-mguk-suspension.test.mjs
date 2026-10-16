import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import {createW17} from "./w17-geometry.ts";

const model=createW17();model.root.updateMatrixWorld(true);
const motor=model.root.getObjectByName("MGU-K complete machine"),rotor=motor.getObjectByName("MGU-K rotor assembly");

test("motor rotor clears the stator over a full revolution and is carried by two bearings",()=>{
  let rotorRadius=0,statorRadius=Infinity;
  rotor.traverse(p=>{if(!p.isMesh||/spline|shaft/.test(p.name))return;const a=p.geometry.attributes.position;for(let i=0;i<a.count;i++){const v=new T.Vector3().fromBufferAttribute(a,i).applyMatrix4(p.matrixWorld).sub(motor.position);if(Math.abs(v.x)<.077)rotorRadius=Math.max(rotorRadius,Math.hypot(v.y,v.z));}});
  for(const p of motor.children.filter(p=>/^MGU-K stator tooth/.test(p.name))){const a=p.geometry.attributes.position;for(let i=0;i<a.count;i++)statorRadius=Math.min(statorRadius,Math.hypot(a.getY(i),a.getZ(i)));}
  assert.ok(statorRadius-rotorRadius>.0015,"rotor strikes the stator");
  for(const side of [-1,1]){
    const bearing=motor.getObjectByName(`MGU-K bearing inner race ${side}`),box=new T.Box3().setFromObject(bearing),shaft=new T.Box3().setFromObject(motor.getObjectByName("MGU-K hollow shaft"));
    assert.ok(shaft.min.x<box.min.x&&shaft.max.x>box.max.x);
    assert.ok(Math.abs(box.getCenter(new T.Vector3()).y-motor.position.y)<1e-6&&Math.abs(box.getCenter(new T.Vector3()).z-motor.position.z)<1e-6);
  }
  assert.equal(motor.children.filter(p=>/copper winding/.test(p.name)).length,72);
  assert.equal(motor.getObjectByName("MGU-K motor housing upper").userData.serviceCover,true);
  assert.equal(motor.getObjectByName("MGU-K motor housing lower").userData.serviceCover,false);
});

test("the high-voltage cable enters the motor and inverter sockets along their axes",()=>{
  const cable=model.root.getObjectByName("High voltage cable"),curve=new T.CatmullRomCurve3(cable.userData.route.map(p=>new T.Vector3(...p)),false,"centripetal");
  const port=new T.Vector3(...motor.userData.ports.power).add(motor.position);
  assert.ok(curve.getPoint(1).distanceTo(port)<1e-9);
  assert.ok(curve.getTangent(1).dot(new T.Vector3(-1,0,0))>.999);
  const outlet=model.root.getObjectByName("Inverter motor outlet"),axis=new T.Vector3(0,1,0).applyQuaternion(outlet.getWorldQuaternion(new T.Quaternion()));
  const ray=new T.Raycaster(curve.getPoint(0),axis.clone().negate(),0,.012);
  assert.equal(ray.intersectObject(outlet,false).length,0,"socket bore is capped");
  assert.ok(curve.getTangent(0).dot(axis)>.999);
});

test("all six exhaust primaries seat concentrically inside their head flanges",()=>{
  for(const side of[-1,1])for(let i=0;i<3;i++){
    const pipe=model.root.getObjectByName(`Exhaust primary ${side} ${i}`),flange=model.root.getObjectByName(`Exhaust head flange ${side} ${i}`);
    const curve=new T.CatmullRomCurve3(pipe.userData.route.map(p=>new T.Vector3(...p)),false,"centripetal"),axis=new T.Vector3(0,1,0).applyQuaternion(flange.quaternion);
    assert.ok(axis.dot(curve.getTangent(0))>.999999,"flange is tilted away from the pipe");
    const local=flange.worldToLocal(curve.getPoint(0)),bounds=new T.Box3().setFromBufferAttribute(flange.geometry.attributes.position);
    assert.ok(Math.hypot(local.x,local.z)<1e-8&&local.y>bounds.min.y+.001&&local.y<bounds.max.y-.001,"pipe starts outside the flange's seating span");
    const ray=new T.Raycaster(curve.getPoint(0).clone().addScaledVector(axis,.002),axis.clone().negate(),0,.025);
    assert.equal(ray.intersectObject(flange,false).length,0,"solid cap blocks exhaust bore");
  }
});

test("each pushrod and damper share the rocker's real bearing centres",()=>{
  for(const front of[true,false])for(const side of[-1,1]){
    const prefix=`${front?"Front":"Rear"} ${side}`,inboard=model.root.getObjectByName(`${prefix} inboard suspension`),joints=inboard.userData.joints;
    const pushrod=model.root.getObjectByName(`${prefix} pushrod`);
    assert.deepEqual(pushrod.userData.anchor,joints.pushrod);
    for(const [name,key]of[["pushrod spherical bearing","pushrod"],["damper moving eye","movingEye"],["damper fixed eye","fixedEye"],["rocker centre bearing","pivot"]]){
      const centre=new T.Box3().setFromObject(inboard.getObjectByName(`${prefix} ${name}`)).getCenter(new T.Vector3());
      assert.ok(centre.distanceTo(new T.Vector3(...joints[key]))<1e-6,`${prefix} ${name} detached`);
    }
    for(const [name,key]of[["rocker chassis bracket","pivot"],["damper chassis bracket","fixedEye"]]){
      const point=new T.Vector3(...joints[key]);
      for(const s of[-1,1]){
        const cheek=inboard.getObjectByName(`${prefix} ${name} cheek ${s}`),box=new T.Box3().setFromObject(cheek);
        assert.ok(box.min.y<point.y-.03&&box.max.y>point.y+.01);
        assert.equal(cheek.userData.internal,true);
        // The pin passes through an actual hole in each cheek.
        const ray=new T.Raycaster(point.clone().add(new T.Vector3(0,0,-.04)),new T.Vector3(0,0,1),0,.08);
        assert.equal(ray.intersectObject(cheek,false).length,0);
      }
    }
  }
});

test("damper rods enter their cylinders and springs end at both seats",()=>{
  for(const front of[true,false])for(const side of[-1,1]){
    const prefix=`${front?"Front":"Rear"} ${side}`,g=model.root.getObjectByName(`${prefix} inboard suspension`),j=g.userData.joints;
    const from=new T.Vector3(...j.movingEye),axis=new T.Vector3(...j.fixedEye).sub(from).normalize();
    const projection=part=>{let min=Infinity,max=-Infinity;const p=part.geometry.attributes.position;for(let i=0;i<p.count;i++){const d=new T.Vector3().fromBufferAttribute(p,i).applyMatrix4(part.matrixWorld).sub(from).dot(axis);min=Math.min(min,d);max=Math.max(max,d);}return[min,max];};
    const rod=projection(g.getObjectByName(`${prefix} damper piston rod`)),cylinder=projection(g.getObjectByName(`${prefix} damper cylinder`));
    assert.ok(rod[1]>cylinder[0]&&rod[0]<cylinder[0]);
    const coil=projection(g.getObjectByName(`${prefix} spring`)),a=projection(g.getObjectByName(`${prefix} spring adjustable seat`)),b=projection(g.getObjectByName(`${prefix} spring fixed seat`));
    assert.ok(coil[0]<=a[1]&&coil[0]>=a[0]-.004&&coil[1]>=b[0]&&coil[1]<=b[1]+.004);
  }
});

test("motor coolant hoses connect to their unions and clear the shaped floor",async()=>{
  const {createSurfaceSampler}=await import("./w17-surface.ts"),floor=[];model.assemblies.get("floor").traverse(p=>{if(p.isMesh)floor.push(p);});const height=createSurfaceSampler(floor,"y");
  for(const [name,key,at]of[["ES coolant return","coolantIn",-1],["MGU-K coolant return","coolantOut",0]]){
    const part=model.root.getObjectByName(name),curve=new T.CatmullRomCurve3(part.userData.route.map(p=>new T.Vector3(...p)),false,"centripetal"),port=new T.Vector3(...motor.userData.ports[key]).add(motor.position);
    assert.ok(new T.Vector3(...part.userData.route.at(at)).distanceTo(port)<1e-9);
    for(const p of curve.getSpacedPoints(400).filter(p=>p.x<-.21)){
      for(const dz of[-part.userData.outerRadius,0,part.userData.outerRadius]){
        const floorY=height(p.x,p.z+dz,1);
        if(floorY!==undefined)assert.ok(p.y-part.userData.outerRadius>floorY+.002,`${name} clips floor at ${p.toArray()}`);
      }
    }
  }
});
