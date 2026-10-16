import * as T from "three";
import { createEngineMotion, ENGINE_CORE } from "./w17-engine-core.ts";

// A steady straight run in fourth gear. These are the tooth counts already
// modeled in the gearbox; time is deliberately slowed for inspection.
export const VEHICLE_MOTION = { engineSpeed: 3.2, primaryTeeth: 36, mainTeeth: 64, pinionTeeth: 14, crownTeeth: 32 };
const mainRatio = -VEHICLE_MOTION.primaryTeeth / VEHICLE_MOTION.mainTeeth;
export const wheelRatio = -mainRatio * VEHICLE_MOTION.pinionTeeth / VEHICLE_MOTION.crownTeeth;
type Rotation = { axis: number[]; ratio: number };

// Establish pivots before static draw batching. Original meshes, geometry and
// their installed world transforms are retained, including the picking layer.
export function prepareVehicleMotion(root: T.Object3D) {
  if (root.userData.vehicleMotionPrepared) return;
  root.userData.vehicleMotionPrepared = true;
  root.updateMatrixWorld(true);
  const centre = (name: string) => {
    const part = root.getObjectByName(name);
    return part ? new T.Box3().setFromObject(part).getCenter(new T.Vector3()) : null;
  };
  const input = centre("Gearbox input shaft"), main = centre("Gearbox main shaft"), diff = centre("Differential drum");
  if (!input || !main || !diff) return;
  const xAxis = new T.Vector3(1, 0, 0), zAxis = new T.Vector3(0, 0, 1);
  const pivot = (component: string, name: string, origin: T.Vector3, axis: T.Vector3, ratio: number, matches: (part: T.Object3D) => boolean) => {
    const parent = root.getObjectByName(component);
    if (!parent) return;
    const parts: T.Object3D[] = [];
    parent.traverse(part => { if (part instanceof T.Mesh && matches(part)) parts.push(part); });
    if (!parts.length) return;
    const group = new T.Group(); group.name = name;
    group.position.copy(parent.worldToLocal(origin.clone()));
    group.userData = { component, vehicleRotation: { axis: axis.toArray(), ratio } satisfies Rotation };
    parent.add(group); group.updateMatrixWorld(true);
    for (const part of parts) group.attach(part);
  };
  pivot("clutch", "Clutch rotating assembly", input, xAxis, 1, p => p.name !== "Clutch release ring");
  pivot("gearbox", "Gearbox input rotation", input, xAxis, 1, p => p.name === "Gearbox input shaft" || /^(Primary ratio gear|Input gear hub) /.test(p.name));
  pivot("gearbox", "Gearbox output rotation", main, xAxis, mainRatio, p => p.name === "Gearbox main shaft" || p.name === "Final drive hypoid pinion" || p.name.startsWith("Selector dog ring "));
  for (let i = 0; i < 8; i++) {
    const teeth = 24 + i * 4;
    pivot("gearbox", `Gearbox ratio ${i + 1} rotation`, main, xAxis, -teeth / (100 - teeth), p => p.name === `Main ratio gear ${i + 1}`);
  }
  // On a straight the sun gears and planets travel with the carrier, without
  // relative differential action. Hydraulic actuators and outer races stay put.
  pivot("differential", "Differential carrier rotation", diff, zAxis, wheelRatio, p => /^(Final drive crown wheel|Crown carrier bolt|Differential (drum|planet|sun|carrier|output shaft|output key|output flange|output thrust shoulder|bearing inner race|clutch plate|clutch pressure ring|clutch rotating collar|thrust rotating race|end bolt))($| )/.test(p.name));
  for (const side of [-1, 1]) {
    const shaft = root.getObjectByName(`Half shaft ${side}`);
    if (shaft) {
      const inner = new T.Vector3(diff.x, diff.y, side * .175), outer = new T.Vector3(diff.x, .355, side * .513);
      const axis = outer.clone().sub(inner).multiplyScalar(side).normalize();
      pivot("differential", `Half shaft rotation ${side}`, inner.clone().add(outer).multiplyScalar(.5), axis, wheelRatio, p => p === shaft);
    }
    pivot("differential", `Inner drive joint rotation ${side}`, diff, zAxis, wheelRatio, p => p.name === `Inner CV joint ${side}` || p.name === `Half shaft boot collar ${side} 0.19`);
    pivot("differential", `Rear hub drive rotation ${side}`, new T.Vector3(diff.x, .355, 0), zAxis, wheelRatio, p => p.name === `CV joint ${side}` || p.name === `Rear drive stub ${side}` || p.name === `Half shaft boot collar ${side} 0.498`);
  }
  root.traverse(part => {
    if (part.userData.wheel || part.userData.brakeRotor) part.userData.vehicleRotation = { axis: [0, 0, 1], ratio: wheelRatio } satisfies Rotation;
    // Turbo speed is illustrative: it is driven by exhaust, not geared to the crank.
    if (part.userData.turboRotor) part.userData.vehicleRotation = { axis: [1, 0, 0], ratio: 4 } satisfies Rotation;
  });
  root.updateMatrixWorld(true);
}

export function createVehicleMotion(root: T.Object3D) {
  const engine = createEngineMotion(root), rotations: { part: T.Object3D; base: T.Quaternion; axis: T.Vector3; ratio: number }[] = [];
  root.traverse(part => {
    const motion = part.userData.vehicleRotation as Rotation | undefined;
    if (motion) rotations.push({ part, base: part.quaternion.clone(), axis: new T.Vector3().fromArray(motion.axis), ratio: motion.ratio });
  });
  const rotation = new T.Quaternion();
  return (angle: number) => {
    engine(angle);
    const travel = angle - ENGINE_CORE.initialAngle;
    for (const { part, base, axis, ratio } of rotations) part.quaternion.copy(base).premultiply(rotation.setFromAxisAngle(axis, travel * ratio));
  };
}
