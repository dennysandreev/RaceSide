import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import sharp from "sharp";

import { ALBERT_PARK_TRACK_MODEL as model } from "./albert-park-model.ts";
import { getThreeDimensionalTrackModelId } from "./track-models.ts";
import { validateTrackAsset } from "../../scripts/track-model-blender/validate-track.mjs";
import { auditAlbertParkSurfaces } from "../../scripts/track-model-blender/audit-albert-park-surfaces.mjs";

const root = new URL("../../", import.meta.url);
const metadata = JSON.parse(await readFile(new URL("public/f1/tracks/3d/albert-park-metadata.json", root), "utf8"));
const glb = await readFile(new URL("public/f1/tracks/3d/albert-park.glb", root));
const jsonLength = glb.readUInt32LE(12);
const gltf = JSON.parse(glb.toString("utf8", 20, 20 + jsonLength));

test("Albert Park T11–T14 follow independent native controls and T14 has no extra exit bend", async () => {
  const audit = await auditAlbertParkSurfaces(glb);
  for (const number of [11, 12, 13, 14]) {
    const corner = audit.reviewedSouthernTurns[number];
    assert.ok(corner.samples >= 9, `T${number} needs complete road cross sections`);
    assert.equal(corner.missingCrossSections, 0);
    assert.ok(corner.maximumAxisDeviationMeters <= 2.4,
      `T${number} axis deviates ${corner.maximumAxisDeviationMeters.toFixed(2)} m from reviewed native controls`);
  }
  assert.ok(audit.reviewedTurn14Exit.samples > 100);
  assert.ok(audit.reviewedTurn14Exit.maximumRoadEdgeDeviationMeters <= 6.4,
    "T14 must meet the native straight without the visitor-map offset blend");
});

test("Albert Park main straight and pit exit stay inside their reviewed road envelopes", async () => {
  const audit = await auditAlbertParkSurfaces(glb);
  assert.ok(audit.reviewedMainStraight.samples > 100);
  assert.ok(audit.reviewedMainStraight.maximumRoadEdgeDeviationMeters <= 6.4,
    `Pit exit must not bend the main straight: ${audit.reviewedMainStraight.maximumRoadEdgeDeviationMeters.toFixed(2)} m`);
  assert.ok(audit.reviewedPitExit.samples > 100);
  assert.ok(audit.reviewedPitExit.maximumOppositeEdgeDeviationMeters <= 6.4,
    "Pit exit must approach the main straight from the pit side without crossing its opposite edge");
  assert.ok(audit.reviewedPitFrontage.samples > 100);
  assert.equal(audit.reviewedPitFrontage.mainRoadOverlapSamples, 0,
    "Pit frontage must occupy the separate lane instead of overlapping the racing surface");
  assert.ok(audit.reviewedRoadJoins.samples > 100);
  assert.ok(audit.reviewedRoadJoins.maximumHeightDifferenceMeters <= .15,
    "The main road and pit lane must share an elevation throughout their junctions");
});

test("Albert Park delivered GLB meets budgets, texture coverage and surface clearance", async () => {
  const metrics = await validateTrackAsset({ modelId: "albert-park",
    glbPath: new URL("public/f1/tracks/3d/albert-park.glb", root),
    previewPath: new URL("public/f1/tracks/3d/albert-park-preview.webp", root),
    metadataPath: new URL("public/f1/tracks/3d/albert-park-metadata.json", root) });
  const audit = metrics.decodedSurfaceAudit;
  assert.deepEqual(audit.structuralConflicts, {});
  assert.equal(audit.textures.physicalPrimitives, audit.textures.texturedPrimitives);
  assert.equal(audit.road.intersections, 0);
  assert.equal(audit.paint.missingSupport, 0);
  assert.ok(audit.reviewedJunction.samples > 30);
  assert.ok(audit.reviewedJunction.maximumRoadEdgeDeviationMeters <= 6.4,
    "The pre-T6 public-road junction must not create a jog in the current racing surface");
  if (audit.bridgeSamples) assert.ok(audit.minimumBridgeClearanceMeters >= 4.5);
});

test("Albert Park replaces the legacy schematic at native metre scale with a closed 14-turn lap", async () => {
  assert.equal(model.id, "albert-park");
  assert.equal(model.data.lapLengthKm, 5.278);
  assert.equal(model.camera.verticalExaggeration, 1);
  assert.equal(metadata.coordinateReferenceSystem, "EPSG:7855");
  assert.equal(metadata.currentLayoutReconstruction.globalScaleApplied, 1);
  assert.match(metadata.currentLayoutReconstruction.source, /organizer current Race Track/);
  assert.ok(metadata.currentLayoutReconstruction.corridorAreaSquareMeters > 50_000);
  assert.ok(metadata.currentLayoutReconstruction.corridorAreaSquareMeters < 85_000);
  const { points, turns } = model.data;
  assert.deepEqual(points.at(-1), [1, ...points[0].slice(1)]);
  assert.equal(points.length, 181);
  assert.ok(points.every((p, i) => p.every(Number.isFinite) && (i === 0 || p[0] > points[i - 1][0])));
  assert.deepEqual(turns.map((t) => t.number), Array.from({ length: 14 }, (_, i) => i + 1));
  assert.ok(turns.every((t, i) => t.progress > (turns[i - 1]?.progress ?? 0) && t.progress < 1));
  for (const alias of [model.data.circuitName, ...model.aliases]) assert.equal(getThreeDimensionalTrackModelId(alias), "albert-park");
  assert.ok((await stat(new URL("src/data/albert-park-model.ts", root))).size < 25_000);
  const lazy = await readFile(new URL("src/components/racemate/track-model-3d-lazy.tsx", root), "utf8");
  assert.match(lazy, /case "albert-park":\s*return \(await import\("@\/data\/albert-park-model"\)\)\.ALBERT_PARK_TRACK_MODEL/);
  const generator = await readFile(new URL("scripts/generate-past-track-models.mjs", root), "utf8");
  assert.match(generator, /if \(track\.id === "albert-park"\) continue/);
});

test("Albert Park anchors retain FIA controls and separate the control line from race start", () => {
  const nodes = new Map(gltf.nodes.map((node) => [node.name, node]));
  assert.equal(nodes.get("StartFinish").extras.distance_m, 0);
  assert.ok(nodes.get("RaceStart").extras.distance_m > 0);
  assert.equal(metadata.controlPointReference.referenceYear, 2026);
  assert.deepEqual(metadata.controlPointReference.sectorLengthsMeters, [1753, 1413, 2112]);
  assert.equal(metadata.objects.pitGarageBoxes, 45);
  assert.equal(metadata.layoutQuality.pitLane.numberedBoxes, 41);
  assert.equal(metadata.layoutQuality.pitLane.letteredBoxes, 4);
  assert.ok(metadata.objects.grandstandFootprints >= 17);
  assert.ok(metadata.layoutQuality.buildings.rendered.some((b) => b.osmWayId === 321789093));
  const length = metadata.lapLength.geometryMeters;
  assert.ok(Math.abs(model.data.turns[5].progress * length - metadata.sectorBoundaryDistancesMeters[0] - 120) < .01);
  assert.ok(Math.abs(model.data.turns[8].progress * length - metadata.sectorBoundaryDistancesMeters[1] - 140) < .01);
  assert.ok(Math.abs(model.data.turns[0].progress * length - nodes.get("SpeedTrap").extras.distance_m - 120) < .01);
  for (const turn of model.data.turns) assert.ok(Math.abs(nodes.get(`Turn_${String(turn.number).padStart(2, "0")}`).extras.distance_m - turn.progress * length) < .01);
});

test("Albert Park pins source provenance and explicitly discloses imagery age and reconstruction estimates", async () => {
  const lock = JSON.parse(await readFile(new URL("docs/track-model-albert-park-source-manifest.json", root), "utf8"));
  assert.deepEqual(metadata.sourceManifest.sources, lock.sources);
  for (const source of lock.sources) {
    assert.ok(source.url && source.license && source.role && source.crs && source.date);
    assert.match(source.sha256, /^[a-f0-9]{64}$/);
    assert.ok(source.bytes > 0);
  }
  assert.ok(lock.sources.some((s) => /vicmap-contours/.test(s.file)));
  assert.ok(lock.sources.some((s) => /skysat/.test(s.file) && /2018/.test(s.date)));
  const photo = metadata.layoutQuality.sourceRasterAudit.photoRegistration;
  assert.equal(photo.controlPoints, 12);
  assert.equal(photo.withheldCheckPoints, 2);
  assert.ok(photo.maximumCheckResidualPixels <= 6,
    "Independent southern photo checkpoints must remain within the reviewed registration envelope");
  assert.equal(photo.roadBandOverpainted, false);
  assert.ok(metadata.limitations.some((s) => /rolling visitor map/.test(s)));
  assert.ok(metadata.limitations.some((s) => /reconstructed estimates/.test(s)));
  assert.match(gltf.asset.copyright, /Planet Labs/);
  assert.match(gltf.asset.copyright, /CC BY-SA 4\.0/);
});

test("Albert Park embeds visible image detail and uses matching asset cache revisions", async () => {
  const binary = glb.subarray(jsonLength + 28);
  for (const image of gltf.images) {
    const view = gltf.bufferViews[image.bufferView];
    assert.ok(view);
    const pixels = sharp(binary.subarray(view.byteOffset, view.byteOffset + view.byteLength));
    const dimensions = await pixels.metadata();
    assert.ok(dimensions.width >= 64 && dimensions.height >= 64);
    const stats = await pixels.stats();
    assert.ok(stats.channels.some((channel) => channel.stdev > 1), `${image.name} must retain texture detail`);
  }
  const hash = (bytes) => createHash("sha256").update(bytes).digest("hex").slice(0, 12);
  assert.equal(new URL(model.webgl.assetPath, "https://raceside.test").searchParams.get("v"), hash(glb));
  const preview = await readFile(new URL("public/f1/tracks/3d/albert-park-preview.webp", root));
  assert.equal(new URL(model.webgl.previewPath, "https://raceside.test").searchParams.get("v"), hash(preview));
});
