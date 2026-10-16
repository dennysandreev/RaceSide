import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { createW17 } from "./w17-geometry.ts";
import { createModelInstance, visibleInPowertrain } from "./w17-model-cache.ts";

const model = createW17(); model.root.updateMatrixWorld(true);
const root = model.root.getObjectByName("Steering supply installation"), part = name => model.root.getObjectByName(name);
const pipes = root.children.filter(o => o.userData.route), vec = p => new T.Vector3(...p);
const curves = pipes.map(pipe => new T.CatmullRomCurve3(pipe.userData.route.map(vec), false, "centripetal"));

test("steering pressure and return terminate at retained manifold and valve fittings", () => {
  assert.equal(pipes.length, 2);
  pipes.forEach((pipe, i) => {
    const { route, from, to } = pipe.userData, a = root.userData.ports[from], b = root.userData.ports[to];
    assert.deepEqual(route[0], a.point); assert.deepEqual(route.at(-1), b.point);
    assert.ok(curves[i].getTangent(0).dot(vec(a.axis)) > .99);
    assert.ok(curves[i].getTangent(1).dot(vec(b.axis)) < -.99);
    for (const port of [a,b]) assert.ok(new T.Box3().setFromObject(part(port.mesh)).expandByScalar(.00001).containsPoint(vec(port.point)));
  });
  for (const x of [-1.306,-1.270]) assert.equal(part(`Hydraulic manifold gallery plug ${x}`), undefined);
});

const occupied = new T.Box3().setFromObject(root).expandByScalar(.01), obstacles = [];
model.root.traverse(o => {
  if (!o.isMesh || o.isInstancedMesh || pipes.includes(o)) return;
  const bounds = new T.Box3().setFromObject(o); if (!bounds.intersectsBox(occupied)) return;
  const p = o.geometry.attributes.position, ix = o.geometry.index, triangles = [];
  for (let i = 0; i < (ix?.count ?? p.count); i += 3) {
    const v = [0,1,2].map(j => new T.Vector3().fromBufferAttribute(p, ix ? ix.getX(i+j) : i+j).applyMatrix4(o.matrixWorld));
    const bounds = new T.Box3().setFromPoints(v); if (bounds.intersectsBox(occupied)) triangles.push({ bounds, triangle: new T.Triangle(...v) });
  }
  obstacles.push({ o, bounds, triangles });
});

test("both full-radius lines clear the engine, exhaust, radiators, skins and their own carriers", () => {
  const errors = new Set(), nearest = new T.Vector3();
  pipes.forEach((pipe,i) => {
    const radius = pipe.userData.outerRadius + .0001;
    for (const point of curves[i].getSpacedPoints(1800)) for (const ob of obstacles) {
      if (ob.bounds.distanceToPoint(point) > radius) continue;
      // The crimp compresses the hose at a real port; all carriers and sleeves
      // remain in this check, including those belonging to the same component.
      if (/Hydraulic steering .* (union|nut|crimp)/.test(ob.o.name)) continue;
      if (ob.triangles.some(t => t.bounds.distanceToPoint(point) < radius && t.triangle.closestPointToPoint(point, nearest).distanceTo(point) < radius)) errors.add(`${pipe.name} / ${ob.o.name}`);
    }
  });
  assert.deepEqual([...errors], []);
});

test("pressure and return have separate smooth bores and cannot cross each other", () => {
  const points = curves.map(curve => curve.getSpacedPoints(1800));
  points.forEach((line,i) => {
    for (let j = 1; j < line.length-1; j++) {
      const a = line[j-1], b = line[j], c = line[j+1], ab = b.clone().sub(a), bc = c.clone().sub(b), cross = new T.Vector3().crossVectors(ab,bc).length();
      if (cross > 1e-12) assert.ok(ab.length()*bc.length()*c.distanceTo(a)/(2*cross) > pipes[i].userData.outerRadius * 3, `${pipes[i].name}: tight bend`);
    }
  });
  const distance = pipes.reduce((sum,p) => sum+p.userData.outerRadius, 0) + .001;
  for (const a of points[0]) assert.ok(points[1].every(b => a.distanceToSquared(b) > distance*distance), "pressure and return hoses touch");
});

test("hose clips seat on structural surfaces and the drilled inlet and outlets stay open", () => {
  const carriers = root.children.filter(o => o.userData.seat);
  assert.equal(carriers.length, 14);
  for (const carrier of carriers) {
    const { point, body } = carrier.userData.seat, p = vec(point);
    const hits = new T.Raycaster(p.clone().add(new T.Vector3(0,0,.020)),new T.Vector3(0,0,-1),0,.040).intersectObject(part(body));
    assert.ok(hits.some(hit => new T.Box3().setFromObject(carrier).expandByScalar(.001).containsPoint(hit.point)), `${carrier.name}: floating carrier`);
  }
  for (const [name, start, direction, length] of [
    ...["pressure","return"].map(label => ["Hydraulic control manifold",root.userData.ports[`${label} manifold`].point,[0,0,-1],.018]),
    ...[.071,.091].map(z => ["Steering assist valve block",[1.432,.316,z],[1,0,0],.020]),
    ...[.30,.286].flatMap(y => ["Lower side enclosure 1","Front suspension keel"].map(name => [name,[.70,y,.24],[0,0,-1],.060])),
  ]) assert.equal(new T.Raycaster(vec(start),vec(direction),0,length).intersectObject(part(name)).length,0,`${name}: blocked bore`);
});

test("engine inspection omits the front installation and details retain the shared fitted parts", () => {
  const detail = createModelInstance("hydraulics"), steering = createModelInstance("steering");
  for (const pipe of pipes) {
    assert.equal(visibleInPowertrain(pipe), false);
    assert.equal(pipe.userData.installedOnly, true, "whole-car lines must not shrink the hydraulic-pack detail");
    assert.equal(detail.root.getObjectByName(pipe.name).geometry, createModelInstance().root.getObjectByName(pipe.name).geometry);
  }
  for (const port of Object.values(root.userData.ports)) {
    const inFront = port.mesh.includes("valve");
    assert.ok((inFront ? steering : detail).root.getObjectByName(port.mesh));
  }
  assert.equal(visibleInPowertrain(part("Hydraulic pump body")),true);
});
