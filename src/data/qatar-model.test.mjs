import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { QATAR_TRACK_MODEL } from "./qatar-model.ts";
import { getThreeDimensionalTrackModelId } from "./track-models.ts";
import { validateTrackAsset } from "../../scripts/track-model-blender/validate-track.mjs";

const root = new URL("../../", import.meta.url);
const json = (name) => readFile(new URL(name, root), "utf8").then(JSON.parse);

test("Lusail, Losail and Qatar use the lazy Qatar model", async () => {
  for (const name of ["Lusail International Circuit", "Losail International Circuit", "Гран-при Катара", "Лусайл"]) {
    assert.equal(getThreeDimensionalTrackModelId(name), "qatar");
  }
  const registry = await readFile(new URL("src/data/track-models.ts", root), "utf8");
  const loader = await readFile(new URL("src/components/racemate/track-model-3d-lazy.tsx", root), "utf8");
  assert.doesNotMatch(registry, /from ["']@\/data\/qatar-model/);
  assert.match(loader, /import\(["']@\/data\/qatar-model["']\)/);
});

test("Qatar has a closed metric loop, sixteen ordered turns and three sectors", () => {
  const { data, camera, webgl } = QATAR_TRACK_MODEL;
  assert.equal(data.lapLengthKm, 5.419);
  assert.equal(camera.verticalExaggeration, 1);
  assert.equal(webgl.turnCount, 16);
  assert.equal(webgl.elevationApproximate, true);
  assert.equal(data.points[0][0], 0);
  assert.deepEqual(data.points.at(-1), [1, ...data.points[0].slice(1)]);
  assert.ok(data.points.flat().every(Number.isFinite));
  assert.deepEqual(data.turns.map((t) => t.number), Array.from({ length: 16 }, (_, i) => i + 1));
  assert.ok(data.turns.every((t, i) => t.progress > (i ? data.turns[i-1].progress : 0) && t.progress < 1));
  assert.ok(data.sectorBreaks[0] > data.turns[4].progress && data.sectorBreaks[0] < data.turns[5].progress);
  assert.ok(data.sectorBreaks[1] > data.turns[10].progress && data.sectorBreaks[1] < data.turns[11].progress);
  assert.ok(data.speedTrapProgress < data.turns[0].progress);
});

test("FIA 2025 controls stay qualified until the 2026 sporting map is published", async () => {
  const metadata = await json("public/f1/tracks/3d/qatar-metadata.json");
  const controls = metadata.controlPointReference;
  const length = metadata.lapLength.geometryMeters;
  assert.equal(controls.referenceYear, 2025);
  assert.equal(controls.currentEventVerified, false);
  assert.ok(Math.abs(QATAR_TRACK_MODEL.data.turns[0].progress * length - controls.speedTrapDistanceMeters - 205) < .01);
  assert.ok(Math.abs(QATAR_TRACK_MODEL.data.turns[5].progress * length - metadata.sectorBoundaryDistancesMeters[0] - 80) < .01);
  assert.ok(Math.abs(QATAR_TRACK_MODEL.data.turns[11].progress * length - metadata.sectorBoundaryDistancesMeters[1] - 75) < .01);
  assert.ok(metadata.limitations.some((s) => /10 m resolution/.test(s)));
  assert.ok(metadata.limitations.some((s) => /heights.*estimates/.test(s)));
});

test("Qatar source pins include current licensed imagery and independent colour references", async () => {
  const lock = await json("docs/track-model-qatar-source-manifest.json");
  const metadata = await json("public/f1/tracks/3d/qatar-metadata.json");
  assert.deepEqual(metadata.sourceManifest.sources, lock.sources);
  for (const source of lock.sources) {
    assert.match(source.sha256, /^[a-f0-9]{64}$/);
    assert.ok(source.bytes > 1000 && source.license && source.crs && source.acquisitionDate);
  }
  const image = lock.sources.find((s) => s.file === "sentinel-20260930.tif");
  assert.equal(image.acquisitionDate, "2026-09-30");
  assert.equal(image.redistributed, true);
  for (const file of ["architect-pit.jpg", "main-grandstand.webp", "event-2026-map.webp"]) {
    assert.equal(lock.sources.find((s) => s.file === file).redistributed, false);
  }
});

test("the delivered compressed Qatar GLB passes geometry, textures and publication limits", async () => {
  const metrics = await validateTrackAsset({ modelId: "qatar",
    glbPath: new URL("public/f1/tracks/3d/qatar.glb", root),
    previewPath: new URL("public/f1/tracks/3d/qatar-preview.webp", root),
    metadataPath: new URL("public/f1/tracks/3d/qatar-metadata.json", root) });
  assert.equal(metrics.animations, 0);
  assert.equal(metrics.decodedSurfaceAudit.textures.physicalPrimitives, metrics.decodedSurfaceAudit.textures.texturedPrimitives);
  assert.deepEqual(metrics.decodedSurfaceAudit.structuralConflicts, {});
});
