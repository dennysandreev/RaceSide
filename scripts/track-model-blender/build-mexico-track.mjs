import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateTrackAsset } from "./validate-track.mjs";
import { writeMexicoClientModel } from "./write-mexico-client-model.mjs";

const scripts = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scripts, "../..");

export async function buildMexicoTrack() {
  const configPath = path.join(root, ".track-model-build/mexico.json");
  const prepared = path.join(root, ".track-model-build/mexico-prepared");
  const metadataPath = path.join(root, "public/f1/tracks/3d/mexico-metadata.json");
  const glbPath = path.join(root, "public/f1/tracks/3d/mexico.glb");
  const previewPath = path.join(root, "public/f1/tracks/3d/mexico-preview.webp");
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
  run(python, [path.join(scripts, "download-mexico-data.py"),
    ...(process.argv.includes("--offline") ? ["--offline"] : [])]);
  run(python, [path.join(scripts, "prepare-mexico-model.py")]);
  run(process.env.BLENDER_BIN ?? "blender", [
    "--background", "--factory-startup", "--python-exit-code", "1",
    "--python", path.join(scripts, "build-mexico-digital-twin.py"), "--",
    "--input", configPath, "--prepared", prepared,
    "--glb", glbPath, "--preview", previewPath, "--metadata", metadataPath,
  ]);
  await writeMexicoClientModel({ configPath, metadataPath });
  const metrics = await validateTrackAsset({
    modelId: "mexico", glbPath, previewPath, metadataPath,
    sourceDirectory: path.join(root, ".track-model-build/mexico-source"),
  });
  console.log(JSON.stringify(metrics, null, 2));
}
