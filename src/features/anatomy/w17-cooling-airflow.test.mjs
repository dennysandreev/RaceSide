import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import * as T from "three";
import { decodeModelAsset } from "./w17-model-asset.ts";
import { createCoolingAirflowPaths } from "./w17-cooling-airflow.ts";
import { airflowRadius, sampleAirflowPoint } from "./w17-airflow.ts";
import { decodeAirflowPaths } from "./w17-flow-cache.ts";

const bytes = gunzipSync(readFileSync(new URL("../../../public/anatomy/model-mercedes.bin.gz", import.meta.url)));
const model = decodeModelAsset(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
model.root.updateMatrixWorld(true);
const paths = createCoolingAirflowPaths(model.root), meshes = [];
const published=decodeAirflowPaths(JSON.parse(readFileSync(new URL("../../../public/anatomy/airflow-mercedes.json",import.meta.url),"utf8"))).filter(path=>path.layer==="cooling");
model.root.traverse(part => {
  if (!part.isMesh) return;
  part.material.side = T.DoubleSide;
  meshes.push({ part, bounds: new T.Box3().setFromObject(part) });
});

test("both cooling paths enter a real duct, cross an open radiator cell and leave the aft outlet", () => {
  assert.equal(paths.length, 3);
  for (const [index, side] of [-1, 1].entries()) {
    const path = paths[index], pack = model.root.getObjectByName(`Radiator pack ${side}`), points = path.corner;
    assert.ok(points[0].x > .6 && points.at(-1).x < -2.1);
    const core = points.map(p => pack.worldToLocal(p.clone())).filter(p => Math.abs(p.x) < .299 && Math.abs(p.y) < .018 && Math.abs(p.z) < .112);
    assert.ok(core.length >= 8, "the flow bypasses the core");
    assert.ok(core.some(p => p.y > .012) && core.some(p => p.y < -.012));
    assert.ok(pack.worldToLocal(points[34].clone()).y>.020&&pack.worldToLocal(points[46].clone()).y<-.020,"the route does not cross the full core depth");
    for (const p of core) {
      assert.ok(Math.abs(p.x + .216) < .00005 && Math.abs(p.z + side * .02018181818181818) < .00005);
    }
    assert.equal(path.radii.length, points.length);
    assert.ok(points.every(p => p.toArray().every(Number.isFinite)));
    assert.ok(path.radii.every(r => r > 0 && r <= .0012));
    assert.ok(points.every((p, i) => p.distanceTo(path.straight[i]) < 1e-12));
  }
});

test("the LT route uses the upper inlet branch and crosses the charge radiator's open air cell", () => {
  const path=paths.find(p=>p.id==="cooling-lt"),pack=model.root.getObjectByName("Charge low-temperature radiator");
  assert.ok(path.corner[0].x>.6&&path.corner[0].y>.552);
  assert.ok(path.corner.at(-1).x< -2.1);
  const core=path.corner.map(p=>pack.worldToLocal(p.clone())).filter(p=>Math.abs(p.x)<.148&&Math.abs(p.y)<.006&&Math.abs(p.z)<.075);
  assert.ok(core.length>=5,"the LT flow bypasses the heat-exchanger core");
  assert.ok(core.some(p=>p.y>.004)&&core.some(p=>p.y<-.004));
  for(const p of core){assert.ok(Math.abs(p.x+.074)<.00005);assert.ok(Math.abs(p.z+.00015)<.00005);}
  assert.equal(path.radii.length,path.corner.length);
  assert.ok(path.corner.every((p,i)=>p.equals(path.straight[i])));
});

test("cooling tubes fit through the installed geometry including coolant tubes and folded fins", () => {
  const ray = new T.Raycaster(), a = new T.Vector3(), b = new T.Vector3(), direction = new T.Vector3(), errors = [];
  assert.equal(published.length,paths.length);
  for(const path of published){
    const expected=paths.find(p=>p.id===path.id);assert.ok(expected);assert.equal(path.corner.length,expected.corner.length);
    for(let i=0;i<path.corner.length;i++)assert.ok(path.corner[i].distanceTo(expected.corner[i])<.00006,`${path.id}: published route is stale`);
  }
  for (const path of published) for (let i = 1; i < path.corner.length; i++) {
    const from = path.corner[i - 1], to = path.corner[i], r = Math.max(path.radii[i - 1], path.radii[i]) + .0001;
    const bounds = new T.Box3().setFromPoints([from, to]).expandByScalar(r);
    const candidates = meshes.filter(m => m.bounds.intersectsBox(bounds)).map(m => m.part);
    for (const offset of [[0, 0, 0], ...[0, 1, 2].flatMap(axis => [-r, r].map(value => [0, 1, 2].map(k => axis === k ? value : 0)))]) {
      a.copy(from).add(new T.Vector3(...offset)); b.copy(to).add(new T.Vector3(...offset)); direction.subVectors(b, a);
      ray.set(a, direction.clone().normalize()); ray.far = direction.length();
      const hit = ray.intersectObjects(candidates, false)[0];
      if (hit) errors.push(`${path.id} segment ${i}: ${hit.object.name} at ${hit.point.toArray()}`);
    }
  }
  assert.deepEqual(errors, []);
});

test("prepared cooling paths retain their narrow core sections and reject malformed radii", () => {
  const asset = { version: 1, paths: paths.map(path => ({ id: path.id, layer: path.layer, radii: path.radii, states: [path.corner.flatMap(p => p.toArray())] })) };
  const loaded = decodeAirflowPaths(asset);
  for (const [i, path] of loaded.entries()) for (let t = 0; t <= 1; t += .003) {
    assert.ok(sampleAirflowPoint(path, t, .7).distanceTo(sampleAirflowPoint(paths[i], t, .7)) < 1e-12);
    assert.equal(airflowRadius(path, t), airflowRadius(paths[i], t));
  }
  for (const radii of [[.001], [NaN, .001], [-.001, .001]]) {
    assert.throws(() => decodeAirflowPaths({ version: 1, paths: [{ id: "bad", layer: "cooling", radii, states: [[0, 0, 0, 1, 1, 1]] }] }));
  }
});
