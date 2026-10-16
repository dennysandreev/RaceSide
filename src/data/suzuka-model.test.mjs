import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import sharp from "sharp";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

import { SUZUKA_TRACK_MODEL as model } from "./suzuka-model.ts";
import { getThreeDimensionalTrackModelId } from "./track-models.ts";
import { validateTrackAsset } from "../../scripts/track-model-blender/validate-track.mjs";

const root = new URL("../../", import.meta.url);
const metadata = JSON.parse(await readFile(new URL("public/f1/tracks/3d/suzuka-metadata.json", root), "utf8"));
const glb = await readFile(new URL("public/f1/tracks/3d/suzuka.glb", root));
const gltf = JSON.parse(glb.toString("utf8", 20, 20 + glb.readUInt32LE(12)));

test("Suzuka compressed delivery meets budgets, textured physical meshes and real surface clearance", async () => {
  const metrics = await validateTrackAsset({ modelId: "suzuka",
    glbPath: new URL("public/f1/tracks/3d/suzuka.glb", root),
    previewPath: new URL("public/f1/tracks/3d/suzuka-preview.webp", root),
    metadataPath: new URL("public/f1/tracks/3d/suzuka-metadata.json", root) });
  assert.deepEqual(metrics.decodedSurfaceAudit.structuralConflicts, {});
  assert.equal(metrics.decodedSurfaceAudit.textures.physicalPrimitives, metrics.decodedSurfaceAudit.textures.texturedPrimitives);
  assert.ok(metrics.decodedSurfaceAudit.minimumBridgeClearanceMeters >= 4.5);
});

test("Suzuka replaces the schematic model with a closed lap at native metre scale", async () => {
  assert.equal(model.id, "suzuka");
  assert.equal(model.data.lapLengthKm, 5.807);
  assert.equal(model.camera.verticalExaggeration, 1);
  assert.equal(metadata.coordinateReferenceSystem, "EPSG:32653");
  const { points, turns } = model.data;
  assert.deepEqual(points.at(-1), [1, ...points[0].slice(1)]);
  assert.equal(points.length, 181);
  assert.ok(points.every((p, i) => p.every(Number.isFinite) && (i === 0 || p[0] > points[i - 1][0])));
  assert.deepEqual(turns.map((t) => t.number), Array.from({ length: 18 }, (_, i) => i + 1));
  assert.ok(turns.every((t, i) => t.progress > (turns[i - 1]?.progress ?? 0) && t.progress < 1));
  for (const alias of [model.data.circuitName, ...model.aliases]) assert.equal(getThreeDimensionalTrackModelId(alias), "suzuka");
  assert.ok((await stat(new URL("src/data/suzuka-model.ts", root))).size < 25_000);
  const lazy = await readFile(new URL("src/components/racemate/track-model-3d-lazy.tsx", root), "utf8");
  assert.match(lazy, /case "suzuka":\s*return \(await import\("@\/data\/suzuka-model"\)\)\.SUZUKA_TRACK_MODEL/);
  const generator = await readFile(new URL("scripts/generate-past-track-models.mjs", root), "utf8");
  assert.match(generator, /track\.id === "suzuka"\) continue/);
});

test("Suzuka anchors follow the FIA 2026 controls and preserve distinct start lines", () => {
  const nodes = new Map(gltf.nodes.map((node) => [node.name, node]));
  assert.equal(nodes.get("StartFinish").extras.distance_m, 0);
  assert.ok(nodes.get("RaceStart").extras.distance_m > 100);
  assert.deepEqual(metadata.sectorBoundaryDistancesMeters, [2184, 4710]);
  assert.equal(metadata.controlPointReference.referenceYear, 2026);
  assert.equal(metadata.objects.pitGarageBoxes, 55);
  assert.equal(metadata.objects.grandstandFootprints, 29);
  assert.equal(metadata.objects.wheel.osmWayId, 184107083);
  assert.ok(metadata.layoutQuality.buildings.rendered.some((b) => b.osmWayId === 184422099));
  for (const turn of model.data.turns) {
    assert.ok(Math.abs(nodes.get(`Turn_${String(turn.number).padStart(2, "0")}`).extras.distance_m - turn.progress * metadata.lapLength.geometryMeters) < .01);
  }
  assert.ok(Math.abs(nodes.get("SpeedTrap").extras.distance_m - metadata.controlPointReference.speedTrapDistanceMeters) < .001);
  for (const [i, d] of metadata.sectorBoundaryDistancesMeters.entries()) assert.ok(Math.abs(nodes.get(`SectorBoundary_0${i + 2}`).extras.distance_m - d) < .001);
});

test("Suzuka sources are pinned and disclose reconstruction limits", async () => {
  const lock = JSON.parse(await readFile(new URL("docs/track-model-suzuka-source-manifest.json", root), "utf8"));
  assert.deepEqual(metadata.sourceManifest.sources, lock.sources);
  assert.ok(lock.sources.length >= 300);
  for (const source of lock.sources) {
    assert.ok(source.url && source.license && source.role && source.crs && source.retrievedAt);
    assert.match(source.sha256, /^[a-f0-9]{64}$/);
    assert.ok(source.bytes > 0);
  }
  assert.ok(lock.sources.some((s) => /fia-2026/.test(s.file)));
  assert.ok(lock.sources.some((s) => /dem5a_png/.test(s.file)));
  assert.ok(metadata.layoutQuality.bridge.tunnelHeightEstimated);
  assert.ok(metadata.limitations.some((value) => /acquisition date/.test(value)));
});

test("Suzuka images contain detail and client asset revisions match the delivery", async () => {
  const length = glb.readUInt32LE(12), binary = glb.subarray(length + 28);
  for (const image of gltf.images) {
    const view = gltf.bufferViews[image.bufferView];
    assert.ok(view);
    const pixels = sharp(binary.subarray(view.byteOffset, view.byteOffset + view.byteLength));
    const dimensions = await pixels.metadata();
    assert.ok(dimensions.width >= 64 && dimensions.height >= 64);
    const stats = await pixels.stats();
    assert.ok(stats.channels.some((channel) => channel.stdev > 1), `${image.name} must retain visible texture detail`);
  }
  const hash = (value) => createHash("sha256").update(value).digest("hex").slice(0, 12);
  assert.equal(new URL(model.webgl.assetPath, "https://raceside.test").searchParams.get("v"), hash(glb));
  const preview = await readFile(new URL("public/f1/tracks/3d/suzuka-preview.webp", root));
  assert.equal(new URL(model.webgl.previewPath, "https://raceside.test").searchParams.get("v"), hash(preview));
});

test("Suzuka canopy colors preserve the source photograph without a repeated gamma conversion", async () => {
  await MeshoptDecoder.ready;
  const binary = glb.subarray(glb.readUInt32LE(12) + 28);
  const image = gltf.images.find((image) => image.name === "suzuka-orthophoto");
  const imageView = gltf.bufferViews[image.bufferView];
  // The first mapped OSM tree at E 641167.897, N 3856465.774.
  const { data } = await sharp(binary.subarray(imageView.byteOffset, imageView.byteOffset + imageView.byteLength))
    .extract({ left: 2827, top: 1364, width: 1, height: 1 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const expected = [...data].map((v) => v / 255).map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  const primitive = gltf.meshes.find((mesh) => mesh.name === "Suzuka_Vegetation_Mesh").primitives[0];
  const accessor = gltf.accessors[primitive.attributes.COLOR_0], view = gltf.bufferViews[accessor.bufferView];
  const compression = view.extensions.EXT_meshopt_compression;
  const decoded = new Uint8Array(compression.count * compression.byteStride);
  MeshoptDecoder.decodeGltfBuffer(decoded, compression.count, compression.byteStride,
    binary.subarray(compression.byteOffset, compression.byteOffset + compression.byteLength), compression.mode, compression.filter);
  const values = new DataView(decoded.buffer);
  assert.equal(accessor.componentType, 5126);
  const stride = view.byteStride ?? (accessor.type === "VEC4" ? 16 : 12);
  const firstTreeColors = Array.from({ length: Math.min(accessor.count, 100) }, (_, row) =>
    expected.map((_, axis) => values.getFloat32((accessor.byteOffset ?? 0) + row * stride + axis * 4, true)));
  assert.ok(firstTreeColors.some((color) => color.every((value, i) => Math.abs(value - expected[i]) < .002)),
    "The delivered tree must use the sampled GSI color converted to linear space once");
});
