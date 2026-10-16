import * as T from "three";
import { createW17, type WingLinkage } from "./w17-geometry.ts";
import type { RearWingVariant } from "./catalog.ts";
import { fetchModelAsset } from "./w17-model-asset.ts";
import { prepareRenderBatches } from "./w17-render-batches.ts";
import { prepareVehicleMotion } from "./w17-vehicle-motion.ts";
import manifest from "./w17-model-manifest.json" with { type: "json" };

type Model = ReturnType<typeof createW17>;
export type CockpitFocus = "all" | "seat" | "wheel" | "pedals";
export function visibleInCockpit(part: T.Object3D, focus: CockpitFocus) {
  return focus === "all" || (part.userData.cockpitSection ?? "seat") === focus;
}
export type CoolingFocus = "all" | "left-pump" | "right-pump" | "lt-pump" | "oil-pump";
export type HydraulicFocus = "all" | "pump-drive" | "pump";
export function visibleInHydraulics(part: T.Object3D, focus: HydraulicFocus) {
  return focus === "all" || (focus === "pump" ? part.userData.hydraulicPump === true : part.userData.hydraulicDrive === true);
}
export function visibleInCooling(part: T.Object3D, focus: CoolingFocus) {
  if (focus === "oil-pump") return part.userData.oilPump === true;
  return focus === "all" || (part.userData.coolantPump === "main" && focus !== "lt-pump") || part.userData.coolantPump === (focus === "lt-pump" ? "lt" : focus === "right-pump" ? 1 : -1);
}
let template: Model | undefined;
const rearTemplates = new Map<RearWingVariant, Model>();
let loading: Promise<void> | undefined;
let loadError: unknown;

// Suspense keeps the canvas responsive while finished mesh data is fetched.
// Procedural builders remain available to the asset script and geometry tests.
export function preloadModel() {
  if (!loading) loading = Promise.all((Object.keys(manifest) as RearWingVariant[]).map(async variant => {
    const model = await fetchModelAsset(manifest[variant]) as Model;
    prepareVehicleMotion(model.root);
    prepareRenderBatches(model.root, new Set(model.linkages.map(link => link.mesh)));
    if (variant === "mercedes") template = model;
    else rearTemplates.set(variant, model);
  })).then(() => undefined).catch(error => { loadError = error; });
  return loading;
}

const powertrainAssemblies = new Set([
  "engine", "turbo", "intake", "exhaust", "mguk", "clutch", "gearbox", "differential",
  "battery", "inverter", "electronics", "fuel", "cooling", "hydraulics",
]);
// Keep the complete installed powertrain and its support circuits connected.
// Only the gearbox casing is removed to expose the gear train and clutch.
export function visibleInPowertrain(part: T.Object3D) {
  const id = part.userData.component;
  return powertrainAssemblies.has(id) && !part.userData.steeringSupply && !(id === "gearbox" && part.userData.cover);
}

// Geometry is immutable after construction and shared across canvases. Keep a
// bounded cache (one car, three wings); each view owns transforms and materials.
function fullTemplate() {
  if (typeof window !== "undefined") {
    if (loadError) throw loadError;
    if (!template || rearTemplates.size < 2) throw preloadModel();
  }
  if (!template) { template = createW17(); prepareVehicleMotion(template.root); }
  return template;
}

function cloneAssembly(source: T.Group, sourceLinks: WingLinkage[]) {
  const objects = new Map<T.Object3D, T.Object3D>(), materials = new Map<T.Material, T.Material>();
  const copy = (part: T.Object3D): T.Object3D => {
    const clone = part.clone(false);
    clone.userData = { ...part.userData, basePosition: part.position.clone() };
    objects.set(part, clone);
    if (clone instanceof T.Mesh) {
      const original = clone.material as T.Material;
      if (!materials.has(original)) materials.set(original, original.clone());
      clone.material = materials.get(original)!;
    }
    for (const child of part.children) clone.add(copy(child));
    return clone;
  };
  const group = copy(source) as T.Group;
  const linkages = sourceLinks.filter(link => objects.has(link.mesh)).map(link => ({
    ...link, mesh: objects.get(link.mesh) as T.Mesh, wing: objects.get(link.wing) as T.Mesh,
    anchor: link.anchor.clone(), end: link.end.clone(),
  }));
  return { group, linkages };
}

export function createModelInstance(component?: string): Model {
  const source = fullTemplate(), root = new T.Group(), assemblies = new Map<string, T.Group>(), linkages: WingLinkage[] = [];
  root.name = "Formula-1-2026"; root.userData.rearWing = "mercedes";
  for (const [id, group] of source.assemblies) {
    if (component && component !== id && !(component === "battery" && id === "inverter")) continue;
    const cloned = cloneAssembly(group, source.linkages);
    root.add(cloned.group); assemblies.set(id, cloned.group); linkages.push(...cloned.linkages);
  }
  if (component === "cockpit") {
    const wheel = source.assemblies.get("steering")?.getObjectByName("Complete steering wheel") as T.Group | undefined;
    if (wheel) assemblies.get("cockpit")!.add(cloneAssembly(wheel, []).group);
  }
  return { root, assemblies, linkages, materials: source.materials };
}

export function replaceRearWing(model: Model, variant: RearWingVariant) {
  if (model.root.userData.rearWing === variant) return false;
  model.root.userData.rearWing = variant;
  const previous = model.assemblies.get("rear-wing");
  if (!previous) return false;
  let source = variant === "mercedes" ? fullTemplate() : rearTemplates.get(variant);
  if (!source) { source = createW17(variant, { rearWingOnly: true }); rearTemplates.set(variant, source); }
  const next = cloneAssembly(source.assemblies.get("rear-wing")!, source.linkages);
  next.group.position.copy(previous.position);
  previous.removeFromParent(); disposeInstanceMaterials(previous);
  model.root.add(next.group); model.assemblies.set("rear-wing", next.group);
  for (let i = model.linkages.length - 1; i >= 0; i--) if (model.linkages[i].wing.userData.component === "rear-wing") model.linkages.splice(i, 1);
  model.linkages.push(...next.linkages);
  return true;
}

export function disposeInstanceMaterials(root: T.Object3D) {
  const materials = new Set<T.Material>();
  root.traverse(part => { if (part instanceof T.Mesh) materials.add(part.material as T.Material); });
  materials.forEach(material => material.dispose());
}
