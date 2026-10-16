import * as T from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { openRadialPort } from "./w17-wastegate.ts";
import { createSurfaceSampler } from "./w17-surface.ts";

type V = [number, number, number];
type Materials = Record<"metal" | "cast" | "darkMetal" | "rubber" | "carbon", T.Material>;
const vec = (p: V) => new T.Vector3(...p);

// Mercedes confirms assisted rack-and-pinion steering. The hidden dimensions,
// mounts and valve packaging below are reconstructed, not a W17 factory drawing.
export function createSteeringSystem(mat: Materials) {
  const root = new T.Group(); root.name = "Complete steering mechanism";
  const add = (name: string, geometry: T.BufferGeometry, material = mat.metal, cover = false) => {
    const part = new T.Mesh(geometry, material); part.name = `Steering ${name}`;
    part.userData = { component: "steering", internal: true, serviceCover: cover };
    part.castShadow = part.receiveShadow = true; root.add(part); return part;
  };
  const cylinder = (name: string, a: V, b: V, radius: number, material = mat.metal) => {
    const axis = vec(b).sub(vec(a));
    const part = add(name, new T.CylinderGeometry(radius, radius, axis.length(), 32), material);
    part.position.copy(vec(a)).addScaledVector(axis, .5); part.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), axis.normalize());
    part.userData.axis = [a, b]; return part;
  };
  const ring = (name: string, a: V, b: V, inner: number, outer: number, material = mat.metal, cover = false) => {
    const axis = vec(b).sub(vec(a));
    const part = add(name, new T.LatheGeometry([[inner, 0], [outer, 0], [outer, axis.length()], [inner, axis.length()], [inner, 0]].map(([r, y]) => new T.Vector2(r, y)), 40), material, cover);
    part.position.copy(vec(a)); part.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), axis.normalize()); return part;
  };
  const box = (name: string, position: V, size: V, material = mat.cast) => {
    const part = add(name, new RoundedBoxGeometry(...size, 2, .001), material); part.position.set(...position); return part;
  };
  const bolt = (name: string, a: V, b: V, cover = false) => {
    cylinder(`${name} shank`, a, b, .0018, mat.darkMetal).userData.serviceCover = cover;
    const d = vec(b).sub(vec(a)).normalize();
    ring(`${name} head`, b, vec(b).addScaledVector(d, .0025).toArray() as V, .0013, .003, mat.metal, cover);
  };
  const rackCentre: V = [1.48, .28, 0], joint: V = [.80, .445, 0], input: V = [.568, .515, 0];
  // The lower shaft and the pinion share one exact axis. Its universal-joint
  // centre sets the upper shaft's end, instead of bending a rotating tube.
  const delta = vec(rackCentre).sub(vec(joint));
  const angle = Math.atan2(delta.y, delta.x) + Math.asin(.021 / delta.length());
  const axis = new T.Vector3(Math.cos(angle), Math.sin(angle), 0), n = new T.Vector3(-axis.y, axis.x, 0);
  const centre = vec(rackCentre).addScaledVector(n, .021);
  const at = (d: number): V => centre.clone().addScaledVector(axis, d).toArray() as V;
  const upperAxis = vec(joint).sub(vec(input)).normalize();
  cylinder("upper shaft", input, vec(joint).addScaledVector(upperAxis, -.021).toArray() as V, .007);
  cylinder("lower shaft", vec(joint).addScaledVector(axis, .021).toArray() as V, at(-.018), .007);
  cylinder("pinion shaft", at(-.024), at(.028), .006, mat.darkMetal);
  ring("quick-release locking collar", [.536, .523, 0], [.558, .5175, 0], .0255, .030, mat.darkMetal);
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    cylinder(`quick-release grip ${i}`, [.537, .523 + Math.cos(a) * .029, Math.sin(a) * .029], [.555, .5185 + Math.cos(a) * .029, Math.sin(a) * .029], .0015);
  }

  // Two perpendicular trunnions, bored yokes and retained bearing caps.
  cylinder("universal cross", [.80, .445, -.013], [.80, .445, .013], .004, mat.darkMetal);
  const crossAxis = new T.Vector3(-axis.y, axis.x, 0);
  cylinder("universal cross trunnion", vec(joint).addScaledVector(crossAxis, -.013).toArray() as V, vec(joint).addScaledVector(crossAxis, .013).toArray() as V, .004, mat.darkMetal);
  for (const [label, direction, cross] of [["upper", upperAxis.clone().negate(), new T.Vector3(0, 0, 1)], ["lower", axis, crossAxis]] as const) {
    ring(`universal ${label} hub`, vec(joint).addScaledVector(direction, .018).toArray() as V, vec(joint).addScaledVector(direction, .029).toArray() as V, .007, .012, mat.cast);
    for (const side of [-1, 1]) {
      const p = vec(joint).addScaledVector(cross, side * .011);
      ring(`universal ${label} bearing ${side}`, p.clone().addScaledVector(cross, -.003).toArray() as V, p.clone().addScaledVector(cross, .003).toArray() as V, .004, .0075, mat.cast);
      cylinder(`universal ${label} cheek ${side}`, p.clone().addScaledVector(direction, .003).toArray() as V, vec(joint).addScaledVector(direction, .023).addScaledVector(cross, side * .008).toArray() as V, .004, mat.cast);
      cylinder(`universal ${label} cap ${side}`, p.clone().addScaledVector(cross, side * .003).toArray() as V, p.clone().addScaledVector(cross, side * .005).toArray() as V, .006, mat.darkMetal);
    }
  }
  const bearing = (name: string, p: T.Vector3, direction: T.Vector3) => {
    ring(`column bearing ${name}`, p.clone().addScaledVector(direction, -.007).toArray() as V, p.clone().addScaledVector(direction, .007).toArray() as V, .0072, .014, mat.cast);
    root.userData[`${name}Bearing`] = p.toArray();
  };
  bearing("upper", vec(input).lerp(vec(joint), .39), upperAxis);
  bearing("lower", vec(joint).lerp(centre, .72), axis);

  // The rack bar retains the previously checked inner tie-rod joint centres.
  cylinder("rack", [1.48, .28, -.25], [1.48, .28, .25], .0065, mat.darkMetal);
  const pitch = Math.PI * .002, profile = new T.Shape();
  profile.moveTo(-11 * pitch, .003); profile.lineTo(-11 * pitch, .0065);
  for (let i = -11; i < 11; i++) {
    const z = (i + .5) * pitch;
    profile.lineTo(z - .0020, .0065); profile.lineTo(z - .0009, .011);
    profile.lineTo(z + .0009, .011); profile.lineTo(z + .0020, .0065);
  }
  profile.lineTo(11 * pitch, .0065); profile.lineTo(11 * pitch, .003); profile.closePath();
  const basis = new T.Matrix4().makeBasis(new T.Vector3(0, 0, 1), n, axis.clone().negate());
  const teeth = new T.ExtrudeGeometry(profile, { depth: .012, bevelEnabled: false }); teeth.translate(0, 0, -.006); teeth.applyMatrix4(basis);
  add("rack teeth", teeth).position.set(...rackCentre);
  const gear = new T.Shape(), count = 12;
  for (let tooth = 0; tooth < count; tooth++) for (const [fraction, radius] of [[-.5, .0095], [-.32, .0095], [-.15, .014], [.15, .014], [.32, .0095], [.5, .0095]]) {
    const angle = -Math.PI / 2 + (tooth + fraction) * Math.PI * 2 / count;
    if (!tooth && fraction === -.5) gear.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
    else gear.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
  }
  gear.closePath(); const bore = new T.Path(); bore.absarc(0, 0, .006, 0, Math.PI * 2, true); gear.holes.push(bore);
  const pinion = new T.ExtrudeGeometry(gear, { depth: .012, bevelEnabled: false, curveSegments: 24 }); pinion.translate(0, 0, -.006); pinion.applyMatrix4(basis);
  add("pinion", pinion).position.copy(centre);
  root.userData.pinion = { centre: centre.toArray(), axis: axis.toArray(), pitchRadius: .012, rackPitch: pitch };

  ring("rack housing", [1.48, .28, -.177], [1.48, .28, -.030], .012, .016, mat.cast, true);
  ring("assist cylinder", [1.48, .28, .030], [1.48, .28, .180], .017, .020, mat.cast, true);
  ring("assist piston", [1.48, .28, .101], [1.48, .28, .111], .0065, .0166);
  ring("assist piston seal", [1.48, .28, .104], [1.48, .28, .108], .0164, .017, mat.rubber);
  for (const z of [.035, .175]) {
    ring(`assist gland ${z}`, [1.48, .28, z - .004], [1.48, .28, z + .004], .0065, .020, mat.darkMetal, true);
    ring(`assist rod seal ${z}`, [1.48, .28, z - .002], [1.48, .28, z + .002], .0065, .009, mat.rubber);
  }
  ring("pinion housing", at(-.020), at(.020), .027, .032, mat.cast, true);
  for (const side of [-1, 1]) {
    ring(`pinion cover ${side}`, at(side * .020), at(side * .025), .0062, .032, mat.cast, true);
    ring(`pinion bearing ${side}`, at(side * .010), at(side * .019), .006, .012, mat.darkMetal);
    for (let i = 0; i < 4; i++) {
      const angle = Math.PI / 4 + i * Math.PI / 2;
      const p = centre.clone().addScaledVector(n, Math.cos(angle) * .027).add(new T.Vector3(0, 0, Math.sin(angle) * .027));
      bolt(`pinion cover screw ${side} ${i}`, p.clone().addScaledVector(axis, side * .015).toArray() as V, p.clone().addScaledVector(axis, side * .026).toArray() as V, true);
    }
  }
  for (const side of [-1, 1]) {
    const points = [new T.Vector2(.012, 0), new T.Vector2(.020, 0)];
    for (let i = 0; i <= 48; i++) {
      const t = i / 48, r = .017 + .009 * Math.sin(Math.PI * t) * (.5 + .5 * Math.cos(t * Math.PI * 12));
      points.push(new T.Vector2(r, .004 + t * .060));
    }
    points.push(new T.Vector2(.012, .068), new T.Vector2(.008, .068), new T.Vector2(.008, 0), new T.Vector2(.012, 0));
    const boot = add(`rack bellows ${side}`, new T.LatheGeometry(points, 40), mat.rubber, true);
    boot.position.set(1.48, .28, side * .174); boot.rotation.x = side * Math.PI / 2;
    for (const z of [.177, .238]) ring(`bellows clamp ${side} ${z}`, [1.48, .28, side * (z - .0015)], [1.48, .28, side * (z + .0015)], z < .2 ? .019 : .011, z < .2 ? .0205 : .0125, mat.metal, true);
    ring(`rack guide bush ${side}`, [1.48, .28, side * .165], [1.48, .28, side * .180], .0065, .012, mat.darkMetal);
    ring(`rack joint locknut ${side}`, [1.48, .28, side * .237], [1.48, .28, side * .243], .0065, .010, mat.metal);
  }

  // Compact mechanical metering valve, with no electrical steering actuator.
  // Its long pressure/return branches are a separate installation task.
  box("assist valve block", [1.458, .316, .080], [.032, .024, .066]).userData.serviceCover = true;
  ring("assist valve sleeve", [1.458, .316, .042], [1.458, .316, .118], .003, .006, mat.darkMetal, true);
  cylinder("assist valve spool", [1.458, .316, .038], [1.458, .316, .122], .0028);
  for (const z of [.058, .080, .100]) cylinder(`assist metering land ${z}`, [1.458, .316, z - .003], [1.458, .316, z + .003], .003);
  ring("assist reaction sleeve", at(-.031), at(-.025), .006, .009, mat.darkMetal);
  const feedback = vec(at(-.028)).addScaledVector(n, .015).toArray() as V;
  cylinder("assist feedback arm", at(-.028), feedback, .003, mat.cast);
  cylinder("assist feedback link", feedback, [1.458, .316, .038], .0018, mat.metal);
  for (const z of [.041, .119]) ring(`assist valve end cap ${z}`, [1.458, .316, z - .003], [1.458, .316, z + .003], .003, .008);
  for (const z of [.057, .102]) {
    cylinder(`assist valve foot ${z}`, [1.469, .305, z], [1.469, .296, z], .008, mat.cast);
    bolt(`assist valve fixing ${z}`, [1.460, .303, z], [1.460, .330, z]);
  }
  const ports: Record<string, { point: V; axis: V }> = {};
  const port = (name: string, point: V, direction: V) => {
    const a = vec(point), d = vec(direction);
    ring(`${name} union`, a.clone().addScaledVector(d, -.010).toArray() as V, point, .0018, .004, mat.metal);
    ring(`${name} nut`, a.clone().addScaledVector(d, -.008).toArray() as V, a.clone().addScaledVector(d, -.004).toArray() as V, .0018, .005, mat.darkMetal);
    ports[name] = { point, axis: direction };
  };
  port("assist chamber A", [1.502, .280, .053], [1, 0, 0]);
  port("assist chamber B", [1.502, .280, .137], [1, 0, 0]);
  port("assist valve A", [1.480, .317, .060], [1, 0, 0]);
  port("assist valve B", [1.480, .317, .096], [1, 0, 0]);
  for (const [name, from, to, mid] of [
    ["assist line A", "assist valve A", "assist chamber A", [[1.522, .322, .060], [1.534, .299, .053]]],
    ["assist line B", "assist valve B", "assist chamber B", [[1.525, .326, .109], [1.532, .305, .129]]],
  ] as const) {
    const a = ports[from], b = ports[to], route = [a.point, vec(a.point).addScaledVector(vec(a.axis), .012).toArray() as V, ...mid, vec(b.point).addScaledVector(vec(b.axis), .012).toArray() as V, b.point];
    const shape = new T.Shape(); shape.absarc(0, 0, .0025, 0, Math.PI * 2, false);
    const hole = new T.Path(); hole.absarc(0, 0, .0018, 0, Math.PI * 2, true); shape.holes.push(hole);
    const curve = new T.CatmullRomCurve3(route.map(p => new T.Vector3(...p)), false, "centripetal");
    const pipe = add(name, new T.ExtrudeGeometry(shape, { extrudePath: curve, steps: 64, bevelEnabled: false, curveSegments: 8 }), mat.darkMetal);
    pipe.userData = { ...pipe.userData, route, outerRadius: .0025, from, to };
  }
  root.userData.ports = ports;
  root.userData.column = { input, joint, pinion: centre.toArray() };
  return root;
}

export function seatSteeringSystem(car: T.Group, system: T.Group, mat: Materials) {
  car.updateMatrixWorld(true);
  const cell = car.getObjectByName("Forward survival cell deck") as T.Mesh;
  const bottom = createSurfaceSampler([cell], "y"), side = createSurfaceSampler([cell], "z");
  const add = (name: string, geometry: T.BufferGeometry, position: V, material = mat.cast) => {
    const part = new T.Mesh(geometry, material); part.name = `Steering ${name}`; part.position.set(...position);
    part.userData = { component: "steering", internal: true }; part.castShadow = part.receiveShadow = true; system.add(part); return part;
  };
  for (const s of [-1, 1]) {
    const z = s * .123, y = bottom(1.48, z, -1)!;
    const foot = add(`rack mount ${s}`, new RoundedBoxGeometry(.062, .009, .040, 2, .001), [1.48, y + .003, z]);
    foot.userData.seat = [1.48, y, z];
    add(`rack pedestal ${s}`, new RoundedBoxGeometry(.034, .28 - y - .014, .025, 2, .002), [1.48, (y + .28 - .014) / 2, z]);
    const shape = new T.Shape(); shape.absarc(0, 0, .026, 0, Math.PI * 2, false);
    const hole = new T.Path(); hole.absarc(0, 0, s > 0 ? .020 : .016, 0, Math.PI * 2, true); shape.holes.push(hole);
    add(`rack clamp ${s}`, new T.ExtrudeGeometry(shape, { depth: .012, bevelEnabled: false, curveSegments: 32 }), [1.48, .28, z - .006]);
    for (const dx of [-.024, .024]) add(`rack fixing ${s} ${dx}`, new T.CylinderGeometry(.003, .003, .017, 6), [1.48 + dx, y + .008, z], mat.metal);
  }
  const upper = vec(system.userData.upperBearing), lower = vec(system.userData.lowerBearing);
  const keel = car.getObjectByName("Front suspension keel") as T.Mesh, keelRoof = createSurfaceSampler([keel], "y");
  for (const [name, p] of [["upper", upper], ["lower", lower]] as const) {
    if (name === "upper") {
      const y = keelRoof(p.x, 0, 1)!;
      for (const z of [-.017, .017]) add(`column upper hanger ${z}`, new T.BoxGeometry(.020, y - p.y, .007), [p.x, (y + p.y) / 2, z]);
      add("column upper chassis plate", new T.BoxGeometry(.040, .006, .048), [p.x, y - .001, 0]);
    } else {
      for (const s of [-1, 1]) {
        const z = side(p.x, p.y, s as 1 | -1)!;
        add(`column lower stay ${s}`, new T.BoxGeometry(.018, .012, Math.abs(z) - .010), [p.x, p.y, z / 2]);
        add(`column lower chassis insert ${s}`, new T.BoxGeometry(.035, .032, .010), [p.x, p.y, z - s * .002]);
      }
    }
  }
  // The carbon skins have thickness at their openings. Separate side holes
  // preserve the free space around the pinion; a tunnel across the entire tub
  // would put a second carbon wall through the mechanism inside it.
  const laminate = (mesh: T.Mesh) => {
    const outer = mesh.geometry, inner = outer.clone(), p = inner.attributes.position, n = inner.attributes.normal;
    outer.computeBoundingBox(); const { min, max } = outer.boundingBox!;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), insetX = Math.abs(x - min.x) < 1e-6 ? min.x + .002 : Math.abs(x - max.x) < 1e-6 ? max.x - .002 : x - n.getX(i) * .002;
      p.setXYZ(i, insetX, p.getY(i) - n.getY(i) * .002, p.getZ(i) - n.getZ(i) * .002);
    }
    const ix = inner.index!;
    for (let i = 0; i < ix.count; i += 3) { const a = ix.getX(i); ix.setX(i, ix.getX(i + 2)); ix.setX(i + 2, a); }
    inner.computeVertexNormals(); mesh.geometry = mergeGeometries([outer, inner]); outer.dispose(); inner.dispose();
  };
  const lowerCell = car.getObjectByName("Survival cell lower shell") as T.Mesh;
  for (const mesh of [cell, keel, lowerCell]) laminate(mesh);
  const bore = (mesh: T.Mesh, centre: V, axis: V, radius: number) => {
    mesh.updateWorldMatrix(true, false);
    const frame = new T.Matrix4().compose(vec(centre), new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 0, 1), vec(axis).normalize()), new T.Vector3(1, 1, 1));
    const transform = frame.clone().invert().multiply(mesh.matrixWorld);
    mesh.geometry.applyMatrix4(transform); openRadialPort(mesh, [0, 0], radius, 1, 0);
    mesh.geometry.applyMatrix4(transform.invert()); mesh.geometry.computeVertexNormals();
  };
  const { input, joint, pinion } = system.userData.column;
  const upperAxis = vec(input).sub(vec(joint)).normalize().toArray() as V;
  bore(keel, joint, upperAxis, .034);
  bore(cell, joint, upperAxis, .014);
  bore(lowerCell, pinion, vec(joint).sub(vec(pinion)).normalize().toArray() as V, .0105);
  bore(keel, pinion, vec(joint).sub(vec(pinion)).normalize().toArray() as V, .0105);
  for (const s of [-1, 1]) bore(cell, [1.48, .28, 0], [0, 0, s], .031);

  // This removable nose fairing previously had a concealed solid underside
  // and a rear cap across the column. Open only the portion above the tub,
  // retaining the visible exterior and the forward crash-nose underside.
  const nose = car.getObjectByName("Silver nose skin") as T.Mesh;
  const source = nose.geometry, p = source.attributes.position, ix = source.index!;
  const kept: number[] = [], edgeCounts = new Map<string, { a: number; b: number; count: number }>();
  source.computeBoundingBox();
  for (let i = 0; i < ix.count; i += 3) {
    const ids = [ix.getX(i), ix.getX(i + 1), ix.getX(i + 2)], v = ids.map(j => new T.Vector3().fromBufferAttribute(p, j));
    const normal = v[1].clone().sub(v[0]).cross(v[2].clone().sub(v[0])).normalize();
    const x = v.reduce((sum, point) => sum + point.x, 0) / 3;
    if (x < source.boundingBox!.min.x + .00001 || (x < 1.80 && normal.y < -.15)) continue;
    kept.push(...ids);
    for (let j = 0; j < 3; j++) {
      const a = ids[j], b = ids[(j + 1) % 3], key = a < b ? `${a}/${b}` : `${b}/${a}`;
      const edge = edgeCounts.get(key); if (edge) edge.count++; else edgeCounts.set(key, { a, b, count: 1 });
    }
  }
  const shell = source.clone(); shell.setIndex(kept); shell.computeVertexNormals();
  const n = shell.attributes.normal, vertices = Array.from(p.array), faces = [...kept], count = p.count;
  for (let i = 0; i < count; i++) vertices.push(p.getX(i) - n.getX(i) * .002, p.getY(i) - n.getY(i) * .002, p.getZ(i) - n.getZ(i) * .002);
  for (let i = 0; i < kept.length; i += 3) faces.push(kept[i + 2] + count, kept[i + 1] + count, kept[i] + count);
  for (const { a, b, count: uses } of edgeCounts.values()) if (uses === 1) faces.push(b, a, a + count, b, a + count, b + count);
  const skin = new T.BufferGeometry(); skin.setAttribute("position", new T.Float32BufferAttribute(vertices, 3)); skin.setIndex(faces); skin.computeVertexNormals();
  nose.geometry = skin; source.dispose(); shell.dispose();
  const housing = system.getObjectByName("Steering pinion housing") as T.Mesh;
  for (const s of [-1, 1]) bore(housing, [1.48, .28, 0], [0, 0, s], .013);
  for (const z of [.053, .137]) bore(system.getObjectByName("Steering assist cylinder") as T.Mesh, [1.48, .28, z], [1, 0, 0], .0018);
  for (const z of [.060, .096]) bore(system.getObjectByName("Steering assist valve block") as T.Mesh, [1.458, .317, z], [1, 0, 0], .0018);
  for (const s of [-1, 1]) bore(system.getObjectByName("Steering assist valve block") as T.Mesh, [1.458, .316, .080], [0, 0, s], .006);
  for (const z of [.060, .096]) bore(system.getObjectByName("Steering assist valve sleeve") as T.Mesh, [1.458, .317, z], [1, 0, 0], .0018);
  cleanSteeringBoreSeams([cell, keel, lowerCell]);
  car.updateMatrixWorld(true);
}


export function cleanSteeringBoreSeams(meshes: T.Mesh[]) {
  // Successive angled cuts can create duplicate sub-micron slivers along an
  // original cap diagonal. Snap only these edited skins to a 1 µm grid and
  // remove collapsed triangles, preserving the joined bore rims.
  for (const mesh of meshes) {
    const p = mesh.geometry.attributes.position, ix = mesh.geometry.index!, faces: number[] = [], seen = new Set<string>();
    const keys = Array.from({ length: p.count }, (_, i) => {
      const v = [p.getX(i), p.getY(i), p.getZ(i)].map(v => Math.round(v * 1e6));
      p.setXYZ(i, v[0] / 1e6, v[1] / 1e6, v[2] / 1e6); return v.join(",");
    });
    for (let i = 0; i < ix.count; i += 3) {
      const ids = [ix.getX(i), ix.getX(i + 1), ix.getX(i + 2)], vertices = ids.map(id => keys[id]);
      if (new Set(vertices).size !== 3) continue;
      const key = vertices.sort().join("/"); if (seen.has(key)) continue;
      seen.add(key); faces.push(...ids);
    }
    const edge = (a: number, b: number) => [keys[a], keys[b]].sort().join("/");
    const counts = new Map<string, number>();
    for (let i = 0; i < faces.length; i += 3) for (let j = 0; j < 3; j++) {
      const key = edge(faces[i + j], faces[i + (j + 1) % 3]); counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const clean: number[] = [];
    for (let i = 0; i < faces.length; i += 3) {
      const ids = faces.slice(i, i + 3), [a, b, c] = ids.map(id => new T.Vector3().fromBufferAttribute(p, id));
      const longest = Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a));
      const branches = ids.some((id, j) => counts.get(edge(id, ids[(j + 1) % 3]))! > 2);
      // A narrow but necessary cap triangle must remain. Only a collapsed
      // sliver with an extra branch duplicates an already joined surface.
      if (branches && b.clone().sub(a).cross(c.clone().sub(a)).length() < longest * .00000075) continue;
      clean.push(...ids);
    }
    mesh.geometry.setIndex(clean); mesh.geometry.computeVertexNormals();
  }
}
