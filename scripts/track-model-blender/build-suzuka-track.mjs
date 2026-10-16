import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateTrackAsset } from "./validate-track.mjs";
import { writeSuzukaClientModel } from "./write-suzuka-client-model.mjs";

const scripts = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scripts, "../..");

export async function buildSuzukaTrack() {
  const configPath = path.join(root, ".track-model-build/suzuka.json");
  const prepared = path.join(root, ".track-model-build/suzuka-prepared");
  const metadataPath = path.join(root, "public/f1/tracks/3d/suzuka-metadata.json");
  const glbPath = path.join(root, "public/f1/tracks/3d/suzuka.glb");
  const previewPath = path.join(root, "public/f1/tracks/3d/suzuka-preview.webp");
  const run = (command, args) => {
    const result = spawnSync(command, args, { cwd: root, stdio: "inherit", env: { ...process.env, PYTHONHASHSEED: "0" } });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${command} failed: ${result.status}`);
  };
  const python = process.env.PYTHON_BIN ?? "python3";
  run(python, [path.join(scripts, "download-suzuka-data.py"), ...(process.argv.includes("--offline") ? ["--offline"] : [])]);
  run(python, [path.join(scripts, "prepare-suzuka-model.py")]);
  run(process.env.BLENDER_BIN ?? "blender", ["--background", "--factory-startup", "--python-exit-code", "1",
    "--python", path.join(scripts, "build-suzuka-digital-twin.py"), "--", "--input", configPath,
    "--prepared", prepared, "--glb", glbPath, "--preview", previewPath, "--metadata", metadataPath]);
  await writeSuzukaClientModel({ configPath, metadataPath });
  console.log(JSON.stringify(await validateTrackAsset({ modelId: "suzuka", glbPath, previewPath, metadataPath,
    sourceDirectory: path.join(root, ".track-model-build/suzuka-source") }), null, 2));
}
