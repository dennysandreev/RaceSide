import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import sharp from "sharp";

import { SHANGHAI_TRACK_MODEL as model } from "./shanghai-model.ts";
import { getThreeDimensionalTrackModelId } from "./track-models.ts";
import { validateTrackAsset } from "../../scripts/track-model-blender/validate-track.mjs";

const root = new URL("../../", import.meta.url);
const assetUrl = new URL("public/f1/tracks/3d/shanghai.glb", root);
const previewUrl = new URL("public/f1/tracks/3d/shanghai-preview.webp", root);
const metadataUrl = new URL("public/f1/tracks/3d/shanghai-metadata.json", root);
const metadata = JSON.parse(await readFile(metadataUrl, "utf8"));
const glb = await readFile(assetUrl);
const gltf = JSON.parse(glb.toString("utf8", 20, 20 + glb.readUInt32LE(12)));

test("Shanghai delivered meshes meet budgets, texture and surface-clearance requirements", async () => {
  const metrics = await validateTrackAsset({ modelId: "shanghai", glbPath: assetUrl,
    previewPath: previewUrl, metadataPath: metadataUrl });
  assert.deepEqual(metrics.decodedSurfaceAudit.structuralConflicts, {});
  assert.equal(metrics.decodedSurfaceAudit.textures.physicalPrimitives,
    metrics.decodedSurfaceAudit.textures.texturedPrimitives);
  assert.ok(metrics.decodedSurfaceAudit.road.maximumGradePercent < 6);
  assert.ok(metrics.decodedSurfaceAudit.minimumBridgeClearanceMeters >= 4.5);
});

test("Shanghai uses a closed native-metre lap and resolves through the existing lazy loader", async () => {
  assert.equal(model.id, "shanghai");
  assert.equal(model.data.lapLengthKm, 5.451);
  assert.equal(model.camera.verticalExaggeration, 1);
  assert.equal(model.webgl.elevationApproximate, true);
  assert.equal(metadata.coordinateReferenceSystem, "EPSG:32651");
  const { points, turns } = model.data;
  assert.deepEqual(points.at(-1), [1, ...points[0].slice(1)]);
  assert.equal(points.length, 181);
  assert.ok(points.every((p, i) => p.every(Number.isFinite) && (i === 0 || p[0] > points[i - 1][0])));
  assert.deepEqual(turns.map((t) => t.number), Array.from({ length: 16 }, (_, i) => i + 1));
  assert.ok(turns.every((t, i) => t.progress > (turns[i - 1]?.progress ?? 0) && t.progress < 1));
  for (const alias of [model.data.circuitName, ...model.aliases]) assert.equal(getThreeDimensionalTrackModelId(alias), "shanghai");
  assert.ok((await stat(new URL("src/data/shanghai-model.ts", root))).size < 25_000);
  const lazy = await readFile(new URL("src/components/racemate/track-model-3d-lazy.tsx", root), "utf8");
  assert.match(lazy, /case "shanghai":\s*return \(await import\("@\/data\/shanghai-model"\)\)\.SHANGHAI_TRACK_MODEL/);
  const generator = await readFile(new URL("scripts/generate-past-track-models.mjs", root), "utf8");
  assert.match(generator, /track\.id === "shanghai"\) continue/);
});

test("Shanghai anchors preserve FIA 2026 sectors, turns, trap and distinct start lines", () => {
  const nodes = new Map(gltf.nodes.map((node) => [node.name, node]));
  assert.equal(nodes.get("StartFinish").extras.distance_m, 0);
  assert.equal(nodes.get("RaceStart").extras.distance_m, 130);
  assert.deepEqual(metadata.sectorBoundaryDistancesMeters, [1430, 2999]);
  assert.equal(metadata.controlPointReference.referenceYear, 2026);
  assert.equal(metadata.objects.pitGarageBoxes, 33);
  assert.equal(metadata.objects.fiaGarageBays, 3);
  assert.equal(metadata.objects.grandstandFootprints, 17);
  assert.equal(metadata.objects.overWaterPavilions, 26);
  assert.equal(metadata.objects.mainComplex.bridges.length, 2);
  for (const turn of model.data.turns) {
    assert.ok(Math.abs(nodes.get(`Turn_${String(turn.number).padStart(2, "0")}`).extras.distance_m
      - turn.progress * metadata.lapLength.geometryMeters) < .01);
  }
  assert.ok(Math.abs(nodes.get("SpeedTrap").extras.distance_m - metadata.controlPointReference.speedTrapDistanceMeters) < .001);
  for (const [i, d] of metadata.sectorBoundaryDistancesMeters.entries()) {
    assert.ok(Math.abs(nodes.get(`SectorBoundary_0${i + 2}`).extras.distance_m - d) < .001);
  }
});

test("Shanghai pins its own sources and discloses historical imagery and reconstruction limits", async () => {
  const lock = JSON.parse(await readFile(new URL("docs/track-model-shanghai-source-manifest.json", root), "utf8"));
  assert.deepEqual(metadata.sourceManifest.sources, lock.sources);
  assert.equal(lock.sources.length, 7);
  for (const source of lock.sources) {
    assert.ok(source.url && source.license && source.role && source.crs && source.retrievedAt);
    assert.match(source.sha256, /^[a-f0-9]{64}$/);
    assert.ok(source.bytes > 0);
  }
  assert.equal(metadata.assetLicense, "CC BY-SA 4.0");
  assert.equal(metadata.elevationApproximate, true);
  assert.ok(metadata.limitations.some((value) => /2018/.test(value)));
  assert.ok(metadata.limitations.some((value) => /30 m/.test(value)));
  assert.ok(metadata.limitations.some((value) => /motorhomes/.test(value)));
  assert.ok(metadata.rasterRegistration.independentRmsResidualPixels < 6);
  assert.ok(metadata.rasterRegistration.independentMaximumResidualPixels < 8);
  assert.equal(metadata.rasterRegistration.sourceSha256, lock.sources.find((s) => s.file === "skysat-2018.jpg").sha256);
});

test("Shanghai embedded images retain detail and cache revisions match the delivered files", async () => {
  const binary = glb.subarray(glb.readUInt32LE(12) + 28);
  for (const image of gltf.images) {
    const view = gltf.bufferViews[image.bufferView];
    assert.ok(view);
    const pixels = sharp(binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength));
    const dimensions = await pixels.metadata();
    assert.ok(dimensions.width >= 64 && dimensions.height >= 64);
    const stats = await pixels.stats();
    assert.ok(stats.channels.some((channel) => channel.stdev > 1), `${image.name} must retain visible detail`);
  }
  const hash = (value) => createHash("sha256").update(value).digest("hex").slice(0, 12);
  assert.equal(new URL(model.webgl.assetPath, "https://raceside.online").searchParams.get("v"), hash(glb));
  assert.equal(new URL(model.webgl.previewPath, "https://raceside.online").searchParams.get("v"), hash(await readFile(previewUrl)));
  const nextConfig = await readFile(new URL("next.config.ts", root), "utf8");
  assert.ok(nextConfig.includes('{ pathname: "/f1/tracks/3d/shanghai-preview.webp" }'));
});
