import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

import { AUSTIN_TRACK_MODEL as model } from "./austin-model.ts";
import { getThreeDimensionalTrackModelId } from "./track-models.ts";
import { validateTrackAsset } from "../../scripts/track-model-blender/validate-track.mjs";

const root = new URL("../../", import.meta.url);
const metadata = JSON.parse(await readFile(new URL("public/f1/tracks/3d/austin-metadata.json", root), "utf8"));

test("Austin delivery has a supported circuit, pit lane, and source-pinned structures", async () => {
  const metrics = await validateTrackAsset({
    modelId: "austin",
    glbPath: new URL("public/f1/tracks/3d/austin.glb", root),
    previewPath: new URL("public/f1/tracks/3d/austin-preview.webp", root),
    metadataPath: new URL("public/f1/tracks/3d/austin-metadata.json", root),
  });
  assert.equal(metrics.decodedSurfaceAudit.road.intersections, 0);
  assert.equal(metrics.decodedSurfaceAudit.paint.intersections, 0);
  assert.deepEqual(metrics.decodedSurfaceAudit.structuralConflicts, {});
  assert.equal(metrics.decodedSurfaceAudit.bridgeConflicts, 0);
});

test("Austin official timing references and provisional year remain explicit", () => {
  const { points, turns, sectorBreaks, speedTrapProgress } = model.data;
  const lap = metadata.lapLength.geometryMeters;
  assert.deepEqual(points.at(-1), [1, ...points[0].slice(1)]);
  assert.deepEqual(turns.map(({ number }) => number), Array.from({ length: 20 }, (_, index) => index + 1));
  assert.ok(turns.every((turn, index) => turn.progress > (turns[index - 1]?.progress ?? 0)));
  assert.ok(Math.abs((turns[6].progress - sectorBreaks[0]) * lap - 55) < 0.01);
  assert.ok(Math.abs((turns[12].progress - sectorBreaks[1]) * lap - 65) < 0.01);
  assert.ok(Math.abs((turns[11].progress - speedTrapProgress) * lap - 180) < 0.01);
  assert.equal(metadata.controlPointReference.referenceYear, 2025);
  assert.equal(metadata.controlPointReference.currentEventVerified, false);
  assert.ok(metadata.lapLength.relativeErrorPercent < 0.5);
  assert.equal(model.camera.verticalExaggeration, 1);
  assert.ok(model.webgl.camera.narrowFitWidth / 1.25 >= metadata.boundsMeters.width,
  "The complete scene should fit across a mobile fullscreen view at its initial zoom");
});

test("Austin provenance keeps each released raster and vector source traceable", () => {
  assert.equal(metadata.sourceManifest.sources.length, 5);
  for (const source of metadata.sourceManifest.sources) {
    for (const field of ["file", "url", "role", "license", "attribution", "retrievedAt", "resolution"]) {
      assert.ok(source[field], `${source.file} lacks ${field}`);
    }
    assert.match(source.sha256, /^[0-9a-f]{64}$/);
    assert.ok(source.bytes > 0);
  }
  assert.match(metadata.verticalDatum, /NAVD88/);
  assert.match(metadata.limitations.join(" "), /temporary 2026 structures.*omitted/);
});

test("Austin delivered buildings retain individual aerial colors instead of one white facade", async () => {
  const buildings = metadata.layoutQuality.buildings;
  const sampled = buildings.rendered.filter((building) => building.roofColorNaip);
  assert.equal(sampled.length, buildings.count - 1, "The observation tower uses its own modeled structure");
  assert.match(buildings.facadeMethod, /NAIP 2022.*estimated facade/);
  assert.ok(new Set(sampled.map((building) => building.roofColorNaip.join(","))).size >= 20);
  assert.ok(new Set(sampled.map((building) => building.facadeColorEstimate.map((channel) => channel.toFixed(2)).join(","))).size >= 15);
  assert.ok(sampled.some((building) => building.facadeColorEstimate.every((channel) => channel < 0.5)));
  const glb = await readFile(new URL("public/f1/tracks/3d/austin.glb", root));
  const jsonLength = glb.readUInt32LE(12);
  const gltf = JSON.parse(glb.toString("utf8", 20, 20 + jsonLength));
  const mesh = gltf.meshes.find((item) => item.name === "Austin_Current_Buildings_Mesh");
  const accessor = gltf.accessors[mesh.primitives[0].attributes.COLOR_0];
  const compressed = gltf.bufferViews[accessor.bufferView].extensions.EXT_meshopt_compression;
  const bytes = new Uint8Array(compressed.count * compressed.byteStride);
  await MeshoptDecoder.ready;
  MeshoptDecoder.decodeGltfBuffer(bytes, compressed.count, compressed.byteStride,
    glb.subarray(28 + jsonLength + compressed.byteOffset, 28 + jsonLength + compressed.byteOffset + compressed.byteLength),
    compressed.mode, compressed.filter);
  const colors = new Float32Array(bytes.buffer);
  const uniqueColors = new Set(Array.from({ length: colors.length / 3 }, (_, index) =>
    Array.from(colors.subarray(index * 3, index * 3 + 3), (channel) => channel.toFixed(2)).join(",")));
  assert.ok(uniqueColors.size >= 30, "The exported GLB should keep varied building colors");
});

test("Austin main grandstand has a short supported canopy and open end seating", () => {
  const stand = metadata.layoutQuality.grandstands.footprints.find((item) => item.osmWayId === 460658889);
  assert.ok(stand);
  assert.ok(stand.coveredLengthMeters > 145 && stand.coveredLengthMeters < 160);
  assert.ok(stand.coveredLengthMeters < stand.lengthMeters * 0.6);
  assert.equal(stand.rows, 18);
  assert.equal(stand.endLowerRows, 16);
  assert.ok(stand.groundAnchoredSupports >= 100);
  assert.equal(stand.supportGroundGapMeters, 0);
});

test("Austin adds mapped Grand Plaza seating and ground-supported circuit fixtures", async () => {
  const seating = metadata.layoutQuality.amphitheaterBleachers;
  assert.deepEqual(seating.footprints.map((item) => item.osmWayId).sort(),
    [460658893, 460658894, 460658895, 460658896, 998801548]);
  assert.ok(seating.sections >= 40);
  assert.ok(seating.footprints.every((item) => item.groundAnchored));
  assert.ok(metadata.objects.mappedBarrierPosts >= 900);
  assert.equal(metadata.objects.mappedGateWays, 10);
  assert.equal(metadata.objects.mappedFootbridgeSupports, 28);
  assert.equal(metadata.objects.startLightPods, 5);
  const glb = await readFile(new URL("public/f1/tracks/3d/austin.glb", root));
  const jsonLength = glb.readUInt32LE(12);
  const gltf = JSON.parse(glb.toString("utf8", 20, 20 + jsonLength));
  assert.ok(gltf.meshes.some((mesh) => mesh.name === "Austin_Grand_Plaza_Bleachers_Mesh"));
});

test("Austin resolves from event names and loads through its own lazy asset", async () => {
  for (const name of ["Circuit of The Americas", "Austin", "Остин", "Гран-при США", "United States Grand Prix"]) {
    assert.equal(getThreeDimensionalTrackModelId(name), "austin");
  }
  const lazy = await readFile(new URL("src/components/racemate/track-model-3d-lazy.tsx", root), "utf8");
  assert.match(lazy, /import\("@\/data\/austin-model"\)/);
  for (const [field, file] of [["assetPath", "austin.glb"], ["previewPath", "austin-preview.webp"]]) {
    const data = await readFile(new URL(`public/f1/tracks/3d/${file}`, root));
    assert.equal(new URL(model.webgl[field], "https://raceside.test").searchParams.get("v"),
      createHash("sha256").update(data).digest("hex").slice(0, 12));
  }
});
