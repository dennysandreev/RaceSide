import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { createW17 } from "./w17-geometry.ts";
import { createModelInstance } from "./w17-model-cache.ts";

const model = createW17(); model.root.updateMatrixWorld(true);
const system = model.root.getObjectByName("Complete hydraulic system");
const part = name => model.root.getObjectByName(name);
const h = name => part(`Hydraulic ${name}`);
const vector = p => new T.Vector3(...p);
const box = o => new T.Box3().setFromObject(o);
const pipes = system.children.filter(o => o.userData.route);

test("the pressure circuit has a mounted pump, return tank, filter, valves and a retained accumulator", () => {
  for (const name of ["pump body", "reservoir wall", "reservoir baffle", "reservoir return standpipe", "pressure filter bowl", "control manifold", "accumulator shell", "accumulator separator piston", "shift valve torque-motor cover", "clutch valve torque-motor cover"]) {
    assert.ok(h(name), `missing ${name}`);
    const bounds = box(h(name)); assert.ok(bounds.min.toArray().concat(bounds.max.toArray()).every(Number.isFinite));
  }
  for (const [body, mount] of [["reservoir wall", "reservoir strap 0.338"], ["reservoir wall", "reservoir strap 0.378"], ["control manifold", "manifold pedestal -1.343"], ["control manifold", "manifold pedestal -1.237"], ["accumulator shell", "accumulator strap -1.314"], ["accumulator shell", "accumulator strap -1.369"], ["pressure filter bowl", "filter bracket"], ["selector cylinder", "selector fixed bracket"]]) {
    assert.ok(box(h(body)).expandByScalar(.0005).intersectsBox(box(h(mount))), `${body} floats above ${mount}`);
  }
  assert.ok(box(h("pump mounting flange")).intersectsBox(box(part("Engine timing end cover -0.938"))));
  assert.ok(box(h("selector casing insert")).intersectsBox(box(h("selector mount bridge"))));
  assert.ok(box(h("selector mount bridge")).intersectsBox(box(h("selector fixed bracket"))));
  for (const [body, insert] of [["manifold mounting foot -1.343", "manifold casing insert -1.343"], ["manifold mounting foot -1.237", "manifold casing insert -1.237"], ["accumulator saddle -1.314", "accumulator casing insert -1.314"], ["accumulator saddle -1.369", "accumulator casing insert -1.369"]]) {
    const carrier = h(insert), bounds = box(carrier);
    assert.ok(bounds.intersectsBox(box(h(body))), `${body}: detached carrier`);
    const origin = carrier.getWorldPosition(new T.Vector3()); origin.y = 1;
    const hit = new T.Raycaster(origin, vector([0, -1, 0])).intersectObject(part("Carbon gearbox casing"), false)[0];
    assert.ok(hit && bounds.clone().expandByScalar(.0001).containsPoint(hit.point), `${insert}: misses the actual gearbox skin`);
  }
});

test("all hydraulic hoses end in matching fittings and leave them tangentially without pinched bends", () => {
  assert.ok(pipes.length >= 8);
  for (const pipe of pipes) {
    const { route, from, to, outerRadius } = pipe.userData, a = system.userData.ports[from], b = system.userData.ports[to];
    assert.deepEqual(route[0], a.point); assert.deepEqual(route.at(-1), b.point);
    for (const end of [from, to]) assert.ok(part(portsName(end)), `${pipe.name}: loose end`);
    const curve = new T.CatmullRomCurve3(route.map(vector), false, "centripetal");
    assert.ok(curve.getTangent(0).dot(vector(a.axis)) > .99, `${pipe.name}: kink at start`);
    assert.ok(curve.getTangent(1).dot(vector(b.axis)) < -.99, `${pipe.name}: kink at end`);
    const points = curve.getSpacedPoints(160);
    for (let i = 1; i < points.length - 1; i++) {
      const ab = points[i].clone().sub(points[i - 1]), bc = points[i + 1].clone().sub(points[i]), ac = points[i + 1].distanceTo(points[i - 1]);
      const cross = new T.Vector3().crossVectors(ab, bc).length();
      if (cross > 1e-12) assert.ok(ab.length() * bc.length() * ac / (2 * cross) > outerRadius * 1.1, `${pipe.name}: pinched bend`);
    }
  }
});

function portsName(name){return system.userData.ports[name].union??`Hydraulic ${name} union`;}

test("reservoir and casing connections have actual bores instead of fittings on closed skins", () => {
  for (const [name, start, direction, length] of [
    ["Hydraulic reservoir wall", [-1.043, .337, .095], [-1, 0, 0], .020],
    ["Hydraulic reservoir lid", [-1.090, .405, .095], [0, -1, 0], .017],
    ["Carbon gearbox casing", [-1.184, .316, .077], [0, 0, -1], .040],
    ["Carbon gearbox casing", [-1.139, .195, .010], [-1, 0, 0], .022],
  ]) assert.equal(new T.Raycaster(vector(start), vector(direction), 0, length).intersectObject(part(name), false).length, 0, `${name}: blocked port`);
  assert.ok(new T.Raycaster(vector([-1.053, .360, .095]), vector([-1, 0, 0]), .001, .060).intersectObject(h("reservoir wall"), false).length, "opposite tank wall was removed");
  assert.equal(part("Hydraulic pan feedthrough collar"), undefined, "obsolete pan fitting floats inside the gearbox");
});

test("hydraulic actuators physically reach the clutch release ring and gear selector", () => {
  for (const [a, b] of [[h("clutch release bearing"), part("Clutch release ring")], [h("clutch slave piston"), h("clutch release bearing")], [h("selector barrel hub"), part("Gear selector barrel")], [h("selector indexing arm"), h("selector rod eye")], [h("selector piston rod"), h("selector rod eye")]]) {
    assert.ok(box(a).expandByScalar(.001).intersectsBox(box(b)), `${a.name} detached from ${b.name}`);
  }
  assert.ok(Math.abs(h("clutch slave housing").position.y - part("Gearbox input shaft").position.y) < 1e-9);
});

const occupied = new T.Box3().setFromObject(system), obstacles = [];
model.root.traverse(o => {
  if (!o.isMesh || o.isInstancedMesh || o.userData.route || /Hydraulic .* (crimp|union|sealing shoulder)/.test(o.name)) return;
  const bounds = box(o); if (!bounds.intersectsBox(occupied)) return;
  const p = o.geometry.attributes.position, index = o.geometry.index, triangles = [];
  for (let i = 0; i < (index?.count ?? p.count); i += 3) {
    const v = [0, 1, 2].map(j => new T.Vector3().fromBufferAttribute(p, index ? index.getX(i + j) : i + j).applyMatrix4(o.matrixWorld));
    const bounds = new T.Box3().setFromPoints(v); if (bounds.intersectsBox(occupied)) triangles.push({ bounds, triangle: new T.Triangle(...v) });
  }
  obstacles.push({ o, bounds, triangles });
});

test("hydraulic lines clear real surrounding surfaces and their own brackets", () => {
  const errors = new Set(), nearest = new T.Vector3();
  for (const pipe of pipes) {
    const { route, outerRadius } = pipe.userData, curve = new T.CatmullRomCurve3(route.map(vector), false, "centripetal");
    for (const point of curve.getSpacedPoints(300)) for (const obstacle of obstacles) {
      const radius = outerRadius + .0002;
      if (obstacle.bounds.distanceToPoint(point) > radius) continue;
      if ([pipe.userData.from,pipe.userData.to].some((name,i)=>obstacle.o.name===portsName(name)&&point.distanceTo(vector(i?route.at(-1):route[0]))<.007)) continue;
      if (obstacle.o.userData.component === "hydraulics" && Math.min(point.distanceTo(vector(route[0])), point.distanceTo(vector(route.at(-1)))) < .016) continue;
      if (obstacle.triangles.some(t => t.bounds.distanceToPoint(point) < radius && t.triangle.closestPointToPoint(point, nearest).distanceTo(point) < radius)) errors.add(`${pipe.name} / ${obstacle.o.name}`);
    }
  }
  assert.deepEqual([...errors], []);
});

test("hydraulic bodies, valves, fittings and mounts clear the bodywork and suspension surfaces", () => {
  const nearest = new T.Vector3(), errors = new Set();
  const bodies = system.children.filter(o => o.isMesh && !o.userData.route && /reservoir|accumulator|manifold|valve|gallery|solenoid|relief|pressure transducer|charging cap|selector/.test(o.name));
  for (const body of bodies) {
    const name = body.name, p = body.geometry.attributes.position, bounds = box(body).expandByScalar(.0007);
    for (const ob of obstacles.filter(ob => ["bodywork", "rear-suspension"].includes(ob.o.userData.component))) {
      if (!bounds.intersectsBox(ob.bounds)) continue;
      const triangles = ob.triangles.filter(t => t.bounds.intersectsBox(bounds));
      for (let i = 0; i < p.count; i++) {
        const point = new T.Vector3().fromBufferAttribute(p, i).applyMatrix4(body.matrixWorld);
        if (triangles.some(t => t.bounds.distanceToPoint(point) < .0007 && t.triangle.closestPointToPoint(point, nearest).distanceTo(point) < .0007)) { errors.add(`${name} / ${ob.o.name}`); break; }
      }
    }
  }
  assert.deepEqual([...errors], []);
});

test("the hydraulic detail reuses the installed assembly without losing connected components", () => {
  const car = createModelInstance(), detail = createModelInstance("hydraulics");
  for (const name of ["Hydraulic pump body", "Hydraulic reservoir wall", "Hydraulic control manifold", "Hydraulic accumulator shell", "Hydraulic clutch release bearing", "Hydraulic selector cylinder"]) {
    const a = car.root.getObjectByName(name), b = detail.root.getObjectByName(name);
    assert.equal(a.geometry, b.geometry); assert.notEqual(a.material, b.material);
    assert.ok(a.position.equals(b.position));
  }
});

test("LSD pressure and return galleries connect their supply ports while remaining separate",()=>{
  const manifold=h("control manifold"),probe=new T.Mesh(manifold.geometry,new T.MeshBasicMaterial({side:T.DoubleSide}));probe.matrixWorld.copy(manifold.matrixWorld);
  const plugs=system.children.filter(p=>p.name.startsWith("Hydraulic LSD ")&&(/gallery end plug|cross-drill plug|vertical drill plug|branch drill plug/.test(p.name)));
  const clear=(a,b)=>{
    const installed=p=>manifold.localToWorld(vector(p).sub(vector([-1.290,.392,.108])));
    const start=installed(a),direction=installed(b).sub(start),length=direction.length();
    const hits=new T.Raycaster(start,direction.normalize(),.00001,length-.00001).intersectObjects([probe,...plugs],false);
    assert.equal(hits.length,0,`blocked gallery ${a} -> ${b}`);
  };
  for(const x of[-1.239,-1.306]){
    clear([x,.391,.147],[x,.391,.121]);clear([x,.391,.121],[x,.397,.121]);clear([x,.397,.121],[-1.359,.397,.121]);
  }
  clear([-1.257,.378,.108],[-1.257,.385,.108]);clear([-1.257,.385,.108],[-1.257,.385,.095]);clear([-1.257,.385,.095],[-1.359,.385,.095]);
  clear([-1.270,.391,.147],[-1.270,.391,.095]);clear([-1.270,.391,.095],[-1.270,.385,.095]);
  for(const x of[-1.290,-1.280,-1.270]){
    const start=manifold.localToWorld(vector([x,.397,.121]).sub(vector([-1.290,.392,.108])));
    assert.ok(new T.Raycaster(start,vector([0,-1,0]),.00001,.006).intersectObject(probe,false).length,"P gallery opens into the lower cross-port");
  }
  probe.material.dispose();
});

test("the LSD feedthroughs have open passages through every crossed skin",()=>{
  const sleeves=system.children.filter(p=>p.userData.feedthrough);
  assert.equal(sleeves.length,4);
  assert.ok(sleeves.every(p=>!p.name.includes("rear panel")),"a grommet floats across the open cooling tail");
  for(const sleeve of sleeves){
    const {centre,axis,length,skins}=sleeve.userData.feedthrough,direction=vector(axis),start=vector(centre).addScaledVector(direction,-length/2-.002);
    for(const name of skins){
      const skin=part(name),probe=new T.Mesh(skin.geometry,new T.MeshBasicMaterial({side:T.DoubleSide}));probe.matrixWorld.copy(skin.matrixWorld);
      assert.equal(new T.Raycaster(start,direction,0,length+.004).intersectObject(probe,false).length,0,`${sleeve.name} rests on a closed ${name}`);
      probe.material.dispose();
    }
    assert.ok(sleeve.geometry.attributes.position.count>20);
  }
});
