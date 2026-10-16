import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { createW17 } from "./w17-geometry.ts";

const model=createW17();model.root.updateMatrixWorld(true);
const part=name=>model.root.getObjectByName(name);

test("rear brake-by-wire replaces the placeholder with separated hydraulic and brake actuators",()=>{
  assert.ok(!part("Rear brake control"),"rear control is still a single solid box");
  const unit=part("Rear brake-by-wire actuator");assert.ok(unit);
  const a=part("BBW hydraulic piston"),b=part("BBW brake piston"),rod=part("BBW transfer rod");
  for(const piston of[a,b])assert.ok(new T.Box3().setFromObject(piston).intersectsBox(new T.Box3().setFromObject(rod)),"disconnected piston rod");
  assert.ok(part("BBW dry separator"));assert.ok(part("BBW bypass return spring"));
});
