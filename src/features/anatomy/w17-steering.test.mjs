import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { createW17 } from "./w17-geometry.ts";
import { createModelInstance } from "./w17-model-cache.ts";

const model = createW17(); model.root.updateMatrixWorld(true);
const part = name => model.root.getObjectByName(name);
const system = part("Complete steering mechanism"), vector = p => new T.Vector3(...p);
const bounds = p => new T.Box3().setFromObject(p);

test("steering has supported straight shafts and a complete rack mechanism", () => {
  for (const name of ["Steering upper shaft", "Steering lower shaft", "Steering universal cross", "Steering pinion", "Steering rack teeth", "Steering assist piston", "Steering rack housing", "Steering rack mount -1", "Steering rack mount 1", "Steering column bearing upper", "Steering column bearing lower"]) {
    assert.ok(part(name)?.isMesh, `missing ${name}`);
  }
  assert.equal(part("Steering column"), undefined, "a curved tube still substitutes for a rotating shaft");
});

test("column, universal joint and pinion form straight connected torque paths", () => {
  const { input, joint, pinion } = system.userData.column, cross = bounds(part("Steering universal cross")).getCenter(new T.Vector3());
  assert.ok(cross.distanceTo(vector(joint)) < 1e-8);
  for (const [name, from, to] of [["upper shaft", input, joint], ["lower shaft", joint, pinion]]) {
    const shaft = part(`Steering ${name}`), line = new T.Line3(vector(from), vector(to));
    for (const p of shaft.userData.axis.map(vector)) assert.ok(line.closestPointToPoint(p, false, new T.Vector3()).distanceTo(p) < 1e-9, `${name}: bent shaft`);
    for (const key of ["upper", "lower"]) if (name.startsWith(key)) {
      const p = vector(system.userData[`${key}Bearing`]);
      assert.ok(line.closestPointToPoint(p, false, new T.Vector3()).distanceTo(p) < 1e-9, "bearing does not share shaft axis");
    }
  }
  assert.ok(bounds(part("Quick release boss")).containsPoint(vector(input)), "wheel boss is detached from the column");
  assert.ok(bounds(part("Steering upper shaft")).intersectsBox(bounds(part("Steering universal upper hub"))));
  assert.ok(bounds(part("Steering lower shaft")).intersectsBox(bounds(part("Steering universal lower hub"))));
  const direction = vector(system.userData.pinion.axis), actual = vector(pinion).sub(vector(joint)).normalize();
  assert.ok(direction.dot(actual) > .999999999);
  assert.ok(bounds(part("Steering rack teeth")).intersectsBox(bounds(part("Steering pinion"))), "pinion cannot reach the rack teeth");
});

test("rack and column mounts seat in the structural tub while tie-rod hardpoints stay fixed", () => {
  const cell = part("Forward survival cell deck");
  for (const side of [-1, 1]) {
    const mount = part(`Steering rack mount ${side}`), p = vector(mount.userData.seat);
    const hit = new T.Raycaster(p.clone().add(new T.Vector3(0, -.020, 0)), new T.Vector3(0, 1, 0), 0, .040).intersectObject(cell)[0];
    assert.ok(hit && bounds(mount).containsPoint(hit.point), "rack mount floats off the structural skin");
    for (const [a, b] of [[mount, part(`Steering rack pedestal ${side}`)], [part(`Steering rack pedestal ${side}`), part(`Steering rack clamp ${side}`)]]) assert.ok(bounds(a).intersectsBox(bounds(b)), "detached mounting hardware");
    assert.deepEqual(part(`Front ${side} track rod`).userData.anchor, [1.48, .28, side * .25]);
    assert.ok(bounds(part(`Steering rack joint ${side}`)).containsPoint(new T.Vector3(1.48, .28, side * .25)));
    const stay = part(`Steering column lower stay ${side}`), insert = part(`Steering column lower chassis insert ${side}`);
    assert.ok(bounds(stay).intersectsBox(bounds(insert)));
    assert.ok(bounds(stay).intersectsBox(bounds(part("Steering column bearing lower"))));
  }
});

const obstacles = [], occupied = bounds(system).expandByScalar(.01);
model.root.traverse(o => {
  if (!o.isMesh || o.isInstancedMesh || o.userData.component === "steering") return;
  const box = bounds(o); if (!box.intersectsBox(occupied)) return;
  const p = o.geometry.attributes.position, ix = o.geometry.index, triangles = [];
  for (let i = 0; i < (ix?.count ?? p.count); i += 3) {
    const v = [0, 1, 2].map(j => new T.Vector3().fromBufferAttribute(p, ix ? ix.getX(i + j) : i + j).applyMatrix4(o.matrixWorld));
    const box = new T.Box3().setFromPoints(v); if (box.intersectsBox(occupied)) triangles.push({ box, triangle: new T.Triangle(...v) });
  }
  obstacles.push({ o, box, triangles });
});

test("steering shafts and local fluid pipes clear real surrounding surfaces at their full radius", () => {
  const errors = new Set(), nearest = new T.Vector3();
  const lines = [part("Steering upper shaft"), part("Steering lower shaft"), ...system.children.filter(o => o.userData.route)];
  for (const mesh of lines) {
    const { route, axis, outerRadius = .007 } = mesh.userData;
    const points = route ? new T.CatmullRomCurve3(route.map(vector), false, "centripetal").getSpacedPoints(180) : Array.from({ length: 120 }, (_, i) => vector(axis[0]).lerp(vector(axis[1]), i / 119));
    for (const p of points) for (const ob of obstacles) {
      if (ob.box.distanceToPoint(p) > outerRadius + .0002) continue;
      if (ob.triangles.some(t => t.box.distanceToPoint(p) < outerRadius + .0002 && t.triangle.closestPointToPoint(p, nearest).distanceTo(p) < outerRadius + .0002)) errors.add(`${mesh.name} / ${ob.o.name}`);
    }
  }
  assert.deepEqual([...errors], []);
});

test("assist pipes end at real drilled fittings and retain a smooth bore", () => {
  for (const mesh of system.children.filter(o => o.userData.route)) {
    const { route, from, to, outerRadius } = mesh.userData, a = system.userData.ports[from], b = system.userData.ports[to];
    assert.deepEqual(route[0], a.point); assert.deepEqual(route.at(-1), b.point);
    const curve = new T.CatmullRomCurve3(route.map(vector), false, "centripetal");
    assert.ok(curve.getTangent(0).dot(vector(a.axis)) > .99);
    assert.ok(curve.getTangent(1).dot(vector(b.axis)) < -.99);
    const points = curve.getSpacedPoints(200);
    for (let i = 1; i < points.length - 1; i++) {
      const ab = points[i].clone().sub(points[i - 1]), bc = points[i + 1].clone().sub(points[i]), ac = points[i + 1].distanceTo(points[i - 1]);
      const cross = new T.Vector3().crossVectors(ab, bc).length();
      if (cross > 1e-12) assert.ok(ab.length() * bc.length() * ac / (2 * cross) > outerRadius * 1.1, `${mesh.name}: pinched bend`);
    }
  }
  for (const [name, z] of [["Steering assist cylinder", .053], ["Steering assist cylinder", .137], ["Steering assist valve block", .060], ["Steering assist valve block", .096]]) {
    const p = new T.Vector3(name.includes("cylinder") ? 1.505 : 1.481, name.includes("cylinder") ? .280 : .317, z);
    assert.equal(new T.Raycaster(p, new T.Vector3(-1, 0, 0), 0, .013).intersectObject(part(name)).length, 0, `${name}: union ends on a closed wall`);
  }
});

test("the wheel and complete rack share the steering explanation with removable housings", () => {
  const detail = createModelInstance("steering");
  for (const name of ["Steering wheel carbon face", "Steering display", "Quick release boss", "Steering universal cross", "Steering pinion", "Steering assist piston", "Front -1 track rod", "Front 1 track rod"]) assert.ok(detail.root.getObjectByName(name), `${name} missing in shared detail`);
  for (const name of ["Steering rack housing", "Steering assist cylinder", "Steering pinion housing", "Steering pinion cover -1", "Steering rack bellows 1"]) assert.equal(part(name).userData.serviceCover, true);
  for (const name of ["Steering pinion", "Steering rack teeth", "Steering assist piston", "Steering column bearing lower"]) assert.equal(part(name).userData.serviceCover, false);
  assert.equal(part("Steering wheel carbon face").userData.internal, false);
});
