import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import {createW17} from "./w17-geometry.ts";
import {createSurfaceSampler} from "./w17-surface.ts";

const model=createW17();model.root.updateMatrixWorld(true);
const cell=model.root.getObjectByName("Forward survival cell deck");
const cellWalls=[cell,...[-1,1].map(side=>model.root.getObjectByName(`Cockpit side ${side}`))];
const cellSide=createSurfaceSampler(cellWalls,"z");

test("all eight front wishbone pivots have bolted clevises seated on the survival cell",()=>{
  for(const side of[-1,1])for(const level of["upper","lower"])for(const i of[0,1]){
    const name=`Front ${side} ${level} wishbone ${i}`,arm=model.root.getObjectByName(name);
    const pad=model.root.getObjectByName(`${name} chassis insert`);
    assert.ok(pad,`${name}: missing structural attachment`);
    assert.equal(pad.userData.component,"monocoque");assert.equal(pad.userData.structural,true);
    assert.ok(!arm.userData.cover&&!pad.userData.cover,"attachment disappears with the body skin");
    const pivot=new T.Vector3(...arm.userData.anchor),bearing=model.root.getObjectByName(`${name} spherical bearing`);
    assert.ok(new T.Box3().setFromObject(bearing).getCenter(new T.Vector3()).distanceTo(pivot)<1e-6);
    const p=pad.geometry.attributes.position;let min=Infinity,max=-Infinity;
    for(let j=0;j<p.count;j++){
      const v=new T.Vector3().fromBufferAttribute(p,j).applyMatrix4(pad.matrixWorld),surface=cellSide(v.x,v.y,side);
      assert.ok(surface!==undefined,`${name}: insert misses the survival cell`);
      const depth=side*(v.z-surface);min=Math.min(min,depth);max=Math.max(max,depth);
    }
    assert.ok(min<-.001&&max>.003,`${name}: insert does not seat in the laminate`);
    // A transverse ray through each clevis foot must hit the same carbon
    // insert and then the structural shell, without relying on bodywork.
    for(const direction of[-1,1]){
      const cheek=model.root.getObjectByName(`${name} clevis cheek ${direction}`);
      assert.ok(cheek&&!cheek.userData.cover);
      const ray=new T.Raycaster(new T.Vector3(pivot.x+direction*.014,pivot.y,pivot.z+side*.02),new T.Vector3(0,0,-side));
      const hits=ray.intersectObjects([cheek,pad,...cellWalls],false);
      assert.equal(hits[0]?.object,cheek);
      assert.ok(hits.some(h=>h.object===pad)&&hits.some(h=>cellWalls.includes(h.object)));
      const cheekBase=cellSide(pivot.x+direction*.014,pivot.y,side);
      const bounds=new T.Box3().setFromObject(cheek);
      assert.ok(side>0?bounds.min.z<cheekBase+.004:bounds.max.z>cheekBase-.004,"clevis floats above insert");
    }
    assert.ok(pivot.x<new T.Box3().setFromObject(model.root.getObjectByName("Nose structural core")).min.x,"wishbone mounts on the replaceable nose");
  }
});

test("rear upper front-wishbone joints and their fairings stay outside the cockpit shoulder",()=>{
  for(const side of[-1,1]){
    const name=`Front ${side} upper wishbone 1`,arm=model.root.getObjectByName(name),pivot=new T.Vector3(...arm.userData.anchor);
    const shoulder=model.root.getObjectByName(`Cockpit side ${side}`);
    const outer=createSurfaceSampler([shoulder],"z");
    assert.ok(side*(pivot.z-outer(pivot.x,pivot.y,side))>.024,"bearing buried in the cockpit wall");
    const positions=arm.geometry.attributes.position;
    for(let i=0;i<positions.count;i++){
      const p=new T.Vector3().fromBufferAttribute(positions,i).applyMatrix4(arm.matrixWorld),skin=cellSide(p.x,p.y,side);
      if(skin!==undefined)assert.ok(side*(p.z-skin)>.003,`fairing cuts through carbon at ${p.toArray()}`);
    }
    const a=new T.Vector3(pivot.x-.012,pivot.y,pivot.z),b=new T.Vector3(pivot.x+.012,pivot.y,pivot.z);
    assert.equal(new T.Raycaster(a,b.clone().sub(a).normalize(),0,a.distanceTo(b)).intersectObjects(cellWalls).length,0,"wall crosses pivot bolt");
  }
});

test("front track rods meet the steering rack ball joints, not the nose skin",()=>{
  const rack=model.root.getObjectByName("Steering rack"),bounds=new T.Box3().setFromObject(rack);
  for(const side of[-1,1]){
    const arm=model.root.getObjectByName(`Front ${side} track rod`),anchor=new T.Vector3(...arm.userData.anchor);
    assert.ok(Math.abs(anchor.x-bounds.getCenter(new T.Vector3()).x)<1e-6);
    assert.ok(Math.abs(anchor.y-bounds.getCenter(new T.Vector3()).y)<1e-6);
    assert.ok(Math.abs(anchor.z-(side>0?bounds.max.z:bounds.min.z))<1e-6);
    assert.ok(model.root.getObjectByName(`Steering rack joint ${side}`));
  }
});

test("removing the body exposes both front dampers while their feet retain structural support",()=>{
  const cover=model.root.getObjectByName("Front suspension access cover");
  assert.ok(cover?.userData.cover,"no removable suspension access cover");
  const exposed=[];model.root.traverse(part=>{if(part.isMesh&&!(part.userData.cover&&!part.userData.structural))exposed.push(part);});
  for(const side of[-1,1]){
    const ray=new T.Raycaster(new T.Vector3(1.01,1,side*.115),new T.Vector3(0,-1,0));
    const hit=ray.intersectObjects(exposed,false)[0];
    assert.match(hit?.object.name??"",new RegExp(`^Front ${side} (spring|damper)`),"monocoque hides damper in cutaway mode");
    for(const mount of["rocker","damper"]){
      const foot=model.root.getObjectByName(`Front ${side} ${mount} chassis bracket foot`),bounds=new T.Box3().setFromObject(foot),centre=bounds.getCenter(new T.Vector3());
      ray.set(new T.Vector3(centre.x,bounds.min.y+.006,centre.z),new T.Vector3(0,-1,0));
      const seat=ray.intersectObject(cell,false)[0];
      assert.ok(seat&&seat.point.y>=bounds.min.y&&seat.point.y<bounds.max.y,"damper bracket foot floats above its tray");
    }
  }
});
