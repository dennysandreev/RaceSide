import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import {createFinalDrive} from "./w17-final-drive.ts";

const material=new T.MeshBasicMaterial({side:T.DoubleSide});
const {differential:root}=createFinalDrive(.246,.326,{metal:material,darkMetal:material});
root.updateMatrixWorld(true);
const part=name=>root.getObjectByName(name);
const box=mesh=>new T.Box3().setFromObject(mesh);
function noPenetration(a,b){
  const bounds=box(b),ray=new T.Raycaster(),direction=new T.Vector3(.314,.596,.739).normalize(),point=new T.Vector3();
  const positions=a.geometry.attributes.position,seen=new Set();let closest=Infinity;
  for(let i=0;i<positions.count;i++){
    point.fromBufferAttribute(positions,i).applyMatrix4(a.matrixWorld);
    if(!bounds.containsPoint(point))continue;
    const key=point.toArray().map(v=>Math.round(v*1e7)).join();if(seen.has(key))continue;seen.add(key);
    ray.set(point,direction);const hits=ray.intersectObject(b,false);
    const crossings=hits.filter((hit,j)=>j===0||hit.distance-hits[j-1].distance>1e-6);
    if(crossings[0]?.distance<2e-6)continue;
    assert.equal(crossings.length%2,0,`${a.name} penetrates ${b.name} at ${point.toArray()}`);
    // Probe contact towards the mating gear as well: one fixed parity ray
    // points away from some of the four symmetrically installed planet pairs.
    ray.set(point,bounds.getCenter(new T.Vector3()).sub(point).normalize());
    const contact=ray.intersectObject(b,false)[0];
    if(contact)closest=Math.min(closest,contact.distance);
  }
  return closest;
}

test("the paired differential gears mesh on both outputs without intersecting tooth faces",()=>{
  for(let pair=0;pair<4;pair++){
    const left=part(`Differential planet ${pair} left`),right=part(`Differential planet ${pair} right`);
    for(const [a,b]of[[left,right],[left,part("Differential sun -1")],[right,part("Differential sun 1")]]){
      assert.ok(box(a).intersectsBox(box(b)),`${a.name} cannot reach ${b.name}`);
      assert.ok(Math.min(noPenetration(a,b),noPenetration(b,a))<.001,`${a.name} has no nearby tooth contact with ${b.name}`);
    }
  }
});

test("the hollow tapered carrier encloses the gearset and keyed clutch plates with running clearance",()=>{
  const shell=part("Differential drum");
  for(const mesh of root.children.filter(m=>/Differential (planet \d|sun |clutch plate)/.test(m.name)))noPenetration(mesh,shell);
  const bounds=box(shell);
  assert.ok(Math.abs(bounds.min.x+1.768)<1e-6&&Math.abs(bounds.max.x+1.632)<1e-6,"carrier flange grows beyond its installation envelope");
  for(const side of[-1,1]){
    const origin=new T.Vector3(-1.7,.326,side*.12),ray=new T.Raycaster(origin,new T.Vector3(0,0,-side),0,.24);
    const covers=root.children.filter(m=>m.userData.serviceCover);
    assert.equal(ray.intersectObjects(covers,false).length,0,"cover closes a drive-shaft bore");
  }
});

test("planet pins fit real bores in both support plates and output keys fit the sun gears",()=>{
  for(let i=0;i<8;i++)for(const side of[-1,1]){
    noPenetration(part(`Differential planet pin ${i}`),part(`Differential planet support ${side}`));
    for(const name of[`Differential sun ${side}`,`Differential planet support ${side}`,...Array.from({length:7},(_,j)=>`Differential clutch plate ${side} ${j}`)]){
      noPenetration(part(`Differential output key ${side} ${i}`),part(name));
    }
  }
  for(const side of[-1,1])assert.ok(box(part(`Differential output shaft ${side}`)).intersectsBox(box(part(`Differential sun ${side}`))),"sun is detached from its output shaft");
});

test("the carrier is a closed wall and opening it retains the differential mechanism",()=>{
  const shell=part("Differential drum"),p=shell.geometry.attributes.position,index=shell.geometry.index.array,edges=new Map();
  const vertex=i=>[p.getX(i),p.getY(i),p.getZ(i)].map(v=>Math.round(v*1e6)).join();
  for(let i=0;i<index.length;i+=3){
    // Micron quantisation may collapse the small slivers at drilled rims.
    if(new Set([0,1,2].map(j=>vertex(index[i+j]))).size<3)continue;
    for(let j=0;j<3;j++){
    const a=vertex(index[i+j]),b=vertex(index[i+(j+1)%3]),key=a<b?`${a}/${b}`:`${b}/${a}`;
    const edge=edges.get(key)??{count:0,winding:0};edge.count++;edge.winding+=a<b?1:-1;edges.set(key,edge);
  }}
  for(const edge of edges.values()){assert.equal(edge.count,2);assert.equal(edge.winding,0);}
  assert.equal(shell.userData.serviceCover,true);
  for(const name of["Differential sun -1","Differential sun 1","Differential planet 0 left","Differential clutch plate -1 1","Differential output shaft 1"]){
    assert.equal(part(name).userData.component,"differential");assert.ok(!part(name).userData.serviceCover,`${name} vanishes with the cover`);
  }
});

test("the crown seats on its drilled carrier flange without passing through the drum",()=>{
  const crown=part("Final drive crown wheel"),carrier=part("Differential drum");
  noPenetration(crown,carrier);noPenetration(carrier,crown);
  for(let i=0;i<8;i++){
    const bolt=part(`Crown carrier bolt ${i}`);noPenetration(bolt,crown);noPenetration(bolt,carrier);
    assert.ok(box(bolt).intersectsBox(box(part(`Crown carrier bolt head ${i}`))));
  }
});

test("stationary piston force reaches the keyed output through a complete thrust bearing",()=>{
  for(const side of[-1,1]){
    const pairs=[
      ["clutch piston","thrust stationary race"],
      ["thrust stationary race",`thrust roller ${side} 0`,true],
      ["thrust rotating race",`thrust roller ${side} 0`,true],
      ["thrust rotating race","clutch rotating collar"],
      ["output thrust shoulder","clutch pressure ring"],
      ["output thrust shoulder","output shaft"],
    ];
    for(const [a,b,full]of pairs){
      const first=part(`Differential ${a} ${side}`),second=part(`Differential ${b}${full?"":` ${side}`}`);
      assert.ok(box(first).expandByScalar(.00001).intersectsBox(box(second)),`${first.name} is disconnected from ${second.name}`);
      if(a!=="output thrust shoulder")noPenetration(first,second);
    }
  }
});
