import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { decodeModelAsset } from "./w17-model-asset.ts";
import { createVehicleMotion, prepareVehicleMotion, VEHICLE_MOTION } from "./w17-vehicle-motion.ts";
import { ENGINE_CORE } from "./w17-engine-core.ts";
import { sampleLesson } from "./monza-lesson.ts";

test("opened component viewers and the full installed car restore identical mechanism poses after seeking", () => {
  const bytes = gunzipSync(readFileSync(new URL("../../../public/anatomy/model-mercedes.bin.gz", import.meta.url)));
  const model = decodeModelAsset(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  prepareVehicleMotion(model.root);
  const moveCar = createVehicleMotion(model.root);
  const isolated = ["engine", "mguk", "gearbox", "brakes"].map(id => {
    const installed = model.assemblies.get(id), copy = installed.clone(true);
    const originalParts = [], copyParts = [];
    installed.traverse(part => originalParts.push(part));
    copy.traverse(part => copyParts.push(part));
    return { id, move: createVehicleMotion(copy), originalParts, copyParts };
  });
  for (const time of [0, 15.5, 22, 104, 15.5, 0]) {
    const angle = ENGINE_CORE.initialAngle - sampleLesson(time).mechanismTime * VEHICLE_MOTION.engineSpeed;
    moveCar(angle);
    for (const { id, move, originalParts, copyParts } of isolated) {
      move(angle);
      assert.equal(copyParts.length, originalParts.length);
      for (let index = 0; index < originalParts.length; index++) {
        const a = originalParts[index], b = copyParts[index];
        assert.ok(a.position.distanceTo(b.position) < 1e-9, `${id}/${a.name}: position at ${time}`);
        assert.ok(a.quaternion.angleTo(b.quaternion) < 1e-7, `${id}/${a.name}: rotation at ${time}`);
      }
    }
  }
});
