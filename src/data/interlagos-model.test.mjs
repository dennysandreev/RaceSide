import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { INTERLAGOS_TRACK_MODEL as model } from "./interlagos-model.ts";
import { getThreeDimensionalTrackModelId } from "./track-models.ts";
import { validateTrackAsset } from "../../scripts/track-model-blender/validate-track.mjs";

const root = new URL("../../", import.meta.url);
const metadata = JSON.parse(await readFile(new URL("public/f1/tracks/3d/interlagos-metadata.json", root), "utf8"));

test("Interlagos compressed delivery has clear roads, textured objects and publication limits", async () => {
  const metrics = await validateTrackAsset({ modelId: "interlagos",
    glbPath: new URL("public/f1/tracks/3d/interlagos.glb", root),
    metadataPath: new URL("public/f1/tracks/3d/interlagos-metadata.json", root),
    previewPath: new URL("public/f1/tracks/3d/interlagos-preview.webp", root) });
  assert.equal(metrics.decodedSurfaceAudit.road.intersections, 0);
  assert.equal(metrics.decodedSurfaceAudit.paint.intersections, 0);
  assert.equal(metrics.decodedSurfaceAudit.turn10Alignment.missingRoadSupport, 0,
    "T10 asphalt must cover both independently traced orthophoto edges");
  assert.ok(metrics.decodedSurfaceAudit.turn10Alignment.samples >= 40);
  assert.deepEqual(metrics.decodedSurfaceAudit.structuralConflicts, {});
  assert.equal(metrics.decodedSurfaceAudit.textures.physicalPrimitives,
    metrics.decodedSurfaceAudit.textures.texturedPrimitives);
});

test("Interlagos timing anchors follow the FIA document and clockwise screen errors cannot hide the lap", () => {
  const { data } = model;
  const lap = metadata.lapLength.geometryMeters;
  assert.deepEqual(data.points.at(-1), [1, ...data.points[0].slice(1)]);
  assert.deepEqual(data.turns.map((turn) => turn.number), Array.from({ length: 15 }, (_, i) => i+1));
  assert.ok(data.turns.every((turn, i) => turn.progress > (data.turns[i-1]?.progress ?? 0)));
  assert.ok(Math.abs((data.turns[3].progress-data.sectorBreaks[0])*lap-168) < .01);
  assert.ok(Math.abs((data.turns[11].progress-data.sectorBreaks[1])*lap-85) < .01);
  assert.ok(Math.abs((data.turns[0].progress-data.speedTrapProgress)*lap-90) < .01);
  const signedArea = data.points.slice(1).reduce((area, p, i) =>
    area+data.points[i][1]*p[2]-p[1]*data.points[i][2], 0)/2;
  assert.ok(signedArea > 0, "Interlagos racing direction must be counterclockwise in east/north coordinates");
  assert.equal(data.lapLengthKm, 4.309);
  assert.ok(data.elevationChangeM > 35 && data.elevationChangeM < 55);
  assert.equal(model.camera.verticalExaggeration, 1);
});

test("Interlagos provenance discloses historical imagery, unverified event structures and vertical datum", async () => {
  const lock = JSON.parse(await readFile(new URL("docs/track-model-interlagos-source-manifest.json", root), "utf8"));
  assert.deepEqual(metadata.sourceManifest.sources, lock.sources);
  const corridorBytes = await readFile(new URL("docs/track-model-interlagos-t10-corridor.json", root));
  const corridor = JSON.parse(corridorBytes);
  assert.equal(metadata.layoutQuality.roadCorridor.sha256, createHash("sha256").update(corridorBytes).digest("hex"));
  assert.deepEqual(metadata.layoutQuality.roadCorridor.source, corridor);
  assert.equal(corridor.sourceSha256, lock.sources.find((source) => source.file === corridor.sourceFile).sha256);
  for (const source of lock.sources) {
    for (const field of ["url", "role", "license", "attribution", "retrievedAt", "bbox", "crs", "verticalDatum", "resolution"]) assert.ok(source[field]);
    assert.match(source.sha256, /^[0-9a-f]{64}$/);
    assert.ok(source.bytes > 0);
  }
  assert.equal(metadata.controlPointReference.referenceYear, 2025);
  assert.equal(metadata.controlPointReference.currentEventVerified, false);
  assert.match(metadata.limitations.join(" "), /temporary 2026.*omitted/);
  assert.match(metadata.verticalDatum, /unknown/);
  assert.deepEqual(metadata.materials.curbColors, ["green", "yellow", "white"]);
  assert.equal(metadata.objects.pitGarageBoxes, 24);
  assert.equal(metadata.layoutQuality.buildings.pitRoofMembraneBays, 24);
  assert.ok(new Set(metadata.layoutQuality.buildings.rendered.map((b) => b.roofColor.join(","))).size > 100);
});

test("Brazil replaces its old map through the common lazy viewer and content-hashed assets", async () => {
  for (const alias of ["Интерлагос", "Жозе Карлос Пасе", "Autódromo José Carlos Pace", "Brazil", "Гран-при Бразилии", "São Paulo Grand Prix"]) {
    assert.equal(getThreeDimensionalTrackModelId(alias), "interlagos");
  }
  const lazy = await readFile(new URL("src/components/racemate/track-model-3d-lazy.tsx", root), "utf8");
  assert.match(lazy, /import\("@\/data\/interlagos-model"\)/);
  const registry = await readFile(new URL("src/data/track-models.ts", root), "utf8");
  assert.doesNotMatch(registry, /import.*interlagos-model/);
  const imageConfig = await readFile(new URL("next.config.ts", root), "utf8");
  assert.match(imageConfig, /pathname: "\/f1\/tracks\/3d\/interlagos-preview\.webp"/);
  for (const [field, name] of [["assetPath", "interlagos.glb"], ["previewPath", "interlagos-preview.webp"]]) {
    const bytes = await readFile(new URL(`public/f1/tracks/3d/${name}`, root));
    assert.equal(new URL(model.webgl[field], "https://raceside.test").searchParams.get("v"), createHash("sha256").update(bytes).digest("hex").slice(0, 12));
  }
});
