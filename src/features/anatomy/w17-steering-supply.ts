import * as T from "three";
import { openRadialPort } from "./w17-wastegate.ts";
import { cleanSteeringBoreSeams } from "./w17-steering.ts";
import { createSurfaceSampler } from "./w17-surface.ts";
import { hydraulicManifoldPoint } from "./w17-hydraulics.ts";

type V = [number, number, number];
type Materials = Record<"metal" | "cast" | "darkMetal" | "rubber" | "black", T.Material>;
const vec = (p: V) => new T.Vector3(...p);

// Reconstructed installation: Mercedes does not publish W17 hydraulic routing.
// The two lines run below the exhaust, then enter the structural steering bay.
export function connectSteeringSupply(car: T.Group, hydraulics: T.Group, steering: T.Group, mat: Materials) {
  const root = new T.Group(); root.name = "Steering supply installation"; hydraulics.add(root);
  const ports: Record<string, { point: V; axis: V; mesh: string }> = {};
  const add = (name: string, geometry: T.BufferGeometry, material = mat.metal, parent = root) => {
    const mesh = new T.Mesh(geometry, material); mesh.name = `Hydraulic steering ${name}`;
    mesh.userData = { component: parent === steering ? "steering" : "hydraulics", internal: true, steeringSupply: parent === root, installedOnly: parent === root };
    mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh;
  };
  const ring = (name: string, a: V, b: V, inner: number, outer: number, material = mat.metal, parent = root) => {
    const axis = vec(b).sub(vec(a));
    const geometry = new T.LatheGeometry([[inner, 0], [outer, 0], [outer, axis.length()], [inner, axis.length()], [inner, 0]].map(([r, y]) => new T.Vector2(r, y)), 24);
    const mesh = add(name, geometry, material, parent); mesh.position.set(...a);
    mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), axis.normalize()); return mesh;
  };
  const bore = (mesh: T.Mesh, point: V, axis: V, radius: number, split = 0) => {
    mesh.updateWorldMatrix(true, false);
    const frame = new T.Matrix4().compose(vec(point), new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 0, 1), vec(axis).normalize()), new T.Vector3(1, 1, 1));
    const transform = frame.clone().invert().multiply(mesh.matrixWorld);
    mesh.geometry.applyMatrix4(transform); openRadialPort(mesh, [0, 0], radius, 1, split);
    mesh.geometry.applyMatrix4(transform.invert()); mesh.geometry.computeVertexNormals();
  };
  const port = (name: string, point: V, axis: V, parent: T.Group, radius: number) => {
    const end = vec(point), direction = vec(axis);
    const union = ring(`${name} union`, end.clone().addScaledVector(direction, -.010).toArray() as V, point, radius * .72, radius + .0015, mat.metal, parent);
    ring(`${name} nut`, end.clone().addScaledVector(direction, -.009).toArray() as V, end.clone().addScaledVector(direction, -.005).toArray() as V, radius * .72, radius + .0025, mat.darkMetal, parent);
    ports[name] = { point, axis, mesh: union.name };
  };
  const base: V[] = [
    [-1.306,.391,.148],[-1.306,.391,.168],[-1.306,.378,.184],[-1.30,.35,.19],[-1.20,.31,.205],[-1.15,.31,.215],[-1.02,.31,.26],
    [-.90,.25,.28],[-.68,.245,.31],[-.48,.245,.32],[-.32,.205,.32],[-.15,.215,.32],[0,.27,.30],
    [.4,.28,.26],[.55,.30,.26],[.60,.30,.28],[.66,.30,.30],[.688,.30,.288],[.70,.30,.26],[.70,.30,.245],[.70,.30,.215],[.70,.30,.150],[.70,.30,.120],
    [.79,.40,.105],[.92,.42,.105],[1,.42,.105],[1.08,.42,.105],[1.16,.42,.105],
    [1.3,.37,.105],[1.39,.316,.071],[1.412,.316,.071],[1.432,.316,.071],
  ];
  const bayEntries: { point: T.Vector3; tangent: T.Vector3; radius: number }[] = [];
  for (const [label, radius, dy, rearX, frontZ] of [["pressure", .0025, 0, -1.306, .071], ["return", .003, -.014, -1.270, .091]] as const) {
    const route = base.map(p => [...p] as V);
    if (label === "return") {
      route.forEach((p, i) => { if (i < 2) p[0] = rearX; else { p[1] += dy; if (i < 7) { p[0] += .025; p[2] -= .012; } } });
      route[1] = [rearX,.391,.164];
      route[2] = [-1.264,.380,.180];
      route[3] = [-1.262,.350,.184];
      for (const i of [7,8]) route[i][2] -= .005;
      // Pass outside the widened timing housing before following the block.
      route[6][2]+=.012;route[7][2]+=.010;
      for(const i of [6,7])route[i][1]-=.014;
      for (let i = route.length - 3; i < route.length; i++) route[i] = [base[i][0], .316, frontZ];
    }
    // Only the rear service loop follows the relocated block. The supported
    // forward route and its structural feedthroughs retain their installation.
    const rear = hydraulicManifoldPoint(route[0]);
    const serviceLoop: V[] = label === "pressure"
      ? [[rear[0], rear[1], rear[2] + .014], [-1.320, .449, .088], [-1.278, .448, .100], [-1.252, .435, .160], [-1.220, .410, .185], [-1.195, .360, .205]]
      : [[rear[0], rear[1], rear[2] + .016], [-1.286, .420, .085], [-1.267, .422, .122], [-1.250, .414, .167], [-1.220, .384, .180], [-1.190, .342, .190]];
    route.splice(0, 5, rear, ...serviceLoop);
    const from = `${label} manifold`, to = `${label} valve`;
    port(from, route[0], [0, 0, 1], hydraulics, radius);
    port(to, route.at(-1)!, [-1, 0, 0], steering, radius);
    // Replace two gallery plugs with actual take-offs, not stacked fittings.
    const plug = car.getObjectByName(`Hydraulic manifold gallery plug ${rearX}`);
    if (plug) { plug.removeFromParent(); if (plug instanceof T.Mesh) plug.geometry.dispose(); }
    const manifold=car.getObjectByName("Hydraulic control manifold") as T.Mesh;
    if(!manifold.userData.steeringGalleries)bore(manifold, hydraulicManifoldPoint([rearX,.391,.108]), [0,0,1], radius*.72);
    bore(car.getObjectByName("Steering assist valve block") as T.Mesh, [1.458,.316,frontZ], [-1,0,0], radius*.72);
    bore(car.getObjectByName("Steering assist valve sleeve") as T.Mesh, [1.458,.316,frontZ], [-1,0,0], radius*.72);
    const curve = new T.CatmullRomCurve3(route.map(vec), false, "centripetal");
    const section = new T.Shape(); section.absarc(0,0,radius,0,Math.PI*2,false);
    const hole = new T.Path(); hole.absarc(0,0,radius*.72,0,Math.PI*2,true); section.holes.push(hole);
    const line = add(`${label} line`, new T.ExtrudeGeometry(section, { extrudePath: curve, steps: 440, curveSegments: 8, bevelEnabled: false }), mat.black);
    line.userData = { ...line.userData, route, outerRadius: radius, from, to };
    for (const [name, end] of [["rear", ports[from]], ["front", ports[to]]] as const) {
      ring(`${label} crimp ${name}`, end.point, vec(end.point).addScaledVector(vec(end.axis), .010).toArray() as V, radius, radius+.001);
    }
    // Each structural penetration has a local bore; the opposite wall stays.
    for (const name of ["Lower side enclosure 1", "Front suspension keel"]) bore(car.getObjectByName(name) as T.Mesh, [.70,.30+dy,0], [0,0,1], .006);
    const samples = curve.getSpacedPoints(1000);
    // Locate the same local crossing regardless of the length of the rear hose.
    let lo = 0, hi = 1;
    for (let i = 0; i < 40; i++) { const mid = (lo+hi)/2; if (curve.getPoint(mid).x < .754) lo = mid; else hi = mid; }
    const t = (lo+hi)/2;
    bayEntries.push({ point: curve.getPoint(t), tangent: curve.getTangent(t), radius });
    for (const name of ["Front suspension keel", "Survival cell lower shell"]) bore(car.getObjectByName(name) as T.Mesh, [.99,.42+dy,.105], [1,0,0], .006);
    for (const [name, a, b] of [
      ["side sleeve", [.70,.30+dy,.185], [.70,.30+dy,.233]],
      ["bay sleeve", [1.034,.42+dy,.105], [1.044,.42+dy,.105]],
    ] as [string,V,V][]) ring(`${label} ${name}`, a, b, radius+.0004, .0055, mat.rubber);
    // Clips are seated on real structural surfaces and share the line tangent.
    for (const [i, targetX, bodyName] of [
      // Seat the middle pair on casting webs between the liner openings.
      [0,-.90,"Engine timing case wall"],[1,-.65,"Cast V6 crankcase"],[2,-.55,"Cast V6 crankcase"],
      [3,.10,"Lower side enclosure 1"],[4,.40,"Lower side enclosure 1"],[5,.50,"Lower side enclosure 1"],
      [6,1.20,"Forward survival cell deck"],
    ] as const) {
      const at = samples.findIndex((p,j) => j > 0 && p.x >= targetX && samples[j-1].x < targetX);
      const p = samples[at], d = samples[at+1].clone().sub(samples[at-1]).normalize();
      const clip = ring(`${label} clip ${i}`, p.clone().addScaledVector(d,-.004).toArray() as V, p.clone().addScaledVector(d,.004).toArray() as V, radius+.0005, radius+.0020, mat.darkMetal);
      const body = car.getObjectByName(bodyName) as T.Mesh, surface = createSurfaceSampler([body], "z"), z = surface(p.x,p.y,1);
      if (z === undefined) throw new Error(`Missing steering hose support on ${bodyName}`);
      const seat: V = [p.x,p.y,z], end = p.clone(); end.z += (z < p.z ? -1 : 1) * (radius+.0015);
      const start = vec(seat); start.z += (z < p.z ? -1 : 1)*.001;
      const arm = add(`${label} clip carrier ${i}`, new T.BoxGeometry(.010,.006,Math.abs(end.z-start.z)),mat.cast);
      arm.position.copy(start).add(end).multiplyScalar(.5); arm.userData.seat = { point: seat, body: bodyName };
      clip.userData.carrier = arm.name;
      ring(`${label} clip fixing ${i}`, [p.x,p.y,z-.002], [p.x,p.y,z+.003], .0009,.0023);
    }
  }
  // A shared two-line gland avoids a fragile 1 mm carbon web between holes.
  const entry = bayEntries[0].point.clone().add(bayEntries[1].point).multiplyScalar(.5);
  bore(car.getObjectByName("Forward survival cell deck") as T.Mesh, [.80,entry.y,entry.z], [-1,0,0], .015);
  const gland = add("bay entry gland", new T.CylinderGeometry(.0155,.0155,.008,40), mat.rubber);
  gland.position.copy(entry); gland.rotation.z = -Math.PI/2;
  for (const { point, tangent, radius } of bayEntries) bore(gland,point.toArray() as V,tangent.toArray() as V,radius+.0005,-.030);
  cleanSteeringBoreSeams(["Forward survival cell deck", "Front suspension keel", "Survival cell lower shell"].map(name => car.getObjectByName(name) as T.Mesh));
  root.userData.ports = ports;
  car.updateMatrixWorld(true);
}
