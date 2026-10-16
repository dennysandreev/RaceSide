import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { SINGAPORE_TRACK_MODEL as model } from "./singapore-model.ts";
import { getThreeDimensionalTrackModelId } from "./track-models.ts";
import { validateTrackAsset } from "../../scripts/track-model-blender/validate-track.mjs";

const root = new URL("../../", import.meta.url);
const asset = (name) => new URL(`public/f1/tracks/3d/singapore${name}`, root);
const metadata = JSON.parse(await readFile(asset("-metadata.json"), "utf8"));

test("Singapore compressed delivery has clear roads and safe building corridors", async () => {
  const metrics = await validateTrackAsset({ modelId: "singapore", glbPath: asset(".glb"),
    previewPath: asset("-preview.webp"), metadataPath: asset("-metadata.json") });
  assert.equal(metrics.decodedSurfaceAudit.road.intersections, 0);
  assert.equal(metrics.decodedSurfaceAudit.paint.intersections, 0);
  assert.deepEqual(metrics.decodedSurfaceAudit.structuralConflicts, {});
  assert.equal(metrics.decodedSurfaceAudit.bridgeConflicts, 0);
  assert.equal(metrics.decodedSurfaceAudit.bridgeGrandstandConflicts, 0);
  assert.equal(metadata.layoutQuality.grandstands.waterConflicts, 0);
  assert.equal(metadata.objects.bridges.ungroundedInteriorEndpoints, 0);
  assert.equal(metadata.objects.bridges.maximumJointHeightGapMeters, 0);
});

test("Singapore has 19 ordered corners and FIA offset controls in racing direction", () => {
  const { points, turns, sectorBreaks, speedTrapProgress } = model.data;
  assert.deepEqual(points.at(-1), [1, ...points[0].slice(1)]);
  assert.equal(turns.length, 19);
  assert.ok(turns.every((turn, i) => turn.number === i+1 && turn.progress > (turns[i-1]?.progress ?? 0)));
  assert.ok(points[1][2] > points[0][2], "Race proceeds north from the finish to turn one");
  const lap = metadata.lapLength.geometryMeters;
  assert.ok(Math.abs((turns[6].progress-sectorBreaks[0])*lap-150)<.01);
  assert.ok(Math.abs((turns[13].progress-sectorBreaks[1])*lap-140)<.01);
  assert.ok(Math.abs((turns[0].progress-speedTrapProgress)*lap-150)<.01);
  assert.equal(model.data.lapLengthKm, 4.927);
  assert.ok(metadata.lapLength.relativeErrorPercent<.5);
});

test("Reconstructed details and unverified elevations stay disclosed", () => {
  assert.equal(model.camera.verticalExaggeration, 1);
  assert.equal(model.webgl.elevationApproximate, true);
  assert.equal(metadata.verticalDatum, null);
  assert.equal(metadata.controlPointReference.currentEventVerified, false);
  assert.match(metadata.limitations.join(" "), /not a surveyed digital twin/);
  assert.ok(metadata.layoutQuality.buildings.rendered.some(b=>b.osmWayId===49890775));
  for(const id of [116801004,172307471,172307472]) assert.ok(metadata.layoutQuality.buildings.rendered.some(b=>b.osmWayId===id));
  assert.equal(metadata.objects.flyerCapsules, 28);
  assert.ok(metadata.objects.additionalParkTrees >= 300);
  assert.ok(metadata.objects.mappedParkFurniture >= 10);
  assert.equal(metadata.lighting.timeOfDay, "night");
  assert.ok(metadata.layoutQuality.buildings.coplanarCleanup.suppressedParentOutlines > 50);
  // These mapped tower outlines also have explicit 3D parts. Rendering both
  // produced overlapping facades with different window textures.
  for(const id of [46595146,46595147,46595384,46595597]) {
    assert.ok(!metadata.layoutQuality.buildings.rendered.some(b=>b.osmWayId===id));
    assert.ok(metadata.layoutQuality.buildings.rendered.some(b=>b.parentOutlineId===id));
  }
});

test("Singapore resolves lazily and references the exact delivered assets", async () => {
  for(const alias of model.aliases) assert.equal(getThreeDimensionalTrackModelId(alias), "singapore");
  const loader=await readFile(new URL("src/components/racemate/track-model-3d-lazy.tsx",root),"utf8");
  assert.match(loader,/import\("@\/data\/singapore-model"\)/);
  for(const [suffix,url] of [[".glb",model.webgl.assetPath],["-preview.webp",model.webgl.previewPath]]) {
    const hash=createHash("sha256").update(await readFile(asset(suffix))).digest("hex").slice(0,12);
    assert.ok(url.endsWith(`?v=${hash}`));
  }
});
