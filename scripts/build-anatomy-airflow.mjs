import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createModelInstance, replaceRearWing } from "../src/features/anatomy/w17-model-cache.ts";
import { createAirflowPaths } from "../src/features/anatomy/w17-airflow.ts";

// Run after changing the exterior or wing kinematics. Surface sampling belongs
// in asset preparation, not in the user's click handler.
const output = new URL("../public/anatomy/", import.meta.url);
await mkdir(output, { recursive: true });
const model = createModelInstance(), manifest = {};
for (const variant of ["mercedes", "ferrari", "red-bull"]) {
  replaceRearWing(model, variant);
  const paths = createAirflowPaths(model.root, model.linkages).map(path => {
    const states = path.states ?? [path.corner, path.straight];
    const unchanged = states.every(state => state.every((p, i) => p.equals(states[0][i])));
    return { id: path.id, layer: path.layer, ...(path.radii?{radii:path.radii}:{}), states: (unchanged ? [states[0]] : states).map(state => state.flatMap(p => p.toArray().map(v => Number(v.toFixed(6))))) };
  });
  const content = JSON.stringify({ version: 1, paths });
  const revision = createHash("sha256").update(content).digest("hex").slice(0, 12);
  await writeFile(new URL(`airflow-${variant}.json`, output), content + "\n");
  manifest[variant] = `/anatomy/airflow-${variant}.json?v=${revision}`;
  console.log(`${variant}: ${paths.length} paths, ${Math.round(content.length / 1024)} KiB`);
}
await writeFile(new URL("../src/features/anatomy/w17-airflow-manifest.json", import.meta.url), JSON.stringify(manifest, null, 2) + "\n");
