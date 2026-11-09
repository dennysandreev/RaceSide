import * as T from "three";
import type { WingLinkage } from "./w17-geometry.ts";

// The launch overhead view has a forward centre and swept-back outer panels.
// Apply the same planform to every joined skin, hinge and mounting saddle.
// Re-express moving geometry in the new hinge frame so opening stays rigid.
export function fitFrontPlanform(root: T.Group, linkages: WingLinkage[]) {
  const advance = (z: number) => .28 * Math.max(0, 1 - Math.abs(z) / .75);
  const swept = (p: T.Vector3) => new T.Vector3(p.x + advance(p.z), p.y, p.z);
  const links = linkages.filter(link => link.wing.userData.component === "front-wing");
  const endpoints = links.map(link => swept(link.end.clone().applyQuaternion(link.wing.quaternion).add(link.wing.position)));
  const moving = new Set(links.map(link => link.mesh));
  root.updateMatrixWorld(true);
  root.traverse(part => {
    if (!(part instanceof T.Mesh) || part.userData.component !== "front-wing" || moving.has(part)) return;
    const world = part.matrixWorld.clone(), geometry = part.geometry;
    if (part.name.endsWith("fixed clevis")) part.position.copy(swept(part.position));
    if (part.userData.pivot) {
      part.position.copy(swept(part.position));
      part.userData.pivot = part.position.toArray();
      const axis = part.userData.hingeAxis as T.Vector3;
      axis.x -= .28 / .75 * Math.sign(part.position.z) * axis.z;
      axis.normalize();
      part.quaternion.setFromAxisAngle(axis, part.userData.closedAngle);
    }
    part.updateMatrix();
    const inverse = part.matrix.clone().invert(), p = geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const v = swept(new T.Vector3().fromBufferAttribute(p, i).applyMatrix4(world)).applyMatrix4(inverse);
      p.setXYZ(i, v.x, v.y, v.z);
    }
    geometry.computeVertexNormals();
  });
  links.forEach((link, i) => {
    link.anchor.copy(swept(link.anchor));
    link.end.copy(endpoints[i].sub(link.wing.position).applyQuaternion(link.wing.quaternion.clone().invert()));
  });
  for (const actuator of new Set(links.map(link => link.mesh.userData.actuator).filter(Boolean))) {
    const parts = links.filter(link => link.mesh.userData.actuator === actuator), sample = parts[0];
    let minimum = Infinity, maximum = 0;
    for (let i = 0; i <= 100; i++) {
      const rotation = new T.Quaternion().setFromAxisAngle(sample.wing.userData.hingeAxis,
        T.MathUtils.lerp(sample.wing.userData.closedAngle, sample.wing.userData.openAngle, i / 100));
      const length = sample.end.clone().applyQuaternion(rotation).add(sample.wing.position).distanceTo(sample.anchor);
      minimum = Math.min(minimum, length); maximum = Math.max(maximum, length);
    }
    const barrel = minimum - .009, rod = maximum - barrel + .006;
    const offsets: Record<string, [number, number]> = {
      body: [.004, barrel], "end cap": [.001, .004], gland: [barrel - .003, barrel],
      "rod seal": [barrel - .001, barrel + .0005], rod: [-rod, 0],
      piston: [-rod, -rod + .003], "piston seal": [-rod + .001, -rod + .002],
    };
    for (const link of parts) {
      [link.fromOffset, link.toOffset] = offsets[link.mesh.userData.actuatorPart];
      if (link.mesh.userData.actuatorPart === "body") link.mesh.userData.stroke = maximum - minimum;
    }
  }
  // Lengthen only the forward crash/nose tip to keep it seated on the swept
  // centre. The suspension cell and its removable service panel stay in place.
  for (const name of ["Silver nose skin", "Nose structural core"]) {
    const part = root.getObjectByName(name) as T.Mesh, p = part.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) + .26 * T.MathUtils.clamp((p.getX(i) - 1.8) / .732, 0, 1));
    part.geometry.computeVertexNormals();
  }
}
