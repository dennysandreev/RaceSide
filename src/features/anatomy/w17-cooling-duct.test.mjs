import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {gunzipSync} from "node:zlib";
import * as T from "three";
import {decodeModelAsset} from "./w17-model-asset.ts";
import {readCoolingDuctSections} from "./w17-cooling-duct.ts";

const bytes=gunzipSync(readFileSync(new URL("../../../public/anatomy/model-mercedes.bin.gz",import.meta.url)));
const {root}=decodeModelAsset(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));root.updateMatrixWorld(true);
const main=root.getObjectByName("Radiator inlet duct 1"),branch=root.getObjectByName("Charge radiator inlet duct"),splitter=root.getObjectByName("Cooling inlet branch splitter");

test("both right-inlet branches have closed laminate walls and a retained splitter",()=>{
  for(const part of[main,branch,splitter]){
    assert.ok(part,"missing branch hardware");assert.equal(part.userData.airflowCover,true);assert.equal(part.userData.serviceCover,true);
    const p=part.geometry.attributes.position,idx=part.geometry.index,edges=new Map(),keys=Array.from({length:p.count},(_,i)=>[p.getX(i),p.getY(i),p.getZ(i)].map(v=>Math.round(v*1e6)).join());
    let volume=0;
    for(let i=0;i<idx.count;i+=3){
      const ids=[0,1,2].map(j=>idx.getX(i+j)),vertices=ids.map(j=>new T.Vector3().fromBufferAttribute(p,j));
      volume+=vertices[0].dot(vertices[1].clone().cross(vertices[2]))/6;
      for(let j=0;j<3;j++){
        const a=keys[ids[j]],b=keys[ids[(j+1)%3]];if(a===b)continue;
        const key=a<b?`${a}/${b}`:`${b}/${a}`,edge=edges.get(key)??[0,0];edge[0]++;edge[1]+=a<b?1:-1;edges.set(key,edge);
      }
    }
    for(const [edge,[count,direction]]of edges){assert.equal(count,2,`${part.name}: open edge ${edge}`);assert.equal(direction,0,part.name);}
    assert.ok(volume>0,`${part.name}: inward faces`);
  }
  const lower=readCoolingDuctSections(main,1)[0],upper=readCoolingDuctSections(branch,1)[0];
  assert.ok(Math.max(...lower.map(p=>p.y))<.54802);
  assert.ok(Math.min(...upper.map(p=>p.y))>.55198);
  const divider=new T.Box3().setFromObject(splitter);
  assert.ok(Math.abs(divider.min.y-.548)<.00002&&Math.abs(divider.max.y-.552)<.00002);
});

test("the LT shroud encloses the full radiator face and seats on its open perimeter",()=>{
  const pack=root.getObjectByName("Charge low-temperature radiator"),rows=readCoolingDuctSections(branch,1);
  for(const point of rows.at(-1)){
    const p=pack.worldToLocal(point.clone());
    assert.ok(Math.abs(p.y-.008)<.00002);
    assert.ok(Math.min(Math.abs(Math.abs(p.x)-.148),Math.abs(Math.abs(p.z)-.075))<.00002);
  }
  const normal=new T.Vector3(0,1,0).transformDirection(pack.matrixWorld),ray=new T.Raycaster();branch.material.side=T.DoubleSide;
  for(const x of[-.14,-.10,-.05,0,.05,.10,.14])for(const z of[-.065,-.03,0,.03,.065]){
    ray.set(new T.Vector3(x,.3,z).applyMatrix4(pack.matrixWorld),normal.clone().negate());ray.far=.291;
    assert.ok(ray.intersectObject(branch,false).length,`uncovered LT face at ${x},${z}`);
  }
});

test("the new branch and revised main duct clear each other and installed service hardware",()=>{
  const ray=new T.Raycaster(),meshes=[],errors=new Set();
  root.traverse(part=>{if(part.isMesh){part.material.side=T.DoubleSide;meshes.push({part,bounds:new T.Box3().setFromObject(part)});}});
  for(const duct of[main,branch]){
    const rows=readCoolingDuctSections(duct,1),positions=duct.geometry.attributes.position;
    // Trace the inner wall too. Packing keeps face order but welds vertices,
    // so the paired skin is addressed through its triangle indices.
    const index=duct.geometry.index,inner=[];
    for(let row=0;row<25;row++)inner.push(Array.from({length:64},(_,col)=>{
      const triangleRow=Math.min(row,23),corner=row===24?2:0;
      return new T.Vector3().fromBufferAttribute(positions,index.getX(24*384+triangleRow*384+col*6+corner)).applyMatrix4(duct.matrixWorld);
    }));
    for(const sections of[rows,inner])for(let row=0;row<25;row++)for(let col=0;col<64;col++){
      const a=sections[row][col];
      for(const b of[sections[row][(col+1)%64],...(row<24?[sections[row+1][col]]:[])]){
        const d=b.clone().sub(a),length=d.length();if(length<1e-8)continue;
        const bounds=new T.Box3().setFromPoints([a,b]);
        const candidates=meshes.filter(m=>m.part!==duct&&m.part!==splitter&&m.part.name!=="Recessed sidepod inlet 1"&&!m.part.name.includes("radiator face seal")&&!m.part.name.includes("Radiator face seal")&&m.bounds.intersectsBox(bounds)).map(m=>m.part);
        ray.set(a,d.normalize());ray.far=length;
        for(const hit of ray.intersectObjects(candidates,false))errors.add(`${duct.name} / ${hit.object.name}`);
      }
    }
  }
  assert.deepEqual([...errors],[]);
});
