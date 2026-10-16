import { mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { exportTrackData } from "./export-track-data.mjs";
import { buildBakuTrack } from "./build-baku-track.mjs";
import { buildYasMarinaTrack } from "./build-yas-marina-track.mjs";
import { buildSingaporeTrack } from "./build-singapore-track.mjs";
import { buildAustinTrack } from "./build-austin-track.mjs";
import { buildLasVegasTrack } from "./build-las-vegas-track.mjs";
import { buildQatarTrack } from "./build-qatar-track.mjs";
import { buildShanghaiTrack } from "./build-shanghai-track.mjs";
import { buildAlbertParkTrack } from "./build-albert-park-track.mjs";
import { buildSuzukaTrack } from "./build-suzuka-track.mjs";
import { buildMexicoTrack } from "./build-mexico-track.mjs";
import { buildInterlagosTrack } from "./build-interlagos-track.mjs";
import { buildMiamiTrack } from "./build-miami-track.mjs";
import { exportCatalunyaTrackData } from "./export-catalunya-track-data.mjs";
import { exportHungaroringTrackData } from "./export-hungaroring-track-data.mjs";
import { exportMonacoTrackData } from "./export-monaco-track-data.mjs";
import { exportMontrealTrackData } from "./export-montreal-track-data.mjs";
import { exportMonzaTrackData } from "./export-monza-track-data.mjs";
import { exportMadringTrackData } from "./export-madring-track-data.mjs";
import { exportRedBullRingTrackData } from "./export-red-bull-ring-track-data.mjs";
import { exportSilverstoneTrackData } from "./export-silverstone-track-data.mjs";
import { exportSpaTrackData } from "./export-spa-track-data.mjs";
import { exportSepangTrackData } from "./export-sepang-track-data.mjs";
import { validateTrackAsset } from "./validate-track.mjs";
import { writeCatalunyaClientModel } from "./write-catalunya-client-model.mjs";
import { writeHungaroringClientModel } from "./write-hungaroring-client-model.mjs";
import { writeMonacoClientModel } from "./write-monaco-client-model.mjs";
import { writeMontrealClientModel } from "./write-montreal-client-model.mjs";
import { writeMonzaClientModel } from "./write-monza-client-model.mjs";
import { writeMadringClientModel } from "./write-madring-client-model.mjs";
import { writeRedBullRingClientModel } from "./write-red-bull-ring-client-model.mjs";
import { writeSilverstoneClientModel } from "./write-silverstone-client-model.mjs";
import { writeSpaClientModel } from "./write-spa-client-model.mjs";
import { writeSepangClientModel } from "./write-sepang-client-model.mjs";
import { writeZandvoortClientModel } from "./write-zandvoort-client-model.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "../..");

const modelId = process.argv.slice(2).find((value) => !value.startsWith("--")) ?? "zandvoort";
if (modelId === "yas-marina") {
  await buildYasMarinaTrack();
  process.exit(0);
}
if (modelId === "qatar") {
  await buildQatarTrack();
  process.exit(0);
}
if (modelId === "las-vegas") {
  await buildLasVegasTrack();
  process.exit(0);
}
if (modelId === "albert-park") {
  await buildAlbertParkTrack();
  process.exit(0);
}
if (modelId === "interlagos") {
  await buildInterlagosTrack();
  process.exit(0);
}
if (modelId === "shanghai") {
  await buildShanghaiTrack();
  process.exit(0);
}
if (modelId === "suzuka") {
  await buildSuzukaTrack();
  process.exit(0);
}
if (modelId === "mexico") {
  await buildMexicoTrack();
  process.exit(0);
}
if (modelId === "singapore") {
  await buildSingaporeTrack();
  process.exit(0);
}
if (modelId === "austin") {
  await buildAustinTrack();
  process.exit(0);
}
if (modelId === "miami") {
  await buildMiamiTrack();
  process.exit(0);
}
if (modelId === "baku") {
  await buildBakuTrack();
  process.exit(0);
}
const buildDirectory = path.join(projectRoot, ".track-model-build");
const publicDirectory = path.join(projectRoot, "public/f1/tracks/3d");
const inputPath = path.join(buildDirectory, `${modelId}.json`);
const preparedDirectory = path.join(buildDirectory, `${modelId}-prepared`);
const glbPath = path.join(publicDirectory, `${modelId}.glb`);
const previewPath = path.join(publicDirectory, `${modelId}-preview.webp`);
const metadataPath = path.join(publicDirectory, `${modelId}-metadata.json`);

await Promise.all([
  mkdir(buildDirectory, { recursive: true }),
  mkdir(preparedDirectory, { recursive: true }),
  mkdir(publicDirectory, { recursive: true }),
]);
const forceSources = process.argv.includes("--force-sources");
const payload = modelId === "sepang"
  ? await exportSepangTrackData({ forceSources, outputPath: inputPath })
  : modelId === "madring"
  ? await exportMadringTrackData({ forceSources, outputPath: inputPath })
  : modelId === "catalunya"
  ? await exportCatalunyaTrackData({ forceSources, outputPath: inputPath })
  : modelId === "silverstone"
  ? await exportSilverstoneTrackData({ forceSources, outputPath: inputPath })
  : modelId === "spa"
    ? await exportSpaTrackData({ forceSources, outputPath: inputPath })
    : modelId === "hungaroring"
      ? await exportHungaroringTrackData({ forceSources, outputPath: inputPath })
      : modelId === "red-bull-ring"
        ? await exportRedBullRingTrackData({ forceSources, outputPath: inputPath })
        : modelId === "montreal"
          ? await exportMontrealTrackData({ forceSources, outputPath: inputPath })
        : modelId === "monza"
          ? await exportMonzaTrackData({ forceSources, outputPath: inputPath })
        : modelId === "monaco"
          ? await exportMonacoTrackData({ forceSources, outputPath: inputPath })
      : await exportTrackData({ forceSources, modelId, outputPath: inputPath });
const isSpa = modelId === "spa";
const isSepang = modelId === "sepang";
const isCatalunya = modelId === "catalunya";
const isHungaroring = modelId === "hungaroring";
const isMonaco = modelId === "monaco";
const isMontreal = modelId === "montreal";
const isMonza = modelId === "monza";
const isMadring = modelId === "madring";
const isRedBullRing = modelId === "red-bull-ring";
const isSilverstone = modelId === "silverstone";

run(process.env.PYTHON_BIN ?? "python3", [
  path.join(
    scriptDirectory,
    isSepang
      ? "prepare-sepang-rasters.py"
      : isMadring
      ? "prepare-madring-rasters.py"
      : isCatalunya
      ? "prepare-catalunya-rasters.py"
      : isSpa
      ? "prepare-spa-rasters.py"
      : isSilverstone
        ? "prepare-silverstone-rasters.py"
        : isHungaroring
          ? "prepare-hungaroring-rasters.py"
          : isRedBullRing
            ? "prepare-red-bull-ring-rasters.py"
            : isMontreal
              ? "prepare-montreal-rasters.py"
            : isMonza
              ? "prepare-monza-rasters.py"
            : isMonaco
              ? "prepare-monaco-rasters.py"
          : "prepare-zandvoort-rasters.py",
  ),
  "--source",
  payload.sourceDirectory,
  "--output",
  preparedDirectory,
]);

run(process.env.BLENDER_BIN ?? "blender", [
  "--background",
  "--factory-startup",
  "--python-exit-code",
  "1",
  "--python",
  path.join(
    scriptDirectory,
    isSepang
      ? "build-sepang-digital-twin.py"
      : isMadring
      ? "build-madring-digital-twin.py"
      : isCatalunya
      ? "build-catalunya-digital-twin.py"
      : isSpa
      ? "build-spa-digital-twin.py"
      : isSilverstone
        ? "build-silverstone-digital-twin.py"
        : isHungaroring
          ? "build-hungaroring-digital-twin.py"
          : isRedBullRing
            ? "build-red-bull-ring-digital-twin.py"
            : isMontreal
              ? "build-montreal-digital-twin.py"
            : isMonza
              ? "build-monza-digital-twin.py"
            : isMonaco
              ? "build-monaco-digital-twin.py"
          : "build-zandvoort-digital-twin.py",
  ),
  "--",
  "--input",
  inputPath,
  "--prepared",
  preparedDirectory,
  "--glb",
  glbPath,
  "--preview",
  previewPath,
  "--metadata",
  metadataPath,
]);

if (isSepang) {
  await writeSepangClientModel({ configPath: inputPath, metadataPath });
} else if (isMadring) {
  await writeMadringClientModel({ configPath: inputPath, metadataPath });
} else if (isCatalunya) {
  await writeCatalunyaClientModel({ configPath: inputPath, metadataPath });
} else if (isSilverstone) {
  await writeSilverstoneClientModel({ configPath: inputPath, metadataPath });
} else if (isSpa) {
  await writeSpaClientModel({ configPath: inputPath, metadataPath });
} else if (isHungaroring) {
  await writeHungaroringClientModel({ configPath: inputPath, metadataPath });
} else if (isRedBullRing) {
  await writeRedBullRingClientModel({ configPath: inputPath, metadataPath });
} else if (isMontreal) {
  await writeMontrealClientModel({ configPath: inputPath, metadataPath });
} else if (isMonza) {
  await writeMonzaClientModel({ configPath: inputPath, metadataPath });
} else if (isMonaco) {
  await writeMonacoClientModel({ configPath: inputPath, metadataPath });
} else {
  await writeZandvoortClientModel({ inputPath, configPath: inputPath, metadataPath });
}
const metrics = await validateTrackAsset({
  glbPath,
  metadataPath,
  modelId,
  previewPath,
  sourceDirectory: payload.sourceDirectory,
});
console.log(`Built ${modelId}:`);
console.log(JSON.stringify(metrics, null, 2));

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, PYTHONHASHSEED: "0" },
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}`);
  }
}
