import * as T from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { openRadialPort } from "./w17-wastegate.ts";
import { createSurfaceSampler } from "./w17-surface.ts";

type V = [number, number, number];
type Materials = Record<"metal" | "cast" | "darkMetal" | "black" | "rubber", T.Material>;

// Keep the complete valve block inboard of the suspension clevises. These
// installation offsets also locate its galleries, electrical leads and ports.
export const HYDRAULIC_MANIFOLD_OFFSET: V = [-.030, .015, -.100];
const ACCUMULATOR_OFFSET: V = [0, .050, -.025];
export const hydraulicManifoldPoint = (p: V): V => p.map((v, i) => v + HYDRAULIC_MANIFOLD_OFFSET[i]) as V;

// Functional reconstruction, not a Mercedes installation drawing. The compact
// valve silhouette follows Moog's published E024 reference; hardpoints, pump,
// reservoir and line routing are reconstructed around the existing drivetrain.
export function createHydraulicSystem(mat: Materials, crankHeight: number, selectorHeight: number) {
  const root = new T.Group(); root.name = "Complete hydraulic system";
  const ports: Record<string, { point: V; axis: V }> = {};
  const add = (name: string, geometry: T.BufferGeometry, material: T.Material) => {
    const part = new T.Mesh(geometry, material); part.name = `Hydraulic ${name}`;
    part.userData = { component: "hydraulics", internal: true };
    part.castShadow = part.receiveShadow = true; root.add(part); return part;
  };
  const box = (name: string, point: V, size: V, material = mat.cast) => {
    const part = add(name, new RoundedBoxGeometry(...size, 2, Math.min(.002, ...size.map(v => v / 4))), material);
    part.position.set(...point); return part;
  };
  const cylinder = (name: string, a: V, b: V, radius: number, material = mat.metal, sides = 32) => {
    const start = new T.Vector3(...a), axis = new T.Vector3(...b).sub(start);
    const part = add(name, new T.CylinderGeometry(radius, radius, axis.length(), sides), material);
    part.position.copy(start).addScaledVector(axis, .5); part.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), axis.normalize()); return part;
  };
  const ring = (name: string, a: V, b: V, inner: number, outer: number, material = mat.metal) => {
    const axis = new T.Vector3(...b).sub(new T.Vector3(...a));
    const part = add(name, new T.LatheGeometry([[inner, 0], [outer, 0], [outer, axis.length()], [inner, axis.length()], [inner, 0]].map(([r, y]) => new T.Vector2(r, y)), 32), material);
    part.position.set(...a); part.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), axis.normalize()); return part;
  };
  const screw = (name: string, a: V, b: V, radius = .0023) => {
    cylinder(`${name} shank`, a, b, radius * .6, mat.darkMetal);
    const v = new T.Vector3(...b).sub(new T.Vector3(...a)).normalize();
    ring(`${name} head`, b, new T.Vector3(...b).addScaledVector(v, .002).toArray() as V, radius * .42, radius);
  };
  const port = (name: string, point: V, axis: V, radius = .003) => {
    const p = new T.Vector3(...point), d = new T.Vector3(...axis).normalize();
    ring(`${name} union`, p.clone().addScaledVector(d, -.010).toArray() as V, point, radius * .72, radius + .0017);
    const nut = ring(`${name} sealing shoulder`, p.clone().addScaledVector(d, -.009).toArray() as V, p.clone().addScaledVector(d, -.005).toArray() as V, radius * .72, radius + .003);
    nut.userData.port = name; ports[name] = { point, axis }; return point;
  };
  const pipe = (name: string, from: string, to: string, middle: V[], radius = .003, approach = .018) => {
    const a = ports[from], b = ports[to], points = [a.point, new T.Vector3(...a.point).addScaledVector(new T.Vector3(...a.axis), approach).toArray() as V, ...middle,
      new T.Vector3(...b.point).addScaledVector(new T.Vector3(...b.axis), approach).toArray() as V, b.point];
    const path = new T.CatmullRomCurve3(points.map(p => new T.Vector3(...p)), false, "centripetal");
    const section = new T.Shape(); section.absarc(0, 0, radius, 0, Math.PI * 2, false);
    const bore = new T.Path(); bore.absarc(0, 0, radius * .72, 0, Math.PI * 2, true); section.holes.push(bore);
    const part = add(name, new T.ExtrudeGeometry(section, { extrudePath: path, steps: Math.max(48, points.length * 10), curveSegments: 8, bevelEnabled: false }), mat.black);
    part.userData = { ...part.userData, route: points, outerRadius: radius, from, to };
    for (const end of [a, b]) {
      const p = new T.Vector3(...end.point), d = new T.Vector3(...end.axis);
      ring(`${name} crimp ${end === a ? "in" : "out"}`, p.toArray() as V, p.clone().addScaledVector(d, .009).toArray() as V, radius, radius + .0011);
    }
    return part;
  };

  // Engine accessory take-off: a flanged pump with a sealed drive quill.
  const pumpY = .335, pumpZ = .115;
  cylinder("pump drive quill", [-.926, pumpY, pumpZ], [-.974, pumpY, pumpZ], .004, mat.darkMetal);
  ring("pump drive seal", [-.942, pumpY, pumpZ], [-.949, pumpY, pumpZ], .004, .009, mat.rubber);
  ring("pump mounting flange", [-.939, pumpY, pumpZ], [-.951, pumpY, pumpZ], .004, .029, mat.cast);
  cylinder("pump body", [-.951, pumpY, pumpZ], [-1.004, pumpY, pumpZ], .020, mat.darkMetal);
  cylinder("pump end plate", [-1.004, pumpY, pumpZ], [-1.009, pumpY, pumpZ], .020, mat.cast);
  for (let i = 0; i < 3; i++) {
    const a = i * Math.PI * 2 / 3, y = pumpY + Math.cos(a) * .025, z = pumpZ + Math.sin(a) * .025;
    screw(`pump fixing ${i}`, [-.938, y, z], [-.953, y, z]);
  }
  port("pump inlet", [-.989, .335, .145], [0, 0, 1], .004);
  port("pump pressure", [-.968, .365, .115], [0, 1, 0]);

  // A closed, thin-walled tank with separate suction and return bosses. A
  // return standpipe and baffle keep the incoming jet away from the pickup.
  ring("reservoir wall", [-1.078, .323, .095], [-1.078, .395, .095], .023, .025, mat.cast);
  for (const [name, y] of [["base", .323], ["lid", .395]] as const) cylinder(`reservoir ${name}`, [-1.078, y - .001, .095], [-1.078, y + .001, .095], .025, mat.cast);
  ring("reservoir lid seal", [-1.078, .392, .095], [-1.078, .394, .095], .0248, .026, mat.rubber);
  cylinder("reservoir filler cap", [-1.078, .395, .095], [-1.078, .404, .095], .009, mat.darkMetal, 8);
  for (const y of [.338, .378]) {
    ring(`reservoir strap ${y}`, [-1.078, y - .004, .095], [-1.078, y + .004, .095], .025, .027, mat.darkMetal);
    box(`reservoir mounting foot ${y}`, [-1.111, y, .095], [.020, .009, .026]);
    screw(`reservoir mount ${y}`, [-1.128, y, .095], [-1.101, y, .095]);
  }
  box("reservoir baffle", [-1.078, .359, .095], [.001, .045, .043]);
  port("reservoir suction", [-1.043, .337, .095], [1, 0, 0], .004);
  port("reservoir return", [-1.090, .405, .095], [0, 1, 0], .004);

  ring("reservoir return standpipe", [-1.090, .395, .095], [-1.090, .333, .095], .0029, .004, mat.metal);

  // Two E024-sized nozzle/flapper valve envelopes sit on a machined manifold.
  // Their exact quantity and installation are not asserted to be W17 data.
  const manifoldStart = root.children.length;
  box("control manifold", [-1.290, .392, .108], [.138, .025, .060]);
  for (const [name, x] of [["shift", -1.323], ["clutch", -1.264]] as const) {
    box(`${name} valve mounting foot`, [x, .406, .108], [.0346, .003, .0305], mat.metal);
    box(`${name} valve spool block`, [x, .414, .108], [.030, .012, .021], mat.metal);
    const cover = new T.Shape(); cover.moveTo(-.014, -.011); cover.lineTo(.014, -.011); cover.lineTo(.014, .004);
    cover.quadraticCurveTo(.013, .013, .005, .013); cover.lineTo(-.005, .013); cover.quadraticCurveTo(-.014, .013, -.014, .004); cover.closePath();
    const g = new T.ExtrudeGeometry(cover, { depth: .013, bevelEnabled: true, bevelSize: .0006, bevelThickness: .0006, bevelSegments: 2, curveSegments: 12 });
    g.translate(x, .430, .1015); add(`${name} valve torque-motor cover`, g, mat.darkMetal);
    for (const dx of [-.014, .014]) for (const dz of [-.012, .012]) screw(`${name} valve fixing ${dx} ${dz}`, [x + dx, .401, .108 + dz], [x + dx, .408, .108 + dz], .0018);
  }
  // Cross-drilling plugs, relief cartridge, pressure transducer and service cap.
  for (const x of [-1.342, -1.306, -1.270, -1.234]) cylinder(`manifold gallery plug ${x}`, [x, .391, .137], [x, .391, .141], .004, mat.darkMetal, 6);
  cylinder("relief cartridge", [-1.222, .390, .095], [-1.198, .390, .095], .006, mat.darkMetal);
  cylinder("pressure transducer", [-1.346, .392, .078], [-1.346, .392, .056], .006, mat.metal);
  cylinder("service charging cap", [-1.359, .392, .107], [-1.369, .392, .107], .005, mat.darkMetal, 6);
  port("manifold pressure", [-1.239, .391, .148], [0, 0, 1]);
  port("manifold return", [-1.257, .378, .108], [0, -1, 0], .004);
  port("manifold accumulator", [-1.326, .392, .148], [0, 0, 1]);
  port("manifold shift A", [-1.321, .390, .068], [0, 0, -1]);
  port("manifold shift B", [-1.302, .390, .068], [0, 0, -1]);
  port("manifold clutch", [-1.278, .390, .068], [0, 0, -1]);
  for (const x of [-1.343, -1.237]) {
    box(`manifold pedestal ${x}`, [x, .369, .108], [.018, .023, .042]);
    box(`manifold mounting foot ${x}`, [x, .359, .083], [.028, .005, .095]);
    screw(`manifold mount ${x}`, [x, .346, .051], [x, .364, .051]);
  }
  for (const part of root.children.slice(manifoldStart)) part.position.add(new T.Vector3(...HYDRAULIC_MANIFOLD_OFFSET));
  for (const [name, fitting] of Object.entries(ports)) if (name.startsWith("manifold ")) fitting.point = hydraulicManifoldPoint(fitting.point);

  // A piston accumulator, retained in two saddles, separates its fluid port
  // from the nitrogen charge valve at the opposite end.
  const accumulatorStart = root.children.length;
  const accY = .340, accZ = .118;
  const profile = [[.004, 0], [.011, 0], [.021, .012], [.023, .024], [.023, .098], [.020, .111], [.007, .120], [.004, .120], [.004, .118], [.006, .118], [.018, .109], [.021, .097], [.021, .025], [.019, .014], [.010, .003], [.004, .003], [.004, 0]];
  const acc = add("accumulator shell", new T.LatheGeometry(profile.map(([r, y]) => new T.Vector2(r, y)), 48), mat.darkMetal);
  acc.position.set(-1.280, accY, accZ); acc.rotation.z = Math.PI / 2;
  cylinder("accumulator separator piston", [-1.361, accY, accZ], [-1.355, accY, accZ], .0208, mat.metal);
  ring("accumulator piston seal", [-1.360, accY, accZ], [-1.356, accY, accZ], .0205, .021, mat.rubber);
  port("accumulator", [-1.270, accY, accZ], [1, 0, 0]);
  cylinder("accumulator gas valve thread", [-1.391, accY, accZ], [-1.400, accY, accZ], .004, mat.metal);
  cylinder("accumulator gas valve", [-1.400, accY, accZ], [-1.404, accY, accZ], .005, mat.metal);
  cylinder("accumulator gas cap", [-1.400, accY, accZ], [-1.408, accY, accZ], .006, mat.darkMetal, 6);
  for (const x of [-1.314, -1.369]) {
    ring(`accumulator strap ${x}`, [x - .004, accY, accZ], [x + .004, accY, accZ], .023, .025, mat.metal);
    box(`accumulator saddle ${x}`, [x, accY, .095], [.019, .036, .018]);
    screw(`accumulator fixing ${x}`, [x, accY + .017, .068], [x, accY + .017, .111]);
  }
  for (const part of root.children.slice(accumulatorStart)) part.position.add(new T.Vector3(...ACCUMULATOR_OFFSET));
  ports.accumulator.point = ports.accumulator.point.map((v, i) => v + ACCUMULATOR_OFFSET[i]) as V;
  // Replaceable pressure filter with a screwed bowl, retained on the pump rail.
  cylinder("pressure filter bowl", [-1.107, .332, .129], [-1.158, .332, .129], .010, mat.darkMetal);
  cylinder("pressure filter head", [-1.098, .332, .129], [-1.109, .332, .129], .013, mat.cast, 8);
  port("filter in", [-1.088, .332, .129], [1, 0, 0]);
  port("filter out", [-1.168, .332, .129], [-1, 0, 0]);
  box("filter bracket", [-1.130, .318, .100], [.025, .008, .068]);

  // Coaxial clutch slave: the release bearing touches the diaphragm ring;
  // the stationary cylinder is carried by the bell's rear bulkhead.
  ring("clutch slave housing", [-1.042, crankHeight, 0], [-1.082, crankHeight, 0], .0125, .027, mat.cast);
  ring("clutch slave piston", [-1.041, crankHeight, 0], [-1.057, crankHeight, 0], .0125, .020, mat.metal);
  ring("clutch release bearing", [-1.033, crankHeight, 0], [-1.040, crankHeight, 0], .0125, .023, mat.darkMetal);
  ring("clutch slave support sleeve", [-1.079, crankHeight, 0], [-1.148, crankHeight, 0], .0125, .017, mat.darkMetal);
  ring("clutch slave mounting flange", [-1.139, crankHeight, 0], [-1.149, crankHeight, 0], .0125, .035, mat.cast);
  port("clutch slave", [-1.063, crankHeight + .037, 0], [0, 1, 0]);
  for (let i = 0; i < 3; i++) {
    const a = i * Math.PI * 2 / 3; screw(`clutch slave fixing ${i}`, [-1.155, crankHeight + Math.cos(a) * .029, Math.sin(a) * .029], [-1.138, crankHeight + Math.cos(a) * .029, Math.sin(a) * .029]);
  }

  // A double-acting selector ram drives an indexing arm on the barrel, with
  // both clevis eyes and the barrel hub physically joined by their pins.
  const shiftX = -1.230, ramY = selectorHeight + .042;
  cylinder("selector cylinder", [shiftX, ramY, -.104], [shiftX, ramY, -.040], .010, mat.darkMetal);
  ring("selector rod gland", [shiftX, ramY, -.041], [shiftX, ramY, -.034], .0035, .010);
  cylinder("selector piston rod", [shiftX, ramY, -.045], [shiftX, ramY, -.011], .0035);
  ring("selector rod eye", [shiftX - .004, ramY, 0], [shiftX + .004, ramY, 0], .003, .011);
  ring("selector barrel hub", [-1.273, selectorHeight, 0], [shiftX + .008, selectorHeight, 0], .008, .016, mat.darkMetal);
  box("selector indexing arm", [shiftX, selectorHeight + .020, 0], [.009, .044, .013], mat.metal);
  cylinder("selector pin", [shiftX - .009, ramY, 0], [shiftX + .009, ramY, 0], .003, mat.darkMetal);
  box("selector fixed bracket", [shiftX, ramY - .015, -.097], [.016, .015, .028]);
  port("selector A", [shiftX, ramY + .020, -.089], [0, 1, 0]);
  port("selector B", [shiftX, ramY + .020, -.050], [0, 1, 0]);
  // Case unions keep external hoses clear of the opaque casing. The internal
  // actuator connections are separate tubes on the inboard side of each bore.
  port("case clutch outside", [-1.184, .316, .077], [0, 0, 1]);
  port("case clutch inside", [-1.184, .316, .045], [0, 0, -1]);

  pipe("pump suction hose", "reservoir suction", "pump inlet", [[-1.026, .337, .143], [-1.015, .337, .175], [-.995, .335, .180]], .004);
  pipe("pump delivery hose", "pump pressure", "filter in", [[-1.030, .388, .139], [-1.060, .357, .148]]);
  pipe("filtered pressure hose", "filter out", "manifold pressure", [[-1.194, .335, .161], [-1.228, .361, .190], [-1.269, .391, .170], [-1.269, .391, .105]]);
  pipe("reservoir return hose", "manifold return", "reservoir return", [[-1.287, .375, .045], [-1.284, .360, .075], [-1.273, .347, .158], [-1.216, .336, .180], [-1.113, .340, .170], [-1.090, .399, .158], [-1.090, .430, .124]], .004);
  pipe("accumulator hose", "manifold accumulator", "accumulator", [[-1.352, .436, .072], [-1.340, .465, .092], [-1.285, .465, .100], [-1.258, .432, .093], [-1.256, .417, .093]], .003, .014);
  pipe("shift A hose", "manifold shift A", "selector A", [[-1.351, .425, -.065], [-1.280, .450, -.040], [-1.230, .450, -.040], [-1.230, .443, -.089]]);
  pipe("shift B hose", "manifold shift B", "selector B", [[-1.332, .428, -.065], [-1.270, .455, -.050], [-1.243, .447, -.050]]);
  pipe("clutch control hose", "manifold clutch", "case clutch outside", [[-1.300, .416, -.070], [-1.280, .416, -.060], [-1.260, .416, -.040], [-1.240, .416, -.038], [-1.215, .410, .020], [-1.202, .375, .035], [-1.180, .337, .107], [-1.166, .317, .123], [-1.184, .306, .113]]);
  pipe("clutch slave internal line", "case clutch inside", "clutch slave", [[-1.187, .309, .020], [-1.187, .285, .020], [-1.190, .213, .016], [-1.161, .195, .010], [-1.139, .195, .010], [-1.104, .200, .010]]);

  // Compact electrical terminations on the manifold, with strain-relieved
  // leads from the two torque motors and the pressure sensor.
  const loomStart = root.children.length;
  box("valve loom socket", [-1.291, .410, .151], [.019, .013, .016], mat.black);
  for (const x of [-1.323, -1.264]) {
    const curve = new T.CatmullRomCurve3([new T.Vector3(x, .429, .115), new T.Vector3(x, .430, .143), new T.Vector3(-1.291, .414, .151)]);
    add(`valve lead ${x}`, new T.TubeGeometry(curve, 32, .0015, 8, false), mat.black);
  }
  for (const part of root.children.slice(loomStart)) part.position.add(new T.Vector3(...HYDRAULIC_MANIFOLD_OFFSET));
  root.userData.ports = ports;
  return root;
}

// Cut a real port in world coordinates, preserving the opposite half of a
// hollow casing. Applying the inverse frame restores the original transform.
function hydraulicBore(mesh: T.Mesh, centre: V, axis: V, radius: number, split = -.012) {
  mesh.updateWorldMatrix(true, false);
  const frame = new T.Matrix4().compose(new T.Vector3(...centre), new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 0, 1), new T.Vector3(...axis)), new T.Vector3(1, 1, 1));
  const toBore = frame.clone().invert().multiply(mesh.matrixWorld);
  mesh.geometry.applyMatrix4(toBore);
  openRadialPort(mesh, [0, 0], radius, 1, split);
  mesh.geometry.applyMatrix4(toBore.invert()); mesh.geometry.computeVertexNormals();
}

export function seatHydraulicSystem(car: T.Group, system: T.Group, mat: Materials) {
  car.updateMatrixWorld(true);
  const casing = car.getObjectByName("Carbon gearbox casing") as T.Mesh;
  const top = createSurfaceSampler([casing], "y"), side = createSurfaceSampler([casing], "z");
  const part = (name: string) => system.getObjectByName(`Hydraulic ${name}`) as T.Mesh;
  const block = (name: string, a: V, b: V, size: number) => {
    const direction = new T.Vector3(...b).sub(new T.Vector3(...a));
    const m = new T.Mesh(new RoundedBoxGeometry(size, direction.length(), size, 2, .001), mat.cast);
    m.name = `Hydraulic ${name}`; m.position.set(...a).addScaledVector(direction, .5);
    m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), direction.normalize());
    m.userData = { component: "hydraulics", internal: true }; system.add(m); return m;
  };
  for (const x of [-1.343, -1.237]) {
    const end = hydraulicManifoldPoint([x, .360, .051]), y = top(end[0], end[2], 1)!;
    block(`manifold casing insert ${x}`, [end[0], y - .003, end[2]], end, .016);
  }
  for (const x of [-1.314, -1.369]) {
    // Upright carriers reach the retained saddles above the track-rod joint.
    const z = .056, y = top(x, z, 1)!;
    block(`accumulator casing insert ${x}`, [x, y - .003, z], [x, .412, z], .018);
  }
  const reservoirSeat: V = [-1.180, .321, side(-1.180, .321, 1)! - .002];
  block("reservoir carrier foot", reservoirSeat, [-1.111, .320, .095], .012);
  block("reservoir carrier", [-1.111, .320, .095], [-1.111, .382, .095], .012);
  block("filter carrier", [-1.157, .321, .075], [-1.118, .318, .100], .012);
  const shiftX = part("selector fixed bracket").position.x, selectorSeat = top(shiftX, -.040, 1)!;
  // Rise inboard before spanning the stationary wishbone bracket's foot.
  block("selector casing insert", [shiftX, selectorSeat - .003, -.040], [shiftX, .382, -.040], .014);
  block("selector mount bridge", [shiftX, .382, -.040], [shiftX, .365, -.097], .014);

  // The clutch line enters the gearbox through its own bulkhead fitting and
  // continues to the clutch-bell bulkhead. The tub ends ahead of the engine;
  // there is no chassis pan or extra feedthrough inside this gearbox bay.
  hydraulicBore(casing, [-1.184, .316, .062], [0, 0, 1], .0055);
  hydraulicBore(casing, [-1.150, .195, .010], [1, 0, 0], .0045);
  // External selector hub sits in a bored nose of the barrel's bearing boss.
  hydraulicBore(casing, [-1.243, .343, 0], [1, 0, 0], .017, -.040);
  const tank = part("reservoir wall");
  hydraulicBore(tank, [-1.053, .337, .095], [1, 0, 0], .003);
  hydraulicBore(part("reservoir lid"), [-1.090, .396, .095], [0, 1, 0], .003);
  // Drill the mounting/fluid bores instead of hiding a closed face under a
  // decorative fitting. Solid pump/filter internals remain concealed.
  hydraulicBore(part("clutch slave housing"), [-1.063, .173, 0], [0, 1, 0], .0022);
  // Pump and drive mounting bores are added to the native timing-cover profile
  // by connectHydraulicPumpDrive once the installed cam axes are available.
  system.updateMatrixWorld(true);
}
