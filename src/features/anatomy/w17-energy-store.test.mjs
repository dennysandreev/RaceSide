import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import {createW17,explodeOffset} from "./w17-geometry.ts";
import {createModelInstance} from "./w17-model-cache.ts";

const model=createW17();model.root.updateMatrixWorld(true);
const store=model.root.getObjectByName("ES main enclosure assembly");
const inverter=model.root.getObjectByName("CU-K inverter cartridge");

test("the complete inverter cartridge sits inside the common energy-store enclosure",()=>{
  assert.ok(store&&inverter);
  const interior=new T.Box3(new T.Vector3(-.294,.006,-.144),new T.Vector3(.294,.077,.144));
  for(const p of inverter.children){
    if(/outlet|feedthrough|socket|phase output|contactor link/.test(p.name))continue;
    const bounds=new T.Box3().setFromObject(p);bounds.translate(store.position.clone().negate());
    assert.ok(interior.containsBox(bounds),`${p.name} outside the enclosure`);
  }
  const body=new T.Box3().setFromObject(inverter.getObjectByName("CU-K liquid cold plate"));
  for(const side of[-1,1]){
    const contactor=new T.Box3().setFromObject(store.getObjectByName(`ES main contactor ${side}`));
    assert.ok(contactor.min.x-body.max.x>=.001,"CU-K touches the adjacent safety devices");
  }
  assert.deepEqual(explodeOffset.battery,explodeOffset.inverter);
  assert.equal(model.root.getObjectByName("Power inverter"),undefined,"old outboard inverter remains");
});

test("cell modules are enclosed by the lid and expose joined terminals when it is removed",()=>{
  const lid=store.getObjectByName("ES access lid"),openParts=[];assert.equal(lid.userData.serviceCover,true);
  store.traverse(p=>{if(p.isMesh&&!p.userData.serviceCover)openParts.push(p);});
  for(let i=0;i<8;i++){
    const cells=store.getObjectByName(`ES module ${i} cells`),tabs=store.getObjectByName(`ES module ${i} tabs`),matrix=new T.Matrix4();
    assert.equal(cells.count,20);assert.equal(tabs.count,40);
    cells.getMatrixAt(9,matrix);const centre=new T.Vector3().setFromMatrixPosition(matrix).applyMatrix4(cells.matrixWorld);
    const ray=new T.Raycaster(new T.Vector3(centre.x,.5,centre.z),new T.Vector3(0,-1,0));
    assert.ok(ray.intersectObject(store,true)[0]?.object.userData.serviceCover,"closed cell module is exposed");
    assert.match(ray.intersectObjects(openParts,false)[0]?.object.name??"",new RegExp(`^ES module ${i} cells$`));
    cells.getMatrixAt(0,matrix);const first=new T.Vector3().setFromMatrixPosition(matrix);cells.getMatrixAt(1,matrix);const next=new T.Vector3().setFromMatrixPosition(matrix);
    assert.ok(Math.abs(next.x-first.x)>.0036,"pouch bodies intersect each other");
    for(let link=0;link<19;link++){
      const bridge=new T.Box3().setFromObject(store.getObjectByName(`ES module ${i} series link ${link}`));
      for(const cell of[link,link+1]){
        // Negative tab of a cell meets the next cell's positive tab.
        tabs.getMatrixAt(cell*2+(cell===link?1:0),matrix);matrix.premultiply(tabs.matrixWorld);
        const tab=new T.Box3().setFromBufferAttribute(tabs.geometry.attributes.position).applyMatrix4(matrix);
        assert.ok(bridge.intersectsBox(tab),`open module interconnect ${i}/${link}/${cell}`);
      }
    }
  }
});

test("battery detail includes the installed inverter and can reveal both real lids",()=>{
  const detail=createModelInstance("battery"),installedModel=createModelInstance();assert.deepEqual([...detail.assemblies.keys()].sort(),["battery","inverter"]);
  for(const name of["ES access lid","CU-K EMI lid"]){
    const part=detail.root.getObjectByName(name),installed=installedModel.root.getObjectByName(name);
    assert.equal(part.geometry,installed.geometry);assert.notEqual(part.material,installed.material);assert.ok(part.userData.serviceCover);
  }
});

test("energy-store ports join the motor cable and both coolant lines",()=>{
  const cooling=model.root.getObjectByName("Cooling and lubrication pack");
  for(const [partName,port,endpoint]of[["High voltage cable","power",0],["ES coolant supply","coolantIn",-1],["ES coolant return","coolantOut",0]]){
    const part=model.root.getObjectByName(partName),point=new T.Vector3(...part.userData.route.at(endpoint));
    const target=new T.Vector3(...store.userData.ports[port]).add(store.position);
    assert.ok(point.distanceTo(target)<1e-8,`${partName} is detached`);
    if(port!=="power")assert.ok(Object.values(cooling.userData.ports).some(p=>point.distanceTo(new T.Vector3(...p))<1e-8));
  }
});

test("the battery mounting feet are carried by the lower survival cell",()=>{
  const shell=model.root.getObjectByName("Survival cell lower shell");
  for(let i=0;i<4;i++){
    const stand=model.root.getObjectByName(`ES chassis stand-off ${i}`),bounds=new T.Box3().setFromObject(stand),c=bounds.getCenter(new T.Vector3());
    const ray=new T.Raycaster(new T.Vector3(c.x,.22,c.z),new T.Vector3(0,-1,0));
    const surface=ray.intersectObject(shell,false)[0]?.point.y;
    assert.ok(surface!==undefined&&surface>bounds.min.y&&surface<bounds.max.y,`mount ${i} does not enter the cell`);
    const foot=new T.Vector3(...store.userData.mounts[i]).add(store.position);
    assert.ok(Math.abs(bounds.max.y-foot.y)<1e-6,"standoff stops before the mounting ear");
  }
});

const skins=[];
model.root.traverse(part=>{
  if(!part.isMesh||!["floor","monocoque","cockpit","fuel","bodywork"].includes(part.userData.component)||(/^ES /.test(part.name)&&part.name!=="ES service passage connector plate"))return;
  const p=part.geometry.attributes.position,index=part.geometry.index,triangles=[];
  for(let i=0;i<(index?.count??p.count);i+=3){
    const v=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(p,index?index.getX(i+j):i+j).applyMatrix4(part.matrixWorld));
    triangles.push({triangle:new T.Triangle(...v),bounds:new T.Box3().setFromPoints(v)});
  }
  skins.push({part,triangles,bounds:new T.Box3().setFromObject(part)});
});

test("the under-seat enclosure clears the seat, fuel bladder and structural skins",()=>{
  const occupied=new T.Box3(new T.Vector3(-.300,0,-.150),new T.Vector3(.300,.087,.150)).translate(store.position);
  for(const {part,triangles,bounds}of skins){
    if(!bounds.intersectsBox(occupied))continue;
    assert.ok(!triangles.some(({triangle})=>occupied.intersectsTriangle(triangle)),`ES intersects ${part.name}`);
  }
});

test("ES plumbing passes through open service bores without intersecting the fuel tank or skins",()=>{
  const closest=new T.Vector3(),errors=new Set();
  for(const name of["ES coolant supply","ES coolant return","High voltage cable"]){
    const part=model.root.getObjectByName(name),radius=part.userData.outerRadius;
    const curve=new T.CatmullRomCurve3(part.userData.route.map(p=>new T.Vector3(...p)),false,"centripetal");
    for(const point of curve.getSpacedPoints(400))for(const {part:skin,triangles,bounds}of skins){
      if(bounds.distanceToPoint(point)>radius+.0004)continue;
      if(triangles.some(({triangle,bounds})=>bounds.distanceToPoint(point)<radius+.0004&&triangle.closestPointToPoint(point,closest).distanceTo(point)<radius+.0004))errors.add(`${name} / ${skin.name}`);
    }
  }
  assert.deepEqual([...errors],[]);
});

test("internal cell services stay inside the enclosure rather than showing through its walls",()=>{
  const interior=new T.Box3(new T.Vector3(-.294,.006,-.144),new T.Vector3(.294,.077,.144)).expandByScalar(1e-7);
  for(const part of store.children){
    if(!part.isMesh||part.userData.serviceCover||/tray|wall|bulkhead|seal|ear|union|outlet|socket|pin|membrane/.test(part.name))continue;
    const bounds=new T.Box3().setFromObject(part).translate(store.position.clone().negate());
    assert.ok(interior.containsBox(bounds),`${part.name} penetrates the enclosure`);
  }
  const ray=new T.Raycaster(new T.Vector3(.32,.05,-.115).add(store.position),new T.Vector3(-1,0,0),0,.04);
  assert.equal(ray.intersectObject(store.getObjectByName("ES front wall"),false).length,0,"vent hole is blocked by the wall");
});
