import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createSlickTyre, addTyreSidewalls } from "./w17-tyres.ts";
import { decodeModelAsset } from "./w17-model-asset.ts";

for (const [axle, radius, width, track] of [["front", .3525, .28, 1.612], ["rear", .355, .375, 1.517]]) {
  const tyre = createSlickTyre(radius, width), wheel = new T.Group();
  const rubber = new T.Mesh(tyre.geometry, new T.MeshStandardMaterial());
  wheel.add(rubber); addTyreSidewalls(wheel, axle, radius, tyre.sidewall);
  wheel.updateMatrixWorld(true);

  test(`${axle} slick keeps the 2026 diameter, bead seat and 1900 mm car envelope`, () => {
    tyre.geometry.computeBoundingBox();
    const size = tyre.geometry.boundingBox.getSize(new T.Vector3());
    assert.ok(Math.abs(size.x - radius * 2) < 1e-6);
    assert.ok(Math.abs(size.y - radius * 2) < 1e-6);
    assert.ok(Math.abs(size.z - (width + .006)) < 1e-6);
    assert.ok(size.z + track < 1.9);
    const p = tyre.geometry.attributes.position;
    let minimum = Infinity;
    for (let i = 0; i < p.count; i++) minimum = Math.min(minimum, Math.hypot(p.getX(i), p.getY(i)));
    assert.ok(Math.abs(minimum * 2 - .4572) < 1e-6);
    // Tyres and markings remain modest meshes, with no runtime image assets.
    let triangles = 0;
    for (const part of wheel.children) {
      triangles += (part.geometry.index?.count ?? part.geometry.attributes.position.count) / 3;
      assert.equal(part.material.map, null);
    }
    assert.ok(triangles < 33000, `${triangles} triangles in one tyre`);
  });

  test(`${axle} markings face outward and follow both sidewalls without sinking into rubber`, () => {
    const ray = new T.Raycaster();
    for (const side of [-1, 1]) {
      const mark = wheel.getObjectByName(`${axle} 2026 hard sidewall markings ${side}`);
      const p = mark.geometry.attributes.position, n = mark.geometry.attributes.normal;
      for (let i = 0; i < p.count; i += Math.max(1, Math.floor(p.count / 120))) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        assert.ok(n.getZ(i) * side > .85, "lettering is mirrored inward");
        ray.set(new T.Vector3(x, y, side), new T.Vector3(0, 0, -side));
        const hit = ray.intersectObject(rubber, false)[0];
        assert.ok(hit, "lettering lies outside the tyre");
        const clearance = (z - hit.point.z) * side;
        assert.ok(clearance > .0001 && clearance < .0008, `marking lifts off or clips: ${clearance}`);
      }
    }
  });
}

test("all four prepared wheels retain their markings and valves seated in the rim", () => {
  const bytes = gunzipSync(readFileSync(new URL("../../../public/anatomy/model-mercedes.bin.gz", import.meta.url)));
  const model = decodeModelAsset(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  model.root.updateMatrixWorld(true);
  const wheels = []; model.root.traverse(part => { if (part.userData.wheel) wheels.push(part); });
  assert.equal(wheels.length, 4);
  for (const wheel of wheels) {
    assert.equal(wheel.children.filter(p => p.userData.tyreSidewall).length, 2);
    const side = wheel.userData.side, valve = wheel.children.find(p => p.name.endsWith("tyre valve"));
    const bowl = wheel.children.find(p => p.name.includes("recessed rim bowl"));
    const origin = wheel.localToWorld(new T.Vector3(valve.position.x, valve.position.y, side));
    const hit = new T.Raycaster(origin, new T.Vector3(0, 0, -side)).intersectObject(bowl)[0];
    assert.ok(hit, `${wheel.name}: valve does not meet the rim`);
    const surface = wheel.worldToLocal(hit.point).z;
    const embedded = (valve.position.z - side * .0065 - surface) * side;
    assert.ok(embedded >= -.002 && embedded <= 0, `${wheel.name}: floating or buried valve (${embedded})`);
    const cap = wheel.children.find(p => p.name.endsWith("valve cap"));
    assert.ok(Math.abs(cap.position.z - valve.position.z) < .009);
  }
});
