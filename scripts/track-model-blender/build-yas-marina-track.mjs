import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateTrackAsset } from "./validate-track.mjs";
import { writeYasMarinaClientModel } from "./write-yas-marina-client-model.mjs";

const scripts = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scripts, "../..");

export async function buildYasMarinaTrack() {
  const configPath = path.join(root, ".track-model-build/yas-marina.json");
  const prepared = path.join(root, ".track-model-build/yas-marina-prepared");
  const metadataPath = path.join(root, "public/f1/tracks/3d/yas-marina-metadata.json");
  const glbPath = path.join(root, "public/f1/tracks/3d/yas-marina.glb");
  const previewPath = path.join(root, "public/f1/tracks/3d/yas-marina-preview.webp");
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
  run(python, [path.join(scripts, "download-yas-marina-data.py"),
    ...(process.argv.includes("--offline") ? ["--offline"] : [])]);
  run(python, [path.join(scripts, "prepare-yas-marina-model.py")]);
  run(process.env.BLENDER_BIN ?? "blender", [
    "--background", "--factory-startup", "--python-exit-code", "1",
    "--python", path.join(scripts, "build-yas-marina-digital-twin.py"), "--",
    "--input", configPath, "--prepared", prepared,
    "--glb", glbPath, "--preview", previewPath, "--metadata", metadataPath,
  ]);
  await writeYasMarinaClientModel({ configPath, metadataPath });
  const metrics = await validateTrackAsset({
    modelId: "yas-marina", glbPath, previewPath, metadataPath,
    sourceDirectory: path.join(root, ".track-model-build/yas-marina-source"),
  });
  console.log(JSON.stringify(metrics, null, 2));
}
