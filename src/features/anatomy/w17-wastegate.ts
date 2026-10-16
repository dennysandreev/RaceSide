import * as T from "three";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { servicePassage } from "./w17-feedthrough.ts";

type V = [number, number, number];
type Materials = Record<"metal" | "cast" | "darkMetal" | "bronze" | "rubber", T.Material>;

// An illustrative external poppet wastegate. FIA C5.1.12–14 specifies the valve
// motion and downstream exhaust return, not Mercedes' private actuator design.
export function createWastegate(mat: Materials) {
  const root = new T.Group(); root.name = "Exhaust wastegate";
  root.position.set(-1.13, .465, -.18); root.rotation.z = -Math.PI / 2;
  const add = (name: string, geometry: T.BufferGeometry, material: T.Material, cover = false) => {
    const mesh = new T.Mesh(geometry, material); mesh.name = `Wastegate ${name}`;
    mesh.userData = { component: "exhaust", internal: true, serviceCover: cover };
    mesh.castShadow = true; mesh.receiveShadow = true; root.add(mesh); return mesh;
  };
  const turned = (name: string, profile: number[][], material: T.Material, cover = false) =>
    add(name, new T.LatheGeometry(profile.map(([r, y]) => new T.Vector2(r, y)), 64), material, cover);
  const ring = (name: string, a: V, b: V, inner: number, outer: number, material = mat.metal, cover = false) => {
    const axis = new T.Vector3(...b).sub(new T.Vector3(...a)), length = axis.length();
    const mesh = turned(name, [[inner, 0], [outer, 0], [outer, length], [inner, length], [inner, 0]], material, cover);
    mesh.position.set(...a); mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), axis.normalize()); return mesh;
  };
  const rod = (name: string, a: V, b: V, radius: number, material = mat.metal, cover = false) => {
    const axis = new T.Vector3(...b).sub(new T.Vector3(...a));
    const mesh = add(name, new T.CylinderGeometry(radius, radius, axis.length(), 24), material, cover);
    mesh.position.set(...a).addScaledVector(axis, .5); mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), axis.normalize()); return mesh;
  };
  turned("inlet flange", [[.0138, 0], [.019, 0], [.021, .003], [.021, .007], [.019, .010], [.016, .010], [.016, .015], [.0138, .015], [.0138, 0]], mat.bronze);
  turned("valve seat", [[.0138, .012], [.017, .012], [.017, .018], [.0154, .020], [.0138, .018], [.0138, .012]], mat.metal);
  const chamber = turned("gas chamber", [[.016, .010], [.019, .010], [.023, .023], [.024, .043], [.018, .055], [.007, .059], [.004, .059], [.004, .056], [.016, .052], [.021, .041], [.020, .024], [.016, .015], [.016, .010]], mat.bronze, true);
  // A real radial outlet in the hollow chamber, with its opposite wall intact.
  openRadialPort(chamber, [0, .034], .0138, 1);
  ring("outlet neck", [0, .034, .018], [0, .034, .047], .0138, .016, mat.bronze, true);
  ring("outlet V-band flange", [0, .034, .041], [0, .034, .047], .0138, .020, mat.metal, true);

  const moving = new T.Group(); moving.name = "Wastegate poppet assembly"; root.add(moving);
  const valve = turned("poppet", [[0, .018], [.0138, .018], [.0154, .020], [.0154, .022], [.010, .025], [.003, .029], [0, .029]], mat.metal);
  moving.add(valve);
  const stem = rod("valve stem", [0, .025, 0], [0, .111, 0], .003); moving.add(stem);
  ring("stem guide", [0, .055, 0], [0, .087, 0], .0031, .006, mat.darkMetal);
  turned("thermal spacer", [[.006, .061], [.012, .061], [.014, .066], [.010, .071], [.010, .083], [.027, .086], [.027, .090], [.006, .090], [.006, .061]], mat.darkMetal);
  for (let i = 0; i < 4; i++) {
    const angle = i * Math.PI / 2 + Math.PI / 4, x = .009 * Math.cos(angle), z = .009 * Math.sin(angle);
    rod(`spacer fixing ${i}`, [x, .057, z], [x, .088, z], .0018);
  }
  turned("actuator lower bowl", [[.006, .086], [.027, .086], [.033, .096], [.034, .103], [.031, .103], [.030, .098], [.025, .089], [.006, .089], [.006, .086]], mat.cast, true);
  const membrane = turned("diaphragm", [[.003, .102], [.010, .102], [.022, .100], [.030, .102], [.034, .102], [.034, .104], [.030, .104], [.022, .102], [.010, .104], [.003, .104], [.003, .102]], mat.rubber);
  moving.add(membrane);
  const plate = turned("diaphragm plate", [[.003, .103], [.011, .103], [.012, .105], [.012, .107], [.003, .107], [.003, .103]], mat.metal); moving.add(plate);
  turned("actuator cap", [[.031, .104], [.034, .104], [.034, .115], [.028, .139], [.016, .148], [0, .148], [0, .145], [.015, .145], [.025, .137], [.031, .114], [.031, .104]], mat.cast, true);
  ring("diaphragm clamp", [0, .100, 0], [0, .107, 0], .033, .036, mat.darkMetal, true);
  const springPoints = Array.from({ length: 193 }, (_, i) => {
    const t = i / 192, a = t * Math.PI * 12;
    return new T.Vector3(Math.cos(a) * .009, .1085 + t * .033, Math.sin(a) * .009);
  });
  add("return spring", new T.TubeGeometry(new T.CatmullRomCurve3(springPoints), 192, .0015, 8, false), mat.metal);
  ring("spring upper seat", [0, .141, 0], [0, .145, 0], .004, .012, mat.darkMetal);
  for (const z of [-.037, .037]) {
    rod(`clamp screw ${z}`, [-.005, .104, z], [.005, .104, z], .002, mat.metal, true);
    for (const x of [-.004, .004]) rod(`clamp lug ${z} ${x}`, [x, .104, Math.sign(z) * .032], [x, .104, z], .003, mat.darkMetal, true);
  }
  // Pressure acts below the diaphragm; the top chamber is vented, not a loose hose.
  const bowl = root.getObjectByName("Wastegate actuator lower bowl") as T.Mesh;
  openRadialPort(bowl, [0, .096], .002, -1);
  ring("pressure union", [0, .096, -.026], [0, .096, -.042], .002, .0045, mat.metal, true);
  const cap = root.getObjectByName("Wastegate actuator cap") as T.Mesh;
  openRadialPort(cap, [0, .120], .0015, -1);
  ring("filtered vent", [0, .120, -.028], [0, .120, -.036], .0015, .003, mat.darkMetal, true);
  for (const z of [-.024, .024]) ring(`mounting eye ${z}`, [0, .077, z], [0, .085, z], .003, .006, mat.darkMetal);
  // Radial ribs join the drilled ears to the cold side of the spacer.
  for (const z of [-1, 1]) rod(`mounting rib ${z}`, [0, .081, z * .009], [0, .081, z * .024], .004, mat.darkMetal);
  root.updateMatrixWorld(true);
  const point = (v: V) => new T.Vector3(...v).applyMatrix4(root.matrixWorld).toArray() as V;
  const ports = { inlet: point([0, 0, 0]), outlet: point([0, .034, .047]), pressure: point([0, .096, -.042]) };
  root.userData.ports = ports;
  return { root, ports };
}

// Cut just the requested side of a hollow tube/casting. The bore is smaller
// than its parent cavity, so the unchanged half has no intersection with it.
export function openRadialPort(mesh: T.Mesh, centre: [number, number], radius: number, side: number, splitZ = 0, closeBore = true, depthLimit = Infinity) {
  const source = mesh.geometry, p = source.attributes.position, ix = source.index;
  const selected: number[] = [], kept: number[] = [];
  for (let i = 0; i < (ix?.count ?? p.count); i += 3) {
    const vertices = [0, 1, 2].map(j => new T.Vector3().fromBufferAttribute(p, ix ? ix.getX(i + j) : i + j));
    const overlaps = Math.min(...vertices.map(v => v.x)) <= centre[0] + radius && Math.max(...vertices.map(v => v.x)) >= centre[0] - radius
      && Math.min(...vertices.map(v => v.y)) <= centre[1] + radius && Math.max(...vertices.map(v => v.y)) >= centre[1] - radius;
    const depth = vertices.reduce((sum, v) => sum + (v.z - splitZ) * side, 0) / 3;
    const target = overlaps && depth > 0 && depth < depthLimit ? selected : kept;
    target.push(...vertices.flatMap(v => v.toArray()));
  }
  const half = new T.BufferGeometry(); half.setAttribute("position", new T.Float32BufferAttribute(selected, 3));
  const profile = Array.from({ length: 32 }, (_, i) => new T.Vector2(centre[0] + Math.cos(i * Math.PI / 16) * radius, centre[1] + Math.sin(i * Math.PI / 16) * radius));
  const indexed = servicePassage(half, profile);
  if (!closeBore) {
    // An open exterior skin gets its thickness after clipping. Discard passage
    // walls here; the subsequent laminate joins its newly cut boundary.
    const p = indexed.attributes.position, ix = indexed.index!, faces: number[] = [];
    for (let i = 0; i < ix.count; i += 3) {
      const ids = [0,1,2].map(j => ix.getX(i+j));
      const onBore = profile.some((a,k) => {
        const b = profile[(k+1)%profile.length], dx = b.x-a.x, dy = b.y-a.y;
        return ids.every(j => Math.abs(dx*(p.getY(j)-a.y)-dy*(p.getX(j)-a.x)) < 1e-10);
      });
      if (!onBore) faces.push(...ids);
    }
    indexed.setIndex(faces);
  }
  const cut = indexed.toNonIndexed(); indexed.dispose(); cut.deleteAttribute("normal");
  // Only local triangles are clipped. Split any neighbouring edge at the new
  // rim vertices, preserving watertight seams without clipping a whole pipe.
  const cp = cut.attributes.position, rim: T.Vector3[] = [], keys = new Set<string>();
  for (let i = 0; i < cp.count; i++) {
    const v = new T.Vector3().fromBufferAttribute(cp, i), key = v.toArray().map(n => Math.round(n * 1e8)).join();
    if (!keys.has(key)) { keys.add(key); rim.push(v); }
  }
  const bounds = new T.Box3().setFromPoints(rim).expandByScalar(1e-7), restPoints: number[] = [];
  for (let i = 0; i < kept.length; i += 9) {
    const vertices = [0, 3, 6].map(j => new T.Vector3(kept[i + j], kept[i + j + 1], kept[i + j + 2]));
    if (!bounds.intersectsBox(new T.Box3().setFromPoints(vertices))) { restPoints.push(...kept.slice(i, i + 9)); continue; }
    const boundary: T.Vector3[] = [];
    for (let j = 0; j < 3; j++) {
      const a = vertices[j], direction = vertices[(j + 1) % 3].clone().sub(a), length = direction.lengthSq();
      const points = [{ t: 0, v: a }];
      if (length > 1e-16) for (const v of rim) {
        const t = v.clone().sub(a).dot(direction) / length;
        if (t > 1e-6 && t < 1 - 1e-6 && a.clone().addScaledVector(direction, t).distanceToSquared(v) < 1e-14) points.push({ t, v });
      }
      points.sort((a, b) => a.t - b.t); boundary.push(...points.map(p => p.v));
    }
    if (boundary.length === 3) restPoints.push(...vertices.flatMap(v => v.toArray()));
    else {
      const middle = vertices.reduce((sum, v) => sum.add(v), new T.Vector3()).divideScalar(3);
      for (let j = 0; j < boundary.length; j++) restPoints.push(...middle.toArray(), ...boundary[j].toArray(), ...boundary[(j + 1) % boundary.length].toArray());
    }
  }
  const rest = new T.BufferGeometry(); rest.setAttribute("position", new T.Float32BufferAttribute(restPoints, 3));
  const merged = mergeGeometries([rest, cut]); mesh.geometry = mergeVertices(merged, 1e-7); mesh.geometry.computeVertexNormals();
  source.dispose(); half.dispose(); cut.dispose(); rest.dispose(); merged.dispose();
}
