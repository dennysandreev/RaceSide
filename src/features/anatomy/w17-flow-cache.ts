import * as T from "three";
import type { RearWingVariant } from "./catalog.ts";
import type { AirflowPath } from "./w17-airflow.ts";
import manifest from "./w17-airflow-manifest.json" with { type: "json" };

const paths = new Map<RearWingVariant, Promise<AirflowPath[]>>();
type FlowAsset = { version: number; paths: { id: string; layer: AirflowPath["layer"]; states: number[][]; radii?:number[] }[] };

export function decodeAirflowPaths(asset: FlowAsset): AirflowPath[] {
  if (asset.version !== 1 || !Array.isArray(asset.paths) || !asset.paths.length) throw new Error("Invalid airflow asset");
  return asset.paths.map(path => {
    if (!Array.isArray(path.states) || !path.states.length || !["body", "floor", "wings", "wake", "cooling"].includes(path.layer)) throw new Error("Invalid airflow path");
    const length = path.states[0].length;
    if (length < 6 || length % 3) throw new Error("Invalid airflow samples");
    if (path.radii && (path.radii.length !== length / 3 || !path.radii.every(r => Number.isFinite(r) && r > 0 && r < .02))) throw new Error("Invalid airflow radii");
    const states = path.states.map(state => {
      if (state.length !== length || !state.every(Number.isFinite)) throw new Error("Invalid airflow state");
      return Array.from({ length: length / 3 }, (_, i) => new T.Vector3(state[i * 3], state[i * 3 + 1], state[i * 3 + 2]));
    });
    return { id: path.id, layer: path.layer, corner: states[0], straight: states.at(-1)!, ...(states.length > 2 ? { states } : {}), ...(path.radii?{radii:path.radii}:{}) };
  });
}

// Geometry clearance is calculated by scripts/build-anatomy-airflow.mjs.
// The browser only decodes the selected variant; repeated toggles reuse it.
export function loadAirflowPaths(variant: RearWingVariant) {
  let pending = paths.get(variant);
  if (!pending) {
    pending = fetch(manifest[variant]).then(async response => {
      if (!response.ok) throw new Error(`Airflow asset: ${response.status}`);
      return decodeAirflowPaths(await response.json());
    }).catch(error => { paths.delete(variant); throw error; });
    paths.set(variant, pending);
  }
  return pending;
}
