import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateTrackAsset } from "./validate-track.mjs";
import { writeAlbertParkClientModel } from "./write-albert-park-client-model.mjs";

const scripts = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scripts, "../..");

export async function buildAlbertParkTrack() {
  const configPath = path.join(root, ".track-model-build/albert-park.json");
  const prepared = path.join(root, ".track-model-build/albert-park-prepared");
  const metadataPath = path.join(root, "public/f1/tracks/3d/albert-park-metadata.json");
  const glbPath = path.join(root, "public/f1/tracks/3d/albert-park.glb");
  const previewPath = path.join(root, "public/f1/tracks/3d/albert-park-preview.webp");
  const run = (command, args) => {
    const result = spawnSync(command, args, { cwd: root, stdio: "inherit", env: { ...process.env, PYTHONHASHSEED: "0" } });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${command} failed: ${result.status}`);
  };
  const python = process.env.PYTHON_BIN ?? "python3";
  run(python, [path.join(scripts, "download-albert-park-data.py"), ...(process.argv.includes("--offline") ? ["--offline"] : [])]);
  run(python, [path.join(scripts, "prepare-albert-park-model.py")]);
  run(process.env.BLENDER_BIN ?? "blender", ["--background", "--factory-startup", "--python-exit-code", "1",
    "--python", path.join(scripts, "build-albert-park-digital-twin.py"), "--", "--input", configPath,
    "--prepared", prepared, "--glb", glbPath, "--preview", previewPath, "--metadata", metadataPath]);
  await writeAlbertParkClientModel({ configPath, metadataPath });
  console.log(JSON.stringify(await validateTrackAsset({ modelId: "albert-park", glbPath, previewPath, metadataPath,
    sourceDirectory: path.join(root, ".track-model-build/albert-park-source") }), null, 2));
}
