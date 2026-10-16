import * as T from "three";
import {openRadialPort} from "./w17-wastegate.ts";

type V = [number, number, number];
type Materials = Record<"metal" | "cast" | "darkMetal" | "bronze" | "black" | "orange", T.Material>;

// Illustrative radial-flux machine. Pole/slot counts, bearings, dimensions and
// water-jacket layout are not published Mercedes data. Local X is the drive axis.
export function createMotorGenerator(mat: Materials) {
  const root = new T.Group(); root.name = "MGU-K complete machine";
  const rotor = new T.Group(); rotor.name = "MGU-K rotor assembly"; rotor.userData.mgukRotor = true; root.add(rotor);
  const ports: Record<string, V> = { drive: [.185, 0, 0], power: [.139, .038, .050], coolantIn: [.115, .008, .053], coolantOut: [-.115, .015, .038] };
  const add = (name: string, g: T.BufferGeometry, m: T.Material, cover = false, parent = root) => {
    const part = new T.Mesh(g, m); part.name = name; part.userData = { component: "mguk", internal: true, serviceCover: cover };
    part.castShadow = true; part.receiveShadow = true; parent.add(part); return part;
  };
  // Annular sectors have explicit end faces: the inspection cutaway reveals
  // actual radial clearances instead of a solid cylinder hiding another one.
  const sector = (name: string, x0: number, x1: number, r0: number, r1: number, a0: number, span: number, m: T.Material, cover = false, parent = root) => {
    const shape = new T.Shape(); shape.absarc(0, 0, r1, a0, a0 + span, false);
    shape.lineTo(Math.cos(a0 + span) * r0, Math.sin(a0 + span) * r0);
    shape.absarc(0, 0, r0, a0 + span, a0, true); shape.closePath();
    const g = new T.ExtrudeGeometry(shape, { depth: x1 - x0, bevelEnabled: false, curveSegments: 40 });
    // Shape X,Y -> radial Y,Z; extrusion -> axial X. Cyclic permutation keeps winding.
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setXYZ(i, x0 + p.getZ(i), p.getX(i), p.getY(i));
    g.computeVertexNormals(); return add(name, g, m, cover, parent);
  };
  const ring = (name: string, a: V, b: V, inner: number, outer: number, m = mat.metal, cover = false, parent = root) => {
    const axis = new T.Vector3(...b).sub(new T.Vector3(...a));
    const profile = [[inner, 0], [outer, 0], [outer, axis.length()], [inner, axis.length()], [inner, 0]].map(([r, x]) => new T.Vector2(r, x));
    const part = add(name, new T.LatheGeometry(profile, 48), m, cover, parent);
    part.position.set(...a); part.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), axis.normalize()); return part;
  };
  // The cartridge sits aft of the coolant-drive cassette. Its longer nose
  // reaches the same front gear plane without moving the engine or pump axes.
  const shaft = ring("MGU-K hollow shaft", [-.129, 0, 0], ports.drive, .004, .0085, mat.metal, false, rotor);
  shaft.userData.axis = [1, 0, 0];
  ring("MGU-K rotor core", [-.077, 0, 0], [.077, 0, 0], .0085, .023, mat.darkMetal, false, rotor);
  for (let i = 0; i < 8; i++) sector(`MGU-K magnet ${i}`, -.075, .075, .023, .026, i * Math.PI / 4 + .025, Math.PI / 4 - .05, mat.metal, false, rotor);
  ring("MGU-K rotor retaining sleeve", [-.079, 0, 0], [.079, 0, 0], .026, .027, mat.darkMetal, true, rotor);
  for (const x of [-.082, .079]) ring(`MGU-K rotor end balance ring ${x}`, [x, 0, 0], [x + .003, 0, 0], .0085, .027, mat.metal, false, rotor);
  for (let i = 0; i < 12; i++) {
    const angle = i * Math.PI / 6, g = new T.BoxGeometry(.026, .0018, .0025);
    const part = add(`MGU-K drive spline ${i}`, g, mat.metal, false, rotor); part.position.set(.169, Math.cos(angle) * .0088, Math.sin(angle) * .0088); part.rotation.x = angle;
  }
  // Lower and upper halves are split only for the educational cutaway.
  for (const upper of [false, true]) {
    const a0 = upper ? -Math.PI / 2 : Math.PI / 2;
    sector(`MGU-K motor housing ${upper ? "upper" : "lower"}`, -.107, .107, .053, .056, a0, Math.PI, mat.cast, upper);
    sector(`MGU-K water jacket ${upper ? "upper" : "lower"}`, -.096, .096, .049, .0505, a0, Math.PI, mat.metal, upper);
    sector(`MGU-K stator back iron ${upper ? "upper" : "lower"}`, -.078, .078, .043, .049, a0, Math.PI, mat.darkMetal, upper);
    for (let j = 0; j < 6; j++) sector(`MGU-K jacket channel rib ${upper} ${j}`, -.092 + j * .034, -.090 + j * .034, .0505, .053, a0, Math.PI, mat.cast, upper);
  }
  for (let i = 0; i < 24; i++) {
    const angle = (i + .5) * Math.PI / 12, upper = Math.cos(angle) > 0;
    sector(`MGU-K stator tooth ${i}`, -.078, .078, .029, .044, angle - .055, .11, mat.darkMetal, upper);
    // Two axial legs and two end turns form a closed winding around each tooth.
    const radial = (x: number, r: number, a: number) => new T.Vector3(x, Math.cos(a) * r, Math.sin(a) * r);
    for (let turn = 0; turn < 3; turn++) {
      const r = .034 + turn * .0033, points = [radial(-.079, r, angle - .084), radial(.079, r, angle - .084), radial(.088, r, angle), radial(.079, r, angle + .084), radial(-.079, r, angle + .084), radial(-.088, r, angle)];
      const g = new T.TubeGeometry(new T.CatmullRomCurve3(points, true, "centripetal"), 40, .0011, 6, true);
      add(`MGU-K copper winding ${i} ${turn}`, g, mat.bronze, upper);
    }
  }
  for (const side of [-1, 1]) {
    const x = side * .103;
    ring(`MGU-K bearing inner race ${side}`, [x - .006, 0, 0], [x + .006, 0, 0], .0085, .0115);
    ring(`MGU-K bearing outer race ${side}`, [x - .006, 0, 0], [x + .006, 0, 0], .017, .0205);
    for (let i = 0; i < 12; i++) {
      const angle = i * Math.PI / 6, part = add(`MGU-K bearing ball ${side} ${i}`, new T.SphereGeometry(.0028, 10, 8), mat.metal);
      part.position.set(x, Math.cos(angle) * .0142, Math.sin(angle) * .0142);
    }
    ring(`MGU-K end shield ${side}`, [side * .099, 0, 0], [side * .114, 0, 0], .0205, .056, mat.cast, true);
    ring(`MGU-K shaft seal ${side}`, [side * .113, 0, 0], [side * .118, 0, 0], .0085, .021, mat.black, true);
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4, y = Math.cos(a) * .050, z = Math.sin(a) * .050;
      ring(`MGU-K end screw ${side} ${i}`, [side * .113, y, z], [side * .117, y, z], .001, .0028, mat.metal, true);
    }
  }
  // Sealed three-phase connector; the loom plugs into the insulated mouth.
  // Put the connections outside the swept gear envelope. Their cast bosses
  // seat on the end shield and have real passages into the motor cartridge.
  const [,powerY,powerZ]=ports.power;
  ring("MGU-K power mounting boss",[.106,powerY,powerZ],[.118,powerY,powerZ],.008,.015,mat.cast);
  ring("MGU-K power socket", [.114,powerY,powerZ], ports.power, .008, .012, mat.darkMetal);
  ring("MGU-K power insulator", [.115,powerY,powerZ], [.134,powerY,powerZ], .0048, .008, mat.orange);
  for (let i = 0; i < 3; i++) {
    const a = i * Math.PI * 2 / 3;
    ring(`MGU-K phase contact ${i}`, [.119,powerY+Math.cos(a)*.003,powerZ+Math.sin(a)*.003], [.131,powerY+Math.cos(a)*.003,powerZ+Math.sin(a)*.003], .0005, .0012, mat.bronze);
  }
  for (const [name, x] of [["in", .095], ["out", -.095]] as const) {
    const end = name === "in" ? ports.coolantIn : ports.coolantOut;
    ring(`MGU-K coolant ${name} union`, [x,end[1],end[2]], end, .004, .0065, mat.metal);
  }
  ring("MGU-K coolant inlet boss",[.099,ports.coolantIn[1],ports.coolantIn[2]],[.115,ports.coolantIn[1],ports.coolantIn[2]],.004,.0085,mat.cast);
  root.updateMatrixWorld(true);
  const shield=root.getObjectByName("MGU-K end shield 1") as T.Mesh;
  for(const [port,radius]of[[ports.power,.008],[ports.coolantIn,.004]] as const){
    const frame=new T.Matrix4().makeBasis(new T.Vector3(0,1,0),new T.Vector3(0,0,1),new T.Vector3(1,0,0));frame.setPosition(0,port[1],port[2]);
    const transform=frame.invert().multiply(shield.matrixWorld);shield.geometry.applyMatrix4(transform);
    openRadialPort(shield,[0,0],radius,1,.090);shield.geometry.applyMatrix4(transform.invert());shield.geometry.computeVertexNormals();
  }
  // Mount holes are drilled through the ears; installed studs and standoffs
  // belong to the car mounting, not this inspectable motor cartridge.
  for (const x of [-.083, .083]) {
    const shape = new T.Shape([new T.Vector2(-.016, -.048), new T.Vector2(.016, -.048), new T.Vector2(.016, -.070), new T.Vector2(-.016, -.070)]);
    const hole = new T.Path(); hole.absarc(0, -.061, .0035, 0, Math.PI * 2, true); shape.holes.push(hole);
    const g = new T.ExtrudeGeometry(shape, { depth: .006, bevelEnabled: false, curveSegments: 16 });
    g.rotateX(Math.PI / 2); g.translate(x, .003, 0);
    // Ear's Y radial direction points toward the engine (negative Z).
    add(`MGU-K mounting ear ${x}`, g, mat.cast);
  }
  root.userData.ports = ports;
  root.userData.clearances = { rotorRadius: .027, statorBore: .029 };
  return { root, ports };
}
