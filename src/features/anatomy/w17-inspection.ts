import * as T from "three";

const nestedCovers: Record<string, readonly string[]> = {
  bodywork: ["bodywork", "engine", "intake", "turbo", "gearbox", "clutch", "differential", "mguk", "cooling"],
  engine: ["engine", "intake"],
  gearbox: ["gearbox", "clutch", "differential"],
};

// Shells often share carbon/metal materials with the mechanisms. Give just
// their surfaces private materials so hovering never fades shafts or pistons.
export function createHoverInspection(root: T.Object3D) {
  const groups = new Map<string, { material: T.MeshStandardMaterial; source: T.MeshStandardMaterial; opacity: number; meshes: { mesh: T.Mesh; shadow: boolean }[] }>();
  root.traverse(part => {
    if (!(part instanceof T.Mesh) || !(part.userData.cover || part.userData.serviceCover) || Array.isArray(part.material)) return;
    const source = part.material as T.MeshStandardMaterial;
    const key = `${part.userData.component}/${!!part.userData.airflowCover}/${source.uuid}`;
    let group = groups.get(key);
    if (!group) {
      const material = source.clone(); material.forceSinglePass = true;
      group = { material, source, opacity: source.opacity, meshes: [] }; groups.set(key, group);
    }
    part.material = group.material;
    group.meshes.push({ mesh: part, shadow: part.castShadow });
  });
  const entries = [...groups].map(([key, group]) => ({ component: key.split("/")[0], airflowCover: key.split("/")[1] === "true", ...group }));
  const update = (hover: string | null, delta: number, immediate = false, airflow = false, enabled = true) => {
    const components = enabled && hover ? nestedCovers[hover] ?? [hover] : [];
    let moving = false, shadowsChanged = false;
    // Returning to the assembled view restores solid shells in the same frame.
    const t = immediate || !enabled ? 1 : 1 - Math.exp(-Math.min(delta, .05) / .12);
    for (const entry of entries) {
      const flowCover = enabled && airflow && (entry.component === "bodywork" || entry.airflowCover);
      const fade = components.includes(entry.component), target = (flowCover ? .12 : fade ? .22 : 1) * entry.opacity;
      const material = entry.material;
      if (material.opacity === target) continue;
      const next = T.MathUtils.lerp(material.opacity, target, t);
      material.opacity = Math.abs(next - target) < .002 ? target : next;
      const transparent = material.opacity < entry.opacity - .001;
      if (material.transparent !== transparent) { material.transparent = transparent; material.needsUpdate = true; }
      material.depthWrite = !transparent;
      for (const { mesh, shadow } of entry.meshes) {
        const cast = shadow && !transparent;
        if (mesh.castShadow !== cast) { mesh.castShadow = cast; shadowsChanged = true; }
      }
      if (material.opacity !== target) moving = true;
    }
    return { moving, shadowsChanged };
  };
  return Object.assign(update, { dispose() {
    for (const entry of entries) {
      for (const { mesh, shadow } of entry.meshes) { mesh.material = entry.source; mesh.castShadow = shadow; }
      entry.material.dispose();
    }
  } });
}
