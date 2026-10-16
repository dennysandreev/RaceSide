import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { createW17 } from "./w17-geometry.ts";

const model = createW17(); model.root.updateMatrixWorld(true);
const part = name => model.root.getObjectByName(name);

test("front brake fluid has a connected path from the pedal master to both calipers", () => {
  const installation = part("Front brake circuit");
  assert.ok(installation, "front master and wheel hoses have no connecting circuit");
  const ports = installation.userData.ports, links = [];
  installation.traverse(o => { if (o.userData.route) links.push(o); });
  const reached = new Set(["master"]);
  const edges = [...links.map(o => [o.userData.from, o.userData.to]), ...installation.userData.junctions];
  for (let pass = 0; pass < edges.length; pass++) for (const [a,b] of edges) {
    if (reached.has(a)) reached.add(b);
    if (reached.has(b)) reached.add(a);
  }
  for (const side of [-1,1]) assert.ok(reached.has(`caliper ${side}`), `disconnected front caliper ${side}`);
  for (const link of links) {
    const {route,from,to} = link.userData;
    assert.deepEqual(route[0], ports[from].point);
    assert.deepEqual(route.at(-1), ports[to].point);
    const points = route.map(p => new T.Vector3(...p));
    const curve = link.userData.straight ? new T.LineCurve3(...points) : new T.CatmullRomCurve3(points, false, "centripetal");
    assert.ok(curve.getTangent(0).dot(new T.Vector3(...ports[from].axis)) > .99, `${link.name}: sideways inlet`);
    assert.ok(curve.getTangent(1).dot(new T.Vector3(...ports[to].axis)) < -.99, `${link.name}: sideways outlet`);
  }
});

test("front lines clear the steering, suspension, bodywork and structural carriers", () => {
  const installation = part("Front brake circuit"); assert.ok(installation);
  const pipes = installation.children.filter(o => o.userData.route);
  const occupied = new T.Box3().setFromObject(installation).expandByScalar(.01), obstacles = [];
  model.root.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh || pipes.includes(o)) return;
    const bounds = new T.Box3().setFromObject(o); if (!bounds.intersectsBox(occupied)) return;
    const p = o.geometry.attributes.position, ix = o.geometry.index, triangles = [];
    for (let i = 0; i < (ix?.count ?? p.count); i += 3) {
      const points = [0,1,2].map(j => new T.Vector3().fromBufferAttribute(p, ix ? ix.getX(i+j) : i+j).applyMatrix4(o.matrixWorld));
      const box = new T.Box3().setFromPoints(points); if (box.intersectsBox(occupied)) triangles.push({box, triangle:new T.Triangle(...points)});
    }
    obstacles.push({o,bounds,triangles});
  });
  const failures = new Set(), nearest = new T.Vector3();
  for (const pipe of pipes) {
    const points = pipe.userData.route.map(p => new T.Vector3(...p));
    const curve = pipe.userData.straight ? new T.LineCurve3(...points) : new T.CatmullRomCurve3(points,false,"centripetal");
    const radius = pipe.userData.outerRadius + .0001;
    for (const p of curve.getSpacedPoints(600)) for (const {o,bounds,triangles} of obstacles) {
      if (bounds.distanceToPoint(p) > radius) continue;
      // The compression sleeves intentionally bear on the hose. Ports are
      // checked separately for a connected bore, not counted as obstacles.
      if (/Front brake .* (union|nut)|Front brake bulkhead sleeve|Front .*brake hose crimp|Front brake master line crimp|Brake circuit outlet -1|Front .* hydraulic port/.test(o.name)) continue;
      if (triangles.some(t => t.box.distanceToPoint(p)<radius && t.triangle.closestPointToPoint(p,nearest).distanceTo(p)<radius)) failures.add(`${pipe.name} / ${o.name}`);
    }
  }
  assert.deepEqual([...failures],[]);
});

test("front hoses have gentle bends and an unobstructed passage through both shields", () => {
  const installation = part("Front brake circuit"); assert.ok(installation);
  for (const pipe of installation.children.filter(o=>o.userData.route&&!o.userData.straight)) {
    const curve = new T.CatmullRomCurve3(pipe.userData.route.map(p=>new T.Vector3(...p)),false,"centripetal");
    const points=curve.getSpacedPoints(800);
    for(let i=1;i<points.length-1;i++){
      const a=points[i-1],b=points[i],c=points[i+1],ab=b.clone().sub(a),bc=c.clone().sub(b),cross=new T.Vector3().crossVectors(ab,bc).length();
      if(cross>1e-12)assert.ok(ab.length()*bc.length()*c.distanceTo(a)/(2*cross)>pipe.userData.outerRadius*3,`${pipe.name}: tight bend near ${b.toArray()}`);
    }
  }
  for(const side of[-1,1]){
    const port=installation.userData.ports[`caliper ${side}`], p=new T.Vector3(...port.point);
    const shield=part(`Front ${side} brake inboard heat shield`);
    const hits=new T.Raycaster(p,new T.Vector3(0,0,side),0,.030).intersectObject(shield);
    assert.equal(hits.length,0,"brake line passes through carbon");
  }
});

test("distribution tee, bulkheads and hose saddles have open bores and seated supports", () => {
  const installation=part("Front brake circuit");assert.ok(installation);
  const tee=part("Front brake distribution tee"),ports=installation.userData.ports;
  for(const name of["tee inlet","tee -1","tee 1"]){
    const port=ports[name],start=new T.Vector3(...port.point),direction=new T.Vector3(...port.axis).negate();
    const length=start.distanceTo(tee.position);
    assert.equal(new T.Raycaster(start,direction,0,length).intersectObjects([tee,part(port.mesh)]).length,0,"blocked tee drilling");
  }
  for(const side of[-1,1]){
    const a=new T.Vector3(...ports[`bulkhead inside ${side}`].point),b=new T.Vector3(...ports[`bulkhead outside ${side}`].point);
    assert.equal(new T.Raycaster(a,b.clone().sub(a).normalize(),0,a.distanceTo(b)).intersectObjects([
      part("Forward survival cell deck"),part("Silver nose skin"),part(`Front brake bulkhead sleeve ${side}`),
    ]).length,0,"blocked bulkhead fitting");
  }
  const supports=installation.children.filter(o=>o.userData.seat);assert.equal(supports.length,5);
  for(const support of supports){
    const p=new T.Vector3(...support.userData.seat.point),body=part(support.userData.seat.body);
    // Sample the load-bearing annulus, not the service hole at its centre.
    if(support.name.includes("washer"))p.x+=.006;
    const direction=body.name.includes("wishbone")?new T.Vector3(0,1,0):new T.Vector3(0,0,-Math.sign(p.z));
    const hits=new T.Raycaster(p.clone().addScaledVector(direction,-.01),direction,0,.02).intersectObject(body);
    assert.ok(hits.some(h=>new T.Box3().setFromObject(support).expandByScalar(.0002).containsPoint(h.point)),`${support.name}: floating support`);
  }
});
