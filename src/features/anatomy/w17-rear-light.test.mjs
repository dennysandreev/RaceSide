import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import {createW17,W17_AXLES,W17_REFERENCE_HEIGHT,W17_REAR_LIGHT_OVERHANG} from "./w17-geometry.ts";

const model=createW17();model.root.updateMatrixWorld(true);
const get=name=>{const p=model.root.getObjectByName(name);assert.ok(p,`missing ${name}`);return p;};
const bounds=name=>new T.Box3().setFromObject(get(name));

test("the rear lamp contains a board, fifteen emitters and a sealed plug inside its retained envelope",()=>{
  const housing=get("Rear rain light housing"),box=bounds(housing.name),board=bounds("Rear light circuit board");
  assert.ok(Math.abs(box.max.x-(W17_AXLES.rear-W17_REAR_LIGHT_OVERHANG))<1e-7);
  assert.ok(Math.abs(box.getCenter(new T.Vector3()).y-W17_REFERENCE_HEIGHT-.300)<1e-7);
  assert.ok(box.containsBox(board));
  for(let row=0;row<5;row++)for(let col=0;col<3;col++){
    const emitter=bounds(`Rear light emitter ${row} ${col}`),pad=bounds(`Rear light emitter pad ${row} ${col}`);
    assert.ok(box.containsBox(emitter));assert.ok(emitter.intersectsBox(pad));assert.ok(pad.intersectsBox(board));
    get(`Rear rain light LED ${row} ${col}`);
  }
  get("Rear light connector socket");get("Rear light connector plug");get("Rear light connector seal");
});

test("the lamp studs pass through real impact-member bores and seat against the inner face",()=>{
  const impact=get("Rear crash structure"),old=impact.material.side;impact.material.side=T.DoubleSide;
  try{
    for(const offset of[-.032,.032]){
      const origin=new T.Vector3(W17_AXLES.rear-W17_REAR_LIGHT_OVERHANG-.010,W17_REFERENCE_HEIGHT+.300+offset,0);
      assert.equal(new T.Raycaster(origin,new T.Vector3(1,0,0),0,.020).intersectObject(impact,false).length,0,"mounting stud crosses solid impact skin");
      assert.ok(bounds(`Rear light washer ${offset}`).intersectsBox(bounds(`Rear light mounting nut ${offset}`)));
      assert.ok(bounds(`Rear light stud ${offset}`).intersectsBox(bounds(`Rear light mounting nut ${offset}`)));
    }
  }finally{impact.material.side=old;}
});
