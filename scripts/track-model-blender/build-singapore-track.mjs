import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateTrackAsset } from "./validate-track.mjs";
import { writeSingaporeClientModel } from "./write-singapore-client-model.mjs";

const scripts = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scripts, "../..");

export async function buildSingaporeTrack() {
  const configPath = path.join(root, ".track-model-build/singapore.json");
  const prepared = path.join(root, ".track-model-build/singapore-prepared");
  const metadataPath = path.join(root, "public/f1/tracks/3d/singapore-metadata.json");
  const glbPath = path.join(root, "public/f1/tracks/3d/singapore.glb");
  const previewPath = path.join(root, "public/f1/tracks/3d/singapore-preview.webp");
  const python = process.env.PYTHON_BIN ?? "python3";
  const run = (command, args) => {
    const result = spawnSync(command, args, {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, PYTHONHASHSEED: "0" },
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${command} failed: ${result.status}`);
  };
  run(python, [path.join(scripts, "download-singapore-data.py"),
    ...(process.argv.includes("--offline") ? ["--offline"] : [])]);
  run(python, [path.join(scripts, "prepare-singapore-model.py")]);
  run(process.env.BLENDER_BIN ?? "blender", [
    "--background", "--factory-startup", "--python-exit-code", "1",
    "--python", path.join(scripts, "build-singapore-digital-twin.py"), "--",
    "--input", configPath, "--prepared", prepared,
    "--glb", glbPath, "--preview", previewPath, "--metadata", metadataPath,
  ]);
  await writeSingaporeClientModel({ configPath, metadataPath });
  const metrics = await validateTrackAsset({
    modelId: "singapore", glbPath, previewPath, metadataPath,
    sourceDirectory: path.join(root, ".track-model-build/singapore-source"),
  });
  console.log(JSON.stringify(metrics, null, 2));
}
