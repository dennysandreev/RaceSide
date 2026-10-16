import * as T from "three";

type V = [number, number, number];
type Materials = Record<"metal" | "cast" | "darkMetal" | "carbon", T.Material>;

// One supported rocker per wheel. Dimensions are illustrative; the rod, rocker,
// damper eyes and fixed clevis use the same physical joint coordinates.
export function createInboardSuspension(front: boolean, side: number, mat: Materials) {
  const component = front ? "front-suspension" : "rear-suspension", prefix = `${front ? "Front" : "Rear"} ${side}`;
  const root = new T.Group(); root.name = `${prefix} inboard suspension`;
  const pivot: V = [front ? 1.19 : -1.43, front ? .510 : .409, side * (front ? .115 : .085)];
  const pushrod: V = [pivot[0] + .048, pivot[1] + .040, pivot[2]];
  const movingEye: V = [pivot[0] - .046, pivot[1] + .024, pivot[2]];
  const fixedEye: V = [front ? .900 : -1.715, front ? .500 : .477, pivot[2]];
  const add = (name: string, g: T.BufferGeometry, m: T.Material) => {
    const part = new T.Mesh(g, m); part.name = `${prefix} ${name}`; part.userData = { component, internal: true };
    part.castShadow = true; part.receiveShadow = true; root.add(part); return part;
  };
  const ring = (name: string, a: V, b: V, inner: number, outer: number, m = mat.metal) => {
    const axis = new T.Vector3(...b).sub(new T.Vector3(...a));
    const g = new T.LatheGeometry([[inner, 0], [outer, 0], [outer, axis.length()], [inner, axis.length()], [inner, 0]].map(([r, y]) => new T.Vector2(r, y)), 32);
    const part = add(name, g, m); part.position.set(...a); part.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), axis.normalize()); return part;
  };
  const box = (name: string, p: V, size: V, m = mat.cast) => { const part = add(name, new T.BoxGeometry(...size), m); part.position.set(...p); return part; };
  const eye = (name: string, p: V, width: number, radius = .012) => ring(name, [p[0], p[1], p[2] - width / 2], [p[0], p[1], p[2] + width / 2], .004, radius);
  const pin = (name: string, p: V, width: number) => {
    const part = add(name, new T.CylinderGeometry(.004, .004, width, 20), mat.darkMetal); part.position.set(...p); part.rotation.x = Math.PI / 2;
    for (const s of [-1, 1]) ring(`${name} washer ${s}`, [p[0], p[1], p[2] + s * (width / 2 - .002)], [p[0], p[1], p[2] + s * (width / 2 + .001)], .004, .007);
  };
  const bracket = (name: string, p: V, depth: number) => {
    // Drilled double-shear cheeks, continuous down to a bolted base plate.
    for (const s of [-1, 1]) {
      const shape = new T.Shape(); shape.moveTo(-.020, -depth); shape.lineTo(.020, -depth); shape.lineTo(.015, .005); shape.quadraticCurveTo(0, .025, -.015, .005); shape.closePath();
      const hole = new T.Path(); hole.absarc(0, 0, .004, 0, Math.PI * 2, true); shape.holes.push(hole);
      const g = new T.ExtrudeGeometry(shape, { depth: .006, bevelEnabled: false, curveSegments: 16 });
      g.translate(p[0], p[1], p[2] + s * .015 - .003); add(`${name} cheek ${s}`, g, mat.cast);
    }
    box(`${name} foot`, [p[0], p[1] - depth, p[2]], [.050, .008, .045]);
    for (const dx of [-.019, .019]) {
      const part = add(`${name} fixing ${dx}`, new T.CylinderGeometry(.0035, .0035, .020, 6), mat.metal); part.position.set(p[0] + dx, p[1] - depth, p[2]);
    }
    pin(`${name} pivot bolt`, p, .042);
  };
  bracket("rocker chassis bracket", pivot, front ? .042 : .051);
  bracket("damper chassis bracket", fixedEye, front ? .040 : .039);
  // Triangular rocker plates with bearings at all three kinematic points.
  const centre = new T.Vector2(pivot[0], pivot[1]);
  const outline = [movingEye, pivot, pushrod].map(p => new T.Vector2(p[0], p[1]));
  const shape = new T.Shape();
  for (let i = 0; i < outline.length; i++) {
    const p = outline[i], previous = outline[(i + 2) % 3], next = outline[(i + 1) % 3];
    const before = Math.atan2(p.y - previous.y, p.x - previous.x) - Math.PI / 2, after = Math.atan2(next.y - p.y, next.x - p.x) - Math.PI / 2;
    // convex hull offset of the three joint centres
    let span = after - before; while (span < 0) span += Math.PI * 2;
    if (!i) shape.moveTo(p.x + Math.cos(before) * .013, p.y + Math.sin(before) * .013);
    else shape.lineTo(p.x + Math.cos(before) * .013, p.y + Math.sin(before) * .013);
    shape.absarc(p.x, p.y, .013, before, before + span, false);
  }
  shape.closePath();
  for (const p of [pivot, pushrod, movingEye]) { const hole = new T.Path(); hole.absarc(p[0], p[1], .004, 0, Math.PI * 2, true); shape.holes.push(hole); }
  for (const s of [-1, 1]) {
    const g = new T.ExtrudeGeometry(shape, { depth: .004, bevelEnabled: false, curveSegments: 12 }); g.translate(0, 0, pivot[2] + s * .009 - .002);
    const rocker = add(`rocker plate ${s}`, g, mat.darkMetal); rocker.userData.pivot = [...pivot];
  }
  eye("rocker centre bearing", pivot, .014, .009);
  eye("pushrod spherical bearing", pushrod, .012); pin("pushrod clevis pin", pushrod, .027);
  eye("damper moving eye", movingEye, .012); pin("damper rocker pin", movingEye, .027);
  eye("damper fixed eye", fixedEye, .020); // its pin is shared with the fixed clevis
  const from = new T.Vector3(...movingEye), to = new T.Vector3(...fixedEye), direction = to.clone().sub(from).normalize(), length = from.distanceTo(to);
  const point = (d: number): V => from.clone().addScaledVector(direction, d).toArray() as V;
  const rod = add("damper piston rod", new T.CylinderGeometry(.006, .006, .090, 24), mat.metal);
  rod.position.copy(from).addScaledVector(direction, .012 + .045); rod.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), direction);
  ring("damper gland", point(.082), point(.094), .006, .018);
  ring("damper cylinder", point(.092), point(length - .023), .012, .020, mat.darkMetal);
  ring("damper end cap", point(length - .028), point(length - .012), .004, .020, mat.cast);
  ring("damper rear neck", point(length - .018), point(length - .008), .004, .008, mat.metal);
  const start = .093, end = length - .031;
  for (const [name, d] of [["adjustable", start], ["fixed", end]] as const) ring(`spring ${name} seat`, point(d - .004), point(d + .004), .020, .029, mat.cast);
  for (let i = 0; i < 7; i++) ring(`spring preload thread ${i}`, point(.083 + i * .003), point(.084 + i * .003), .020, .0215, mat.metal);
  const rotation = new T.Quaternion().setFromUnitVectors(new T.Vector3(1, 0, 0), direction), points: T.Vector3[] = [];
  for (let i = 0; i <= 140; i++) { const t = i / 140, a = t * Math.PI * 14; points.push(new T.Vector3(start + .002 + t * (end - start - .004), Math.cos(a) * .025, Math.sin(a) * .025).applyQuaternion(rotation).add(from)); }
  add("spring", new T.TubeGeometry(new T.CatmullRomCurve3(points), 140, .0025, 8, false), mat.metal);
  root.userData.joints = { pivot, pushrod, movingEye, fixedEye };
  root.userData.damperAxis = direction.toArray(); root.userData.rockerCentre = centre.toArray();
  return { root, pushrod };
}
