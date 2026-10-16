import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// Keep the named construction nodes and their immutable geometry for motion,
// fitting and inspection. Only their static draw surfaces are combined, within
// the same parent and visibility class. No triangles or details are removed.
const visibilityKeys = ["component", "cover", "serviceCover", "airflowCover", "structural", "installedOnly", "brakeAxle", "brakeSide", "cockpitSection", "coolantPump", "oilPump", "hydraulicDrive", "hydraulicPump", "hydraulicPumpCover", "hydraulicBarrel", "steeringSupply"] as const;

export function prepareRenderBatches(root: T.Object3D, moving: Set<T.Object3D> = new Set()) {
  const parents: T.Object3D[] = [];
  root.traverse(parent => parents.push(parent));
  let combined = 0, batches = 0;
  for (const parent of parents) {
    const groups = new Map<string, T.Mesh[]>();
    for (const child of parent.children) {
      if (!(child instanceof T.Mesh) || child instanceof T.InstancedMesh || child instanceof T.SkinnedMesh || Array.isArray(child.material)) continue;
      if (moving.has(child) || child.name === "Crankshaft" || child.userData.engineMotion || child.userData.flap || child.userData.wheel || child.userData.turboRotor || child.userData.brakeRotor) continue;
      if (child.userData.renderBatch || child.layers.mask !== 1 || child.material.transparent || child.morphTargetInfluences) continue;
      child.updateMatrix();
      if (child.matrix.determinant() <= 0 || child.geometry.drawRange.start !== 0 || child.geometry.drawRange.count !== Infinity) continue;
      const attributes = Object.entries((child.geometry as T.BufferGeometry).attributes).map(([name, a]) => `${name}/${a.itemSize}/${a.array.constructor.name}/${a.normalized}`).sort();
      const key = JSON.stringify([child.material.uuid, child.visible, child.castShadow, child.receiveShadow, child.renderOrder, !!child.geometry.index, attributes, ...visibilityKeys.map(k => child.userData[k])]);
      const group = groups.get(key) ?? []; group.push(child); groups.set(key, group);
    }
    for (const parts of groups.values()) {
      if (parts.length < 2) continue;
      const geometries = parts.map(part => part.geometry.clone().applyMatrix4(part.matrix));
      const geometry = mergeGeometries(geometries);
      geometries.forEach(g => g.dispose());
      if (!geometry) continue;
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      const source = parts[0], batch = new T.Mesh(geometry, source.material);
      batch.name = `Render batch ${parent.name} ${batches++}`;
      batch.userData = Object.fromEntries(visibilityKeys.filter(k => source.userData[k] !== undefined).map(k => [k, source.userData[k]]));
      batch.userData.renderBatch = true; batch.userData.sourceCount = parts.length;
      batch.visible = source.visible; batch.castShadow = source.castShadow; batch.receiveShadow = source.receiveShadow; batch.renderOrder = source.renderOrder;
      parent.add(batch);
      // Cameras use layer 0. Construction nodes stay accessible by name and
      // retain their transforms; their surfaces are drawn by the batch.
      for (const part of parts) part.layers.set(1);
      combined += parts.length;
    }
  }
  // Picking uses the original small bounding volumes on layer 1. Raycasting a
  // merged assembly would otherwise visit every triangle in its much larger box.
  root.traverse(part => { if (part instanceof T.Mesh && !part.userData.renderBatch) part.layers.enable(1); });
  return { combined, batches };
}
