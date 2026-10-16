import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { SEPANG_TRACK_MODEL as model } from "./sepang-model.ts";
import { getThreeDimensionalTrackModelId } from "./track-models.ts";
import { validateTrackAsset } from "../../scripts/track-model-blender/validate-track.mjs";
import { loadSepangBuildingColours, verifySepangSources } from "../../scripts/track-model-blender/download-sepang-data.mjs";
import { assembleWays, cumulativeDistances, parseOsmXml, rotateClosedLine, utm47nFromWgs84 } from "../../scripts/track-model-blender/sepang-geometry.mjs";

const root = new URL("../../", import.meta.url);
const metadata = JSON.parse(await readFile(new URL("public/f1/tracks/3d/sepang-metadata.json", root), "utf8"));

test("Sepang delivery asset keeps its texture, anchors, scale and clear driving surfaces", async () => {
  const asset = await readFile(new URL("public/f1/tracks/3d/sepang.glb", root));
  const revision = createHash("sha256").update(asset).digest("hex").slice(0, 12);
  assert.equal(new URL(model.webgl.assetPath, "https://raceside.test").searchParams.get("v"), revision);
  const preview = await readFile(new URL("public/f1/tracks/3d/sepang-preview.webp", root));
  assert.equal(new URL(model.webgl.previewPath, "https://raceside.test").searchParams.get("v"), createHash("sha256").update(preview).digest("hex").slice(0, 12));
  const nextConfig = await readFile(new URL("next.config.ts", root), "utf8");
  assert.match(nextConfig, /\{ pathname: "\/f1\/tracks\/3d\/sepang-preview\.webp" \}/, "versioned preview must be allowed by the Next image optimizer");
  const metrics = await validateTrackAsset({ modelId: "sepang", glbPath: new URL("public/f1/tracks/3d/sepang.glb", root), metadataPath: new URL("public/f1/tracks/3d/sepang-metadata.json", root), previewPath: new URL("public/f1/tracks/3d/sepang-preview.webp", root) });
  assert.equal(metrics.decodedSurfaceAudit.structuralRoadConflicts, 0);
  assert.ok(metrics.decodedSurfaceAudit.paint.minimumClearanceMeters > .01);
  assert.deepEqual(metrics.decodedSurfaceAudit.appearance.missingBuildingColours, []);
  assert.deepEqual(metrics.decodedSurfaceAudit.appearance.missingGrandstandColours, []);
});

test("Sepang roofs retain photographed material families and disclose satellite estimates", async () => {
  const appearance = await loadSepangBuildingColours();
  assert.equal(metadata.buildingAppearance.auditSha256, appearance.auditSha256);
  assert.equal(metadata.buildingAppearance.sourceColorSpace, "sRGB");
  assert.equal(metadata.buildingAppearance.vertexColorSpace, "linear");
  assert.equal(metadata.buildingAppearance.photographsEmbedded, false);
  const buildings = metadata.layoutQuality.buildings.rendered;
  const find = (id) => buildings.find((building) => building.id === id).appearance;
  assert.equal(find(144362328).roofSrgbHex, "#494e4b", "chalets have dark metal roofs in the exterior photograph");
  assert.equal(find(1105232836).roofSrgbHex, "#4a504d", "south paddock roof is dark in the venue photograph");
  assert.equal(find(107364040).roofSrgbHex, "#a26557", "welcome roofs are reddish in Sentinel");
  assert.ok(buildings.every((building) => building.appearance.method.includes("interior")));
  assert.equal(buildings.filter((building) => building.appearance.group === "satellite-roof-proxy").length, 102);
  for (const reference of appearance.references) {
    const source = metadata.sourceManifest.sources.find((source) => source.file === reference.file);
    assert.equal(source.sha256, reference.sha256, reference.id);
    assert.equal(source.bytes, reference.bytes, reference.id);
  }
});

test("Sepang UI uses a closed, clockwise metre path and all fifteen ordered turns", () => {
  const { points, turns, sectorBreaks, speedTrapProgress } = model.data;
  assert.equal(points[0][0], 0);
  assert.deepEqual(points.at(-1), [1, ...points[0].slice(1)]);
  assert.ok(points[1][1] < points[0][1], "main straight must head west from the control line");
  assert.ok(points.every((p) => p.every(Number.isFinite)));
  assert.deepEqual(turns.map((t) => t.number), Array.from({ length: 15 }, (_, i) => i + 1));
  assert.ok(turns.every((t, i) => t.progress > (turns[i - 1]?.progress ?? 0) && t.progress < 1));
  assert.ok(sectorBreaks[0] < turns[3].progress && sectorBreaks[0] > turns[2].progress);
  assert.ok(sectorBreaks[1] > turns[8].progress && sectorBreaks[1] < turns[9].progress);
  assert.ok(speedTrapProgress < turns[14].progress && speedTrapProgress > turns[13].progress);
  assert.equal(model.data.lapLengthKm, 5.543);
  assert.equal(model.camera.verticalExaggeration, 1);
  assert.equal(model.webgl.elevationApproximate, true);
});

test("Sepang embeds 4K mapped materials and preserves the source resolution disclosure", async () => {
  const asset = await readFile(new URL("public/f1/tracks/3d/sepang.glb", root));
  const jsonLength = asset.readUInt32LE(12);
  const gltf = JSON.parse(asset.subarray(20, 20 + jsonLength).toString("utf8"));
  const image = gltf.images.find((image) => image.name === "sepang-ground-surface");
  const view = gltf.bufferViews[image.bufferView];
  const offset = 28 + jsonLength + (view.byteOffset ?? 0);
  const dimensions = await sharp(asset.subarray(offset, offset + view.byteLength)).metadata();
  assert.deepEqual([dimensions.width, dimensions.height], [4096, 2868]);
  const ground = metadata.layoutQuality.terrainSurface;
  assert.equal(ground.sourceResolutionMeters, 10, "4K delivery must not be claimed as a higher resolution satellite source");
  assert.equal(ground.multipolygonHolesPreserved, true);
  assert.ok(ground.sourceRelationIds.includes(21393969), "main asphalt envelope must use its mapped inner ring");
  assert.ok(ground.sourceRelationIds.includes(14729002), "main grandstand mall must have its own mapped surface");
  assert.equal(ground.currentGroundPolygons, ground.sourceWayIds.length + ground.sourceRelationIds.length);
  assert.equal(ground.polygonCounts.gravel, 11);
});

test("Sepang carries pinned source provenance and discloses unverified event details", () => {
  for (const source of metadata.sourceManifest.sources) {
    for (const field of ["url", "license", "attribution", "retrievedAt", "crs", "bboxCrs", "resolution"]) assert.ok(source[field], `${source.file}: ${field}`);
    assert.match(source.sha256, /^[0-9a-f]{64}$/);
    assert.ok(source.bytes > 0 && source.bbox);
  }
  assert.equal(metadata.controlPointReference.referenceYear, 2017);
  assert.equal(metadata.controlPointReference.currentEventVerified, false);
  assert.deepEqual(metadata.controlPointReference.drs, []);
  assert.match(metadata.limitations.join(" "), /30 m.*DEM/);
  assert.match(metadata.limitations.join(" "), /10 m/);
  assert.equal(metadata.publicationStatus, "review-required");
});

test("Sepang resolves lazily without claiming the Bahrain circuit", async () => {
  for (const name of ["Сепанг", "Sepang International Circuit", "Гран-при Малайзии", "Bahrain Grand Prix in Malaysia"]) assert.equal(getThreeDimensionalTrackModelId(name), "sepang");
  assert.notEqual(getThreeDimensionalTrackModelId("Bahrain International Circuit"), "sepang");
  const loader = await readFile(new URL("src/components/racemate/track-model-3d-lazy.tsx", root), "utf8");
  const registry = await readFile(new URL("src/data/track-models.ts", root), "utf8");
  assert.match(loader, /import\("@\/data\/sepang-model"\)/);
  assert.doesNotMatch(registry, /import.*sepang-model/);
});

test("source cache tampering fails instead of silently accepting changed geography", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "sepang-cache-"));
  try {
    const body = Buffer.from("pinned map");
    const manifest = { sources: [{ file: "map.osm", bytes: body.length, sha256: createHash("sha256").update(body).digest("hex") }] };
    await writeFile(path.join(dir, "map.osm"), body);
    await verifySepangSources(dir, manifest);
    await writeFile(path.join(dir, "map.osm"), "edited map");
    await assert.rejects(verifySepangSources(dir, manifest), /source cache changed/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("Sepang source assembly rejects gaps and incomplete OSM snapshots", () => {
  assert.deepEqual(utm47nFromWgs84(0, 99), [500000, 0]);
  const osm = parseOsmXml('<osm><node id="1" lat="2.76" lon="101.738"/><node id="2" lat="2.761" lon="101.738"/><node id="3" lat="2.762" lon="101.739"/><way id="11" version="1"><nd ref="1"/><nd ref="2"/><tag k="highway" v="raceway"/></way><way id="12"><nd ref="3"/><nd ref="1"/></way></osm>');
  assert.throws(() => assembleWays(osm, [11, 12]), /Disconnected/);
  assert.throws(() => assembleWays(osm, [99]), /Missing/);
  assert.throws(() => assembleWays(osm, [11], { closed: true }), /not closed/);
  assert.throws(() => parseOsmXml('<osm><way id="1"><nd ref="9"/></way></osm>'), /Incomplete/);
  const ring = [[0,0],[10,0],[10,10],[0,10],[0,0]];
  const rotated = rotateClosedLine(ring, 3);
  assert.deepEqual(rotated[0], [3,0]);
  assert.deepEqual(rotated.at(-1), rotated[0]);
  assert.equal(cumulativeDistances(rotated).at(-1), 40);
});
