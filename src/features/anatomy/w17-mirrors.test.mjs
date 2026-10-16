import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import {createW17,explodeOffset} from "./w17-geometry.ts";
import {components} from "./catalog.ts";
import {createSurfaceSampler} from "./w17-surface.ts";

const model=createW17();model.root.updateMatrixWorld(true);

test("mirrors select their own catalog entry and move with their bodywork mounts",()=>{
  assert.equal(components.find(c=>c.id==="mirrors")?.name,"Зеркала заднего вида");
  assert.ok(!components.find(c=>c.id==="safety").parts.includes("зеркала"));
  assert.deepEqual(explodeOffset.mirrors,explodeOffset.bodywork);
  const group=model.assemblies.get("mirrors");assert.ok(group);
  model.root.traverse(part=>{if(!part.name.startsWith("Mirror "))return;assert.equal(part.userData.component,"mirrors");assert.equal(part.parent,group);assert.equal(part.userData.cover,true,"mirror must leave with its mounting body panel in cutaway mode");});
});

test("both mirror stays seat on conforming mounting pads without a gap to the body",()=>{
  for(const side of [-1,1])for(const outer of [false,true]){
    const body=model.root.getObjectByName(outer?"Continuous undercut sidepod shell":`Cockpit shoulder fairing ${side}`),height=createSurfaceSampler([body],"y");
    const stay=model.root.getObjectByName(`Mirror ${outer?"outer brace":"stay"} ${side}`),pad=model.root.getObjectByName(`Mirror ${outer?"outer":"inner"} mounting foot ${side}`);
    assert.ok(stay.userData.route&&pad,"missing seated support");
    const root=new T.Vector3(...stay.userData.route[0]),y=height(root.x,root.z,1);
    assert.ok(root.y-y>.0005&&root.y-y<.004,"stay root does not enter its mounting foot");
    const p=pad.geometry.attributes.position;let min=Infinity,max=-Infinity;
    for(let i=0;i<p.count;i++){
      const v=new T.Vector3().fromBufferAttribute(p,i).applyMatrix4(pad.matrixWorld),surface=height(v.x,v.z,1);
      assert.ok(surface!==undefined,"mounting foot overhangs bodywork");
      const gap=v.y-surface;min=Math.min(min,gap);max=Math.max(max,gap);
    }
    assert.ok(min<-.0005&&min>-.0015&&max>.0035&&max<.0045,"mounting foot must overlap the body and have a raised top");
    const tip=new T.Vector3(...stay.userData.route.at(-1)),housing=model.root.getObjectByName(`Mirror housing ${side}`),old=housing.material.side;housing.material.side=T.DoubleSide;
    try{
      const ray=new T.Raycaster(tip.clone().add(new T.Vector3(0,-.1,0)),new T.Vector3(0,1,0),0,.2),hits=ray.intersectObject(housing,false);
      assert.ok(hits.length>=2&&tip.y>hits[0].point.y&&tip.y<hits.at(-1).point.y,"stay does not enter mirror housing");
      const below=[...new Set(hits.filter(hit=>hit.point.y<tip.y).map(hit=>Math.round(hit.point.y*1e6)))];
      assert.equal(below.length%2,1,"support ends in the empty cavity instead of the housing wall");
    }finally{housing.material.side=old;}
  }
});

test("mirror glasses have a 200 by 50 mm projected surface and a convex horizontal section",()=>{
  for(const side of[-1,1]){
    const glass=model.root.getObjectByName(`Mirror glass ${side}`),bounds=new T.Box3().setFromObject(glass),size=bounds.getSize(new T.Vector3());
    assert.ok(Math.abs(size.z-.200)<1e-6&&Math.abs(size.y-.050)<1e-6,"undersized reflective surface");
    const angles=[];
    for(let i=0;i<=20;i++){
      const z=side*(.4905+i*.00995),ray=new T.Raycaster(new T.Vector3(0,.7,z),new T.Vector3(1,0,0));
      const hit=ray.intersectObject(glass)[0];assert.ok(hit);
      const normal=hit.face.normal;assert.ok(normal.x<0&&side*normal.z<0);
      angles.push(Math.atan2(Math.abs(normal.z),-normal.x));
    }
    assert.ok(angles[0]>24*Math.PI/180&&angles[0]<28*Math.PI/180);
    assert.ok(angles[0]-angles.at(-1)>8*Math.PI/180);
    for(let i=1;i<angles.length;i++)assert.ok(angles[i]<=angles[i-1]+.001,"concave or rippled mirror glass");
  }
});

test("mirror cups and glass are watertight outward-facing solids",()=>{
  for(const side of[-1,1])for(const type of["housing","glass"]){
    const part=model.root.getObjectByName(`Mirror ${type} ${side}`),p=part.geometry.attributes.position,index=part.geometry.index.array,edges=new Map();let volume=0;
    for(let i=0;i<index.length;i+=3){
      const a=new T.Vector3().fromBufferAttribute(p,index[i]),b=new T.Vector3().fromBufferAttribute(p,index[i+1]),c=new T.Vector3().fromBufferAttribute(p,index[i+2]);
      volume+=a.dot(b.cross(c))/6;
      for(let j=0;j<3;j++){
        const a=index[i+j],b=index[i+(j+1)%3],key=[Math.min(a,b),Math.max(a,b)].join("/"),edge=edges.get(key)??[0,0];
        edge[0]++;edge[1]+=a<b?1:-1;edges.set(key,edge);
      }
    }
    assert.ok(volume>0,`${part.name} faces point into the solid`);
    for(const [faces,winding]of edges.values()){assert.equal(faces,2);assert.equal(winding,0);}
  }
});

test("the real rear aperture exposes the recessed reflective surface",()=>{
  for(const side of[-1,1]){
    const housing=model.root.getObjectByName(`Mirror housing ${side}`),glass=model.root.getObjectByName(`Mirror glass ${side}`);
    for(const y of[.68,.7,.72])for(const z of[.5,.54,.59,.64,.68]){
      const ray=new T.Raycaster(new T.Vector3(0,y,side*z),new T.Vector3(1,0,0)),hits=ray.intersectObjects([housing,glass]);
      assert.equal(hits[0]?.object,glass,"housing blocks the reflective surface");
      const cup=hits.find(hit=>hit.object===housing);assert.ok(cup&&cup.point.x-hits[0].point.x>.025,"mirror has no physical recess behind its glass");
    }
  }
});
